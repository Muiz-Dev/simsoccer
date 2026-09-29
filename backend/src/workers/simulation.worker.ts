import { Worker, Job } from 'bullmq';
import { redisConnection, SIMULATION_QUEUE_NAME, SETTLEMENT_QUEUE_NAME } from './queues';
import { MatchEngine } from '../simulation/match-engine';
import { processPostMatchEvolution } from '../simulation/evolution';
import { settleFixtureBets } from '../betting/settlement';
import { db } from '../db/index';
import { fixtures, matches, matchEvents, matchStatistics, simulationRuns } from '../db/schema/index';
import { eq } from 'drizzle-orm';

/**
 * BullMQ Worker for processing live/scheduled match simulation jobs.
 */
export const simulationWorker = new Worker(
  SIMULATION_QUEUE_NAME,
  async (job: Job) => {
    const { fixtureId, input } = job.data;
    console.log(`\n⚙️ [WORKER] Processing match simulation job for fixture '${fixtureId}'...`);

    // Record simulation run
    const [simRun] = await db.insert(simulationRuns).values({
      fixtureId,
      simulationVersion: input.simulationVersion || '1.0.0',
      seed: input.seed || 'seed-123',
      status: 'RUNNING',
    }).returning();

    try {
      const engine = new MatchEngine(input);
      const result = engine.simulate();

      // Persist Match Result
      await db.insert(matches).values({
        fixtureId,
        seed: input.seed || 'seed-123',
        simulationVersion: input.simulationVersion || '1.0.0',
        homeScore: result.homeScore,
        awayScore: result.awayScore,
        status: 'FINISHED',
        resultHash: result.resultHash,
        timelineHash: result.timelineHash,
      });

      // Persist Match Events
      for (const ev of result.events) {
        await db.insert(matchEvents).values({
          fixtureId,
          sequence: ev.sequence,
          virtualMinute: ev.virtualMinute,
          virtualSecond: ev.virtualSecond,
          eventType: ev.eventType,
          teamId: ev.teamId,
          playerId: ev.playerId,
          metadata: ev.metadata,
        });
      }

      // Persist Final Match Statistics
      await db.insert(matchStatistics).values({
        fixtureId,
        homeShots: result.finalState.homeShots,
        awayShots: result.finalState.awayShots,
        homeShotsOnTarget: result.finalState.homeShotsOnTarget,
        awayShotsOnTarget: result.finalState.awayShotsOnTarget,
        homeCorners: result.finalState.homeCorners,
        awayCorners: result.finalState.awayCorners,
        homeFouls: result.finalState.homeFouls,
        awayFouls: result.finalState.awayFouls,
        homeYellowCards: result.finalState.homeYellowCards,
        awayYellowCards: result.finalState.awayYellowCards,
        homeRedCards: result.finalState.homeRedCards,
        awayRedCards: result.finalState.awayRedCards,
      });

      // Update Fixture status
      await db.update(fixtures).set({
        status: 'FINISHED',
        homeScore: result.homeScore,
        awayScore: result.awayScore,
        finishedAt: new Date(),
      }).where(eq(fixtures.id, fixtureId));

      // Post-match ratings & evolution
      await processPostMatchEvolution(result);

      // Trigger Settlement
      await settleFixtureBets(fixtureId);

      await db.update(simulationRuns).set({
        status: 'COMPLETED',
        resultHash: result.resultHash,
        timelineHash: result.timelineHash,
        completedAt: new Date(),
      }).where(eq(simulationRuns.id, simRun.id));

      console.log(`✅ [WORKER] Match simulation & settlement completed for fixture '${fixtureId}'.`);
      return result;
    } catch (err: any) {
      console.error(`❌ [WORKER] Simulation failed for fixture '${fixtureId}':`, err);
      await db.update(simulationRuns).set({ status: 'FAILED', error: err.message }).where(eq(simulationRuns.id, simRun.id));
      throw err;
    }
  },
  { connection: redisConnection }
);
