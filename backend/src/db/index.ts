import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config/env';
import * as schema from './schema';

const client = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  ssl: env.DATABASE_URL.includes('supabase.co') || env.DATABASE_URL.includes('sslmode=require') ? 'require' : false,
});

export const db = drizzle(client, { schema });
export { client };
