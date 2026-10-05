import { createApp } from './app.js';
import { database, verifyDatabase } from './database.js';
import { env } from './env.js';
import { redis, verifyRedis } from './redis.js';
import { cleanupExpiredAuthData } from './auth-service.js';

async function start(): Promise<void> {
  await verifyDatabase();
  await verifyRedis();
  await cleanupExpiredAuthData();
  const cleanupTimer = setInterval(() => {
    void cleanupExpiredAuthData().catch((error: unknown) => {
      console.error('Expired authentication data cleanup failed.', {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    });
  }, 24 * 60 * 60 * 1000);
  cleanupTimer.unref();
  const server = createApp().listen(env.PORT, () => {
    console.log(`SimSoccer accounts API listening on port ${env.PORT}.`);
  });

  const shutdown = async (signal: string) => {
    console.log(`Stopping accounts API after ${signal}.`);
    clearInterval(cleanupTimer);
    server.close(async () => {
      redis?.disconnect();
      await database.end({ timeout: 5 });
      process.exit(0);
    });
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

void start().catch(async () => {
  console.error('Account API dependency checks failed; service was not started.');
  redis?.disconnect();
  await database.end({ timeout: 5 });
  process.exitCode = 1;
});