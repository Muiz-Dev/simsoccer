import { Worker, Job } from 'bullmq';
import crypto from 'crypto';
import { redisConnection, SIMULATION_QUEUE_NAME } from './queues';
import { MatchEngine } from '../simulation/match-engine';
import { processPostMatchEvolution } from '../simulation/evolution';
import { settleFixtureBets } from '../betting/settlement';
import { broadcastMatchEvent } from '../realtime/websocket';
import { db } from '../db/index';
import { fixtures, matches, matchEvents, matchStatistics, simulationRuns } from '../db/schema/index';
import { eq } from 'drizzle-orm';
import { SimulationResult, LiveMatchEvent } from '../simulation/types';

/**
 * Executes a step-by-step live match simulation.
 * Advances match state second-by-second, commits event updates to DB before broadcasting,
 * streams WebSocket events chronologically, and settles bets ONLY after full time.
 */
export async function executeLiveMatchSimulation(options: {
  fixtureId: string;
  input: any;
  fastMode?: boolean;
  tickDelayMs?: number;
}): Promise<SimulationResult> {
  const { fixtureId, input, fastMode = true, tickDelayMs = 0 } = options;

  console.log(`\n⚙️ [MATCH ENGINE] Starting live step-by-step simulation for fixture '${fixtureId}'...`);

  const [simRun] = await db
    .insert(simulationRuns)
    .values({
      fixtureId,
      simulationVersion: input.simulationVersion || '1.0.0',
      seed: input.seed || 'seed-123',
      status: 'RUNNING',
    })
    .returning();

  if (!simRun) {
    throw new Error(`Failed to record simulation run for fixture ${fixtureId}`);
  }

  try {
    // 1. Set fixture status to LIVE
    await db
      .update(fixtures)
      .set({
        status: 'LIVE',
        startedAt: new Date(),
      })
      .where(eq(fixtures.id, fixtureId));

    // 2. Initialize match record
    const existingMatches = await db.select().from(matches).where(eq(matches.fixtureId, fixtureId));
    if (existingMatches.length === 0) {
      await db.insert(matches).values({
        fixtureId,
        seed: input.seed || 'seed-123',
        simulationVersion: input.simulationVersion || '1.0.0',
        homeScore: 0,
        awayScore: 0,
        status: 'LIVE',
        virtualSecond: 0,
      });
    }

    const engine = new MatchEngine(input);
    const state = engine.initializeState();
    const allEvents: LiveMatchEvent[] = [];

    // Step second-by-second
    while (!state.isFullTime) {
      const stepEvents = engine.stepSecond(state);

      for (const ev of stepEvents) {
        allEvents.push(ev);

        // Commit event to DB before broadcasting
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

        // Broadcast event chronologically via WebSocket
        broadcastMatchEvent(fixtureId, ev);
      }

      // Update match live status periodically
      if (stepEvents.length > 0 || state.virtualSecond % 60 === 0 || state.isFullTime) {
        await db
          .update(matches)
          .set({
            homeScore: state.homeScore,
            awayScore: state.awayScore,
            virtualSecond: state.virtualSecond,
            status: state.status,
            updatedAt: new Date(),
          })
          .where(eq(matches.fixtureId, fixtureId));

        await db
          .update(fixtures)
          .set({
            homeScore: state.homeScore,
            awayScore: state.awayScore,
            updatedAt: new Date(),
          })
          .where(eq(fixtures.id, fixtureId));
      }

      if (!fastMode && tickDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, tickDelayMs));
      }
    }

    // Compute hashes
    const resultHash = crypto
      .createHash('sha256')
      .update(`${state.fixtureId}:${state.homeScore}:${state.awayScore}:${state.eventSequence}`)
      .digest('hex');

    const timelineHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(allEvents))
      .digest('hex');

    // Update match hashes
    await db
      .update(matches)
      .set({
        status: 'FINISHED',
        resultHash,
        timelineHash,
        updatedAt: new Date(),
      })
      .where(eq(matches.fixtureId, fixtureId));

    // Save final match statistics
    const existingStats = await db.select().from(matchStatistics).where(eq(matchStatistics.fixtureId, fixtureId));
    if (existingStats.length === 0) {
      await db.insert(matchStatistics).values({
        fixtureId,
        homeShots: state.homeShots,
        awayShots: state.awayShots,
        homeShotsOnTarget: state.homeShotsOnTarget,
        awayShotsOnTarget: state.awayShotsOnTarget,
        homeCorners: state.homeCorners,
        awayCorners: state.awayCorners,
        homeFouls: state.homeFouls,
        awayFouls: state.awayFouls,
        homeYellowCards: state.homeYellowCards,
        awayYellowCards: state.awayYellowCards,
        homeRedCards: state.homeRedCards,
        awayRedCards: state.awayRedCards,
      });
    }

    // Mark fixture FINISHED
    await db
      .update(fixtures)
      .set({
        status: 'FINISHED',
        homeScore: state.homeScore,
        awayScore: state.awayScore,
        finishedAt: new Date(),
      })
      .where(eq(fixtures.id, fixtureId));

    const result: SimulationResult = {
      fixtureId: state.fixtureId,
      homeScore: state.homeScore,
      awayScore: state.awayScore,
      finalState: state,
      events: allEvents,
      resultHash,
      timelineHash,
    };

    // Post-match ratings & form evolution
    await processPostMatchEvolution(result);

    // Trigger bet settlement ONLY after full time
    await settleFixtureBets(fixtureId);

    await db
      .update(simulationRuns)
      .set({
        status: 'COMPLETED',
        resultHash,
        timelineHash,
        completedAt: new Date(),
      })
      .where(eq(simulationRuns.id, simRun.id));

    console.log(`✅ [MATCH ENGINE] Live simulation completed for fixture '${fixtureId}'. Final Score: ${state.homeScore}-${state.awayScore}`);
    return result;
  } catch (err: any) {
    console.error(`❌ [MATCH ENGINE] Live simulation failed for fixture '${fixtureId}':`, err);
    await db
      .update(simulationRuns)
      .set({ status: 'FAILED', error: err.message })
      .where(eq(simulationRuns.id, simRun.id));
    throw err;
  }
}

/**
 * BullMQ Worker for processing live/scheduled match simulation jobs.
 */
export const simulationWorker = new Worker(
  SIMULATION_QUEUE_NAME,
  async (job: Job) => {
    const { fixtureId, input, fastMode, tickDelayMs } = job.data;
    return await executeLiveMatchSimulation({
      fixtureId,
      input,
      fastMode: fastMode ?? true,
      tickDelayMs: tickDelayMs ?? 0,
    });
  },
  { connection: redisConnection }
);
