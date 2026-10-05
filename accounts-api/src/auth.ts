import type { NextFunction, Request, Response } from 'express';
import type { JWTPayload } from 'jose';
import { database } from './database.js';
import { verifyAccessToken } from './auth-crypto.js';

export type VerifiedIdentity = {
  id: string;
  email: string;
  emailVerified: true;
  role: string;
  sessionFamilyId: string;
};

export type AuthenticatedRequest = Request & { identity?: VerifiedIdentity };

export async function requireVerifiedIdentity(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authorization = req.get('Authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Sign in to continue.' });
    return;
  }

  try {
    const { payload } = await verifyAccessToken(token);
    if (!isValidIdentity(payload)) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Sign in to continue.' });
      return;
    }
    const [account] = await database<{ email: string; role: string; active: boolean; account_status: string }[]>`
      SELECT email, role, is_email_verified AS active, account_status
      FROM users WHERE id = ${payload.sub} LIMIT 1
    `;
    if (!account?.active) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Sign in to continue.' });
      return;
    }
    if (account.account_status !== 'ACTIVE') {
      res.status(403).json({ error: 'ACCOUNT_SUSPENDED', message: 'This account is unavailable. Contact support for help.' });
      return;
    }
    const [session] = await database<{ active: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM auth_sessions
        WHERE family_id = ${payload.sid}
          AND user_id = ${payload.sub}
          AND revoked_at IS NULL
          AND expires_at > now()
      ) AS active
    `;
    if (!session?.active) {
      res.status(401).json({ error: 'SESSION_EXPIRED', message: 'Your session has expired. Sign in again.' });
      return;
    }
    req.identity = {
      id: payload.sub,
      email: account.email,
      emailVerified: true,
      role: account.role,
      sessionFamilyId: payload.sid,
    };
    next();
  } catch (error) {
    if (error instanceof Error && (error.name.startsWith('JWT') || error.name.startsWith('JWS'))) {
      res.status(401).json({ error: 'SESSION_EXPIRED', message: 'Your session has expired. Sign in again.' });
      return;
    }
    console.error('Access token validation failed.', {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    res.status(503).json({ error: 'AUTH_UNAVAILABLE', message: 'Account services are temporarily unavailable.' });
  }
}

function isValidIdentity(payload: JWTPayload): payload is JWTPayload & {
  sub: string;
  email: string;
  role: string;
  sid: string;
} {
  return typeof payload.sub === 'string'
    && typeof payload.email === 'string'
    && typeof payload.role === 'string'
    && typeof payload.sid === 'string';
}
