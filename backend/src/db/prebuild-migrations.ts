import { env } from '../config/env';
import { client } from './index';
import { runMigrations } from './run-migrations';

async function runPrebuildMigrations(): Promise<void> {
  if (!env.MIGRATE_BEFORE_BUILD) {
    console.log('[BUILD] Database migrations skipped (MIGRATE_BEFORE_BUILD is false).');
    return;
  }

  console.log('[BUILD] Applying pending database migrations before TypeScript compilation.');
  try {
    await runMigrations();
  } finally {
    await client.end();
  }
}

void runPrebuildMigrations().catch((error: unknown) => {
  console.error('[BUILD] Prebuild migration failed; TypeScript compilation was not run:', error);
  process.exitCode = 1;
});