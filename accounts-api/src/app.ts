import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { RedisStore } from 'rate-limit-redis';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { AccountConflictError, getAccountBySubject, provisionAccount, updateAccountProfile } from './account-service.js';
import { requireVerifiedIdentity, type AuthenticatedRequest } from './auth.js';
import { database } from './database.js';
import { env } from './env.js';
import { handleSupabaseEmailHook } from './email-hook.js';
import { redis } from './redis.js';
import { profileSchema, provisionSchema } from './validation.js';

const allowedOrigins = new Set(env.APP_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean));
const rateLimitRedis = redis;
const rateLimitStore = rateLimitRedis
  ? new RedisStore({
      prefix: 'simsoccer:accounts:limit:',
      sendCommand: (command, ...args) => rateLimitRedis.call(command, ...args) as Promise<number>,
    })
  : undefined;

const accountWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: rateLimitStore,
  message: { error: 'TOO_MANY_ATTEMPTS', message: 'Too many account requests. Try again later.' },
});

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

  app.post('/api/hooks/supabase/email', express.raw({ type: 'application/json', limit: '64kb' }), handleSupabaseEmailHook);
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/health/live', (_req, res) => res.json({ status: 'live', service: 'simsoccer-accounts' }));
  app.get('/api/health/ready', async (_req, res) => {
    try {
      await database`SELECT auth_subject FROM users LIMIT 0`;
      if (env.NODE_ENV === 'production' && !redis) throw new Error('Redis unavailable.');
      if (redis && await redis.ping() !== 'PONG') throw new Error('Redis unavailable.');
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'not_ready' });
    }
  });

  app.post('/api/account/provision', accountWriteLimiter, requireVerifiedIdentity, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = provisionSchema.safeParse(req.body ?? {});
    if (!parsed.success || !req.identity) {
      res.status(400).json({ error: 'INVALID_ACCOUNT_REQUEST', message: 'Check the account details and try again.' });
      return;
    }
    try {
      const account = await provisionAccount(req.identity, parsed.data.phone ?? '');
      res.status(200).json({ account });
    } catch (error) {
      if (error instanceof AccountConflictError) {
        res.status(409).json({ error: 'ACCOUNT_LINK_REQUIRED', message: error.message });
        return;
      }
      res.status(503).json({ error: 'ACCOUNT_UNAVAILABLE', message: 'Your account could not be prepared right now.' });
    }
  });

  app.get('/api/account/me', requireVerifiedIdentity, async (req: AuthenticatedRequest, res: Response) => {
    if (!req.identity) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Sign in to continue.' });
      return;
    }
    try {
      const account = await getAccountBySubject(req.identity.id);
      if (!account) {
        res.status(404).json({ error: 'ACCOUNT_NOT_PROVISIONED', message: 'Complete account setup to continue.' });
        return;
      }
      res.json({ account });
    } catch {
      res.status(503).json({ error: 'ACCOUNT_UNAVAILABLE', message: 'Account details are temporarily unavailable.' });
    }
  });

  app.patch('/api/account/profile', accountWriteLimiter, requireVerifiedIdentity, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = profileSchema.safeParse(req.body ?? {});
    if (!parsed.success || !req.identity) {
      res.status(400).json({ error: 'INVALID_PROFILE', message: 'Enter your name, phone number, and accept the terms to continue.' });
      return;
    }
    try {
      const account = await updateAccountProfile(req.identity.id, parsed.data);
      if (!account) {
        res.status(404).json({ error: 'ACCOUNT_NOT_PROVISIONED', message: 'Complete account setup to continue.' });
        return;
      }
      res.json({ account });
    } catch {
      res.status(503).json({ error: 'PROFILE_UNAVAILABLE', message: 'Your profile could not be saved right now.' });
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Account API request failed.');
    res.status(500).json({ error: 'ACCOUNT_API_ERROR', message: 'Account services are temporarily unavailable.' });
  });

  return app;
}