import crypto from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { config } from './config';
import { db } from './db';
import { runtimeState } from './runtime';
import { startSettlementWorker, stopSettlementWorker } from './worker';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors((request, callback) => {
  const origin = request.get('Origin');
  if (!origin) return callback(null, { origin: false });
  if (!config.allowedOrigins.has(origin)) return callback(null, { origin: false });
  return callback(null, { origin, credentials: true, methods: ['GET', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] });
}));
app.use(cookieParser());
app.use(express.json({ limit: '32kb' }));

function adminToken(request: Request): string | null {
  const cookie = request.cookies?.sim_admin_session;
  if (typeof cookie === 'string' && cookie) return cookie;
  const authorization = request.get('Authorization');
  return authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() || null : null;
}

async function requireAdmin(request: Request, response: Response, next: NextFunction): Promise<void> {
  const origin = request.get('Origin');
  if (!origin || !config.allowedOrigins.has(origin)) {
    response.status(403).json({ error: 'UNTRUSTED_ORIGIN', message: 'This admin request is not allowed.' });
    return;
  }

  const token = adminToken(request);
  if (!token || !/^sim_admin_v1\.primary\.[a-f0-9]{32}$/i.test(token)) {
    response.status(401).json({ error: 'UNAUTHORIZED', message: 'Admin session required.' });
    return;
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const [session] = await db<{ id: string; revoked_at: Date | null; idle_expires_at: Date; absolute_expires_at: Date }[]>`
      SELECT id, revoked_at, idle_expires_at, absolute_expires_at
      FROM admin_sessions WHERE token_hash = ${tokenHash} LIMIT 1
    `;
    const now = Date.now();
    if (!session || session.revoked_at || new Date(session.idle_expires_at).getTime() <= now
      || new Date(session.absolute_expires_at).getTime() <= now) {
      response.status(401).json({ error: 'UNAUTHORIZED', message: 'Admin session required.' });
      return;
    }

    await db`
      UPDATE admin_sessions
      SET last_seen_at = now(), idle_expires_at = now() + interval '30 minutes'
      WHERE id = ${session.id}
    `;
    next();
  } catch (error) {
    console.error('Admin session validation failed.', error);
    response.status(503).json({ error: 'SETTLEMENT_SERVICE_UNAVAILABLE', message: 'Settlement data is temporarily unavailable.' });
  }
}

app.get(['/health/live', '/api/settlement/health/live'], (_request, response) => {
  response.json({ status: 'live', service: 'simsoccer-settlement', startedAt: runtimeState.startedAt });
});

app.get(['/health/ready', '/api/settlement/health/ready'], async (_request, response) => {
  try {
    await db`SELECT 1`;
    const healthy = runtimeState.consecutiveErrors < 3;
    response.status(healthy ? 200 : 503).json({
      status: healthy ? 'ready' : 'degraded',
      service: 'simsoccer-settlement',
      worker: {
        leader: runtimeState.isLeader,
        lastScanAt: runtimeState.lastScanAt,
        lastSuccessfulScanAt: runtimeState.lastSuccessfulScanAt,
        consecutiveErrors: runtimeState.consecutiveErrors,
        lastError: runtimeState.lastError,
      },
    });
  } catch (error) {
    console.error('Settlement readiness check failed.', error);
    response.status(503).json({ status: 'not_ready', service: 'simsoccer-settlement' });
  }
});

