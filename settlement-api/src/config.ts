import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '../backend/.env') });
dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1).optional(),
  SETTLEMENT_DATABASE_URL: z.string().min(1).optional(),
  SETTLEMENT_PORT: z.coerce.number().int().min(1).max(65535).default(8091),
  SETTLEMENT_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
  SETTLEMENT_ALLOWED_ORIGINS: z.string().default('http://localhost:3000,https://simsoccer.vercel.app'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Settlement service configuration is invalid.', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid settlement service configuration.');
}

const databaseUrl = parsed.data.SETTLEMENT_DATABASE_URL ?? parsed.data.DATABASE_URL;
if (!databaseUrl) {
  console.error('Settlement service requires SETTLEMENT_DATABASE_URL or DATABASE_URL.');
  throw new Error('Settlement database URL is not configured.');
}

export const config = {
  ...parsed.data,
  SETTLEMENT_DATABASE_URL: databaseUrl,
  allowedOrigins: new Set(parsed.data.SETTLEMENT_ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)),
};
