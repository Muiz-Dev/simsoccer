import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { RedisStore } from 'rate-limit-redis';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuthCapacityError, changePassword, getAccount, authenticatePassword, completePasswordRecovery, createSession, listActiveSessions, register, requestPasswordless, requestPasswordRecovery, refreshSession, revokeAllSessions, revokeRefreshSession, revokeSessionFamily, verifyEmailChallenge, updateAccountProfile } from './auth-service.js';
import { sendPasswordChangedNotice } from './auth-mailer.js';
import { digestSecret, publicJwks } from './auth-crypto.js';
import { requireVerifiedIdentity, type AuthenticatedRequest } from './auth.js';
import { database } from './database.js';
import { env } from './env.js';
import { redis } from './redis.js';
import { challengeSchema, emailSchema, passwordChangeSchema, passwordSchema, profileSchema } from './validation.js';

const allowedOrigins = new Set(env.APP_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean));

function createRedisStore(prefix: string): RedisStore | undefined {
  const client = redis;
  if (!client) return undefined;
  return new RedisStore({
    prefix,
    sendCommand: (command, ...args) => client.call(command, ...args) as Promise<number>,
  });
}

function rateLimitKey(req: Request): string {
  const parsedEmail = emailSchema.safeParse(req.body?.email);
  if (parsedEmail.success) return `email:${digestSecret(parsedEmail.data)}`;
  if (typeof req.body?.challengeId === 'string') {
    return `challenge:${digestSecret(req.body.challengeId)}`;
  }
  const authorization = req.get('Authorization');
  if (authorization?.startsWith('Bearer ')) {
    return `session:${digestSecret(authorization.slice(7))}`;
  }
  return `ip:${ipKeyGenerator(req.ip || 'unknown')}`;
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: createRedisStore('simsoccer:accounts:auth-limit:'),
  keyGenerator: rateLimitKey,
  message: { error: 'TOO_MANY_ATTEMPTS', message: 'Too many sign-in attempts. Try again later.' },
});
const accountWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: createRedisStore('simsoccer:accounts:write-limit:'),
  keyGenerator: rateLimitKey,
  message: { error: 'TOO_MANY_ATTEMPTS', message: 'Too many account requests. Try again later.' },
});
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: createRedisStore('simsoccer:accounts:refresh-limit:'),
  message: { error: 'TOO_MANY_ATTEMPTS', message: 'Too many session refresh requests. Try again later.' },
});

const refreshCookieName = 'ss_refresh';
const deviceCookieName = 'ss_device';

function requestCookie(req: Request, name: string): string | undefined {
  const value = req.get('Cookie')?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!value || value.length > 128) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function cookieOptions(path: string, maxAge: number) {
  return [
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(env.NODE_ENV === 'production' ? ['Secure'] : []),
  ].join('; ');
}

function setSessionCookies(res: Response, refreshToken: string, deviceToken: string): void {
  res.append('Set-Cookie', `${refreshCookieName}=${encodeURIComponent(refreshToken)}; ${cookieOptions('/api/auth', 30 * 24 * 60 * 60)}`);
  res.append('Set-Cookie', `${deviceCookieName}=${encodeURIComponent(deviceToken)}; ${cookieOptions('/', 180 * 24 * 60 * 60)}`);
}

function clearSessionCookies(res: Response): void {
  res.append('Set-Cookie', `${refreshCookieName}=; ${cookieOptions('/api/auth', 0)}`);
}

function getClientIp(req: Request): string | undefined {
  return req.ip || undefined;
}

function genericCodeResponse(challengeId: string, purpose: string) {
  return {
    challengeId,
    purpose,
    message: 'If this address can receive a code, a message is on its way.',
  };
}

function parseEmail(value: unknown) {
  return emailSchema.safeParse(value);
}

async function allowEmailAction(email: string, action: string): Promise<boolean> {
  if (!redis) {
    if (env.NODE_ENV === 'production') throw new Error('Distributed auth rate limiting is unavailable.');
    return true;
  }
  const key = `simsoccer:accounts:auth-email:${action}:${digestSecret(email)}`;
  const count = await redis.eval(
    "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n;",
    1,
    key,
    60 * 60,
  ) as number;
  return count <= 5;
}

function getErrorMetadata(error: unknown): Record<string, string | number> {
  const metadata: Record<string, string | number> = {
    errorName: error instanceof Error ? error.name : typeof error,
  };
  if (typeof error !== 'object' || error === null) return metadata;
  if ('code' in error && (typeof error.code === 'string' || typeof error.code === 'number')) {
    metadata.errorCode = error.code;
  }
  if ('type' in error && typeof error.type === 'string') metadata.errorType = error.type;
  if ('status' in error && typeof error.status === 'number') metadata.errorStatus = error.status;
  else if ('statusCode' in error && typeof error.statusCode === 'number') metadata.errorStatus = error.statusCode;
  return metadata;
}

