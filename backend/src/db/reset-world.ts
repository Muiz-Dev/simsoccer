import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { sql } from 'drizzle-orm';
import { db, client } from './index';
import { wallets } from './schema/index';
import { redisConnection, simulationQueue } from '../workers/queues';
import { seedDatabase } from '../football/seed';
import { env } from '../config/env';

const CONFIRMATION = 'RESET SIMSOCCER WORLD';

async function resetWorld(): Promise<void> {
  if (!env.ALLOW_WORLD_RESET) {
    throw new Error('Set ALLOW_WORLD_RESET=true in the backend environment before running this destructive command.');
  }
  if (!stdin.isTTY) {
    throw new Error('World reset requires an interactive terminal.');
  }

  const target = new URL(env.DATABASE_URL);
  const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ''));
  console.log(`Target database: ${target.hostname}/${databaseName}`);
  console.log('This removes all league/season/match/market/bet data and queue jobs.');
  console.log('It preserves user accounts and admin credentials/sessions/audit history. Existing virtual wallets reset to 10,000.');
  console.log('Take a database backup first. Stop the PM2 runtime before continuing.');

  const terminal = createInterface({ input: stdin, output: stdout });
  let confirmation: string;
  try {
    confirmation = await terminal.question(`Type "${CONFIRMATION}" to continue: `);
  } finally {
    terminal.close();
  }
  if (confirmation !== CONFIRMATION) throw new Error('World reset cancelled; confirmation did not match.');

  await simulationQueue.obliterate({ force: true });
  console.log('Cleared simulation queue.');

  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE public.leagues, public.bets, public.wallet_transactions RESTART IDENTITY CASCADE`);
    const resetWallets = await tx.update(wallets)
      .set({ balance: '10000.00', updatedAt: new Date() })
      .returning({ id: wallets.id });
    console.log(`Cleared world and betting data; reset ${resetWallets.length} virtual wallets.`);
  });

  process.env.EXPLICIT_TEST_DB_CONFIRMED = 'true';
  try {
    await seedDatabase('Season 1');
  } finally {
    delete process.env.EXPLICIT_TEST_DB_CONFIRMED;
  }

  console.log('Fresh Season 1 created. User accounts and admin credentials were preserved.');
}

void resetWorld()
  .catch((error: unknown) => {
    console.error('World reset failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await simulationQueue.close();
    redisConnection.disconnect();
    await client.end();
  });