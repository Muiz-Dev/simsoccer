import { randomBytes } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index';
import {
  bookingSlipSelections,
  bookingSlips,
  fixtures,
  leagues,
  marketOutcomes,
  markets,
  seasons,
  teams,
  worldRuntime,
} from '../db/schema/index';
import { getRoundCutoffAt, isRoundMarketOpen, selectDefaultBettingRound } from './round-market-policy';

const MAX_BOOKING_SELECTIONS = 20;

export interface BookingSelectionInput {
  fixtureId: string;
  marketId: string;
  outcomeCode: string;
}

export async function listBettingMarkets(requestedRound?: number, leagueId?: string) {
  const [runtime] = await db.select().from(worldRuntime).where(eq(worldRuntime.id, 'singleton')).limit(1);
  if (!runtime || runtime.currentRound < 1) {
    return {
      round: 1,
      worldRound: 0,
      totalRounds: 0,
      currentRoundOpen: false,
      defaultRound: 1,
      nextRoundAvailable: false,
      serverNow: new Date(),
      cutoffAt: null,
      fixtures: [],
    };
  }

  const activeCompetitions = await db.select({
    leagueId: leagues.id,
    leagueName: leagues.name,
    seasonId: seasons.id,
    seasonName: seasons.name,
  })
    .from(seasons)
    .innerJoin(leagues, eq(seasons.leagueId, leagues.id))
    .where(and(eq(seasons.status, 'ACTIVE'), eq(leagues.active, true)))
    .orderBy(asc(leagues.name));

  const activeSeasonIds = activeCompetitions.map((competition) => competition.seasonId);
  const currentRoundFixtures = activeSeasonIds.length === 0
    ? []
    : await db.select({ scheduledAt: fixtures.scheduledAt, status: fixtures.status })
      .from(fixtures)
      .where(and(inArray(fixtures.seasonId, activeSeasonIds), eq(fixtures.round, runtime.currentRound)));
  const nextRoundFixtures = runtime.currentRound >= runtime.totalRounds || activeSeasonIds.length === 0
    ? []
    : await db.select({ scheduledAt: fixtures.scheduledAt, status: fixtures.status })
      .from(fixtures)
      .where(and(inArray(fixtures.seasonId, activeSeasonIds), eq(fixtures.round, runtime.currentRound + 1)));
  const [clock] = await db.select({ now: sql<Date>`now()` })
    .from(worldRuntime)
    .where(eq(worldRuntime.id, 'singleton'))
    .limit(1);
  const serverNow = clock?.now ?? new Date();
  const currentRoundKickoffs = currentRoundFixtures
    .filter((fixture) => fixture.status !== 'CANCELLED' && fixture.status !== 'POSTPONED')
    .map((fixture) => fixture.scheduledAt);
  const nextRoundKickoffs = nextRoundFixtures
    .filter((fixture) => fixture.status === 'SCHEDULED')
    .map((fixture) => fixture.scheduledAt);
  const currentRoundOpen = isRoundMarketOpen(currentRoundKickoffs, serverNow);
  const defaultRound = selectDefaultBettingRound(
    runtime.currentRound,
    currentRoundKickoffs,
    nextRoundKickoffs,
    serverNow,
  );
  const round = requestedRound ?? defaultRound;
  if (!Number.isInteger(round) || round < runtime.currentRound || round > runtime.currentRound + 1) {
    throw new Error('Only the current or next world round is available.');
  }

  const competitions = leagueId
    ? activeCompetitions.filter((competition) => competition.leagueId === leagueId)
    : activeCompetitions;
  const seasonIds = competitions.map((competition) => competition.seasonId);
  const fixtureRows = seasonIds.length === 0
    ? []
    : await db.select().from(fixtures)
      .where(and(inArray(fixtures.seasonId, seasonIds), eq(fixtures.round, round)))
      .orderBy(asc(fixtures.scheduledAt), asc(fixtures.id));
  const roundFixtures = activeSeasonIds.length === 0
    ? []
    : await db.select({ scheduledAt: fixtures.scheduledAt, status: fixtures.status })
      .from(fixtures)
      .where(and(inArray(fixtures.seasonId, activeSeasonIds), eq(fixtures.round, round)));

  const fixtureIds = fixtureRows.map((fixture) => fixture.id);
  const persistedMarkets = fixtureIds.length === 0
    ? []
    : await db.select().from(markets).where(inArray(markets.fixtureId, fixtureIds)).orderBy(asc(markets.marketType));
  const newestMarketByFixtureScope = new Map<string, typeof persistedMarkets[number]>();
  for (const market of [...persistedMarkets].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())) {
    const key = `${market.fixtureId}:${market.marketType}:${market.marketScope}`;
    if (!newestMarketByFixtureScope.has(key)) newestMarketByFixtureScope.set(key, market);
  }
  const marketRows = [...newestMarketByFixtureScope.values()];
  const marketIds = marketRows.map((market) => market.id);
  const outcomeRows = marketIds.length === 0
    ? []
    : await db.select().from(marketOutcomes).where(inArray(marketOutcomes.marketId, marketIds)).orderBy(asc(marketOutcomes.outcomeCode));
  const teamIds = [...new Set(fixtureRows.flatMap((fixture) => [fixture.homeTeamId, fixture.awayTeamId]))];
  const teamRows = teamIds.length === 0 ? [] : await db.select().from(teams).where(inArray(teams.id, teamIds));
  const teamById = new Map(teamRows.map((team) => [team.id, team]));
  const competitionBySeasonId = new Map(competitions.map((competition) => [competition.seasonId, competition]));
  const marketsByFixture = new Map<string, Array<typeof marketRows[number] & { outcomes: typeof outcomeRows }>>();

  for (const market of marketRows) {
    const outcomes = outcomeRows.filter((outcome) => outcome.marketId === market.id);
    const fixtureMarkets = marketsByFixture.get(market.fixtureId) ?? [];
    fixtureMarkets.push({ ...market, outcomes });
    marketsByFixture.set(market.fixtureId, fixtureMarkets);
  }

  const cutoffAt = getRoundCutoffAt(
    roundFixtures
      .filter((fixture) => fixture.status !== 'CANCELLED' && fixture.status !== 'POSTPONED')
      .map((fixture) => fixture.scheduledAt),
  );
  const roundOpen = cutoffAt !== null && serverNow < cutoffAt;

  return {
    round,
    worldRound: runtime.currentRound,
    totalRounds: runtime.totalRounds,
    currentRoundOpen,
    defaultRound,
    nextRoundAvailable: isRoundMarketOpen(nextRoundKickoffs, serverNow),
    serverNow,
    cutoffAt,
    fixtures: fixtureRows.map((fixture) => {
      const competition = competitionBySeasonId.get(fixture.seasonId);
      const fixtureMarkets = (marketsByFixture.get(fixture.id) ?? []).map((market) => {
        const status = market.status === 'OPEN' && !roundOpen ? 'SUSPENDED' : market.status;
        return {
          ...market,
          status,
          outcomes: market.outcomes.map((outcome) => ({
            ...outcome,
            status: status === 'OPEN' ? outcome.status : status,
          })),
        };
      });
      return {
        id: fixture.id,
        round: fixture.round,
        scheduledAt: fixture.scheduledAt,
        status: fixture.status,
        homeScore: fixture.homeScore,
        awayScore: fixture.awayScore,
        homeTeam: teamById.get(fixture.homeTeamId) ?? null,
        awayTeam: teamById.get(fixture.awayTeamId) ?? null,
        league: competition ? { id: competition.leagueId, name: competition.leagueName } : null,
        season: competition ? { id: competition.seasonId, name: competition.seasonName } : null,
        markets: fixtureMarkets,
      };
    }),
  };
}

