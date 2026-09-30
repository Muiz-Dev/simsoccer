import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config({ override: true });

const envSchema = z.object({
  PORT: z.string().default('8080').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  SUPABASE_URL: z.string().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  SUPABASE_JWKS_URL: z.string().optional(),

  ALLOW_UNSAFE_DB: z.string().optional().default('false').transform((val) => val === 'true'),
  ALLOW_UNSAFE_SEEDS: z.string().optional().default('false').transform((val) => val === 'true'),

  TICK_RATE_MS: z.string().default('1000').transform((val) => parseInt(val, 10)),
  MATCH_REAL_DURATION_SECONDS: z.string().default('5400').transform((val) => parseInt(val, 10)),
  SIMULATION_WORKER_CONCURRENCY: z.string().default('30').transform((val) => parseInt(val, 10)),
  MARKET_PREPARATION_BUFFER_SECONDS: z.string().default('120').transform((val) => parseInt(val, 10)),
  FIXTURE_KICKOFF_STAGGER_SECONDS: z.string().default('60').transform((val) => parseInt(val, 10)),
  ROUND_BREAK_SECONDS: z.string().default('600').transform((val) => parseInt(val, 10)),
  SIMULATION_VERSION: z.string().default('1.0.0'),

  TEST_DATABASE_URL: z.string().optional(),
  TEST_REDIS_URL: z.string().optional(),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  throw new Error('Invalid environment variables');
}

export const env = _env.data;
