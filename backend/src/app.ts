import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { db } from './db/index';
import { leagues, seasons, teams, teamRatings, fixtures, matches, matchEvents, markets, marketOutcomes, wallets, walletTransactions, bets, betSelections } from './db/schema/index';
import { authenticateJwt, requireRole, AuthenticatedRequest } from './auth/jwt';
import { calculateAllPreMatchMarkets } from './markets/probability-engine';
import { placePlayMoneyBet } from './betting/bet-service';
import { MatchEngine } from './simulation/match-engine';
import { checkDependenciesHealth, getWorldStatusInfo } from './football/coordinator';
import { eq, and } from 'drizzle-orm';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
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
    if (health.postgres && health.redis) {
      res.json({ status: 'ready', dependencies: health });
    } else {
      res.status(503).json({ status: 'not_ready', dependencies: health });
    }
  });

  app.get('/api/world/status', async (req: Request, res: Response) => {
    const statusInfo = await getWorldStatusInfo();
    res.json(statusInfo);
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