app.get('/api/settlement/admin/overview', requireAdmin, async (_request, response) => {
  try {
    const [ticketTotals] = await db`
      SELECT count(*)::int AS ticket_count,
        count(DISTINCT user_id)::int AS user_count,
        count(*) FILTER (WHERE status = 'PENDING')::int AS pending_count,
        count(*) FILTER (WHERE status = 'WON')::int AS won_count,
        count(*) FILTER (WHERE status = 'LOST')::int AS lost_count,
        count(*) FILTER (WHERE status = 'VOID')::int AS void_count,
        COALESCE(sum(stake), 0)::numeric(18, 2) AS total_staked_credits,
        COALESCE(sum(stake) FILTER (WHERE status = 'PENDING'), 0)::numeric(18, 2) AS pending_stake_credits,
        COALESCE(sum(potential_payout) FILTER (WHERE status = 'PENDING'), 0)::numeric(18, 2) AS pending_potential_return_credits
      FROM bets
    `;
    const [settledTotals] = await db`
      SELECT COALESCE(sum(b.stake), 0)::numeric(18, 2) AS settled_stake_credits,
        COALESCE(sum(s.payout_amount), 0)::numeric(18, 2) AS payout_credits,
        COALESCE(sum(b.stake) - sum(s.payout_amount), 0)::numeric(18, 2) AS simulated_book_net_credits
      FROM settlements s JOIN bets b ON b.id = s.bet_id
    `;
    const [customerCredits] = await db`
      SELECT COALESCE(sum(balance), 0)::numeric(18, 2) AS customer_virtual_credit_balances
      FROM wallets WHERE currency = 'VIRTUAL'
    `;
    const [pendingWork] = await db`
      SELECT count(*) FILTER (WHERE f.status = 'SCHEDULED')::int AS scheduled_fixtures,
        count(*) FILTER (WHERE f.status IN ('LIVE', 'HALFTIME'))::int AS live_fixtures,
        count(*) FILTER (WHERE f.status IN ('FINISHED', 'CANCELLED'))::int AS finished_unprocessed_fixtures,
        count(*)::int AS pending_legs,
        (SELECT count(*)::int FROM settlement_fixture_records WHERE status = 'REVIEW')
          AS fixtures_needing_review
      FROM bet_selections bs
      JOIN fixtures f ON f.id = bs.fixture_id
      WHERE bs.status = 'PENDING'
    `;
    const [rounds] = await db`
      SELECT count(*)::int AS monitored_rounds,
        count(*) FILTER (WHERE status = 'NO_BETS')::int AS completed_no_bet_rounds,
        count(*) FILTER (WHERE status = 'REVIEW')::int AS rounds_needing_review
      FROM settlement_round_records
    `;
    response.json({
      currency: 'VIRTUAL',
      meaning: 'Play-money credits only. These amounts are not deposits, cash, or company treasury.',
      tickets: ticketTotals,
      settled: settledTotals,
      pendingWork,
      rounds,
      customerVirtualCreditBalances: customerCredits.customer_virtual_credit_balances,
      worker: {
        leader: runtimeState.isLeader,
        startedAt: runtimeState.startedAt,
        lastScanAt: runtimeState.lastScanAt,
        lastSuccessfulScanAt: runtimeState.lastSuccessfulScanAt,
        lastFixturesProcessed: runtimeState.lastFixturesProcessed,
        lastTicketsSettled: runtimeState.lastTicketsSettled,
        consecutiveErrors: runtimeState.consecutiveErrors,
        lastError: runtimeState.lastError,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Settlement overview query failed.', error);
    response.status(503).json({ error: 'SETTLEMENT_DATA_UNAVAILABLE', message: 'Settlement totals are temporarily unavailable.' });
  }
});

app.get('/api/settlement/admin/rounds', requireAdmin, async (request, response) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(request.query.limit) || 50));
    const rows = await db`
      SELECT rr.*, s.season_number, s.name AS season_name, l.name AS league_name,
        COALESCE(coverage.processed_fixture_count, 0)::int AS settled_fixture_count,
        COALESCE(coverage.no_bet_fixture_count, 0)::int AS no_bet_fixture_count,
        COALESCE(coverage.selection_count, 0)::int AS selection_count
      FROM settlement_round_records rr
      JOIN seasons s ON s.id = rr.season_id
      JOIN leagues l ON l.id = s.league_id
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE status IN ('SETTLED', 'NO_BETS'))::int AS processed_fixture_count,
          count(*) FILTER (WHERE status = 'NO_BETS')::int AS no_bet_fixture_count,
          COALESCE(sum(selection_count), 0)::int AS selection_count
        FROM settlement_fixture_records
        WHERE season_id = rr.season_id AND round = rr.round
      ) coverage ON TRUE
      ORDER BY s.season_number DESC, l.name, rr.round DESC
      LIMIT ${limit}
    `;
    response.json({ rounds: rows });
  } catch (error) {
    console.error('Settlement round timeline query failed.', error);
    response.status(503).json({ error: 'SETTLEMENT_DATA_UNAVAILABLE', message: 'Round history is temporarily unavailable.' });
  }
});

