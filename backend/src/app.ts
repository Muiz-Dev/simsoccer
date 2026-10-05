import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { db } from './db/index';
import { leagues, seasons, teams, players, teamRatings, fixtures, matches, matchEvents, markets, marketOutcomes, wallets, walletTransactions, bets, betSelections, settlements, standings, adminCredentials, adminSessions, adminAuditLog } from './db/schema/index';
import { authenticateJwt, requireLocalAccount, requireRole, AuthenticatedRequest } from './auth/jwt';
import { placePlayMoneyBet } from './betting/bet-service';
import { createBookingSlip, listBettingMarkets, loadBookingSlip } from './betting/market-service';
import { getFixtureStatistics } from './betting/statistics-service';
import { hashTicketAccessCode, isTicketAccessCode } from './betting/ticket-access';
import { MatchEngine } from './simulation/match-engine';
import { checkDependenciesHealth, getWorldStatusInfo } from './football/coordinator';
import { eq, and, asc, desc, inArray } from 'drizzle-orm';
import { getPrimaryAdminCredential, verifyAdminPin, createAdminSessionToken, hashSessionToken, readAdminSessionTokenFromRequest, getAdminCookieOptions, resolveAdminSession, revokeAdminSession } from './admin/security';
import { coerceLeagueInput, coerceTeamInput } from './admin/operations';
import { z } from 'zod';

const placeBetRequestSchema = z.object({
  selections: z.array(z.object({
    fixtureId: z.string().uuid(),
    marketId: z.string().uuid(),
    outcomeCode: z.string().trim().min(1).max(80),
  }).strict()).min(1).max(20),
  stake: z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/),
  idempotencyKey: z.string().uuid(),
  ticketCode: z.string().regex(/^[A-Za-z0-9_-]{24}$/).optional(),
}).strict();
const ticketLookupRequestSchema = z.object({
  ticketCode: z.string().trim().max(24),
}).strict();

const adminAllowedOrigins = new Set(env.ADMIN_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean));
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'TOO_MANY_ATTEMPTS', message: 'Too many admin PIN attempts. Try again later.' },
});
const bookingCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'TOO_MANY_ATTEMPTS', message: 'Too many booking codes created. Try again later.' },
});
const bookingLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'TOO_MANY_ATTEMPTS', message: 'Too many booking lookups. Try again later.' },
});
const ticketLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'TOO_MANY_ATTEMPTS', message: 'Too many ticket lookups. Try again later.' },
});

async function attachBetTicketDetails(betRows: Array<typeof bets.$inferSelect>) {
  if (betRows.length === 0) return [];

  const betIds = betRows.map((bet) => bet.id);
  const selectionRows = await db.select().from(betSelections).where(inArray(betSelections.betId, betIds));
  const fixtureIds = [...new Set(selectionRows.map((selection) => selection.fixtureId))];
  const marketIds = [...new Set(selectionRows.map((selection) => selection.marketId))];
  const [fixtureRows, marketRows, outcomeRows, settlementRows] = await Promise.all([
    fixtureIds.length ? db.select().from(fixtures).where(inArray(fixtures.id, fixtureIds)) : Promise.resolve([]),
    marketIds.length ? db.select().from(markets).where(inArray(markets.id, marketIds)) : Promise.resolve([]),
    marketIds.length ? db.select().from(marketOutcomes).where(inArray(marketOutcomes.marketId, marketIds)) : Promise.resolve([]),
    db.select().from(settlements).where(inArray(settlements.betId, betIds)),
  ]);
  const teamIds = [...new Set(fixtureRows.flatMap((fixture) => [fixture.homeTeamId, fixture.awayTeamId]))];
  const teamRows = teamIds.length ? await db.select().from(teams).where(inArray(teams.id, teamIds)) : [];
  const selectionsByBet = new Map<string, typeof selectionRows>();
  for (const selection of selectionRows) {
    const rows = selectionsByBet.get(selection.betId) ?? [];
    rows.push(selection);
    selectionsByBet.set(selection.betId, rows);
  }
  const fixturesById = new Map(fixtureRows.map((fixture) => [fixture.id, fixture]));
  const teamsById = new Map(teamRows.map((team) => [team.id, team]));
  const marketsById = new Map(marketRows.map((market) => [market.id, market]));
  const outcomesByKey = new Map(outcomeRows.map((outcome) => [`${outcome.marketId}:${outcome.outcomeCode}`, outcome]));
  const settlementsByBet = new Map(settlementRows.map((settlement) => [settlement.betId, settlement]));

  return betRows.map(({ publicTicketCodeHash: _codeHash, ...bet }) => {
    const settlement = settlementsByBet.get(bet.id);
    return {
      ...bet,
      settlement: settlement ? { status: settlement.status, payoutAmount: settlement.payoutAmount } : null,
      selections: (selectionsByBet.get(bet.id) ?? []).map((selection) => {
        const fixture = fixturesById.get(selection.fixtureId);
        const market = marketsById.get(selection.marketId);
        const outcome = outcomesByKey.get(`${selection.marketId}:${selection.outcomeCode}`);
        return {
          ...selection,
          marketType: market?.marketType ?? 'Market',
          displayName: outcome?.displayName ?? selection.outcomeCode,
          fixture: fixture ? {
            scheduledAt: fixture.scheduledAt,
            status: fixture.status,
            homeScore: fixture.homeScore,
            awayScore: fixture.awayScore,
            homeTeam: teamsById.get(fixture.homeTeamId)?.name ?? 'Home team',
            awayTeam: teamsById.get(fixture.awayTeamId)?.name ?? 'Away team',
          } : null,
        };
      }),
    };
  });
}

function requireAdminOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.get('Origin');
  if (!origin || !adminAllowedOrigins.has(origin)) {
    return res.status(403).json({ error: 'UNTRUSTED_ORIGIN', message: 'Admin requests must come from a configured origin.' });
  }
  return next();
}

async function requireAdminSession(req: Request, res: Response) {
  const token = readAdminSessionTokenFromRequest(req);
  const session = await resolveAdminSession(token);

  if (!session) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Admin session required.' });
    return null;
  }

  return session;
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors((req, callback) => {
    const origin = req.get('Origin');
    if (req.path.startsWith('/api/admin')) {
      if (!origin || !adminAllowedOrigins.has(origin)) return callback(null, { origin: false });
      return callback(null, { origin, credentials: true, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] });
    }
    return callback(null, { origin: origin || '*' });
  }));
  app.use(cookieParser());
  app.use(express.json());

  // 1. Health & World Status Endpoints
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'sim-soccer', environment: env.NODE_ENV, timestamp: new Date().toISOString() });
  });

  app.get('/api/health/live', (req: Request, res: Response) => {
    res.json({ status: 'live', service: 'sim-soccer', timestamp: new Date().toISOString() });
  });

  app.get('/api/health/ready', async (req: Request, res: Response) => {
    const health = await checkDependenciesHealth();
    if (health.postgres && health.redis && health.migrationOk) {
      res.json({ status: 'ready', dependencies: health });
    } else {
      res.status(503).json({ status: 'not_ready', dependencies: health });
    }
  });

  app.get('/api/world/status', async (req: Request, res: Response) => {
    const statusInfo = await getWorldStatusInfo();
    res.json(statusInfo);
  });

  app.get('/api/world/overview', async (req: Request, res: Response) => {
    const seasonNumberValue = req.query.seasonNumber;
    const requestedSeasonNumber = seasonNumberValue === undefined ? undefined : Number(seasonNumberValue);
    const roundValue = req.query.round;
    const requestedRound = roundValue === undefined ? undefined : Number(roundValue);

    if (
      (requestedSeasonNumber !== undefined && (!Number.isInteger(requestedSeasonNumber) || requestedSeasonNumber < 1))
      || (requestedRound !== undefined && (!Number.isInteger(requestedRound) || requestedRound < 1))
    ) {
      return res.status(400).json({ error: 'INVALID_OVERVIEW_QUERY', message: 'Season and round must be positive integers.' });
    }

    const [world, activeLeagues, allSeasons] = await Promise.all([
      getWorldStatusInfo(),
      db.select().from(leagues).where(eq(leagues.active, true)).orderBy(asc(leagues.name)),
      db.select({ seasonNumber: seasons.seasonNumber, name: seasons.name, totalRounds: seasons.totalRounds })
        .from(seasons)
        .orderBy(desc(seasons.seasonNumber)),
    ]);
    const availableSeasons = Array.from(
      new Map(allSeasons.map((season) => [season.seasonNumber, season])).values(),
    );

    const leagueOverviews = await Promise.all(activeLeagues.map(async (league) => {
      const seasonConditions = [eq(seasons.leagueId, league.id)];
      if (requestedSeasonNumber !== undefined) {
        seasonConditions.push(eq(seasons.seasonNumber, requestedSeasonNumber));
      } else {
        seasonConditions.push(eq(seasons.status, 'ACTIVE'));
      }
      const [season] = await db.select().from(seasons)
        .where(and(...seasonConditions))
        .limit(1);

      if (!season) {
        return { league, season: null, standings: [], roundFixtures: [], nextRoundFixtures: [], previousRoundFixtures: [] };
      }

      const selectedRound = Math.min(requestedRound ?? season.currentRound, season.totalRounds);
      const nextRound = selectedRound < season.totalRounds ? selectedRound + 1 : null;
      const previousRound = selectedRound > 1 ? selectedRound - 1 : null;
      const nextRoundQuery = nextRound === null
        ? Promise.resolve([])
        : db.select().from(fixtures)
          .where(and(eq(fixtures.seasonId, season.id), eq(fixtures.round, nextRound)))
          .orderBy(asc(fixtures.scheduledAt), asc(fixtures.id));
      const previousRoundQuery = previousRound === null
        ? Promise.resolve([])
        : db.select().from(fixtures)
          .where(and(eq(fixtures.seasonId, season.id), eq(fixtures.round, previousRound)))
          .orderBy(asc(fixtures.scheduledAt), asc(fixtures.id));
      const [tableRows, roundFixtures, nextRoundFixtures, previousRoundFixtures, leagueTeams] = await Promise.all([
        db.select({
          teamId: teams.id,
          teamName: teams.name,
          shortName: teams.shortName,
          slug: teams.slug,
          played: standings.played,
          won: standings.won,
          drawn: standings.drawn,
          lost: standings.lost,
          goalsFor: standings.goalsFor,
          goalsAgainst: standings.goalsAgainst,
          goalDifference: standings.goalDifference,
          points: standings.points,
        })
          .from(standings)
          .innerJoin(teams, eq(standings.teamId, teams.id))
          .where(eq(standings.seasonId, season.id))
          .orderBy(desc(standings.points), desc(standings.goalDifference), desc(standings.goalsFor), asc(teams.name)),
        db.select().from(fixtures)
        .where(and(eq(fixtures.seasonId, season.id), eq(fixtures.round, selectedRound)))
        .orderBy(asc(fixtures.scheduledAt), asc(fixtures.id)),
        nextRoundQuery,
        previousRoundQuery,
        db.select({ id: teams.id, name: teams.name, shortName: teams.shortName, slug: teams.slug })
          .from(teams)
          .where(eq(teams.leagueId, league.id)),
      ]);

      const teamById = new Map(leagueTeams.map((team) => [team.id, team]));
      const allVisibleFixtures = [...roundFixtures, ...nextRoundFixtures, ...previousRoundFixtures];
      const fixtureIds = allVisibleFixtures.map((fixture) => fixture.id);
      const [matchRows, goalRows] = fixtureIds.length === 0
        ? [[], []]
        : await Promise.all([
          db.select({
            fixtureId: matches.fixtureId,
            status: matches.status,
            virtualSecond: matches.virtualSecond,
            updatedAt: matches.updatedAt,
          })
            .from(matches)
            .where(inArray(matches.fixtureId, fixtureIds)),
          db.select({
            fixtureId: matchEvents.fixtureId,
            sequence: matchEvents.sequence,
            virtualMinute: matchEvents.virtualMinute,
            teamId: matchEvents.teamId,
            playerName: players.name,
            createdAt: matchEvents.createdAt,
          })
            .from(matchEvents)
            .leftJoin(players, eq(matchEvents.playerId, players.id))
            .where(and(inArray(matchEvents.fixtureId, fixtureIds), eq(matchEvents.eventType, 'GOAL')))
            .orderBy(asc(matchEvents.sequence)),
        ]);
      const matchByFixtureId = new Map(matchRows.map((match) => [match.fixtureId, match]));
      const goalsByFixtureId = new Map<string, typeof goalRows>();
      for (const goal of goalRows) {
        const fixtureGoals = goalsByFixtureId.get(goal.fixtureId) ?? [];
        fixtureGoals.push(goal);
        goalsByFixtureId.set(goal.fixtureId, fixtureGoals);
      }

      const formatFixture = (fixture: typeof fixtures.$inferSelect) => {
        const match = matchByFixtureId.get(fixture.id);
        return {
          id: fixture.id,
          round: fixture.round,
          status: fixture.status === 'FINISHED' || match?.status === 'FINISHED' ? 'FINISHED' : fixture.status,
          matchStatus: match?.status ?? null,
          scheduledAt: fixture.scheduledAt,
          startedAt: fixture.startedAt,
          finishedAt: fixture.finishedAt,
          homeScore: fixture.homeScore ?? 0,
          awayScore: fixture.awayScore ?? 0,
          virtualSecond: match?.virtualSecond ?? 0,
          clockUpdatedAt: match?.updatedAt ?? null,
          goalEvents: (goalsByFixtureId.get(fixture.id) ?? []).map((goal) => ({
            sequence: goal.sequence,
            minute: goal.virtualMinute,
            teamId: goal.teamId,
            playerName: goal.playerName,
            createdAt: goal.createdAt,
          })),
          homeTeam: teamById.get(fixture.homeTeamId) ?? null,
          awayTeam: teamById.get(fixture.awayTeamId) ?? null,
        };
      };

      return {
        league,
        season: {
          id: season.id,
          name: season.name,
          seasonNumber: season.seasonNumber,
          currentRound: season.currentRound,
          totalRounds: season.totalRounds,
        },
        standings: tableRows.map((row, index) => ({ position: index + 1, ...row })),
        roundFixtures: roundFixtures.map(formatFixture),
        nextRoundFixtures: nextRoundFixtures.map(formatFixture),
        previousRoundFixtures: previousRoundFixtures.map(formatFixture),
      };
    }));

    res.json({ generatedAt: new Date().toISOString(), world, leagues: leagueOverviews, availableSeasons });
  });

  app.post('/api/admin/login', adminLoginLimiter, requireAdminOrigin, async (req: Request, res: Response) => {
    try {
      const { pin } = req.body ?? {};
      if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
        return res.status(400).json({ error: 'INVALID_PIN', message: 'Enter the four-digit admin PIN.' });
      }

      const credential = await getPrimaryAdminCredential();
      if (!credential) {
        return res.status(503).json({ error: 'ADMIN_NOT_INITIALIZED', message: 'Run the one-time admin bootstrap command first.' });
      }
      const now = new Date();
      if (credential.lockedUntil && new Date(credential.lockedUntil).getTime() > now.getTime()) {
        return res.status(423).json({ error: 'PIN_LOCKED', message: 'Admin pin is temporarily locked.' });
      }

      if (!verifyAdminPin(pin, credential.pinHash)) {
        const failedAttempts = (credential.failedAttempts ?? 0) + 1;
        const lockoutUntil = failedAttempts >= 5 ? new Date(now.getTime() + 15 * 60 * 1000) : null;
        await db.update(adminCredentials)
          .set({
            failedAttempts,
            lockedUntil: lockoutUntil,
            updatedAt: now,
          })
          .where(eq(adminCredentials.id, 'primary'));

        return res.status(401).json({ error: 'INVALID_PIN', message: 'Incorrect admin pin.' });
      }

      await db.update(adminCredentials)
        .set({
          failedAttempts: 0,
          lockedUntil: null,
          updatedAt: now,
        })
        .where(eq(adminCredentials.id, 'primary'));

      const token = createAdminSessionToken('primary');
      const nowTs = Date.now();
      const idleExpiresAt = new Date(nowTs + 30 * 60 * 1000);
      const absoluteExpiresAt = new Date(nowTs + 8 * 60 * 60 * 1000);

      await db.insert(adminSessions).values({
        tokenHash: hashSessionToken(token),
        createdAt: now,
        lastSeenAt: now,
        idleExpiresAt,
        absoluteExpiresAt,
        revokedAt: null,
      });

      res.cookie('sim_admin_session', token, getAdminCookieOptions());
      res.json({
        ok: true,
        user: { id: 'primary', role: 'admin' },
        session: {
          idleExpiresAt: idleExpiresAt.toISOString(),
          absoluteExpiresAt: absoluteExpiresAt.toISOString(),
        },
      });
    } catch (error: any) {
      console.error('Admin login failed:', error);
      res.status(503).json({ error: 'ADMIN_LOGIN_UNAVAILABLE', message: error.message || 'Admin login is unavailable right now.' });
    }
  });

  app.post('/api/admin/logout', requireAdminOrigin, async (req: Request, res: Response) => {
    const token = readAdminSessionTokenFromRequest(req);
    if (token) {
      await revokeAdminSession(token);
    }

    res.clearCookie('sim_admin_session', {
      path: '/',
      sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
      secure: env.NODE_ENV === 'production',
    });
    res.json({ ok: true });
  });

  app.get('/api/admin/me', async (req: Request, res: Response) => {
    const token = readAdminSessionTokenFromRequest(req);
    const session = await resolveAdminSession(token);

    if (!session) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Admin session required.' });
    }

    return res.json({ user: { id: 'primary', role: 'admin' }, session: { id: session.id, idleExpiresAt: session.idleExpiresAt, absoluteExpiresAt: session.absoluteExpiresAt } });
  });

  app.get('/api/admin/summary', async (req: Request, res: Response) => {
    const session = await requireAdminSession(req, res);
    if (!session) return;

    try {
      const [world, leaguesList, seasonsList, teamsList, fixturesList, auditRows] = await Promise.all([
        getWorldStatusInfo(),
        db.select().from(leagues),
        db.select().from(seasons),
        db.select().from(teams),
        db.select().from(fixtures),
        db.select().from(adminAuditLog).orderBy(desc(adminAuditLog.createdAt)).limit(20),
      ]);

      res.json({
        ok: true,
        world,
        counts: {
          leagues: leaguesList.length,
          seasons: seasonsList.length,
          teams: teamsList.length,
          fixtures: fixturesList.length,
        },
        recentAudit: auditRows,
      });
    } catch (error: any) {
      console.error('Admin summary failed:', error);
      res.status(503).json({ error: 'ADMIN_SUMMARY_UNAVAILABLE', message: error.message || 'Admin summary unavailable.' });
    }
  });

  app.get('/api/admin/leagues', async (req: Request, res: Response) => {
    const session = await requireAdminSession(req, res);
    if (!session) return;

    const allLeagues = await db.select().from(leagues).orderBy(asc(leagues.name));
    res.json(allLeagues);
  });

  app.post('/api/admin/leagues', requireAdminOrigin, async (req: Request, res: Response) => {
    const session = await requireAdminSession(req, res);
    if (!session) return;

    try {
      const payload = coerceLeagueInput(req.body ?? {});
      if (!payload.name) {
        return res.status(400).json({ error: 'INVALID_LEAGUE', message: 'League name is required.' });
      }

      const existingId = typeof req.body?.id === 'string' ? req.body.id : null;
      let record: any;

      if (existingId) {
        const [updated] = await db.update(leagues)
          .set({
            name: payload.name,
            slug: payload.slug,
            country: payload.country,
            competitionType: payload.competitionType,
            teamCount: payload.teamCount,
            active: payload.active,
            updatedAt: new Date(),
          })
          .where(eq(leagues.id, existingId))
          .returning();

        record = updated;
      } else {
        const [created] = await db.insert(leagues).values({
          name: payload.name,
          slug: payload.slug,
          country: payload.country,
          competitionType: payload.competitionType,
          teamCount: payload.teamCount,
          active: payload.active,
        }).returning();

        record = created;
      }

      await db.insert(adminAuditLog).values({
        actor: 'primary',
        action: existingId ? 'league.update' : 'league.create',
        targetType: 'league',
        targetId: record.id,
        summary: `League ${payload.name} ${existingId ? 'updated' : 'created'} by admin control room.`,
        metadata: { league: record },
      });

      return res.status(200).json(record);
    } catch (error: any) {
      console.error('Admin league save failed:', error);
      return res.status(500).json({ error: 'ADMIN_LEAGUE_SAVE_FAILED', message: error.message || 'Unable to save league.' });
    }
  });

  app.get('/api/admin/teams', async (req: Request, res: Response) => {
    const session = await requireAdminSession(req, res);
    if (!session) return;

    const activeSeasons = await db.select({ id: seasons.id, name: seasons.name, seasonNumber: seasons.seasonNumber })
      .from(seasons)
      .where(eq(seasons.status, 'ACTIVE'));
    const seasonIds = activeSeasons.map((season) => season.id);
    const ratingRows = seasonIds.length === 0 ? [] : await db.select({
      teamId: teamRatings.teamId,
      seasonId: teamRatings.seasonId,
      overallAbility: teamRatings.overallAbility,
      attackStrength: teamRatings.attackStrength,
      defenseStrength: teamRatings.defenseStrength,
      creationRating: teamRatings.creationRating,
      finishingRating: teamRatings.finishingRating,
      goalkeepingRating: teamRatings.goalkeepingRating,
      pressingRating: teamRatings.pressingRating,
      disciplineRating: teamRatings.disciplineRating,
      homeAdvantage: teamRatings.homeAdvantage,
      form: teamRatings.form,
    })
      .from(teamRatings)
      .where(inArray(teamRatings.seasonId, seasonIds));
    const seasonById = new Map(activeSeasons.map((season) => [season.id, season]));
    const ratingsByTeamId = new Map<string, Array<Record<string, unknown>>>();

    for (const rating of ratingRows) {
      const season = seasonById.get(rating.seasonId);
      const teamRatingsForTeam = ratingsByTeamId.get(rating.teamId) ?? [];
      teamRatingsForTeam.push({
        seasonId: rating.seasonId,
        seasonName: season?.name,
        seasonNumber: season?.seasonNumber,
        overallAbility: Number(rating.overallAbility),
        attackStrength: Number(rating.attackStrength),
        defenseStrength: Number(rating.defenseStrength),
        creationRating: Number(rating.creationRating),
        finishingRating: Number(rating.finishingRating),
        goalkeepingRating: Number(rating.goalkeepingRating),
        pressingRating: Number(rating.pressingRating),
        disciplineRating: Number(rating.disciplineRating),
        homeAdvantage: Number(rating.homeAdvantage),
        form: Number(rating.form),
      });
      ratingsByTeamId.set(rating.teamId, teamRatingsForTeam);
    }

    const teamRows = await db.select({
      id: teams.id,
      leagueId: teams.leagueId,
      name: teams.name,
      shortName: teams.shortName,
      slug: teams.slug,
      stadiumName: teams.stadiumName,
      active: teams.active,
      leagueName: leagues.name,
    })
      .from(teams)
      .leftJoin(leagues, eq(teams.leagueId, leagues.id))
      .orderBy(asc(teams.name));

    res.json(teamRows.map((team) => ({
      ...team,
      ratings: ratingsByTeamId.get(team.id) ?? [],
    })));
  });

  app.post('/api/admin/teams', requireAdminOrigin, async (req: Request, res: Response) => {
    const session = await requireAdminSession(req, res);
    if (!session) return;

    try {
      const payload = coerceTeamInput(req.body ?? {});
      if (!payload.name || !payload.leagueId) {
        return res.status(400).json({ error: 'INVALID_TEAM', message: 'Team name and league are required.' });
      }

      const existingId = typeof req.body?.id === 'string' ? req.body.id : null;
      let record: any;

      if (existingId) {
        const [updated] = await db.update(teams)
          .set({
            leagueId: payload.leagueId,
            name: payload.name,
            shortName: payload.shortName,
            slug: payload.slug,
            stadiumName: payload.stadiumName,
            active: payload.active,
            updatedAt: new Date(),
          })
          .where(eq(teams.id, existingId))
          .returning();

        record = updated;
      } else {
        const [created] = await db.insert(teams).values({
          leagueId: payload.leagueId,
          name: payload.name,
          shortName: payload.shortName,
          slug: payload.slug,
          stadiumName: payload.stadiumName,
          active: payload.active,
        }).returning();

        record = created;
      }

      await db.insert(adminAuditLog).values({
        actor: 'primary',
        action: existingId ? 'team.update' : 'team.create',
        targetType: 'team',
        targetId: record.id,
        summary: `Team ${payload.name} ${existingId ? 'updated' : 'created'} by admin control room.`,
        metadata: { team: record },
      });

      return res.status(200).json(record);
    } catch (error: any) {
      console.error('Admin team save failed:', error);
      return res.status(500).json({ error: 'ADMIN_TEAM_SAVE_FAILED', message: error.message || 'Unable to save team.' });
    }
  });

  app.get('/api/health/database', async (req: Request, res: Response) => {
    try {
      await db.execute(db.select().from(leagues).limit(1));
      res.json({ status: 'ok', database: 'connected' });
    } catch (err: any) {
      res.status(500).json({ status: 'error', database: err.message });
    }
  });

  // 2. Leagues & Seasons API
  app.get('/api/leagues', async (req: Request, res: Response) => {
    const allLeagues = await db.select().from(leagues);
    res.json(allLeagues);
  });

  app.get('/api/seasons', async (req: Request, res: Response) => {
    const allSeasons = await db.select().from(seasons);
    res.json(allSeasons);
  });

  // 3. Fixtures & Matches API
  app.get('/api/fixtures', async (req: Request, res: Response) => {
    const seasonId = req.query.seasonId as string;
    const allFixtures = seasonId
      ? await db.select().from(fixtures).where(eq(fixtures.seasonId, seasonId))
      : await db.select().from(fixtures).limit(50);
    res.json(allFixtures);
  });

  app.get('/api/fixtures/:id', async (req: Request, res: Response) => {
    const fixtureId = req.params.id as string;
    const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
    if (!fixture) return res.status(404).json({ error: 'Fixture not found' });
    res.json(fixture);
  });

  app.get('/api/fixtures/:id/events', async (req: Request, res: Response) => {
    const fixtureId = req.params.id as string;
    const events = await db.select().from(matchEvents).where(eq(matchEvents.fixtureId, fixtureId));
    res.json(events);
  });

  // 4. Markets API — Dynamically derived from team ratings
  app.get('/api/betting/markets', async (req: Request, res: Response) => {
    try {
      const roundValue = req.query.round;
      const round = roundValue === undefined ? undefined : Number(roundValue);
      const leagueId = typeof req.query.leagueId === 'string' ? req.query.leagueId : undefined;
      const result = await listBettingMarkets(round, leagueId);
      return res.json(result);
    } catch (err: any) {
      return res.status(400).json({ error: 'MARKET_QUERY_FAILED', message: err.message });
    }
  });

  app.get('/api/betting/fixtures/:fixtureId/statistics', bookingLookupLimiter, async (req: Request, res: Response) => {
    try {
      const statistics = await getFixtureStatistics(req.params.fixtureId as string);
      if (!statistics) return res.status(404).json({ error: 'FIXTURE_NOT_FOUND', message: 'Fixture not found.' });
      return res.json(statistics);
    } catch (err: any) {
      return res.status(400).json({ error: 'FIXTURE_STATISTICS_FAILED', message: err.message });
    }
  });

  app.post('/api/betting/bookings', bookingCreateLimiter, async (req: Request, res: Response) => {
    try {
      const selections = req.body?.selections;
      if (!Array.isArray(selections) || selections.some((selection) =>
        typeof selection?.fixtureId !== 'string'
        || typeof selection?.marketId !== 'string'
        || typeof selection?.outcomeCode !== 'string'
      )) {
        return res.status(400).json({ error: 'INVALID_BOOKING', message: 'Provide fixtureId, marketId, and outcomeCode for every selection.' });
      }
      const booking = await createBookingSlip(selections);
      return res.status(201).json(booking);
    } catch (err: any) {
      return res.status(400).json({ error: 'BOOKING_CREATE_FAILED', message: err.message });
    }
  });

  app.get('/api/betting/bookings/:code', bookingLookupLimiter, async (req: Request, res: Response) => {
    try {
      const booking = await loadBookingSlip(req.params.code as string);
      return res.json(booking);
    } catch (err: any) {
      const notFound = err.message === 'Booking code not found.';
      return res.status(notFound ? 404 : 400).json({ error: notFound ? 'BOOKING_NOT_FOUND' : 'BOOKING_LOAD_FAILED', message: err.message });
    }
  });

  app.get('/api/fixtures/:id/markets', async (req: Request, res: Response) => {
    const fixtureId = req.params.id as string;
    const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
    if (!fixture) return res.status(404).json({ error: 'FIXTURE_NOT_FOUND', message: 'Fixture not found.' });

    const existingMarkets = await db.select().from(markets).where(eq(markets.fixtureId, fixtureId));
    const marketIds = existingMarkets.map((market) => market.id);
    const outcomes = marketIds.length === 0
      ? []
      : await db.select().from(marketOutcomes).where(inArray(marketOutcomes.marketId, marketIds));
    return res.json(existingMarkets.map((market) => ({
      ...market,
      outcomes: outcomes.filter((outcome) => outcome.marketId === market.id),
    })));
  });

  // 5. Betting API
  app.post('/api/bets', authenticateJwt, requireLocalAccount, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = placeBetRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'INVALID_BET', message: 'Check the stake and selected market.' });
    }

    try {
      const bet = await placePlayMoneyBet({
        userId: req.user!.id,
        ...parsed.data,
      });

      return res.status(201).json(bet);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const safeMessage = message === 'Wallet balance is insufficient.'
        ? message
        : message === 'Betting for this round is closed.' || message === 'Fixture is outside the current betting rounds.'
          ? message
          : message === 'Selected odds are no longer available.'
            || message === 'One or more fixtures are not available for betting.'
            || message === 'All selections must belong to the same world round.'
            || message === 'A straight multiple can include only one selection per fixture.'
            ? message
            : null;
      if (safeMessage) return res.status(409).json({ error: 'BET_NOT_ACCEPTED', message: safeMessage });
      console.error('Bet placement failed:', error);
      return res.status(503).json({ error: 'BETTING_UNAVAILABLE', message: 'Betting is temporarily unavailable. Try again.' });
    }
  });

  app.get('/api/bets', authenticateJwt, requireLocalAccount, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userBets = await db.select().from(bets)
        .where(eq(bets.userId, req.user!.id))
        .orderBy(desc(bets.placedAt))
        .limit(100);
      return res.json(await attachBetTicketDetails(userBets));
    } catch (error) {
      console.error('Bet history lookup failed:', error);
      return res.status(503).json({ error: 'BET_HISTORY_UNAVAILABLE', message: 'Bet history is temporarily unavailable.' });
    }
  });

  app.get('/api/bets/:betId', authenticateJwt, requireLocalAccount, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const [bet] = await db.select().from(bets)
        .where(and(eq(bets.id, req.params.betId as string), eq(bets.userId, req.user!.id)))
        .limit(1);
      if (!bet) return res.status(404).json({ error: 'BET_NOT_FOUND', message: 'Bet ticket was not found.' });
      const [ticket] = await attachBetTicketDetails([bet]);
      return res.json(ticket);
    } catch (error) {
      console.error('Bet ticket lookup failed:', error);
      return res.status(503).json({ error: 'BET_TICKET_UNAVAILABLE', message: 'Bet ticket is temporarily unavailable.' });
    }
  });

  app.post('/api/bets/lookup', ticketLookupLimiter, async (req: Request, res: Response) => {
    const parsed = ticketLookupRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success || !isTicketAccessCode(parsed.data.ticketCode)) {
      return res.status(404).json({ error: 'TICKET_NOT_FOUND', message: 'Ticket code not found.' });
    }

    try {
      const ticketCode = parsed.data.ticketCode;
      const [bet] = await db.select().from(bets)
        .where(eq(bets.publicTicketCodeHash, hashTicketAccessCode(ticketCode)))
        .limit(1);
      if (!bet) return res.status(404).json({ error: 'TICKET_NOT_FOUND', message: 'Ticket code not found.' });
      const [ticket] = await attachBetTicketDetails([bet]);
      const { stake, totalOdds, potentialPayout, status, placedAt, settledAt, settlement, selections } = ticket;
      return res.json({
        stake,
        totalOdds,
        potentialPayout,
        status,
        placedAt,
        settledAt,
        settlement,
        selections: selections.map(({ outcomeCode, odds, status: selectionStatus, marketType, displayName, fixture }) => ({
          outcomeCode,
          odds,
          status: selectionStatus,
          marketType,
          displayName,
          fixture,
        })),
      });
    } catch (error) {
      console.error('Public ticket lookup failed:', error);
      return res.status(503).json({ error: 'TICKET_LOOKUP_UNAVAILABLE', message: 'Ticket details are temporarily unavailable.' });
    }
  });

  // 6. Wallet API
  app.get('/api/wallet', authenticateJwt, requireLocalAccount, async (req: AuthenticatedRequest, res: Response) => {
    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, req.user!.id));
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
    res.json(wallet);
  });

  app.get('/api/wallet/transactions', authenticateJwt, requireLocalAccount, async (req: AuthenticatedRequest, res: Response) => {
    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, req.user!.id));
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });

    const txs = await db.select().from(walletTransactions).where(eq(walletTransactions.walletId, wallet.id));
    res.json(txs);
  });

  // 7. Admin Simulation Lab API — Protected strictly for Admin roles
  app.post('/api/admin/simulation-lab/run', authenticateJwt, requireRole(['admin', 'ADMIN', 'SUPER_ADMIN']), async (req: Request, res: Response) => {
    try {
      const { fixtureId, seed, homeTeam, awayTeam } = req.body;

      const engine = new MatchEngine({
        fixtureId: fixtureId || 'sim-lab-fixture-1',
        seasonId: 'sim-lab-season',
        simulationVersion: '1.0.0',
        seed: seed || 'sim-lab-seed-123',
        homeTeam: homeTeam || { id: 'team-a', name: 'Team A', attackStrength: 1.2, defenseStrength: 1.0, overallRating: 80 },
        awayTeam: awayTeam || { id: 'team-b', name: 'Team B', attackStrength: 1.0, defenseStrength: 1.1, overallRating: 78 },
        homePlayers: [],
        awayPlayers: [],
      });

      const result = engine.simulate();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: 'SIMULATION_LAB_FAILED', message: err.message });
    }
  });

  // Global Error Handler
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('❌ Global error caught:', err);
    res.status(err.status || 500).json({ error: err.code || 'INTERNAL_SERVER_ERROR', message: err.message || 'An unexpected error occurred' });
  });

  return app;
}
