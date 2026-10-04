import { createClient, type User } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
import { env } from './env.js';

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

export type VerifiedIdentity = {
  id: string;
  email: string;
  emailVerified: true;
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
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      res.status(error?.status && error.status >= 500 ? 503 : 401).json({
        error: error?.status && error.status >= 500 ? 'AUTH_UNAVAILABLE' : 'UNAUTHORIZED',
        message: error?.status && error.status >= 500 ? 'Account services are temporarily unavailable.' : 'Sign in to continue.',
      });
      return;
    }

    const identity = verifiedIdentity(data.user);
    if (!identity) {
      res.status(403).json({ error: 'EMAIL_NOT_VERIFIED', message: 'Verify your email before continuing.' });
      return;
    }

    req.identity = identity;
    next();
  } catch {
    res.status(503).json({ error: 'AUTH_UNAVAILABLE', message: 'Account services are temporarily unavailable.' });
  }
}

export function verifiedIdentity(user: User): VerifiedIdentity | null {
  const email = user.email?.trim().toLowerCase();
  if (!user.id || !email || !(user.email_confirmed_at || user.confirmed_at)) return null;
  return { id: user.id, email, emailVerified: true };
}