async function notifyPasswordChanged(email: string): Promise<boolean> {
  try {
    await sendPasswordChangedNotice(email, randomUUID());
    return true;
  } catch (error) {
    console.error('Password-change notification delivery failed.', {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return false;
  }
}

export function createApp() {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin) return callback(null, false);
      return callback(null, allowedOrigins.has(origin));
    },
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
  }));
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/health/live', (_req, res) => res.json({ status: 'live', service: 'simsoccer-accounts' }));
  app.get('/api/health/ready', async (_req, res) => {
    try {
      await database`SELECT is_email_verified FROM users LIMIT 0`;
      await database`SELECT family_id FROM auth_sessions LIMIT 0`;
      if (env.NODE_ENV === 'production' && !redis) throw new Error('Redis unavailable.');
      if (redis && await redis.ping() !== 'PONG') throw new Error('Redis unavailable.');
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'not_ready' });
    }
  });

  app.get('/api/auth/.well-known/jwks.json', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json(publicJwks());
  });

  app.post('/api/auth/signup', authLimiter, async (req, res) => {
    const parsedEmail = parseEmail(req.body?.email);
    const parsedPassword = passwordSchema.safeParse(req.body?.password);
    if (!parsedEmail.success || !parsedPassword.success) {
      res.status(400).json({ error: 'INVALID_SIGNUP', message: 'Enter a valid email and a password of at least 12 characters.' });
      return;
    }
    if (!await allowEmailAction(parsedEmail.data, 'signup')) {
      res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', message: 'Too many account requests. Try again later.' });
      return;
    }
    const challenge = await register(parsedEmail.data, parsedPassword.data);
    res.status(202).json(genericCodeResponse(challenge.challengeId, 'verify'));
  });

  app.post('/api/auth/signin', authLimiter, async (req, res) => {
    const parsedEmail = parseEmail(req.body?.email);
    const parsedPassword = typeof req.body?.password === 'string' && req.body.password.length <= 128
      ? { success: true as const, data: req.body.password }
      : { success: false as const };
    if (!parsedEmail.success || !parsedPassword.success) {
      res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
      return;
    }
    if (!await allowEmailAction(parsedEmail.data, 'signin')) {
      res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', message: 'Too many sign-in attempts. Try again later.' });
      return;
    }
    const result = await authenticatePassword(parsedEmail.data, parsedPassword.data);
    if (!result.challenge) {
      res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
      return;
    }
    const purpose = result.needsVerification ? 'verify' : 'login';
    res.status(202).json(genericCodeResponse(result.challenge.challengeId, purpose));
  });

  app.post('/api/auth/passwordless', authLimiter, async (req, res) => {
    const parsedEmail = parseEmail(req.body?.email);
    if (!parsedEmail.success) {
      res.status(400).json({ error: 'INVALID_EMAIL', message: 'Enter a valid email address.' });
      return;
    }
    if (!await allowEmailAction(parsedEmail.data, 'passwordless')) {
      res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', message: 'Too many sign-in codes requested. Try again later.' });
      return;
    }
    const challenge = await requestPasswordless(parsedEmail.data);
    res.status(202).json(genericCodeResponse(challenge.challengeId, 'passwordless'));
  });

  app.post('/api/auth/verify', authLimiter, async (req, res) => {
    const parsed = challengeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'INVALID_CODE', message: 'Enter the eight-digit code from the email.' });
      return;
    }
    const result = await verifyEmailChallenge(parsed.data.challengeId, parsed.data.code);
    if (!result) {
      res.status(400).json({ error: 'CODE_INVALID_OR_EXPIRED', message: 'That code is invalid or expired. Request a new one.' });
      return;
    }
    const session = await createSession(
      result.user.id,
      requestCookie(req, deviceCookieName),
      req.get('User-Agent'),
      getClientIp(req),
    );
    setSessionCookies(res, session.refreshToken, session.deviceToken);
    res.json({ accessToken: session.accessToken, account: session.account });
  });

  app.post('/api/auth/password-reset/request', authLimiter, async (req, res) => {
    const parsedEmail = parseEmail(req.body?.email);
    if (!parsedEmail.success) {
      res.status(400).json({ error: 'INVALID_EMAIL', message: 'Enter a valid email address.' });
      return;
    }
    if (!await allowEmailAction(parsedEmail.data, 'recovery')) {
      res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', message: 'Too many recovery requests. Try again later.' });
      return;
    }
    const challenge = await requestPasswordRecovery(parsedEmail.data);
    res.status(202).json({
      ...genericCodeResponse(challenge.challengeId, 'recovery'),
      message: 'If this address has an account, a recovery code is on its way.',
    });
  });

  app.post('/api/auth/password-reset/complete', authLimiter, async (req, res) => {
    const parsedCode = challengeSchema.safeParse({
      challengeId: req.body?.challengeId,
      code: req.body?.code,
    });
    const parsedPassword = passwordSchema.safeParse(req.body?.password);
    if (!parsedCode.success || !parsedPassword.success) {
      res.status(400).json({ error: 'INVALID_RECOVERY', message: 'Enter a valid code and a password of at least 12 characters.' });
      return;
    }
    const changedEmail = await completePasswordRecovery(
      parsedCode.data.challengeId,
      parsedCode.data.code,
      parsedPassword.data,
    );
    if (!changedEmail) {
      res.status(400).json({ error: 'CODE_INVALID_OR_EXPIRED', message: 'That code is invalid or expired. Request a new one.' });
      return;
    }
    const notificationSent = await notifyPasswordChanged(changedEmail);
    clearSessionCookies(res);
    res.json({
      message: 'Password updated. Sign in with your new password.',
      notificationSent,
    });
  });

  app.post('/api/auth/password/change', authLimiter, requireVerifiedIdentity, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = passwordChangeSchema.safeParse(req.body ?? {});
    if (!parsed.success || !req.identity) {
      res.status(400).json({ error: 'INVALID_PASSWORD_CHANGE', message: 'Enter your current password and a new password of at least 12 characters.' });
      return;
    }
    const changedEmail = await changePassword(req.identity.id, parsed.data.currentPassword, parsed.data.newPassword);
    if (!changedEmail) {
      res.status(401).json({ error: 'CURRENT_PASSWORD_INVALID', message: 'Your current password is incorrect.' });
      return;
    }
    const notificationSent = await notifyPasswordChanged(changedEmail);
    const session = await createSession(
      req.identity.id,
      requestCookie(req, deviceCookieName),
      req.get('User-Agent'),
      getClientIp(req),
    );
    setSessionCookies(res, session.refreshToken, session.deviceToken);
    res.json({ accessToken: session.accessToken, account: session.account, notificationSent });
  });

  app.post('/api/auth/refresh', refreshLimiter, async (req, res) => {
    const refreshToken = requestCookie(req, refreshCookieName);
    if (!refreshToken) {
      clearSessionCookies(res);
      res.status(401).json({ error: 'SESSION_EXPIRED', message: 'Sign in to continue.' });
      return;
    }
    const result = await refreshSession(refreshToken, req.get('User-Agent'), getClientIp(req));
    if (result.status !== 'ok') {
      clearSessionCookies(res);
      res.status(401).json({ error: 'SESSION_EXPIRED', message: 'Sign in to continue.' });
      return;
    }
    res.append('Set-Cookie', `${refreshCookieName}=${encodeURIComponent(result.refreshToken)}; ${cookieOptions('/api/auth', 30 * 24 * 60 * 60)}`);
    res.json({ accessToken: result.accessToken, account: result.account });
  });

  app.post('/api/auth/logout', async (req, res) => {
    const refreshToken = requestCookie(req, refreshCookieName);
    clearSessionCookies(res);
    if (refreshToken) await revokeRefreshSession(refreshToken);
    res.json({ message: 'Signed out.' });
  });

  app.get('/api/auth/sessions', requireVerifiedIdentity, async (req: AuthenticatedRequest, res: Response) => {
    if (!req.identity) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Sign in to continue.' });
      return;
    }
    res.json({ sessions: await listActiveSessions(req.identity.id, req.identity.sessionFamilyId) });
  });

  app.post('/api/auth/sessions/revoke', requireVerifiedIdentity, async (req: AuthenticatedRequest, res: Response) => {
    const familyId = z.string().uuid().safeParse(req.body?.familyId);
    if (!familyId.success || !req.identity) {
      res.status(400).json({ error: 'INVALID_SESSION', message: 'Choose a valid session.' });
      return;
    }
    await revokeSessionFamily(req.identity.id, familyId.data);
    res.json({ message: 'Session revoked.' });
  });

  app.post('/api/auth/logout-all', requireVerifiedIdentity, async (req: AuthenticatedRequest, res: Response) => {
    if (!req.identity) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Sign in to continue.' });
      return;
    }
    await revokeAllSessions(req.identity.id);
    clearSessionCookies(res);
    res.json({ message: 'Signed out on all devices.' });
  });

  app.get('/api/account/me', requireVerifiedIdentity, async (req: AuthenticatedRequest, res: Response) => {
    if (!req.identity) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Sign in to continue.' });
      return;
    }
    const account = await getAccount(req.identity.id);
    if (!account) {
      res.status(404).json({ error: 'ACCOUNT_NOT_FOUND', message: 'Complete account setup to continue.' });
      return;
    }
    res.json({ account });
  });

  app.patch('/api/account/profile', accountWriteLimiter, requireVerifiedIdentity, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = profileSchema.safeParse(req.body ?? {});
    if (!parsed.success || !req.identity) {
      res.status(400).json({ error: 'INVALID_PROFILE', message: 'Enter your name and accept the terms to continue.' });
      return;
    }
    const account = await updateAccountProfile(req.identity.id, parsed.data);
    if (!account) {
      res.status(404).json({ error: 'ACCOUNT_NOT_FOUND', message: 'Complete account setup to continue.' });
      return;
    }
    res.json({ account });
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    console.error('Account API request failed.', {
      method: req.method,
      path: req.path,
      ...getErrorMetadata(error),
    });
    const status = error instanceof AuthCapacityError ? error.status : 500;
    res.status(status).json({
      error: error instanceof AuthCapacityError ? 'AUTH_BUSY' : 'ACCOUNT_API_ERROR',
      message: 'Account services are temporarily unavailable. Try again shortly.',
    });
  });

  return app;
}
