import { Worker, Job } from 'bullmq';
import crypto from 'crypto';
import { redisConnection, SIMULATION_QUEUE_NAME } from './queues';
import { MatchEngine } from '../simulation/match-engine';
import { processPostMatchEvolution } from '../simulation/evolution';
import { settleFixtureBets } from '../betting/settlement';
import { broadcastMatchEvent } from '../realtime/websocket';
import { db } from '../db/index';
import { fixtures, matches, matchEvents, matchSnapshots, matchStatistics, simulationRuns } from '../db/schema/index';
import { eq, and, desc } from 'drizzle-orm';
import { SimulationResult, LiveMatchEvent, DynamicMatchState } from '../simulation/types';
import { env } from '../config/env';

/**
 * Executes a step-by-step live match simulation with checkpoint restoration & timestamp wall-clock mapping.
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
    // 1. Fetch fixture & set status to LIVE
    const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
    if (!fixture) throw new Error(`Fixture ${fixtureId} not found`);

    const actualStartedAt = fixture.startedAt || new Date();
    await db
      .update(fixtures)
      .set({
        status: 'LIVE',
        startedAt: actualStartedAt,
      })
      .where(eq(fixtures.id, fixtureId));

    // 2. Initialize or retrieve match record
    let [matchRecord] = await db.select().from(matches).where(eq(matches.fixtureId, fixtureId));
    if (!matchRecord) {
      const [inserted] = await db
        .insert(matches)
        .values({
          fixtureId,
          seed: input.seed || 'seed-123',
          simulationVersion: input.simulationVersion || '1.0.0',
          homeScore: 0,
          awayScore: 0,
          status: 'LIVE',
          virtualSecond: 0,
        })
        .returning();
      matchRecord = inserted;
    }

    const engine = new MatchEngine(input);
    let state: DynamicMatchState;

    // Check for saved snapshots to restore state on restart
    const [latestSnapshot] = await db
      .select()
      .from(matchSnapshots)
      .where(eq(matchSnapshots.matchId, matchRecord.id))
      .orderBy(desc(matchSnapshots.virtualSecond))
      .limit(1);

    if (latestSnapshot && latestSnapshot.matchStateJson) {
      console.log(`🔄 [MATCH ENGINE] Restoring match '${fixtureId}' from snapshot at virtual second ${latestSnapshot.virtualSecond}`);
      state = latestSnapshot.matchStateJson as DynamicMatchState;
      engine.restoreRngState(state);
    } else {
      state = engine.initializeState();
    }

    // Load existing events to avoid duplicate sequence insertions
    const existingEvents = await db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.fixtureId, fixtureId));

    const existingSequences = new Set<number>(existingEvents.map((e) => e.sequence));
    const allEvents: LiveMatchEvent[] = existingEvents.map((e) => ({
      fixtureId: e.fixtureId,
      sequence: e.sequence,
      virtualMinute: e.virtualMinute,
      virtualSecond: e.virtualSecond,
      eventType: e.eventType as any,
      teamId: e.teamId || undefined,
      playerId: e.playerId || undefined,
      metadata: e.metadata || {},
    }));

    const totalRealMs = env.MATCH_REAL_DURATION_SECONDS * 1000;

    // Step second-by-second
    while (!state.isFullTime) {
      if (!fastMode) {
        const elapsedRealMs = Math.max(0, Date.now() - new Date(actualStartedAt).getTime());
        const targetVirtualSecond = Math.min(5400, Math.floor((elapsedRealMs / totalRealMs) * 5400));

        if (state.virtualSecond >= targetVirtualSecond && targetVirtualSecond < 5400) {
          const sleepMs = tickDelayMs > 0 ? tickDelayMs : 250;
          await new Promise((resolve) => setTimeout(resolve, sleepMs));
          continue;
        }
      }

      const stepEvents = engine.stepSecond(state);

      for (const ev of stepEvents) {
        if (!existingSequences.has(ev.sequence)) {
          existingSequences.add(ev.sequence);
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
      }

      // Checkpoint snapshot saving (every 300 seconds or on goals/halftime/fulltime)
      const isKeyEvent = stepEvents.some((e) => ['GOAL', 'RED_CARD', 'HALFTIME', 'MATCH_END'].includes(e.eventType));
      if (state.virtualSecond % 300 === 0 || isKeyEvent) {
        await db.insert(matchSnapshots).values({
          matchId: matchRecord.id,
          virtualSecond: state.virtualSecond,
          matchStateJson: state as any,
        });
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

    // Post-match ratings & form evolution (guarded against duplicate)
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