app.get('/api/settlement/admin/fixtures', requireAdmin, async (request, response) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(request.query.limit) || 50));
    const rows = await db`
      SELECT f.id AS fixture_id, f.round, f.status AS fixture_status, f.scheduled_at,
        f.finished_at, f.home_score, f.away_score, COALESCE(m.result_hash, sr.result_hash) AS result_hash,
        ht.name AS home_team, at.name AS away_team, l.name AS league_name,
        sr.status AS settlement_status, sr.ticket_count, sr.selection_count,
        sr.attempt_count, sr.last_error, sr.settled_at
      FROM fixtures f
      JOIN seasons s ON s.id = f.season_id
      JOIN leagues l ON l.id = s.league_id
      JOIN teams ht ON ht.id = f.home_team_id
      JOIN teams at ON at.id = f.away_team_id
      LEFT JOIN matches m ON m.fixture_id = f.id
      LEFT JOIN settlement_fixture_records sr ON sr.fixture_id = f.id
      ORDER BY f.scheduled_at DESC
      LIMIT ${limit}
    `;
    response.json({ fixtures: rows });
  } catch (error) {
    console.error('Settlement fixture timeline query failed.', error);
    response.status(503).json({ error: 'SETTLEMENT_DATA_UNAVAILABLE', message: 'Fixture history is temporarily unavailable.' });
  }
});

app.get('/api/settlement/admin/tickets', requireAdmin, async (request, response) => {
  try {
    const status = typeof request.query.status === 'string' && ['PENDING', 'WON', 'LOST', 'VOID', 'CANCELLED'].includes(request.query.status)
      ? request.query.status
      : null;
    const limit = Math.min(200, Math.max(1, Number(request.query.limit) || 50));
    const rows = await db`
      SELECT b.id, b.status, b.stake, b.total_odds, b.potential_payout, b.placed_at, b.settled_at,
        count(DISTINCT bs.id)::int AS selection_count,
        count(DISTINCT bs.id) FILTER (WHERE bs.status = 'PENDING')::int AS pending_selection_count,
        count(DISTINCT bs.id) FILTER (WHERE bs.status = 'WON')::int AS won_selection_count,
        count(DISTINCT bs.id) FILTER (WHERE bs.status = 'LOST')::int AS lost_selection_count,
        count(DISTINCT bs.id) FILTER (WHERE bs.status = 'VOID')::int AS void_selection_count,
        s.payout_amount
      FROM bets b
      LEFT JOIN bet_selections bs ON bs.bet_id = b.id
      LEFT JOIN settlements s ON s.bet_id = b.id
      WHERE ${status}::text IS NULL OR b.status = ${status}
      GROUP BY b.id, s.payout_amount
      ORDER BY b.placed_at DESC
      LIMIT ${limit}
    `;
    response.json({ tickets: rows });
  } catch (error) {
    console.error('Settlement ticket report query failed.', error);
    response.status(503).json({ error: 'SETTLEMENT_DATA_UNAVAILABLE', message: 'Ticket report is temporarily unavailable.' });
  }
});

app.get('/api/settlement/admin/tickets/:ticketId', requireAdmin, async (request, response) => {
  try {
    const [ticket] = await db`
      SELECT b.id, b.user_id, b.status, b.stake, b.total_odds, b.potential_payout,
        b.placed_at, b.settled_at, s.status AS settlement_status,
        s.payout_amount, s.settled_at AS settlement_recorded_at
      FROM bets b
      LEFT JOIN settlements s ON s.bet_id = b.id
      WHERE b.id = ${request.params.ticketId}
      LIMIT 1
    `;
    if (!ticket) {
      response.status(404).json({ error: 'TICKET_NOT_FOUND', message: 'Ticket not found.' });
      return;
    }
    const selections = await db`
      SELECT bs.id AS selection_id, bs.status AS selection_status, bs.outcome_code,
        bs.odds AS accepted_odds, m.market_type, o.display_name,
        f.id AS fixture_id, f.round, f.status AS fixture_status,
        f.scheduled_at, f.finished_at, f.home_score, f.away_score,
        ht.name AS home_team, at.name AS away_team,
        sl.status AS graded_status, sl.fixture_result_hash, sl.rules_version,
        sl.settled_at AS graded_at
      FROM bet_selections bs
      JOIN fixtures f ON f.id = bs.fixture_id
      JOIN teams ht ON ht.id = f.home_team_id
      JOIN teams at ON at.id = f.away_team_id
      JOIN markets m ON m.id = bs.market_id
      LEFT JOIN market_outcomes o ON o.market_id = bs.market_id AND o.outcome_code = bs.outcome_code
      LEFT JOIN settlement_bet_legs sl ON sl.bet_selection_id = bs.id
      WHERE bs.bet_id = ${request.params.ticketId}
      ORDER BY f.scheduled_at, bs.id
    `;
    const activity = await db`
      SELECT event_type, details, created_at
      FROM settlement_activity
      WHERE bet_id = ${request.params.ticketId}
      ORDER BY created_at DESC
    `;
    response.json({ ticket, selections, activity });
  } catch (error) {
    console.error('Settlement ticket detail query failed.', error);
    response.status(503).json({ error: 'SETTLEMENT_DATA_UNAVAILABLE', message: 'Ticket details are temporarily unavailable.' });
  }
});

