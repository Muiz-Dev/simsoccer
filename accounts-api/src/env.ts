import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8090),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  SEND_EMAIL_HOOK_SECRET: z.string().optional(),
  APP_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error('Account API configuration is invalid. Check the required environment variable names.');
}

if (parsed.data.NODE_ENV === 'production') {
  const requiredForProduction = [
    parsed.data.REDIS_URL,
    parsed.data.RESEND_API_KEY,
    parsed.data.EMAIL_FROM,
    parsed.data.SEND_EMAIL_HOOK_SECRET,
  ];
  if (requiredForProduction.some((value) => !value)) {
    throw new Error('Production account API requires Redis and configured Resend email-hook settings.');
  }
}

export const env = parsed.data;