import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, client } from './index';
import { verifySafeDatabase } from './guard';

async function runMigrate() {
  try {
    verifySafeDatabase('Database Drizzle Versioned Migrations');

    console.log('🚀 Executing versioned Drizzle migrations from ./drizzle...');
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('✅ Drizzle versioned migrations applied successfully.');

    await client.end();
    process.exit(0);
  } catch (err: any) {
    console.error('❌ Migration failed:', err.message || err);
    await client.end();
    process.exit(1);
  }
}

runMigrate();
