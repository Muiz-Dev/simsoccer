import postgres from 'postgres';
import Redis from 'ioredis';
import { db } from '../db/index';
import { worldRuntime, seasons, fixtures, matches, matchEvents, settlements, markets, marketOutcomes, teamRatings } from '../db/schema/index';
import { eq, and, sql, asc } from 'drizzle-orm';
import { env } from '../config/env';
import { simulationQueue } from '../workers/queues';
import { buildSimulationInput } from './match-input';
import { calculateAllPreMatchMarkets } from '../markets/probability-engine';

const ADVISORY_LOCK_ID = 88812388;
const NODE_ID = `node-${process.pid}-${Math.random().toString(36).substring(2, 7)}`;

export type WorldStatusType = 'RUNNING' | 'RECOVERING' | 'WAITING_FOR_SEASON' | 'DEGRADED' | 'STOPPED';

export interface WorldStatusInfo {
  status: WorldStatusType;
  isCoordinatorLeader: boolean;
  coordinatorNodeId: string | null;
  activeSeasonId: string | null;
  activeSeasonName: string | null;
  currentRound: number;
  totalRounds: number;
  liveFixtureCount: number;
  completedFixtureCount: number;
  scheduledFixtureCount: number;
  nextKickoffAt: string | null;
  heartbeatAt: string | null;
  lastReconciliationAt: string | null;
  degradedReason: string | null;
  dependencies: {
    postgres: boolean;
    redis: boolean;
  };
}

let dedicatedLockSql: ReturnType<typeof postgres> | null = null;
let isLeader = false;
let loopInterval: NodeJS.Timeout | null = null;
let currentStatus: WorldStatusType = 'WAITING_FOR_SEASON';
let degradedReasonStr: string | null = null;
let lastReconciliationTime: Date | null = null;

export async function checkDependenciesHealth(): Promise<{ postgres: boolean; redis: boolean }> {
  let pgOk = false;
  let redisOk = false;

  try {
    await db.execute(sql`SELECT 1`);
    pgOk = true;
  } catch (err) {
    pgOk = false;
  }

  try {
    const redisClient = new Redis(env.REDIS_URL, {
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      tls: env.REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    });
    const pong = await redisClient.ping();
    redisOk = (pong === 'PONG');
    redisClient.disconnect();
  } catch (err) {
    redisOk = false;
  }

  return { postgres: pgOk, redis: redisOk };
}

export async function tryAcquireCoordinatorLeadership(): Promise<boolean> {
  try {
    if (!dedicatedLockSql) {
      dedicatedLockSql = postgres(env.DATABASE_URL, {
        max: 1,
        connect_timeout: 5,
        ssl: env.DATABASE_URL.includes('supabase.co') || env.DATABASE_URL.includes('sslmode=require') ? 'require' : false,
      });
    }

    const result = await dedicatedLockSql`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_ID}) as locked`;
    const locked = result[0]?.locked === true;

    if (locked && !isLeader) {
      console.log(`👑 [WORLD COORDINATOR] Leadership acquired by node '${NODE_ID}'`);
    }
    isLeader = locked;
    return isLeader;
  } catch (err: any) {
    isLeader = false;
    console.error(`⚠️ [WORLD COORDINATOR] Failed acquiring leadership lock: ${err.message}`);
    return false;
  }
}

