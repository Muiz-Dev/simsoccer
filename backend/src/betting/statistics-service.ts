import { and, asc, desc, eq, or } from 'drizzle-orm';
import { db } from '../db/index';
import { fixtures, teams } from '../db/schema/index';

function outcomeForTeam(teamId: string, fixture: {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
}): 'W' | 'D' | 'L' {
  const teamScore = fixture.homeTeamId === teamId ? fixture.homeScore ?? 0 : fixture.awayScore ?? 0;
  const opponentScore = fixture.homeTeamId === teamId ? fixture.awayScore ?? 0 : fixture.homeScore ?? 0;
  return teamScore > opponentScore ? 'W' : teamScore < opponentScore ? 'L' : 'D';
}

export async function getFixtureStatistics(fixtureId: string) {
  const [target] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId)).limit(1);
  if (!target) return null;

  const [homeTeam, awayTeam] = await Promise.all([
    db.select().from(teams).where(eq(teams.id, target.homeTeamId)).limit(1),
    db.select().from(teams).where(eq(teams.id, target.awayTeamId)).limit(1),
  ]);
  const homeName = homeTeam[0]?.name ?? 'Home';
  const awayName = awayTeam[0]?.name ?? 'Away';
  const samePair = or(
    and(eq(fixtures.homeTeamId, target.homeTeamId), eq(fixtures.awayTeamId, target.awayTeamId)),
    and(eq(fixtures.homeTeamId, target.awayTeamId), eq(fixtures.awayTeamId, target.homeTeamId)),
  );
  const headToHeadRows = await db.select().from(fixtures)
    .where(and(eq(fixtures.status, 'FINISHED'), samePair))
    .orderBy(desc(fixtures.scheduledAt), desc(fixtures.id))
    .limit(5);

  const loadRecentForm = async (teamId: string) => {
    const rows = await db.select().from(fixtures)
      .where(and(
        eq(fixtures.status, 'FINISHED'),
        or(eq(fixtures.homeTeamId, teamId), eq(fixtures.awayTeamId, teamId)),
      ))
      .orderBy(desc(fixtures.scheduledAt), desc(fixtures.id))
      .limit(5);
    const opponentIds = [...new Set(rows.map((row) => row.homeTeamId === teamId ? row.awayTeamId : row.homeTeamId))];
    const opponentRows = opponentIds.length === 0
      ? []
      : await db.select().from(teams).where(or(...opponentIds.map((opponentId) => eq(teams.id, opponentId))));
    const opponents = new Map(opponentRows.map((team) => [team.id, team.name]));
    return {
      sampleSize: rows.length,
      record: {
        wins: rows.filter((row) => outcomeForTeam(teamId, row) === 'W').length,
        draws: rows.filter((row) => outcomeForTeam(teamId, row) === 'D').length,
        losses: rows.filter((row) => outcomeForTeam(teamId, row) === 'L').length,
      },
      matches: rows.map((row) => {
        const home = row.homeTeamId === teamId;
        const opponentId = home ? row.awayTeamId : row.homeTeamId;
        return {
          fixtureId: row.id,
          scheduledAt: row.scheduledAt,
          opponent: opponents.get(opponentId) ?? 'Unknown team',
          teamScore: home ? row.homeScore : row.awayScore,
          opponentScore: home ? row.awayScore : row.homeScore,
          outcome: outcomeForTeam(teamId, row),
        };
      }),
    };
  };

  const [homeForm, awayForm] = await Promise.all([
    loadRecentForm(target.homeTeamId),
    loadRecentForm(target.awayTeamId),
  ]);

  const headToHeadTeamIds = [...new Set(headToHeadRows.flatMap((row) => [row.homeTeamId, row.awayTeamId]))];
  const headToHeadTeams = headToHeadTeamIds.length === 0
    ? []
    : await db.select().from(teams).where(or(...headToHeadTeamIds.map((teamId) => eq(teams.id, teamId))));
  const teamNames = new Map(headToHeadTeams.map((team) => [team.id, team.name]));

  return {
    fixtureId,
    homeTeam: { id: target.homeTeamId, name: homeName, sampleSize: homeForm.sampleSize, form: homeForm },
    awayTeam: { id: target.awayTeamId, name: awayName, sampleSize: awayForm.sampleSize, form: awayForm },
    headToHead: {
      sampleSize: headToHeadRows.length,
      homeWins: headToHeadRows.filter((row) => {
        const score = row.homeTeamId === target.homeTeamId ? row.homeScore : row.awayScore;
        const opponentScore = row.homeTeamId === target.homeTeamId ? row.awayScore : row.homeScore;
        return (score ?? 0) > (opponentScore ?? 0);
      }).length,
      draws: headToHeadRows.filter((row) => row.homeScore === row.awayScore).length,
      awayWins: headToHeadRows.filter((row) => {
        const score = row.homeTeamId === target.awayTeamId ? row.homeScore : row.awayScore;
        const opponentScore = row.homeTeamId === target.awayTeamId ? row.awayScore : row.homeScore;
        return (score ?? 0) > (opponentScore ?? 0);
      }).length,
      meetings: headToHeadRows.map((row) => ({
        fixtureId: row.id,
        scheduledAt: row.scheduledAt,
        homeTeam: teamNames.get(row.homeTeamId) ?? 'Unknown team',
        awayTeam: teamNames.get(row.awayTeamId) ?? 'Unknown team',
        homeScore: row.homeScore,
        awayScore: row.awayScore,
        resultForSelectedHome: outcomeForTeam(target.homeTeamId, row),
      })),
    },
  };
}