export async function createBookingSlip(selections: BookingSelectionInput[]) {
  if (selections.length === 0 || selections.length > MAX_BOOKING_SELECTIONS) {
    throw new Error(`A booking slip must contain between 1 and ${MAX_BOOKING_SELECTIONS} selections.`);
  }

  const fixtureIds = selections.map((selection) => selection.fixtureId);
  if (new Set(fixtureIds).size !== fixtureIds.length) {
    throw new Error('A booking slip can include only one selection per fixture.');
  }

  const code = randomBytes(8).toString('hex').toUpperCase();
  const createdCode = await db.transaction(async (tx) => {
    const selectedFixtures = await tx.select({
      id: fixtures.id,
      round: fixtures.round,
      status: fixtures.status,
      scheduledAt: fixtures.scheduledAt,
      seasonId: seasons.id,
    })
      .from(fixtures)
      .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
      .innerJoin(leagues, eq(seasons.leagueId, leagues.id))
      .where(and(inArray(fixtures.id, fixtureIds), eq(seasons.status, 'ACTIVE'), eq(leagues.active, true)));

    if (selectedFixtures.length !== fixtureIds.length) {
      throw new Error('One or more fixtures are not in an active season.');
    }

    const selectedRound = selectedFixtures[0].round;
    if (selectedFixtures.some((fixture) => fixture.round !== selectedRound)) {
      throw new Error('All booking selections must belong to the same world round.');
    }

    const [runtime] = await tx.select({ currentRound: worldRuntime.currentRound })
      .from(worldRuntime)
      .where(eq(worldRuntime.id, 'singleton'))
      .limit(1);
    if (!runtime || selectedRound < runtime.currentRound || selectedRound > runtime.currentRound + 1) {
      throw new Error('Booking selections must belong to the current or next world round.');
    }
    if (selectedFixtures.some((fixture) => fixture.status !== 'SCHEDULED')) {
      throw new Error('A selected fixture is no longer available for pre-match betting.');
    }

    const activeSeasonRows = await tx.select({ seasonId: seasons.id })
      .from(seasons)
      .innerJoin(leagues, eq(seasons.leagueId, leagues.id))
      .where(and(eq(seasons.status, 'ACTIVE'), eq(leagues.active, true)));
    const activeSeasonIds = activeSeasonRows.map((season) => season.seasonId);
    const roundFixtures = await tx.select({ scheduledAt: fixtures.scheduledAt, status: fixtures.status })
      .from(fixtures)
      .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
      .where(and(inArray(fixtures.seasonId, activeSeasonIds), eq(fixtures.round, selectedRound)));
    const cutoffAt = getRoundCutoffAt(
      roundFixtures
        .filter((fixture) => fixture.status !== 'CANCELLED' && fixture.status !== 'POSTPONED')
        .map((fixture) => fixture.scheduledAt),
    );
    const [clock] = await tx.select({ now: sql<Date>`now()` }).from(worldRuntime).limit(1);
    if (!cutoffAt || !clock || clock.now >= cutoffAt) {
      throw new Error('Betting for this round is suspended.');
    }

    const marketIds = [...new Set(selections.map((selection) => selection.marketId))];
    const availableOutcomes = await tx.select({
      marketId: markets.id,
      fixtureId: markets.fixtureId,
      marketStatus: markets.status,
      outcomeCode: marketOutcomes.outcomeCode,
      outcomeId: marketOutcomes.id,
      outcomeStatus: marketOutcomes.status,
      odds: marketOutcomes.odds,
    })
      .from(markets)
      .innerJoin(marketOutcomes, eq(marketOutcomes.marketId, markets.id))
      .where(inArray(markets.id, marketIds));

    const quoteBySelection = new Map(availableOutcomes.map((outcome) => [
      `${outcome.marketId}:${outcome.outcomeCode}`,
      outcome,
    ]));

    const selectionRows = selections.map((selection) => {
      const quote = quoteBySelection.get(`${selection.marketId}:${selection.outcomeCode}`);
      if (!quote || quote.fixtureId !== selection.fixtureId) {
        throw new Error('A selected market outcome could not be found for its fixture.');
      }
      if (quote.marketStatus !== 'OPEN' || quote.outcomeStatus !== 'OPEN') {
        throw new Error('A selected market is suspended or closed.');
      }
      return {
        fixtureId: selection.fixtureId,
        marketId: selection.marketId,
        marketOutcomeId: quote.outcomeId,
        quotedOdds: quote.odds,
      };
    });

    const [slip] = await tx.insert(bookingSlips).values({ code }).returning({ id: bookingSlips.id });
    await tx.insert(bookingSlipSelections).values(selectionRows.map((selection) => ({
      ...selection,
      bookingSlipId: slip.id,
    })));
    return code;
  });

  return loadBookingSlip(createdCode);
}

