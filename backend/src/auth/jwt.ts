import { Request, Response, NextFunction } from 'express';
import jwt, { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { and, eq } from 'drizzle-orm';
import { env } from '../config/env';
import { db, client } from '../db/index';
import { users } from '../db/schema/index';

export interface AuthenticatedUser {
  id: string;
  email?: string;
  role: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  sessionFamilyId: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

let jwksClientInstance: jwksRsa.JwksClient | null = null;

function getJwksClient(): jwksRsa.JwksClient {
  if (jwksClientInstance) return jwksClientInstance;
  if (!env.AUTH_JWKS_URL) throw new Error('AUTH_JWKS_URL is not configured.');
  jwksClientInstance = jwksRsa({
    jwksUri: env.AUTH_JWKS_URL,
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 10,
  });
  return jwksClientInstance;
}

function getKey(header: JwtHeader, callback: SigningKeyCallback) {
  try {
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
      callback(new Error('Unsupported signing key.'));
      return;
    }
    getJwksClient().getSigningKey(header.kid, (error, key) => {
      if (error) return callback(error);
      callback(null, key?.getPublicKey());
    });
  } catch (error) {
    callback(error instanceof Error ? error : new Error('JWT key lookup failed.'));
  }
}

export function authenticateJwt(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authorization = req.get('Authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Sign in to continue.' });
  }
  if (!env.AUTH_ISSUER || !env.AUTH_JWKS_URL) {
    return res.status(503).json({ error: 'AUTH_UNAVAILABLE', message: 'Account services are temporarily unavailable.' });
  }

  jwt.verify(token, getKey, {
    algorithms: ['RS256'],
    issuer: env.AUTH_ISSUER,
    audience: 'simsoccer-api',
  }, async (error, decoded) => {
    if (error || !decoded || typeof decoded === 'string') {
      const invalidToken = error?.name === 'JsonWebTokenError'
        || error?.name === 'TokenExpiredError'
        || error?.name === 'NotBeforeError';
      return res.status(invalidToken ? 401 : 503).json({
        error: invalidToken ? 'INVALID_TOKEN' : 'AUTH_UNAVAILABLE',
        message: invalidToken ? 'Sign in to continue.' : 'Account services are temporarily unavailable.',
      });
    }
    const claims = decoded as jwt.JwtPayload;
    if (
      typeof claims.sub !== 'string'
      || typeof claims.email !== 'string'
      || typeof claims.role !== 'string'
      || typeof claims.sid !== 'string'
    ) {
      return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Sign in to continue.' });
    }

    try {
      const [account] = await client<{ role: string; active: boolean }[]>`
        SELECT u.role,
               EXISTS (
                 SELECT 1 FROM auth_sessions
                 WHERE family_id = ${claims.sid}
                   AND user_id = ${claims.sub}
                   AND revoked_at IS NULL
                   AND expires_at > now()
               ) AS active
        FROM users u
        WHERE u.id = ${claims.sub} AND u.is_email_verified = true
        LIMIT 1
      `;
      if (!account?.active) {
        return res.status(401).json({ error: 'SESSION_EXPIRED', message: 'Your session has expired. Sign in again.' });
      }
      req.user = {
        id: claims.sub,
        email: claims.email,
        role: account.role,
        sessionFamilyId: claims.sid,
      };
      return next();
    } catch {
      return res.status(503).json({ error: 'AUTH_UNAVAILABLE', message: 'Account services are temporarily unavailable.' });
    }
  });
}

export function requireRole(allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Your account cannot perform this action.' });
    }
    return next();
  };
}

export function requireLocalAccount(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required.' });
  }

  db.select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, req.user.id), eq(users.isEmailVerified, true)))
    .limit(1)
    .then(([account]) => {
      if (!account) {
        return res.status(403).json({ error: 'ACCOUNT_NOT_READY', message: 'Complete account setup before betting.' });
      }
      return next();
    })
    .catch(() => res.status(503).json({ error: 'ACCOUNT_UNAVAILABLE', message: 'Account services are temporarily unavailable.' }));
}
