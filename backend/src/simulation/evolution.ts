import { db } from '../db/index';
import { teamRatings, teamRatingHistory, players, playerRatingHistory, standings, fixtures } from '../db/schema/index';
import { SimulationResult } from './types';
import { eq, and } from 'drizzle-orm';

/**
 * Updates dynamic team and player ratings, form, and league standings after match completion.
 */
export async function processPostMatchEvolution(result: SimulationResult) {
  const { fixtureId, homeScore, awayScore, finalState } = result;

  // Guard against duplicate evolution updates for the same fixture
  const existingHistory = await db.select().from(teamRatingHistory).where(eq(teamRatingHistory.matchId, fixtureId)).limit(1);
  if (existingHistory.length > 0) {
    console.log(`ℹ️ Evolution already processed for fixture '${fixtureId}'. Skipping.`);
    return;
  }

  // 1. Fetch Fixture to retrieve SeasonId and Team IDs
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  if (!fixture) return;

  const { seasonId, homeTeamId, awayTeamId } = fixture;

  const homeWon = homeScore > awayScore;
  const isDraw = homeScore === awayScore;
  const awayWon = awayScore > homeScore;

  // 2. Recalculate Standings for Home Team
  const [homeStanding] = await db.select().from(standings).where(
    and(eq(standings.seasonId, seasonId), eq(standings.teamId, homeTeamId))
  );

  if (homeStanding) {
    const played = homeStanding.played + 1;
    const won = homeStanding.won + (homeWon ? 1 : 0);
    const drawn = homeStanding.drawn + (isDraw ? 1 : 0);
    const lost = homeStanding.lost + (awayWon ? 1 : 0);
    const goalsFor = homeStanding.goalsFor + homeScore;
    const goalsAgainst = homeStanding.goalsAgainst + awayScore;
    const goalDifference = goalsFor - goalsAgainst;
    const points = homeStanding.points + (homeWon ? 3 : isDraw ? 1 : 0);

    await db.update(standings)
      .set({ played, won, drawn, lost, goalsFor, goalsAgainst, goalDifference, points, updatedAt: new Date() })
      .where(eq(standings.id, homeStanding.id));
  }

  // 3. Recalculate Standings for Away Team
  const [awayStanding] = await db.select().from(standings).where(
    and(eq(standings.seasonId, seasonId), eq(standings.teamId, awayTeamId))
  );

  if (awayStanding) {
    const played = awayStanding.played + 1;
    const won = awayStanding.won + (awayWon ? 1 : 0);
    const drawn = awayStanding.drawn + (isDraw ? 1 : 0);
    const lost = awayStanding.lost + (homeWon ? 1 : 0);
    const goalsFor = awayStanding.goalsFor + awayScore;
    const goalsAgainst = awayStanding.goalsAgainst + homeScore;
    const goalDifference = goalsFor - goalsAgainst;
    const points = awayStanding.points + (awayWon ? 3 : isDraw ? 1 : 0);

    await db.update(standings)
      .set({ played, won, drawn, lost, goalsFor, goalsAgainst, goalDifference, points, updatedAt: new Date() })
      .where(eq(standings.id, awayStanding.id));
  }

  // 4. Update Team Ratings & Form
  const homeAttackSurprise = homeScore - 1.3;
  const [homeRating] = await db.select().from(teamRatings).where(
    and(eq(teamRatings.seasonId, seasonId), eq(teamRatings.teamId, homeTeamId))
  );

  if (homeRating) {
    const newHomeAttack = Math.max(0.5, Math.min(2.0, parseFloat(homeRating.attackStrength) + homeAttackSurprise * 0.02));
    const homePoints = homeWon ? 3 : isDraw ? 1 : 0;

    await db.update(teamRatings)
      .set({
        attackStrength: newHomeAttack.toFixed(2),
        form: (parseFloat(homeRating.form) * 0.8 + homePoints * 0.1).toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(teamRatings.id, homeRating.id));

    await db.insert(teamRatingHistory).values({
      teamId: homeTeamId,
      matchId: fixtureId,
      attribute: 'attackStrength',
      beforeValue: homeRating.attackStrength,
      afterValue: newHomeAttack.toFixed(2),
      delta: (homeAttackSurprise * 0.02).toFixed(2),
      reason: 'POST_MATCH_PERFORMANCE_UPDATE',
    });
  }

  // 5. Update Player Stats & Form
  for (const pState of Object.values(finalState.homePlayers)) {
    if (pState.minutesPlayed > 0) {
      const ratingDelta = pState.goalsScored * 1.5 + (pState.shotsOnTarget * 0.3) - (pState.yellowCards * 0.5) - (pState.redCard ? 2.0 : 0);
      const [playerRec] = await db.select().from(players).where(eq(players.id, pState.id));

      if (playerRec) {
        const newForm = (parseFloat(playerRec.form) * 0.85 + ratingDelta * 0.15).toFixed(2);
        await db.update(players).set({ form: newForm, updatedAt: new Date() }).where(eq(players.id, pState.id));
      }
    }
  }

  for (const pState of Object.values(finalState.awayPlayers)) {
    if (pState.minutesPlayed > 0) {
      const ratingDelta = pState.goalsScored * 1.5 + (pState.shotsOnTarget * 0.3) - (pState.yellowCards * 0.5) - (pState.redCard ? 2.0 : 0);
      const [playerRec] = await db.select().from(players).where(eq(players.id, pState.id));

      if (playerRec) {
        const newForm = (parseFloat(playerRec.form) * 0.85 + ratingDelta * 0.15).toFixed(2);
        await db.update(players).set({ form: newForm, updatedAt: new Date() }).where(eq(players.id, pState.id));
      }
    }
  }
}