export async function releaseCoordinatorLeadership(): Promise<void> {
  if (dedicatedLockSql && isLeader) {
    try {
      await dedicatedLockSql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID})`;
      console.log(`👑 [WORLD COORDINATOR] Leadership released by node '${NODE_ID}'`);
    } catch (err: any) {
      console.error(`⚠️ Error unlocking coordinator advisory lock: ${err.message}`);
    }
  }
  isLeader = false;
  if (dedicatedLockSql) {
    try {
      await dedicatedLockSql.end({ timeout: 2 });
    } catch (_) {}
    dedicatedLockSql = null;
  }
}

export async function updateRuntimeHeartbeat(
  status: WorldStatusType,
  activeSeasonId: string | null = null,
  round = 0,
  totalRounds = 38,
  reason: string | null = null
) {
  currentStatus = status;
  degradedReasonStr = reason;

  try {
    await db
      .insert(worldRuntime)
      .values({
        id: 'singleton',
        status,
        activeSeasonId,
        currentRound: round,
        totalRounds,
        coordinatorNodeId: isLeader ? NODE_ID : null,
        heartbeatAt: new Date(),
        lastReconciliationAt: lastReconciliationTime,
        degradedReason: reason,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: worldRuntime.id,
        set: {
          status,
          activeSeasonId,
          currentRound: round,
          totalRounds,
          coordinatorNodeId: isLeader ? NODE_ID : sql`world_runtime.coordinator_node_id`,
          heartbeatAt: new Date(),
          lastReconciliationAt: lastReconciliationTime,
          degradedReason: reason,
          updatedAt: new Date(),
        },
      });
  } catch (err: any) {
    console.error(`⚠️ Failed updating world runtime table: ${err.message}`);
  }
}

/**
 * Main coordinator loop tick.
 */
export async function tickCoordinator(): Promise<void> {
  const health = await checkDependenciesHealth();

  if (!health.postgres) {
    currentStatus = 'DEGRADED';
    degradedReasonStr = 'PostgreSQL database is unavailable.';
    console.error(`❌ [WORLD COORDINATOR] DEGRADED: ${degradedReasonStr}`);
    return;
  }

  // Attempt leader lock if not leader
  await tryAcquireCoordinatorLeadership();

  if (!isLeader) {
    // Standby node
    return;
  }

  if (!health.redis) {
    currentStatus = 'DEGRADED';
    degradedReasonStr = 'Redis is unavailable.';
    console.warn(`⚠️ [WORLD COORDINATOR] DEGRADED: ${degradedReasonStr}`);
    await updateRuntimeHeartbeat('DEGRADED', null, 0, 38, degradedReasonStr);
    return;
  }

  // Run world state reconciliation and progression
  try {
    await reconcileAndScheduleWorld();
  } catch (err: any) {
    console.error(`❌ [WORLD COORDINATOR] Error in reconciliation loop:`, err);
    currentStatus = 'DEGRADED';
    degradedReasonStr = err.message;
    await updateRuntimeHeartbeat('DEGRADED', null, 0, 38, degradedReasonStr);
  }
}

export async function reconcileAndScheduleWorld(): Promise<void> {
  const now = new Date();
  lastReconciliationTime = now;

  // 1. Find active or draft season
  const activeSeasons = await db.select().from(seasons).where(eq(seasons.status, 'ACTIVE')).limit(1);
  let currentSeason = activeSeasons[0];

  if (!currentSeason) {
    const scheduledSeasons = await db.select().from(seasons).where(eq(seasons.status, 'SCHEDULED')).limit(1);
    if (scheduledSeasons.length > 0) {
      currentSeason = scheduledSeasons[0];
      await db.update(seasons).set({ status: 'ACTIVE', startAt: new Date() }).where(eq(seasons.id, currentSeason.id));
      currentSeason.status = 'ACTIVE';
      console.log(`⚽ [WORLD COORDINATOR] Activated season '${currentSeason.name}' (${currentSeason.id})`);
    } else {
      currentStatus = 'WAITING_FOR_SEASON';
      degradedReasonStr = 'No active or scheduled season found in PostgreSQL.';
      await updateRuntimeHeartbeat('WAITING_FOR_SEASON', null, 0, 38, degradedReasonStr);
      return;
    }
  }

  // 2. Fetch all fixtures for the active season
  const seasonFixtures = await db.select().from(fixtures).where(eq(fixtures.seasonId, currentSeason.id)).orderBy(asc(fixtures.round), asc(fixtures.scheduledAt));

  if (seasonFixtures.length === 0) {
    currentStatus = 'WAITING_FOR_SEASON';
    degradedReasonStr = `Season '${currentSeason.name}' has no generated fixtures.`;
    await updateRuntimeHeartbeat('WAITING_FOR_SEASON', currentSeason.id, currentSeason.currentRound, currentSeason.totalRounds, degradedReasonStr);
    return;
  }

  // Determine current active round
  let activeRound = currentSeason.currentRound;
  if (activeRound === 0) {
    activeRound = 1;
    await db.update(seasons).set({ currentRound: 1 }).where(eq(seasons.id, currentSeason.id));
  }

  const roundFixtures = seasonFixtures.filter((f) => f.round === activeRound);

  // Ensure scheduledAt times are populated and formatted for roundFixtures
  for (const f of roundFixtures) {
    if (f.status === 'SCHEDULED' && f.scheduledAt > now && f.scheduledAt.getTime() - now.getTime() > 1000 * 60 * 60 * 24) {
      // Reposition to near-future kickoff if unscheduled dummy date
      const nextKickoff = new Date(now.getTime() + env.MARKET_PREPARATION_BUFFER_SECONDS * 1000);
      await db.update(fixtures).set({ scheduledAt: nextKickoff, updatedAt: new Date() }).where(eq(fixtures.id, f.id));
      f.scheduledAt = nextKickoff;
    }
  }

  // Check if all fixtures in current round are completed
  const uncompletedInRound = roundFixtures.filter((f) => f.status !== 'FINISHED' && f.status !== 'CANCELLED');

  if (uncompletedInRound.length === 0 && roundFixtures.length > 0) {
    // Check if the round break has elapsed
    const maxFinishedAt = roundFixtures.reduce((latest: Date | null, f) => {
      if (!f.finishedAt) return latest;
      return !latest || f.finishedAt > latest ? f.finishedAt : latest;
    }, null);

    const roundBreakMs = env.ROUND_BREAK_SECONDS * 1000;
    const canAdvanceAt = maxFinishedAt ? new Date(maxFinishedAt.getTime() + roundBreakMs) : now;

    if (now >= canAdvanceAt) {
      if (activeRound < currentSeason.totalRounds) {
        const nextRound = activeRound + 1;
        console.log(`🏆 [WORLD COORDINATOR] Round ${activeRound} completed. Advancing to Round ${nextRound}...`);

        const nextRoundFixtures = seasonFixtures.filter((f) => f.round === nextRound);
        const nextKickoff = new Date(now.getTime() + env.MARKET_PREPARATION_BUFFER_SECONDS * 1000);

        for (const f of nextRoundFixtures) {
          if (f.scheduledAt <= now || f.scheduledAt.getTime() - now.getTime() > 1000 * 60 * 60 * 24) {
            await db.update(fixtures).set({ scheduledAt: nextKickoff, updatedAt: new Date() }).where(eq(fixtures.id, f.id));
            f.scheduledAt = nextKickoff;
          }
        }

        await db.update(seasons).set({ currentRound: nextRound }).where(eq(seasons.id, currentSeason.id));
        activeRound = nextRound;
      } else {
        // Season completed!
        console.log(`🎉 [WORLD COORDINATOR] All ${currentSeason.totalRounds} rounds completed for Season '${currentSeason.name}'!`);
        await db.update(seasons).set({ status: 'COMPLETED', endAt: new Date() }).where(eq(seasons.id, currentSeason.id));

        const nextSeasonNumber = currentSeason.seasonNumber + 1;
        const [nextSeasonObj] = await db.select().from(seasons).where(and(eq(seasons.leagueId, currentSeason.leagueId), eq(seasons.seasonNumber, nextSeasonNumber)));

        if (nextSeasonObj) {
          await db.update(seasons).set({ status: 'ACTIVE', startAt: new Date(), currentRound: 1 }).where(eq(seasons.id, nextSeasonObj.id));
          console.log(`⚽ [WORLD COORDINATOR] Next season '${nextSeasonObj.name}' activated automatically!`);
        } else {
          currentStatus = 'WAITING_FOR_SEASON';
          degradedReasonStr = `Season '${currentSeason.name}' ended. Next season (${nextSeasonNumber}) not seeded yet.`;
          await updateRuntimeHeartbeat('WAITING_FOR_SEASON', currentSeason.id, activeRound, currentSeason.totalRounds, degradedReasonStr);
          return;
        }
      }
    }
  }

  // Re-fetch active round fixtures to process kickoffs/markets
  const currentRoundFixtures = seasonFixtures.filter((f) => f.round === activeRound);

  // 3. Prepare markets for upcoming fixtures in active round
  for (const f of currentRoundFixtures) {
    if (f.status === 'SCHEDULED') {
      const existingMarkets = await db.select().from(markets).where(eq(markets.fixtureId, f.id));
      if (existingMarkets.length === 0) {
        await prepareFixtureMarkets(f.id, f.seasonId, f.homeTeamId, f.awayTeamId);
      }

      if (f.scheduledAt <= now) {
        // Close markets at kickoff
        await db.update(markets).set({ status: 'CLOSED', updatedAt: new Date() }).where(eq(markets.fixtureId, f.id));

        // Trigger simulation via BullMQ queue (or directly if queue already has it)
        await triggerOrCatchUpMatch(f);
      }
    } else if (f.status === 'LIVE') {
      await triggerOrCatchUpMatch(f);
    }
  }

  currentStatus = 'RUNNING';
  degradedReasonStr = null;
  await updateRuntimeHeartbeat('RUNNING', currentSeason.id, activeRound, currentSeason.totalRounds, null);
}

async function prepareFixtureMarkets(fixtureId: string, seasonId: string, homeTeamId: string, awayTeamId: string) {
  const [homeRating] = await db.select().from(teamRatings).where(and(eq(teamRatings.seasonId, seasonId), eq(teamRatings.teamId, homeTeamId)));
  const [awayRating] = await db.select().from(teamRatings).where(and(eq(teamRatings.seasonId, seasonId), eq(teamRatings.teamId, awayTeamId)));

  let lambdaHome = 1.30;
  let lambdaAway = 1.05;

  if (homeRating && awayRating) {
    lambdaHome = 1.20 * parseFloat(homeRating.attackStrength) * (1 / Math.max(0.5, parseFloat(awayRating.defenseStrength))) * parseFloat(homeRating.homeAdvantage);
    lambdaAway = 1.05 * parseFloat(awayRating.attackStrength) * (1 / Math.max(0.5, parseFloat(awayRating.defenseStrength)));
  }

  const calculated = calculateAllPreMatchMarkets(lambdaHome, lambdaAway);

  for (const mData of calculated) {
    const [mRecord] = await db.insert(markets).values({
      fixtureId,
      marketType: mData.marketType,
      status: 'OPEN',
    }).returning();

    const outcomesToInsert = mData.outcomes.map((o) => ({
      marketId: mRecord.id,
      outcomeCode: o.outcomeCode,
      displayName: o.displayName,
      probability: o.probability.toFixed(4),
      odds: o.odds.toFixed(2),
      status: 'OPEN',
    }));

    await db.insert(marketOutcomes).values(outcomesToInsert);
  }
}

async function triggerOrCatchUpMatch(fixture: any) {
  const jobId = `simulation-${fixture.id}`;
  const existingJob = await simulationQueue.getJob(jobId);

  if (!existingJob) {
    try {
      const input = await buildSimulationInput(fixture.id);
      const isOverdue = fixture.scheduledAt && (new Date().getTime() - new Date(fixture.scheduledAt).getTime() > env.MATCH_REAL_DURATION_SECONDS * 1000);
      await simulationQueue.add(
        'simulate-fixture',
        {
          fixtureId: fixture.id,
          input,
          fastMode: isOverdue ? true : false,
          tickDelayMs: 0,
        },
        { jobId }
      );
      console.log(`🚀 [WORLD COORDINATOR] Scheduled match simulation for fixture '${fixture.id}' (fastMode=${isOverdue ? 'true' : 'false'})`);
    } catch (err: any) {
      console.error(`⚠️ Failed to build match input or queue job for fixture ${fixture.id}:`, err.message);
    }
  }
}

export async function getWorldStatusInfo(): Promise<WorldStatusInfo> {
  const health = await checkDependenciesHealth();

  let activeSeasonObj = null;
  let liveCount = 0;
  let completedCount = 0;
  let scheduledCount = 0;
  let nextKickoffStr: string | null = null;

  if (health.postgres) {
    try {
      const [runtimeRow] = await db.select().from(worldRuntime).where(eq(worldRuntime.id, 'singleton'));
      if (runtimeRow) {
        currentStatus = (runtimeRow.status as WorldStatusType) || currentStatus;
        degradedReasonStr = runtimeRow.degradedReason || null;
      }

      const activeSeasons = await db.select().from(seasons).where(eq(seasons.status, 'ACTIVE')).limit(1);
      if (activeSeasons.length > 0) {
        activeSeasonObj = activeSeasons[0];
        const allFixtures = await db.select().from(fixtures).where(eq(fixtures.seasonId, activeSeasonObj.id));

        for (const f of allFixtures) {
          if (f.status === 'LIVE') liveCount++;
          else if (f.status === 'FINISHED') completedCount++;
          else if (f.status === 'SCHEDULED') {
            scheduledCount++;
            if (!nextKickoffStr || f.scheduledAt.toISOString() < nextKickoffStr) {
              nextKickoffStr = f.scheduledAt.toISOString();
            }
          }
        }
      }
    } catch (_) {}
  } else {
    currentStatus = 'DEGRADED';
    degradedReasonStr = 'PostgreSQL database is unavailable.';
  }

  return {
    status: currentStatus,
    isCoordinatorLeader: isLeader,
    coordinatorNodeId: isLeader ? NODE_ID : null,
    activeSeasonId: activeSeasonObj ? activeSeasonObj.id : null,
    activeSeasonName: activeSeasonObj ? activeSeasonObj.name : null,
    currentRound: activeSeasonObj ? activeSeasonObj.currentRound : 0,
    totalRounds: activeSeasonObj ? activeSeasonObj.totalRounds : 38,
    liveFixtureCount: liveCount,
    completedFixtureCount: completedCount,
    scheduledFixtureCount: scheduledCount,
    nextKickoffAt: nextKickoffStr,
    heartbeatAt: new Date().toISOString(),
    lastReconciliationAt: lastReconciliationTime ? lastReconciliationTime.toISOString() : null,
    degradedReason: degradedReasonStr,
    dependencies: health,
  };
}

export function startCoordinatorLoop(intervalMs = 5000): void {
  if (loopInterval) return;
  console.log(`🏁 [WORLD COORDINATOR] Starting coordinator loop (${intervalMs}ms interval)...`);
  void tickCoordinator();
  loopInterval = setInterval(() => {
    void tickCoordinator();
  }, intervalMs);
}

export async function stopCoordinatorLoop(): Promise<void> {
  if (loopInterval) {
    clearInterval(loopInterval);
    loopInterval = null;
  }
  await releaseCoordinatorLeadership();
}