app.get('/api/settlement/admin/fixtures/:fixtureId', requireAdmin, async (request, response) => {
  try {
    const [fixture] = await db`
      SELECT f.id AS fixture_id, f.season_id, s.season_number, s.name AS season_name,
        f.round, f.status AS fixture_status, f.scheduled_at, f.started_at, f.finished_at,
        f.home_score, f.away_score, COALESCE(m.result_hash, sr.result_hash) AS result_hash, m.timeline_hash,
        l.name AS league_name, ht.name AS home_team, at.name AS away_team,
        sr.status AS settlement_status, sr.ticket_count, sr.selection_count,
        sr.attempt_count, sr.last_error, sr.discovered_at, sr.settled_at
      FROM fixtures f
      JOIN seasons s ON s.id = f.season_id
      JOIN leagues l ON l.id = s.league_id
      JOIN teams ht ON ht.id = f.home_team_id
      JOIN teams at ON at.id = f.away_team_id
      LEFT JOIN matches m ON m.fixture_id = f.id
      LEFT JOIN settlement_fixture_records sr ON sr.fixture_id = f.id
      WHERE f.id = ${request.params.fixtureId}
      LIMIT 1
    `;
    if (!fixture) {
      response.status(404).json({ error: 'FIXTURE_NOT_FOUND', message: 'Fixture not found.' });
      return;
    }
    const [statistics] = await db`
      SELECT home_possession, away_possession, home_shots, away_shots,
        home_shots_on_target, away_shots_on_target, home_corners, away_corners,
        home_fouls, away_fouls, home_yellow_cards, away_yellow_cards,
        home_red_cards, away_red_cards
      FROM match_statistics WHERE fixture_id = ${request.params.fixtureId}
    `;
    const events = await db`
      SELECT sequence, virtual_minute, virtual_second, event_type, team_id, player_id,
        secondary_player_id, metadata
      FROM match_events
      WHERE fixture_id = ${request.params.fixtureId}
      ORDER BY sequence
    `;
    const markets = await db`
      SELECT m.id AS market_id, m.market_type, m.status AS market_status,
        o.id AS outcome_id, o.outcome_code, o.display_name, o.probability, o.odds,
        o.status AS outcome_status, mos.status AS graded_status,
        mos.fixture_result_hash, mos.rules_version, mos.settled_at
      FROM markets m
      LEFT JOIN market_outcomes o ON o.market_id = m.id
      LEFT JOIN market_outcome_settlements mos ON mos.market_outcome_id = o.id
      WHERE m.fixture_id = ${request.params.fixtureId}
      ORDER BY m.market_type, o.outcome_code
    `;
    response.json({ fixture, statistics: statistics ?? null, events, markets });
  } catch (error) {
    console.error('Settlement fixture detail query failed.', error);
    response.status(503).json({ error: 'SETTLEMENT_DATA_UNAVAILABLE', message: 'Fixture details are temporarily unavailable.' });
  }
});

app.get('/api/settlement/admin/activity', requireAdmin, async (request, response) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(request.query.limit) || 100));
    const rows = await db`
      SELECT id, season_id, round, fixture_id, bet_id, event_type, result_hash, details, created_at
      FROM settlement_activity
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    response.json({ activity: rows });
  } catch (error) {
    console.error('Settlement audit timeline query failed.', error);
    response.status(503).json({ error: 'SETTLEMENT_DATA_UNAVAILABLE', message: 'Settlement activity is temporarily unavailable.' });
  }
});

app.use((_request, response) => {
  response.status(404).json({ error: 'NOT_FOUND', message: 'Settlement route not found.' });
});

const server = app.listen(config.SETTLEMENT_PORT, () => {
  console.log(`SimSoccer settlement API listening on port ${config.SETTLEMENT_PORT}.`);
  startSettlementWorker();
});

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`Stopping settlement service after ${signal}.`);
  server.close(async (error) => {
    if (error) {
      console.error('Settlement API shutdown failed.', error);
      process.exitCode = 1;
    }
    try {
      await stopSettlementWorker();
    } catch (shutdownError) {
      console.error('Settlement worker shutdown failed.', shutdownError);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
