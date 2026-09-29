import Redis from 'ioredis';
import { Queue, Worker, Job } from 'bullmq';
import { env } from '../config/env';

export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  tls: env.REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
});

export const SIMULATION_QUEUE_NAME = 'match-simulation';
export const SETTLEMENT_QUEUE_NAME = 'bet-settlement';

export const simulationQueue = new Queue(SIMULATION_QUEUE_NAME, { connection: redisConnection });
export const settlementQueue = new Queue(SETTLEMENT_QUEUE_NAME, { connection: redisConnection });

console.log('⚡ Redis & BullMQ Queues initialized successfully.');
