import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './index';
import { verifySafeMigration } from './guard';

export async function runMigrations(): Promise<void> {
  verifySafeMigration('Database Drizzle Versioned Migrations');
  console.log('🚀 Executing versioned Drizzle migrations from ./drizzle...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('✅ Drizzle versioned migrations applied successfully.');
}