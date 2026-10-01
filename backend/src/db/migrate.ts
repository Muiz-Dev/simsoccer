import { db, client } from './index';
import { runMigrations } from './run-migrations';

async function runMigrate() {
  try {
    await runMigrations();
  } catch (err: any) {
    console.error('❌ Migration failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

runMigrate();
