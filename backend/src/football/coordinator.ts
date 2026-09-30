import postgres from 'postgres';
import Redis from 'ioredis';
import { db } from '../db/index';
import { worldRuntime, leagues, seasons, teams, fixtures, matches, markets, marketOutcomes, teamRatings, standings } from '../db/schema/index';
import { eq, and, sql, asc, desc } from 'drizzle-orm';
import { env } from '../config/env';
import { simulationQueue } from '../workers/queues';
import { buildSimulationInput } from './match-input';
import { calculateAllPreMatchMarkets } from '../markets/probability-engine';
import { generateDoubleRoundRobin } from './fixture-generator';

const ADVISORY_LOCK_ID = 88812388;
const NODE_ID = `node-${process.pid}-${Math.random().toString(36).substring(2, 7)}`;

export type WorldStatusType = 'RUNNING' | 'RECOVERING' | 'WAITING_FOR_SEASON' | 'DEGRADED' | 'STOPPED';

export interface LeagueStatusDetail {
  leagueId: string;
  leagueName: string;
  seasonId: string | null;
  seasonName: string | null;
  currentRound: number;
  totalRounds: number;
  liveFixtures: number;
  completedFixtures: number;
  scheduledFixtures: number;
  nextKickoffAt: string | null;
  status: string;
}

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
  activeLeagues: LeagueStatusDetail[];
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
 * Automatically creates and seeds the next season for a given league when previous season finishes.
 */
