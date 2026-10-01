import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { db } from './db/index';
import { leagues, seasons, teams, teamRatings, fixtures, matches, matchEvents, markets, marketOutcomes, wallets, walletTransactions, bets, betSelections, standings, adminCredentials, adminSessions, adminAuditLog } from './db/schema/index';
import { authenticateJwt, requireRole, AuthenticatedRequest } from './auth/jwt';
import { calculateAllPreMatchMarkets } from './markets/probability-engine';
import { placePlayMoneyBet } from './betting/bet-service';
import { MatchEngine } from './simulation/match-engine';
import { checkDependenciesHealth, getWorldStatusInfo } from './football/coordinator';
import { eq, and, asc, desc, inArray } from 'drizzle-orm';
import { getPrimaryAdminCredential, verifyAdminPin, createAdminSessionToken, hashSessionToken, readAdminSessionTokenFromRequest, getAdminCookieOptions, resolveAdminSession, revokeAdminSession } from './admin/security';
import { coerceLeagueInput, coerceTeamInput } from './admin/operations';

const adminAllowedOrigins = new Set(env.ADMIN_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean));
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'TOO_MANY_ATTEMPTS', message: 'Too many admin PIN attempts. Try again later.' },
});

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
    const [world, activeLeagues] = await Promise.all([
      getWorldStatusInfo(),
      db.select().from(leagues).where(eq(leagues.active, true)).orderBy(asc(leagues.name)),
    ]);

    const leagueOverviews = await Promise.all(activeLeagues.map(async (league) => {
      const [season] = await db.select().from(seasons)
        .where(and(eq(seasons.leagueId, league.id), eq(seasons.status, 'ACTIVE')))
        .limit(1);

      if (!season) {
        return { league, season: null, standings: [], roundFixtures: [], nextRoundFixtures: [], previousRoundFixtures: [] };
      }

      const nextRound = season.currentRound < season.totalRounds ? season.currentRound + 1 : null;
      const previousRound = season.currentRound > 1 ? season.currentRound - 1 : null;
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
          .where(and(eq(fixtures.seasonId, season.id), eq(fixtures.round, season.currentRound)))
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
      const matchRows = fixtureIds.length === 0
        ? []
        : await db.select({
          fixtureId: matches.fixtureId,
          status: matches.status,
          virtualSecond: matches.virtualSecond,
          updatedAt: matches.updatedAt,
        })
          .from(matches)
          .where(inArray(matches.fixtureId, fixtureIds));
      const matchByFixtureId = new Map(matchRows.map((match) => [match.fixtureId, match]));

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

    res.json({ generatedAt: new Date().toISOString(), world, leagues: leagueOverviews });
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
  app.get('/api/fixtures/:id/markets', async (req: Request, res: Response) => {
    const fixtureId = req.params.id as string;
    const existingMarkets = await db.select().from(markets).where(eq(markets.fixtureId, fixtureId));

    if (existingMarkets.length > 0) {
      const result = [];
      for (const m of existingMarkets) {
        const outcomes = await db.select().from(marketOutcomes).where(eq(marketOutcomes.marketId, m.id));
        result.push({ ...m, outcomes });
      }
      return res.json(result);
    }

    // Retrieve fixture & team ratings dynamically
    const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
    let lambdaHome = 1.30;
    let lambdaAway = 1.05;

    if (fixture) {
      const [homeRating] = await db.select().from(teamRatings).where(and(eq(teamRatings.seasonId, fixture.seasonId), eq(teamRatings.teamId, fixture.homeTeamId)));
      const [awayRating] = await db.select().from(teamRatings).where(and(eq(teamRatings.seasonId, fixture.seasonId), eq(teamRatings.teamId, fixture.awayTeamId)));

      if (homeRating && awayRating) {
        lambdaHome = 1.20 * parseFloat(homeRating.attackStrength) * (1 / Math.max(0.5, parseFloat(awayRating.defenseStrength))) * parseFloat(homeRating.homeAdvantage);
        lambdaAway = 1.05 * parseFloat(awayRating.attackStrength) * (1 / Math.max(0.5, parseFloat(homeRating.defenseStrength)));
      }
    }

    // Calculate pre-match markets dynamically
    const calculated = calculateAllPreMatchMarkets(lambdaHome, lambdaAway);
    const createdMarkets = [];

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

      const createdOutcomes = await db.insert(marketOutcomes).values(outcomesToInsert).returning();
      createdMarkets.push({ ...mRecord, outcomes: createdOutcomes });
    }

    return res.json(createdMarkets);
  });

  // 5. Betting API
  app.post('/api/bets', authenticateJwt, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { fixtureId, marketId, outcomeCode, stake, idempotencyKey } = req.body;
      const userId = req.user!.id;

      const bet = await placePlayMoneyBet({
        userId,
        fixtureId,
        marketId,
        outcomeCode,
        stake: parseFloat(stake),
        idempotencyKey,
      });

      res.status(201).json(bet);
    } catch (err: any) {
      res.status(400).json({ error: 'BET_PLACEMENT_FAILED', message: err.message });
    }
  });

  // 6. Wallet API
  app.get('/api/wallet', authenticateJwt, async (req: AuthenticatedRequest, res: Response) => {
    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, req.user!.id));
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
    res.json(wallet);
  });

  app.get('/api/wallet/transactions', authenticateJwt, async (req: AuthenticatedRequest, res: Response) => {
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