export async function loadBookingSlip(rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  const [slip] = await db.select().from(bookingSlips).where(eq(bookingSlips.code, code)).limit(1);
  if (!slip) throw new Error('Booking code not found.');

  const rows = await db.select({
    fixtureId: bookingSlipSelections.fixtureId,
    marketId: bookingSlipSelections.marketId,
    outcomeId: bookingSlipSelections.marketOutcomeId,
    quotedOdds: bookingSlipSelections.quotedOdds,
    currentOdds: marketOutcomes.odds,
    outcomeCode: marketOutcomes.outcomeCode,
    displayName: marketOutcomes.displayName,
    outcomeStatus: marketOutcomes.status,
    marketType: markets.marketType,
    marketStatus: markets.status,
    fixtureStatus: fixtures.status,
    scheduledAt: fixtures.scheduledAt,
    round: fixtures.round,
    seasonId: seasons.id,
    leagueId: leagues.id,
    leagueName: leagues.name,
    homeTeamId: fixtures.homeTeamId,
    awayTeamId: fixtures.awayTeamId,
    seasonStatus: seasons.status,
    leagueActive: leagues.active,
  })
    .from(bookingSlipSelections)
    .innerJoin(fixtures, eq(bookingSlipSelections.fixtureId, fixtures.id))
    .innerJoin(markets, eq(bookingSlipSelections.marketId, markets.id))
    .innerJoin(marketOutcomes, eq(bookingSlipSelections.marketOutcomeId, marketOutcomes.id))
    .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
    .innerJoin(leagues, eq(seasons.leagueId, leagues.id))
    .where(eq(bookingSlipSelections.bookingSlipId, slip.id))
    .orderBy(asc(bookingSlipSelections.createdAt));

  const round = rows[0]?.round ?? null;
  const activeSeasonRows = await db.select({ seasonId: seasons.id })
    .from(seasons)
    .innerJoin(leagues, eq(seasons.leagueId, leagues.id))
    .where(and(eq(seasons.status, 'ACTIVE'), eq(leagues.active, true)));
  const activeSeasonIds = activeSeasonRows.map((season) => season.seasonId);
  const roundFixtures = round === null || activeSeasonIds.length === 0
    ? []
    : await db.select({ scheduledAt: fixtures.scheduledAt, status: fixtures.status })
      .from(fixtures)
      .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
      .where(and(inArray(fixtures.seasonId, activeSeasonIds), eq(fixtures.round, round)));
  const cutoffAt = getRoundCutoffAt(
    roundFixtures
      .filter((fixture) => fixture.status !== 'CANCELLED' && fixture.status !== 'POSTPONED')
      .map((fixture) => fixture.scheduledAt),
  );
  const [clock] = await db.select({ now: sql<Date>`now()` })
    .from(worldRuntime)
    .where(eq(worldRuntime.id, 'singleton'))
    .limit(1);
  const [runtime] = await db.select({ currentRound: worldRuntime.currentRound })
    .from(worldRuntime)
    .where(eq(worldRuntime.id, 'singleton'))
    .limit(1);
  const roundOpen = cutoffAt !== null
    && clock !== undefined
    && runtime !== undefined
    && (round === runtime.currentRound || round === runtime.currentRound + 1)
    && clock.now < cutoffAt;
  const teamIds = [...new Set(rows.flatMap((row) => [row.homeTeamId, row.awayTeamId]))];
  const teamRows = teamIds.length === 0 ? [] : await db.select().from(teams).where(inArray(teams.id, teamIds));
  const teamById = new Map(teamRows.map((team) => [team.id, team]));

  const loadedSelections = rows.map((row) => {
    const status = roundOpen
      && row.fixtureStatus === 'SCHEDULED'
      && row.seasonStatus === 'ACTIVE'
      && row.leagueActive
      && row.marketStatus === 'OPEN'
      && row.outcomeStatus === 'OPEN'
      ? 'OPEN'
      : 'SUSPENDED';
    const quotedOdds = Number(row.quotedOdds);
    const currentOdds = Number(row.currentOdds);
    return {
      fixtureId: row.fixtureId,
      marketId: row.marketId,
      outcomeId: row.outcomeId,
      round: row.round,
      scheduledAt: row.scheduledAt,
      league: { id: row.leagueId, name: row.leagueName },
      homeTeam: teamById.get(row.homeTeamId) ?? null,
      awayTeam: teamById.get(row.awayTeamId) ?? null,
      marketType: row.marketType,
      outcomeCode: row.outcomeCode,
      displayName: row.displayName,
      quotedOdds: quotedOdds.toFixed(2),
      currentOdds: currentOdds.toFixed(2),
      priceChanged: quotedOdds !== currentOdds,
      status,
    };
  });

  return {
    code: slip.code,
    createdAt: slip.createdAt,
    round,
    cutoffAt,
    selections: loadedSelections,
    available: loadedSelections.length > 0
      && loadedSelections.every((selection) => selection.status === 'OPEN' && !selection.priceChanged),
  };
}
