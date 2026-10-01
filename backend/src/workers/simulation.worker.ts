import { Worker, Job } from 'bullmq';
import crypto from 'crypto';
import { redisConnection, SIMULATION_QUEUE_NAME } from './queues';
import { getTargetVirtualSecond, getVirtualStepsToAdvance, MatchEngine } from '../simulation/match-engine';
import { processPostMatchEvolution } from '../simulation/evolution';
import { broadcastMatchEvent } from '../realtime/websocket';
import { db } from '../db/index';
import { fixtures, matches, matchEvents, matchSnapshots, matchStatistics, simulationRuns } from '../db/schema/index';
import { eq, desc } from 'drizzle-orm';
import { SimulationResult, LiveMatchEvent, DynamicMatchState } from '../simulation/types';
import { env } from '../config/env';

/**
 * Executes a step-by-step live match simulation with checkpoint restoration & UTC wall-clock mapping.
 */
export async function executeLiveMatchSimulation(options: {
  fixtureId: string;
  input: any;
  fastMode?: boolean;
  tickDelayMs?: number;
}): Promise<SimulationResult> {
  const { fixtureId, input, fastMode = false, tickDelayMs = 0 } = options;

  console.log(`\n⚙️ [MATCH ENGINE] Executing live simulation for fixture '${fixtureId}' (fastMode=${fastMode})...`);

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
    if (!fixture.startedAt) {
      await db
        .update(fixtures)
        .set({
          status: 'LIVE',
          startedAt: actualStartedAt,
        })
        .where(eq(fixtures.id, fixtureId));
    }

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

    const kickoffTime = new Date(actualStartedAt).getTime();

    // Advance in bounded batches to the wall-clock target without sleeping once per virtual second.
    while (!state.isFullTime) {
      let targetVirtualSecond = 5400;
      if (!fastMode) {
        const elapsedRealMs = Math.max(0, Date.now() - kickoffTime);
        targetVirtualSecond = getTargetVirtualSecond(elapsedRealMs, env.MATCH_REAL_DURATION_SECONDS);

        // If engine is caught up with real wall-clock time, sleep briefly
        if (state.virtualSecond > targetVirtualSecond) {
          const sleepMs = tickDelayMs > 0 ? tickDelayMs : 250;
          await new Promise((resolve) => setTimeout(resolve, sleepMs));
          continue;
        }
      }

      const stepsToAdvance = getVirtualStepsToAdvance(state.virtualSecond, targetVirtualSecond);

      for (let step = 0; step < stepsToAdvance && !state.isFullTime; step++) {
        const stepEvents = engine.stepSecond(state);

        for (const ev of stepEvents) {
          if (!existingSequences.has(ev.sequence)) {
            existingSequences.add(ev.sequence);
            allEvents.push(ev);

            // Idempotent commit before broadcast
            await db
              .insert(matchEvents)
              .values({
                fixtureId,
                sequence: ev.sequence,
                virtualMinute: ev.virtualMinute,
                virtualSecond: ev.virtualSecond,
                eventType: ev.eventType,
                teamId: ev.teamId,
                playerId: ev.playerId,
                metadata: ev.metadata,
              })
              .onConflictDoNothing({ target: [matchEvents.fixtureId, matchEvents.sequence] });

            // Broadcast event chronologically via WebSocket
            broadcastMatchEvent(fixtureId, ev);
          }
        }

        // Checkpoint snapshot saving (every 300 seconds or key events)
        const isKeyEvent = stepEvents.some((e) => ['GOAL', 'RED_CARD', 'HALFTIME', 'MATCH_END'].includes(e.eventType));
        if (state.virtualSecond % 300 === 0 || isKeyEvent) {
          await db
            .insert(matchSnapshots)
            .values({
              matchId: matchRecord.id,
              virtualSecond: state.virtualSecond,
              matchStateJson: state as any,
            })
            .onConflictDoNothing({ target: [matchSnapshots.matchId, matchSnapshots.virtualSecond] });
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
      }

      await new Promise<void>((resolve) => setImmediate(resolve));

      if (fastMode && tickDelayMs > 0) {
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

    // Save final match statistics
    await db
      .insert(matchStatistics)
      .values({
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
      })
      .onConflictDoNothing({ target: matchStatistics.fixtureId });

    // Update fixture scores so post-match evolution and settlement have scores
    await db
      .update(fixtures)
      .set({
        homeScore: state.homeScore,
        awayScore: state.awayScore,
        updatedAt: new Date(),
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

    const finishedAt = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(matches)
        .set({ status: 'FINISHED', resultHash, timelineHash, updatedAt: finishedAt })
        .where(eq(matches.fixtureId, fixtureId));

      await tx
        .update(fixtures)
        .set({ status: 'FINISHED', finishedAt, updatedAt: finishedAt })
        .where(eq(fixtures.id, fixtureId));

      await tx
        .update(simulationRuns)
        .set({ status: 'COMPLETED', resultHash, timelineHash, completedAt: finishedAt })
        .where(eq(simulationRuns.id, simRun.id));

    });

    console.log(`✅ [MATCH ENGINE] Simulation completed for fixture '${fixtureId}'. Final Score: ${state.homeScore}-${state.awayScore}`);
    return result;
  } catch (err: any) {
    console.error(`❌ [MATCH ENGINE] Simulation failed for fixture '${fixtureId}':`, err);
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
      fastMode: fastMode ?? false,
      tickDelayMs: tickDelayMs ?? 0,
    });
  },
  { connection: redisConnection, concurrency: env.SIMULATION_WORKER_CONCURRENCY }
);
