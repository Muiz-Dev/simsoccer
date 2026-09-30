import { and, asc, eq } from 'drizzle-orm';
import { env } from '../config/env';
import { db, client } from '../db/index';
import { fixtures, matches, players, seasons, teamRatings, teams } from '../db/schema/index';
import { MatchSimulationInput } from '../simulation/types';
import { verifySafeDatabase } from '../db/guard';
import { redisConnection, settlementQueue, simulationQueue } from './queues';

async function enqueueFixtureSimulation(fixtureId: string): Promise<void> {
  verifySafeDatabase(`Queue Simulation for Fixture ${fixtureId}`);

  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  if (!fixture) throw new Error(`Fixture '${fixtureId}' was not found.`);
  if (fixture.status !== 'SCHEDULED') {
    throw new Error(`Fixture '${fixtureId}' must be SCHEDULED; current status is ${fixture.status}.`);
  }

  const [existingMatch] = await db.select().from(matches).where(eq(matches.fixtureId, fixtureId));
  if (existingMatch) throw new Error(`Fixture '${fixtureId}' already has a match record.`);

  const [season] = await db.select().from(seasons).where(eq(seasons.id, fixture.seasonId));
  if (!season) throw new Error(`Season '${fixture.seasonId}' was not found.`);

  const [homeTeam] = await db.select().from(teams).where(eq(teams.id, fixture.homeTeamId));
  const [awayTeam] = await db.select().from(teams).where(eq(teams.id, fixture.awayTeamId));
  if (!homeTeam || !awayTeam) throw new Error('Fixture team records are incomplete.');

  const [homeRating] = await db.select().from(teamRatings).where(
    and(eq(teamRatings.teamId, homeTeam.id), eq(teamRatings.seasonId, season.id))
  );
  const [awayRating] = await db.select().from(teamRatings).where(
    and(eq(teamRatings.teamId, awayTeam.id), eq(teamRatings.seasonId, season.id))
  );
  if (!homeRating || !awayRating) throw new Error('Fixture team ratings are incomplete.');

  const homeRoster = await db.select().from(players)
    .where(eq(players.teamId, homeTeam.id))
    .orderBy(asc(players.id));
  const awayRoster = await db.select().from(players)
    .where(eq(players.teamId, awayTeam.id))
    .orderBy(asc(players.id));
  if (homeRoster.length === 0 || awayRoster.length === 0) {
    throw new Error('Both teams must have player records before simulation.');
  }

  const simulationVersion = env.SIMULATION_VERSION;
  const input: MatchSimulationInput = {
    fixtureId,
    seasonId: season.id,
    simulationVersion,
    seed: `${fixtureId}:${simulationVersion}`,
    homeTeam: {
      id: homeTeam.id,
      name: homeTeam.name,
      attackStrength: Number(homeRating.attackStrength),
      defenseStrength: Number(homeRating.defenseStrength),
      overallRating: Number(homeRating.overallAbility),
    },
    awayTeam: {
      id: awayTeam.id,
      name: awayTeam.name,
      attackStrength: Number(awayRating.attackStrength),
      defenseStrength: Number(awayRating.defenseStrength),
      overallRating: Number(awayRating.overallAbility),
    },
    homePlayers: homeRoster.map((player) => ({
      id: player.id,
      name: player.name,
      position: player.primaryPosition,
      rating: player.overallRating,
    })),
    awayPlayers: awayRoster.map((player) => ({
      id: player.id,
      name: player.name,
      position: player.primaryPosition,
      rating: player.overallRating,
    })),
  };

  const jobId = `simulation-${fixtureId}`;
  if (await simulationQueue.getJob(jobId)) {
    throw new Error(`A simulation job already exists for fixture '${fixtureId}'.`);
  }

  await simulationQueue.add('simulate-fixture', {
    fixtureId,
    input,
    fastMode: true,
    tickDelayMs: 0,
  }, { jobId });

  console.log(`✅ Queued fixture ${fixtureId}: ${homeTeam.name} vs ${awayTeam.name} (${season.name}).`);
}

async function main(): Promise<void> {
  const fixtureId = process.argv[2];
  if (!fixtureId) throw new Error('Usage: npm run simulate:fixture -- <fixture-id>');

  try {
    await enqueueFixtureSimulation(fixtureId);
  } catch (error) {
    console.error('❌ Failed to queue fixture simulation:', error);
    process.exitCode = 1;
  } finally {
    await simulationQueue.close();
    await settlementQueue.close();
    redisConnection.disconnect();
    await client.end();
  }
}

if (require.main === module) {
  void main();
}