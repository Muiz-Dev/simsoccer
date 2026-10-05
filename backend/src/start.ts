import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import Redis from 'ioredis';
import postgres from 'postgres';
import { env } from './config/env';
import { runMigrations } from './db/run-migrations';

const services: Array<{ name: string; entrypoint: string }> = [
  { name: 'API', entrypoint: 'index.js' },
  { name: 'Simulation worker', entrypoint: 'worker.js' },
  { name: 'World coordinator', entrypoint: 'coordinator.js' },
];

const children: ChildProcess[] = [];
let shuttingDown = false;

async function verifyDependencies(): Promise<void> {
  const database = postgres(env.DATABASE_URL, {
    connect_timeout: 10,
    ssl: env.DATABASE_URL.includes('sslmode=require') ? 'require' : false,
  });
  const redis = new Redis(env.REDIS_URL, {
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });

  try {
    await database`SELECT 1`;
    const pong = await redis.ping();
    if (pong !== 'PONG') throw new Error('Redis ping did not return PONG');
    console.log('✅ [BOOT] PostgreSQL and Redis dependency health checks passed.');
  } catch (err: any) {
    console.error('❌ [BOOT] Dependency verification failed:', err.message);
    throw err;
  } finally {
    redis.disconnect();
    await database.end({ timeout: 5 });
  }
}

function stop(exitCode: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;

  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  }
}

async function start(): Promise<void> {
  await verifyDependencies();
  await runMigrations();
  if (shuttingDown) return;

  for (const service of services) {
    const child = spawn(process.execPath, [path.join(__dirname, service.entrypoint)], {
      stdio: 'inherit',
    });
    children.push(child);
    console.log(`🚀 [SUPERVISOR] Started ${service.name} (${service.entrypoint}).`);

    child.on('error', (error) => {
      console.error(`Failed to start ${service.name}:`, error);
      stop(1);
    });

    child.on('exit', (code, signal) => {
      if (!shuttingDown) {
        console.error(`${service.name} stopped unexpectedly (code ${code}, signal ${signal}).`);
        stop(code ?? 1);
      }
    });
  }

  console.log('✅ [SUPERVISOR] Exactly one API, one World Coordinator, and one Worker running under supervision.');
}

process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));

void start().catch((error) => {
  console.error('Startup checks failed; services were not started:', error);
  process.exitCode = 1;
});
