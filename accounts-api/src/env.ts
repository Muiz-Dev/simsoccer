import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8090),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  AUTH_PRIVATE_JWK: z.string().min(1).optional(),
  AUTH_ADDITIONAL_PUBLIC_JWKS: z.string().optional(),
  AUTH_ISSUER: z.url().optional(),
  AUTH_TOKEN_PEPPER: z.string().min(32).optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
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
  ];
  if (requiredForProduction.some((value) => !value)) {
    throw new Error('Production account API requires Redis and configured Resend email settings.');
  }
  if (!parsed.data.AUTH_PRIVATE_JWK || !parsed.data.AUTH_ISSUER || !parsed.data.AUTH_TOKEN_PEPPER) {
    throw new Error('Production account API requires AUTH_PRIVATE_JWK, AUTH_ISSUER, and AUTH_TOKEN_PEPPER.');
  }
  if (!parsed.data.AUTH_ISSUER.startsWith('https://')) {
    throw new Error('Production AUTH_ISSUER must use HTTPS.');
  }
} else if (!parsed.data.AUTH_PRIVATE_JWK || !parsed.data.AUTH_ISSUER || !parsed.data.AUTH_TOKEN_PEPPER) {
  throw new Error('Configure AUTH_PRIVATE_JWK, AUTH_ISSUER, and AUTH_TOKEN_PEPPER to start account services.');
}

export const env = parsed.data;