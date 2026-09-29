import { verifySafeDatabase } from '../db/guard';
import { db } from '../db/index';
import { leagues, seasons, teams, teamRatings, players, fixtures, standings, users, wallets } from '../db/schema/index';
import { COMPETITIONS_DATA } from './data/competitions';
import { generateDoubleRoundRobin } from './fixture-generator';
import { eq, and } from 'drizzle-orm';

export async function seedDatabase(targetSeasonName: string = '2025-2026') {
  verifySafeDatabase(`Seed Database for Season ${targetSeasonName}`);

  console.log(`🌱 Starting database seed for season '${targetSeasonName}'...`);

  // Ensure default system user and play-money wallet exist
  let [systemUser] = await db.select().from(users).where(eq(users.email, 'demo@simsoccer.com'));
  if (!systemUser) {
    [systemUser] = await db.insert(users).values({
      email: 'demo@simsoccer.com',
      role: 'ADMIN',
    }).returning();

    await db.insert(wallets).values({
      userId: systemUser.id,
      currency: 'VIRTUAL',
      balance: '10000.00',
    });
    console.log('👤 Created demo user demo@simsoccer.com with 10,000 virtual credits wallet.');
  }

  for (const [leagueSlug, compData] of Object.entries(COMPETITIONS_DATA)) {
    console.log(`\n🏆 Processing League: ${compData.leagueName} (${compData.country})...`);

    // 1. Get or create league
    let [leagueRecord] = await db.select().from(leagues).where(eq(leagues.slug, compData.slug));
    if (!leagueRecord) {
      [leagueRecord] = await db.insert(leagues).values({
        name: compData.leagueName,
        slug: compData.slug,
        country: compData.country,
        teamCount: compData.teams.length,
      }).returning();
    }

    // 2. Get or create season
    let [seasonRecord] = await db.select().from(seasons).where(
      and(eq(seasons.leagueId, leagueRecord.id), eq(seasons.name, targetSeasonName))
    );

    if (!seasonRecord) {
      [seasonRecord] = await db.insert(seasons).values({
        leagueId: leagueRecord.id,
        name: targetSeasonName,
        seasonNumber: 1,
        status: 'SCHEDULED',
        totalRounds: 38,
      }).returning();
    }

    // 3. Process 20 Teams, Ratings, Standings and Players in Batch
    const createdTeamIds: string[] = [];

    for (const teamData of compData.teams) {
      let [teamRecord] = await db.select().from(teams).where(eq(teams.slug, teamData.slug));
      if (!teamRecord) {
        [teamRecord] = await db.insert(teams).values({
          leagueId: leagueRecord.id,
          name: teamData.name,
          shortName: teamData.shortName,
          slug: teamData.slug,
          stadiumName: teamData.stadiumName,
        }).returning();
      }
      createdTeamIds.push(teamRecord.id);

      // Upsert Team Rating
      let [ratingRecord] = await db.select().from(teamRatings).where(
        and(eq(teamRatings.teamId, teamRecord.id), eq(teamRatings.seasonId, seasonRecord.id))
      );
      if (!ratingRecord) {
        await db.insert(teamRatings).values({
          teamId: teamRecord.id,
          seasonId: seasonRecord.id,
          overallAbility: teamData.overallRating.toFixed(1),
          attackStrength: teamData.attackStrength.toFixed(2),
          defenseStrength: teamData.defenseStrength.toFixed(2),
          creationRating: '1.00',
          finishingRating: '1.00',
          goalkeepingRating: '1.00',
          pressingRating: '1.00',
          disciplineRating: '1.00',
          homeAdvantage: '1.10',
        });
      }

      // Upsert Initial Standings
      let [standingRecord] = await db.select().from(standings).where(
        and(eq(standings.seasonId, seasonRecord.id), eq(standings.teamId, teamRecord.id))
      );
      if (!standingRecord) {
        await db.insert(standings).values({
          seasonId: seasonRecord.id,
          teamId: teamRecord.id,
        });
      }

      // Upsert 11 Starter Players
      const existingPlayers = await db.select().from(players).where(eq(players.teamId, teamRecord.id));
      if (existingPlayers.length === 0) {
        const positions = ['GK', 'CB', 'CB', 'LB', 'RB', 'CM', 'CM', 'AM', 'LW', 'RW', 'ST'];
        const playersToInsert = positions.map((pos, i) => ({
          teamId: teamRecord.id,
          name: `${teamData.shortName} Player ${i + 1}`,
          age: 22 + (i % 8),
          primaryPosition: pos,
          pace: Math.floor(65 + Math.random() * 25),
          shooting: pos === 'ST' ? 82 : Math.floor(60 + Math.random() * 20),
          passing: Math.floor(65 + Math.random() * 25),
          dribbling: Math.floor(65 + Math.random() * 25),
          defending: pos === 'CB' ? 82 : Math.floor(55 + Math.random() * 25),
          physical: Math.floor(65 + Math.random() * 25),
          goalkeeping: pos === 'GK' ? 82 : 10,
          overallRating: teamData.overallRating,
          potential: teamData.overallRating + 4,
        }));
        await db.insert(players).values(playersToInsert);
      }
    }

    // 4. Batch Insert 38 Rounds / 380 Fixtures
    const existingFixtures = await db.select().from(fixtures).where(eq(fixtures.seasonId, seasonRecord.id));
    if (existingFixtures.length === 0) {
      console.log(`  📅 Generating 380 fixtures for ${compData.leagueName}...`);
      const pairings = generateDoubleRoundRobin(createdTeamIds.length);
      const now = new Date();

      const fixturesToInsert = pairings.map((pairing) => ({
        seasonId: seasonRecord.id,
        round: pairing.round,
        homeTeamId: createdTeamIds[pairing.homeTeamIndex],
        awayTeamId: createdTeamIds[pairing.awayTeamIndex],
        scheduledAt: new Date(now.getTime() + pairing.round * 86400000),
        status: 'SCHEDULED',
      }));

      // Insert in batch chunks of 100
      for (let i = 0; i < fixturesToInsert.length; i += 100) {
        await db.insert(fixtures).values(fixturesToInsert.slice(i, i + 100));
      }
      console.log(`  ✅ Generated 38 rounds (380 fixtures) for ${compData.leagueName}.`);
    } else {
      console.log(`  ℹ️ Fixtures already exist for ${compData.leagueName} (${existingFixtures.length} found).`);
    }
  }

  console.log('\n🎉 Seeding complete for all initial competitions!');
  process.exit(0);
}

if (require.main === module) {
  const selectedSeason = process.argv[2] || '2025-2026';
  seedDatabase(selectedSeason).catch((err) => {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  });
}
