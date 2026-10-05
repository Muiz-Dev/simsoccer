import { Redis } from 'ioredis';
import { env } from './env.js';

export const redis = env.REDIS_URL
  ? new Redis(env.REDIS_URL, {
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
      tls: env.REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    })
  : null;

redis?.on('error', (error: Error) => {
  console.error('Accounts API Redis connection failed.', {
    errorName: error.name,
    ...('code' in error && (typeof error.code === 'string' || typeof error.code === 'number')
      ? { errorCode: error.code }
      : {}),
  });
});

export async function verifyRedis(): Promise<void> {
  if (env.NODE_ENV === 'production' && !redis) {
    throw new Error('Redis is required for the production account API.');
  }
  if (redis && await redis.ping() !== 'PONG') {
    throw new Error('Redis readiness check failed.');
  }
}