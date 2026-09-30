import { Worker, Job } from 'bullmq';
import { settleFixtureBets } from '../betting/settlement';
import { redisConnection, SETTLEMENT_QUEUE_NAME } from './queues';

export const settlementWorker = new Worker(
  SETTLEMENT_QUEUE_NAME,
  async (job: Job<{ fixtureId: string }>) => {
    const { fixtureId } = job.data;
    if (!fixtureId) throw new Error('Settlement job is missing its fixture ID.');

    await settleFixtureBets(fixtureId);

    return { fixtureId, settlementCompleted: true };
  },
  { connection: redisConnection, concurrency: 5 }
);