async function autoCreateNextSeason(leagueRecord: any, previousSeason: any) {
  const nextSeasonNumber = previousSeason.seasonNumber + 1;
  let nextSeasonName = `Season ${nextSeasonNumber}`;

  if (previousSeason.name && previousSeason.name.includes('-')) {
    const parts = previousSeason.name.split('-');
    const startYear = parseInt(parts[0], 10);
    const endYear = parseInt(parts[1], 10);
    if (!isNaN(startYear) && !isNaN(endYear)) {
      nextSeasonName = `${startYear + 1}-${endYear + 1}`;
    }
  }

  const leagueTeams = await db.select().from(teams).where(and(eq(teams.leagueId, leagueRecord.id), eq(teams.active, true)));
  if (leagueTeams.length === 0 || leagueTeams.length % 2 !== 0) {
    console.warn(`⚠️ [WORLD COORDINATOR] Cannot auto-create season for '${leagueRecord.name}': missing or odd team count (${leagueTeams.length}). Waiting for official data.`);
    return null;
  }

  const totalRounds = (leagueTeams.length - 1) * 2;
  const [newSeason] = await db
    .insert(seasons)
    .values({
      leagueId: leagueRecord.id,
      name: nextSeasonName,
      seasonNumber: nextSeasonNumber,
      status: 'ACTIVE',
      startAt: new Date(),
      currentRound: 1,
      totalRounds,
    })
    .returning();

  for (const team of leagueTeams) {
    await db.insert(standings).values({
      seasonId: newSeason.id,
      teamId: team.id,
    }).onConflictDoNothing();

    const [prevRating] = await db
      .select()
      .from(teamRatings)
      .where(and(eq(teamRatings.seasonId, previousSeason.id), eq(teamRatings.teamId, team.id)));

    if (prevRating) {
      await db.insert(teamRatings).values({
        teamId: team.id,
        seasonId: newSeason.id,
        overallAbility: prevRating.overallAbility,
        attackStrength: prevRating.attackStrength,
        defenseStrength: prevRating.defenseStrength,
        creationRating: prevRating.creationRating,
        finishingRating: prevRating.finishingRating,
        goalkeepingRating: prevRating.goalkeepingRating,
        pressingRating: prevRating.pressingRating,
        disciplineRating: prevRating.disciplineRating,
        homeAdvantage: prevRating.homeAdvantage,
      });
    }
  }

  const pairings = generateDoubleRoundRobin(leagueTeams.length);
  const now = new Date();
  const firstKickoff = new Date(now.getTime() + env.MARKET_PREPARATION_BUFFER_SECONDS * 1000);

  const fixturesToInsert = pairings.map((pairing) => ({
    seasonId: newSeason.id,
    round: pairing.round,
    homeTeamId: leagueTeams[pairing.homeTeamIndex].id,
    awayTeamId: leagueTeams[pairing.awayTeamIndex].id,
    scheduledAt: pairing.round === 1 ? firstKickoff : new Date(now.getTime() + pairing.round * 86400000),
    status: 'SCHEDULED',
  }));

  for (let i = 0; i < fixturesToInsert.length; i += 100) {
    await db.insert(fixtures).values(fixturesToInsert.slice(i, i + 100));
  }

  console.log(`⚽ [WORLD COORDINATOR] Created and activated next season '${newSeason.name}' for league '${leagueRecord.name}' (${fixturesToInsert.length} fixtures scheduled).`);
  return newSeason;
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

  await tryAcquireCoordinatorLeadership();

  if (!isLeader) {
    return;
  }

  if (!health.redis) {
    currentStatus = 'DEGRADED';
    degradedReasonStr = 'Redis is unavailable.';
    console.warn(`⚠️ [WORLD COORDINATOR] DEGRADED: ${degradedReasonStr}`);
    await updateRuntimeHeartbeat('DEGRADED', null, 0, 38, degradedReasonStr);
    return;
  }

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

  const allLeagues = await db.select().from(leagues).where(eq(leagues.active, true));

  if (allLeagues.length === 0) {
    currentStatus = 'WAITING_FOR_SEASON';
    degradedReasonStr = 'No active leagues found in PostgreSQL.';
    await updateRuntimeHeartbeat('WAITING_FOR_SEASON', null, 0, 38, degradedReasonStr);
    return;
  }

  let anyLeagueRunning = false;
  let firstActiveSeasonId: string | null = null;
  let firstActiveRound = 0;
  let firstTotalRounds = 38;

  for (const league of allLeagues) {
    // 1. Find active season or scheduled season for this league
    const activeSeasons = await db
      .select()
      .from(seasons)
      .where(and(eq(seasons.leagueId, league.id), eq(seasons.status, 'ACTIVE')))
      .limit(1);

    let currentSeason = activeSeasons[0];

    if (!currentSeason) {
      const scheduledSeasons = await db
        .select()
        .from(seasons)
        .where(and(eq(seasons.leagueId, league.id), eq(seasons.status, 'SCHEDULED')))
        .limit(1);

      if (scheduledSeasons.length > 0) {
        currentSeason = scheduledSeasons[0];
        await db.update(seasons).set({ status: 'ACTIVE', startAt: new Date() }).where(eq(seasons.id, currentSeason.id));
        currentSeason.status = 'ACTIVE';
        console.log(`⚽ [WORLD COORDINATOR] Activated season '${currentSeason.name}' for league '${league.name}'`);
      } else {
        // Try auto-creating next season if a completed season exists
        const [lastCompleted] = await db
          .select()
          .from(seasons)
          .where(and(eq(seasons.leagueId, league.id), eq(seasons.status, 'COMPLETED')))
          .orderBy(desc(seasons.seasonNumber))
          .limit(1);

        if (lastCompleted) {
          const created = await autoCreateNextSeason(league, lastCompleted);
          if (created) {
            currentSeason = created;
          }
        }
      }
    }

    if (!currentSeason) {
      continue;
    }

    if (!firstActiveSeasonId) {
      firstActiveSeasonId = currentSeason.id;
      firstActiveRound = currentSeason.currentRound;
      firstTotalRounds = currentSeason.totalRounds;
    }

    // 2. Fetch all fixtures for this league season
    const seasonFixtures = await db
      .select()
      .from(fixtures)
      .where(eq(fixtures.seasonId, currentSeason.id))
      .orderBy(asc(fixtures.round), asc(fixtures.scheduledAt));

    if (seasonFixtures.length === 0) {
      continue;
    }

    anyLeagueRunning = true;

    let activeRound = currentSeason.currentRound;
    if (activeRound === 0) {
      activeRound = 1;
      await db.update(seasons).set({ currentRound: 1 }).where(eq(seasons.id, currentSeason.id));
    }

    const roundFixtures = seasonFixtures.filter((f) => f.round === activeRound);

    // Schedule kickoffs for active round fixtures if unscheduled/far future
    for (const f of roundFixtures) {
      if (f.status === 'SCHEDULED' && f.scheduledAt > now && f.scheduledAt.getTime() - now.getTime() > 1000 * 60 * 60 * 24) {
        const nextKickoff = new Date(now.getTime() + env.MARKET_PREPARATION_BUFFER_SECONDS * 1000);
        await db.update(fixtures).set({ scheduledAt: nextKickoff, updatedAt: new Date() }).where(eq(fixtures.id, f.id));
        f.scheduledAt = nextKickoff;
      }
    }

    // Check if current round is complete
    const uncompletedInRound = roundFixtures.filter((f) => f.status !== 'FINISHED' && f.status !== 'CANCELLED');

    if (uncompletedInRound.length === 0 && roundFixtures.length > 0) {
      const maxFinishedAt = roundFixtures.reduce((latest: Date | null, f) => {
        if (!f.finishedAt) return latest;
        return !latest || f.finishedAt > latest ? f.finishedAt : latest;
      }, null);

      const roundBreakMs = env.ROUND_BREAK_SECONDS * 1000;
      const canAdvanceAt = maxFinishedAt ? new Date(maxFinishedAt.getTime() + roundBreakMs) : now;

      if (now >= canAdvanceAt) {
        if (activeRound < currentSeason.totalRounds) {
          const nextRound = activeRound + 1;
          console.log(`🏆 [WORLD COORDINATOR] Round ${activeRound} completed for league '${league.name}'. Advancing to Round ${nextRound}...`);

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
          console.log(`🎉 [WORLD COORDINATOR] All ${currentSeason.totalRounds} rounds completed for League '${league.name}' Season '${currentSeason.name}'!`);
          await db.update(seasons).set({ status: 'COMPLETED', endAt: new Date() }).where(eq(seasons.id, currentSeason.id));

          // Attempt auto-creation of next season immediately
          await autoCreateNextSeason(league, currentSeason);
        }
      }
    }

    // Process markets and match kickoffs for active round
    const currentRoundFixtures = seasonFixtures.filter((f) => f.round === activeRound);

    for (const f of currentRoundFixtures) {
      if (f.status === 'SCHEDULED') {
        const existingMarkets = await db.select().from(markets).where(eq(markets.fixtureId, f.id));
        if (existingMarkets.length === 0) {
          await prepareFixtureMarkets(f.id, f.seasonId, f.homeTeamId, f.awayTeamId);
        }

        if (f.scheduledAt <= now) {
          await db.update(markets).set({ status: 'CLOSED', updatedAt: new Date() }).where(eq(markets.fixtureId, f.id));
          await triggerOrCatchUpMatch(f);
        }
      } else if (f.status === 'LIVE') {
        await triggerOrCatchUpMatch(f);
      }
    }
  }

  if (anyLeagueRunning) {
    currentStatus = 'RUNNING';
    degradedReasonStr = null;
    await updateRuntimeHeartbeat('RUNNING', firstActiveSeasonId, firstActiveRound, firstTotalRounds, null);
  } else {
    currentStatus = 'WAITING_FOR_SEASON';
    degradedReasonStr = 'All leagues are waiting for season data.';
    await updateRuntimeHeartbeat('WAITING_FOR_SEASON', null, 0, 38, degradedReasonStr);
  }
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

  let shouldEnqueue = false;

  if (!existingJob) {
    shouldEnqueue = true;
  } else {
    const jobState = await existingJob.getState();
    if (jobState === 'failed' || jobState === 'completed') {
      if (fixture.status === 'LIVE' || fixture.status === 'SCHEDULED') {
        try {
          await existingJob.remove();
        } catch (_) {}
        shouldEnqueue = true;
      }
    }
  }

  if (shouldEnqueue) {
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
      console.log(`🚀 [WORLD COORDINATOR] Scheduled match simulation job '${jobId}' for fixture '${fixture.id}' (fastMode=${isOverdue ? 'true' : 'false'})`);
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

  const activeLeaguesDetail: LeagueStatusDetail[] = [];

  if (health.postgres) {
    try {
      const [runtimeRow] = await db.select().from(worldRuntime).where(eq(worldRuntime.id, 'singleton'));
      if (runtimeRow) {
        currentStatus = (runtimeRow.status as WorldStatusType) || currentStatus;
        degradedReasonStr = runtimeRow.degradedReason || null;
      }

      const allLeagues = await db.select().from(leagues).where(eq(leagues.active, true));

      for (const league of allLeagues) {
        const [activeSeason] = await db
          .select()
          .from(seasons)
          .where(and(eq(seasons.leagueId, league.id), eq(seasons.status, 'ACTIVE')))
          .limit(1);

        let lLive = 0;
        let lCompleted = 0;
        let lScheduled = 0;
        let lNextKickoff: string | null = null;

        if (activeSeason) {
          if (!activeSeasonObj) activeSeasonObj = activeSeason;

          const leagueFixtures = await db.select().from(fixtures).where(eq(fixtures.seasonId, activeSeason.id));
          for (const f of leagueFixtures) {
            if (f.status === 'LIVE') {
              lLive++;
              liveCount++;
            } else if (f.status === 'FINISHED') {
              lCompleted++;
              completedCount++;
            } else if (f.status === 'SCHEDULED') {
              lScheduled++;
              scheduledCount++;
              const kStr = f.scheduledAt.toISOString();
              if (!lNextKickoff || kStr < lNextKickoff) lNextKickoff = kStr;
              if (!nextKickoffStr || kStr < nextKickoffStr) nextKickoffStr = kStr;
            }
          }
        }

        activeLeaguesDetail.push({
          leagueId: league.id,
          leagueName: league.name,
          seasonId: activeSeason ? activeSeason.id : null,
          seasonName: activeSeason ? activeSeason.name : null,
          currentRound: activeSeason ? activeSeason.currentRound : 0,
          totalRounds: activeSeason ? activeSeason.totalRounds : 38,
          liveFixtures: lLive,
          completedFixtures: lCompleted,
          scheduledFixtures: lScheduled,
          nextKickoffAt: lNextKickoff,
          status: activeSeason ? 'RUNNING' : 'WAITING_FOR_SEASON',
        });
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
    activeLeagues: activeLeaguesDetail,
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
