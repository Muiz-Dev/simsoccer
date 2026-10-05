import postgres from 'postgres';
import { env } from './env.js';

export const database = postgres(env.DATABASE_URL, {
  max: 8,
  idle_timeout: 30,
  connect_timeout: 10,
  ssl: env.DATABASE_URL.includes('sslmode=require') ? 'require' : false,
});

export async function verifyDatabase(): Promise<void> {
  await database`SELECT 1`;
  await database`SELECT is_email_verified FROM users LIMIT 0`;
  await database`SELECT user_id FROM wallets LIMIT 0`;
}