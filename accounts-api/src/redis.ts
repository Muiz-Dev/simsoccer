import { Redis } from 'ioredis';
import { env } from './env.js';

export const redis = env.REDIS_URL
  ? new Redis(env.REDIS_URL, {
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      tls: env.REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    })
  : null;

export async function verifyRedis(): Promise<void> {
  if (env.NODE_ENV === 'production' && !redis) {
    throw new Error('Redis is required for the production account API.');
  }
  if (redis && await redis.ping() !== 'PONG') {
    throw new Error('Redis readiness check failed.');
  }
}