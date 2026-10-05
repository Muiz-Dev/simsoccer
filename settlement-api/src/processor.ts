import type postgres from 'postgres';
import Decimal from 'decimal.js';
import { db } from './db';
import { runtimeState } from './runtime';
import { gradeOutcome, gradeTicket, type LegStatus } from './rules';

const RULES_VERSION = 'sim-soccer-settlement-v1';
const COORDINATOR_LOCK_ID = 7821942601;
type Transaction = postgres.TransactionSql;

type FixtureRow = {
  fixture_id: string;
  season_id: string;
  round: number;
  status: string;
  home_score: number | null;
  away_score: number | null;
  result_hash: string | null;
  home_corners: number | null;
  away_corners: number | null;
  home_yellow_cards: number | null;
  away_yellow_cards: number | null;
  home_red_cards: number | null;
  away_red_cards: number | null;
  updated_at: Date;
};

type SettlementOutcomeRow = {
  market_id: string;
  market_type: string;
  market_status: string;
  outcome_id: string;
  outcome_code: string;
  outcome_status: string;
};

async function writeActivity(
  tx: Transaction,
  input: {
    key: string;
    seasonId?: string | null;
    round?: number | null;
    fixtureId?: string | null;
    betId?: string | null;
    eventType: string;
    resultHash?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await tx`
    INSERT INTO settlement_activity (
      idempotency_key, season_id, round, fixture_id, bet_id, event_type, result_hash, details
    )
    VALUES (
      ${input.key}, ${input.seasonId ?? null}, ${input.round ?? null}, ${input.fixtureId ?? null},
      ${input.betId ?? null}, ${input.eventType}, ${input.resultHash ?? null},
      ${JSON.stringify(input.details ?? {})}::jsonb
    )
    ON CONFLICT (idempotency_key) DO NOTHING
  `;
}

async function synchronizeRoundRecords(): Promise<void> {
  await db`
    INSERT INTO settlement_round_records (season_id, round, fixture_count, status, updated_at)
    SELECT season_id, round, count(*)::int, 'WAITING', now()
    FROM fixtures
    GROUP BY season_id, round
    ON CONFLICT (season_id, round) DO UPDATE
    SET fixture_count = EXCLUDED.fixture_count, updated_at = now()
  `;
}

async function recordFixtureFailure(fixtureId: string, error: unknown): Promise<void> {
  const [fixture] = await db<FixtureRow[]>`
    SELECT fixture_id, season_id, round, status, home_score, away_score,
      result_hash, home_corners, away_corners, home_yellow_cards, away_yellow_cards,
      home_red_cards, away_red_cards
    FROM (
      SELECT f.id AS fixture_id, f.season_id, f.round, f.status, f.home_score, f.away_score,
        CASE WHEN f.status = 'CANCELLED' THEN 'CANCELLED:' || f.id::text ELSE m.result_hash END AS result_hash,
        ms.home_corners, ms.away_corners, ms.home_yellow_cards,
        ms.away_yellow_cards, ms.home_red_cards, ms.away_red_cards, f.updated_at
      FROM fixtures f
      LEFT JOIN matches m ON m.fixture_id = f.id
      LEFT JOIN match_statistics ms ON ms.fixture_id = f.id
      WHERE f.id = ${fixtureId}
    ) AS result
  `;
  if (!fixture) return;
  const message = error instanceof Error ? error.message : 'Unknown settlement processing error.';
  await db`
    INSERT INTO settlement_fixture_records (
      fixture_id, season_id, round, result_hash, status, next_attempt_at, last_error, updated_at
    )
    VALUES (${fixture.fixture_id}, ${fixture.season_id}, ${fixture.round}, ${fixture.result_hash},
      'DISCOVERED', now() + make_interval(secs => 10), ${message}, now())
    ON CONFLICT (fixture_id) DO UPDATE SET
      attempt_count = settlement_fixture_records.attempt_count + 1,
      last_error = EXCLUDED.last_error,
      next_attempt_at = now() + make_interval(secs =>
        LEAST(300, 5 * power(2, LEAST(settlement_fixture_records.attempt_count, 6))::int)),
      status = CASE
        WHEN settlement_fixture_records.status IN ('SETTLED', 'NO_BETS', 'REVIEW') THEN settlement_fixture_records.status
        ELSE 'DISCOVERED'
      END,
      updated_at = now()
  `;
  console.error(`Settlement failed for fixture ${fixtureId}: ${message}`);
}

async function processFixture(fixtureId: string): Promise<boolean> {
  return db.begin(async (tx) => {
    const [fixture] = await tx<FixtureRow[]>`
      SELECT f.id AS fixture_id, f.season_id, f.round, f.status, f.home_score, f.away_score,
        CASE WHEN f.status = 'CANCELLED' THEN 'CANCELLED:' || f.id::text ELSE m.result_hash END AS result_hash,
        ms.home_corners, ms.away_corners, ms.home_yellow_cards,
        ms.away_yellow_cards, ms.home_red_cards, ms.away_red_cards, f.updated_at
      FROM fixtures f
      LEFT JOIN matches m ON m.fixture_id = f.id
      LEFT JOIN match_statistics ms ON ms.fixture_id = f.id
      WHERE f.id = ${fixtureId}
      FOR UPDATE OF f
    `;
    const cancelled = fixture?.status === 'CANCELLED';
    if (!fixture || (!cancelled && (fixture.status !== 'FINISHED' || fixture.home_score === null
      || fixture.away_score === null || !fixture.result_hash))) return false;

    const [existingRecord] = await tx<{ result_hash: string | null; status: string }[]>`
      SELECT result_hash, status FROM settlement_fixture_records WHERE fixture_id = ${fixtureId}
    `;
    const [priorOutcome] = await tx<{ has_conflict: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM market_outcome_settlements
        WHERE fixture_id = ${fixtureId} AND fixture_result_hash <> ${fixture.result_hash}
      ) OR EXISTS (
        SELECT 1 FROM settlement_bet_legs
        WHERE fixture_id = ${fixtureId} AND fixture_result_hash <> ${fixture.result_hash}
      ) OR (
        ${cancelled} AND EXISTS (
          SELECT 1 FROM bet_selections bs
          JOIN settlements s ON s.bet_id = bs.bet_id
          WHERE bs.fixture_id = ${fixtureId}
        )
      ) AS has_conflict
    `;
    if ((existingRecord?.result_hash && existingRecord.result_hash !== fixture.result_hash)
      || priorOutcome?.has_conflict) {
      await tx`
        INSERT INTO settlement_fixture_records (
          fixture_id, season_id, round, result_hash, status, last_error, updated_at
        )
        VALUES (${fixtureId}, ${fixture.season_id}, ${fixture.round}, ${fixture.result_hash},
          'REVIEW', 'Final result hash changed after discovery.', now())
        ON CONFLICT (fixture_id) DO UPDATE SET status = 'REVIEW',
          last_error = EXCLUDED.last_error, updated_at = now()
      `;
      await writeActivity(tx, {
        key: `fixture:${fixtureId}:result-hash-conflict:${fixture.result_hash}`,
        seasonId: fixture.season_id,
        round: fixture.round,
        fixtureId,
        eventType: 'RESULT_HASH_CONFLICT',
        resultHash: fixture.result_hash,
      });
      return false;
    }

    if (existingRecord && ['SETTLED', 'NO_BETS'].includes(existingRecord.status)
      && existingRecord.result_hash === fixture.result_hash) return false;

    await tx`
      INSERT INTO settlement_fixture_records (
        fixture_id, season_id, round, result_hash, status, attempt_count, next_attempt_at, last_error, updated_at
      )
      VALUES (${fixtureId}, ${fixture.season_id}, ${fixture.round}, ${fixture.result_hash},
        'PROCESSING', 1, NULL, NULL, now())
      ON CONFLICT (fixture_id) DO UPDATE SET
        status = 'PROCESSING', attempt_count = settlement_fixture_records.attempt_count + 1,
        next_attempt_at = NULL, last_error = NULL, updated_at = now()
    `;

    const [fixtureBetCounts] = await tx<{ selection_count: number }[]>`
      SELECT count(*)::int AS selection_count
      FROM bet_selections WHERE fixture_id = ${fixtureId}
    `;
    const outcomes = await tx<SettlementOutcomeRow[]>`
      SELECT m.id AS market_id, m.market_type, m.status AS market_status,
        o.id AS outcome_id, o.outcome_code, o.status AS outcome_status
      FROM markets m
      JOIN market_outcomes o ON o.market_id = m.id
      WHERE m.fixture_id = ${fixtureId}
      ORDER BY m.id, o.id
    `;
    for (const outcome of outcomes) {
      const status = cancelled || outcome.market_status === 'VOID' || outcome.outcome_status === 'VOID'
        ? 'VOID'
        : gradeOutcome({
          marketType: outcome.market_type,
          outcomeCode: outcome.outcome_code,
          homeScore: fixture.home_score ?? 0,
          awayScore: fixture.away_score ?? 0,
          statistics: fixture.home_corners === null || fixture.away_corners === null
          || fixture.home_yellow_cards === null || fixture.away_yellow_cards === null
          || fixture.home_red_cards === null || fixture.away_red_cards === null
            ? null
            : {
              homeCorners: fixture.home_corners,
              awayCorners: fixture.away_corners,
              homeYellowCards: fixture.home_yellow_cards,
              awayYellowCards: fixture.away_yellow_cards,
              homeRedCards: fixture.home_red_cards,
              awayRedCards: fixture.away_red_cards,
            },
        });
      const storedRows: Array<{ status: LegStatus; fixture_result_hash: string }> = await tx`
        INSERT INTO market_outcome_settlements (
          fixture_id, market_id, market_outcome_id, outcome_code, status,
          fixture_result_hash, rules_version
        )
        VALUES (${fixtureId}, ${outcome.market_id}, ${outcome.outcome_id}, ${outcome.outcome_code},
          ${status}, ${fixture.result_hash}, ${RULES_VERSION})
        ON CONFLICT (market_outcome_id) DO UPDATE
          SET status = market_outcome_settlements.status
          WHERE market_outcome_settlements.fixture_result_hash = EXCLUDED.fixture_result_hash
        RETURNING status, fixture_result_hash
      `;
      const stored: { status: LegStatus; fixture_result_hash: string } | undefined = storedRows[0];
      if (!stored || stored.fixture_result_hash !== fixture.result_hash) {
        throw new Error(`Stored outcome result differs from fixture ${fixtureId} result hash.`);
      }
      await tx`
        UPDATE market_outcomes SET
          status = ${stored.status === 'WON' ? 'WIN' : stored.status === 'LOST' ? 'LOSS' : 'VOID'},
          updated_at = now()
        WHERE id = ${outcome.outcome_id}
      `;
    }

    const selections = await tx<{
      selection_id: string;
      bet_id: string;
      bet_status: string;
      market_id: string;
      outcome_id: string | null;
      outcome_code: string;
      odds: string;
      status: LegStatus | null;
    }[]>`
      SELECT bs.id AS selection_id, bs.bet_id, b.status AS bet_status,
        bs.market_id, o.id AS outcome_id, bs.outcome_code, bs.odds,
        CASE WHEN ${cancelled} OR m.status = 'VOID' OR o.status = 'VOID' THEN 'VOID'
          WHEN mos.status IS NOT NULL THEN mos.status
          ELSE NULL END AS status
      FROM bet_selections bs
      JOIN bets b ON b.id = bs.bet_id
      JOIN markets m ON m.id = bs.market_id AND m.fixture_id = bs.fixture_id
      LEFT JOIN market_outcomes o ON o.market_id = m.id AND o.outcome_code = bs.outcome_code
      LEFT JOIN market_outcome_settlements mos ON mos.market_outcome_id = o.id
      WHERE bs.fixture_id = ${fixtureId}
      ORDER BY bs.id
      FOR UPDATE OF bs
    `;

    if (fixtureBetCounts.selection_count !== selections.length) {
      throw new Error(`Fixture ${fixtureId} has bet selections without a matching settled market outcome.`);
    }
    if (selections.some((selection) => !selection.status)) {
      throw new Error(`Fixture ${fixtureId} has a selection with no graded market outcome.`);
    }

    for (const selection of selections) {
      const selectionStatus = selection.status ?? 'VOID';
      const legRows: Array<{ status: LegStatus; fixture_result_hash: string; accepted_odds: string }> = await tx`
        INSERT INTO settlement_bet_legs (
          bet_selection_id, bet_id, fixture_id, market_id, market_outcome_id,
          outcome_code, accepted_odds, status, fixture_result_hash, rules_version
        )
        VALUES (${selection.selection_id}, ${selection.bet_id}, ${fixtureId}, ${selection.market_id},
          ${selection.outcome_id}, ${selection.outcome_code}, ${selection.odds}, ${selectionStatus},
          ${fixture.result_hash}, ${RULES_VERSION})
        ON CONFLICT (bet_selection_id) DO UPDATE
          SET status = settlement_bet_legs.status
          WHERE settlement_bet_legs.fixture_result_hash = EXCLUDED.fixture_result_hash
            AND settlement_bet_legs.accepted_odds = EXCLUDED.accepted_odds
            AND settlement_bet_legs.status = EXCLUDED.status
        RETURNING status, fixture_result_hash, accepted_odds
      `;
      const leg: { status: LegStatus; fixture_result_hash: string; accepted_odds: string } | undefined = legRows[0];
      if (!leg || leg.fixture_result_hash !== fixture.result_hash) {
        throw new Error(`Ticket leg ${selection.selection_id} conflicts with its prior settlement record.`);
      }
      await tx`
        UPDATE bet_selections SET status = ${leg.status}
        WHERE id = ${selection.selection_id} AND ${selection.bet_status === 'PENDING'}
      `;
    }

    const betCount = new Set(selections.map((selection) => selection.bet_id)).size;
    const status = selections.length ? 'SETTLED' : 'NO_BETS';
    await tx`
      INSERT INTO settlement_fixture_records (
        fixture_id, season_id, round, result_hash, status, ticket_count,
        selection_count, next_attempt_at, settled_at, updated_at
      )
      VALUES (${fixtureId}, ${fixture.season_id}, ${fixture.round}, ${fixture.result_hash},
        ${status}, ${status === 'NO_BETS' ? 0 : betCount}, ${selections.length}, NULL, now(), now())
      ON CONFLICT (fixture_id) DO UPDATE SET
        result_hash = EXCLUDED.result_hash, status = EXCLUDED.status,
        ticket_count = EXCLUDED.ticket_count, selection_count = EXCLUDED.selection_count,
        next_attempt_at = NULL, last_error = NULL,
        settled_at = COALESCE(settlement_fixture_records.settled_at, now()),
        updated_at = now()
    `;
    await tx`
      UPDATE markets SET status = CASE
        WHEN ${cancelled} OR status = 'VOID' THEN 'VOID'
        ELSE 'SETTLED'
      END, updated_at = now()
      WHERE fixture_id = ${fixtureId}
    `;
    await writeActivity(tx, {
      key: `fixture:${fixtureId}:graded:${fixture.result_hash}`,
      seasonId: fixture.season_id,
      round: fixture.round,
      fixtureId,
      eventType: cancelled
        ? status === 'NO_BETS' ? 'CANCELLED_FIXTURE_NO_BETS' : 'FIXTURE_CANCELLED'
        : status === 'NO_BETS' ? 'FIXTURE_NO_BETS' : 'FIXTURE_GRADED',
      resultHash: fixture.result_hash,
      details: {
        tickets: status === 'NO_BETS' ? 0 : betCount,
        selections: selections.length,
        markets: new Set(outcomes.map((outcome) => outcome.market_id)).size,
      },
    });
    return true;
  });
}

async function settleReadyTickets(): Promise<number> {
  const readyBets = await db<{ id: string }[]>`
    SELECT b.id FROM bets b
    WHERE b.status = 'PENDING'
      AND EXISTS (SELECT 1 FROM bet_selections bs WHERE bs.bet_id = b.id)
      AND NOT EXISTS (
        SELECT 1 FROM bet_selections bs
        WHERE bs.bet_id = b.id AND bs.status = 'PENDING'
      )
    ORDER BY b.placed_at, b.id
    LIMIT 500
  `;

  let settled = 0;
  for (const { id } of readyBets) {
    const result = await db.begin(async (tx) => {
      const [bet] = await tx<{ id: string; user_id: string; stake: string; total_odds: string; status: string }[]>`
        SELECT id, user_id, stake, total_odds, status
        FROM bets WHERE id = ${id} FOR UPDATE
      `;
      if (!bet || bet.status !== 'PENDING') return false;
      const existing = await tx<{ id: string }[]>`SELECT id FROM settlements WHERE bet_id = ${id}`;
      if (existing.length) return false;

      const legs = await tx<{
        status: LegStatus;
        odds: string;
        fixture_id: string;
        season_id: string;
        round: number;
      }[]>`
        SELECT bs.status, bs.odds, bs.fixture_id, f.season_id, f.round
        FROM bet_selections bs
        JOIN settlement_bet_legs sl ON sl.bet_selection_id = bs.id
        JOIN fixtures f ON f.id = bs.fixture_id
        WHERE bs.bet_id = ${id}
        ORDER BY f.scheduled_at ASC, bs.id ASC
      `;
      const selectionCount = await tx<{ count: number }[]>`
        SELECT count(*)::int AS count FROM bet_selections WHERE bet_id = ${id}
      `;
      if (legs.length === 0 || legs.length !== selectionCount[0]?.count
        || legs.some((leg) => !['WON', 'LOST', 'VOID'].includes(leg.status))) return false;

      const outcome = gradeTicket(legs.map((leg) => ({ status: leg.status, odds: leg.odds })), bet.stake);
      const finalFixtureId = legs[legs.length - 1].fixture_id;
      const [settlement] = await tx<{ id: string }[]>`
        INSERT INTO settlements (bet_id, fixture_id, status, payout_amount)
        VALUES (${id}, ${finalFixtureId}, ${outcome.status}, ${outcome.payout})
        ON CONFLICT (bet_id) DO NOTHING
        RETURNING id
      `;
      if (!settlement) return false;

      if (new Decimal(outcome.payout).gt(0)) {
        const [wallet] = await tx<{ id: string; balance: string }[]>`
          SELECT id, balance FROM wallets WHERE user_id = ${bet.user_id} FOR UPDATE
        `;
        if (!wallet) throw new Error(`Wallet not found while settling ticket ${id}.`);
        const before = new Decimal(wallet.balance);
        const amount = new Decimal(outcome.payout);
        const after = before.add(amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        const [ledger] = await tx<{ id: string }[]>`
          INSERT INTO wallet_transactions (
            wallet_id, type, amount, balance_before, balance_after, reference_type,
            reference_id, idempotency_key
          )
          VALUES (
            ${wallet.id}, ${outcome.status === 'VOID' ? 'BET_REFUND' : 'WIN_PAYOUT'},
            ${amount.toFixed(2)}, ${before.toFixed(2)}, ${after.toFixed(2)},
            ${outcome.status === 'VOID' ? 'BET_REFUND' : 'BET_PAYOUT'}, ${id},
            ${`settlement:${id}:payout:v1`}
          )
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING id
        `;
        if (!ledger) throw new Error(`Payout idempotency key already exists for unsettled ticket ${id}.`);
        await tx`
          UPDATE wallets SET balance = ${after.toFixed(2)}, updated_at = now()
          WHERE id = ${wallet.id}
        `;
      }

      await tx`UPDATE bets SET status = ${outcome.status}, settled_at = now() WHERE id = ${id}`;
      await writeActivity(tx, {
        key: `ticket:${id}:settled:${RULES_VERSION}`,
        seasonId: legs[legs.length - 1].season_id,
        round: legs[legs.length - 1].round,
        fixtureId: finalFixtureId,
        betId: id,
        eventType: `TICKET_${outcome.status}`,
        details: {
          status: outcome.status,
          payout: outcome.payout,
          stake: bet.stake,
          legCount: legs.length,
          rulesVersion: RULES_VERSION,
        },
      });
      return true;
    });
    if (result) settled++;
  }
  return settled;
}

async function refreshRoundRecords(): Promise<void> {
  await db`
    WITH fixture_totals AS (
      SELECT season_id, round, count(*)::int AS fixture_count,
        count(*) FILTER (WHERE status IN ('FINISHED', 'CANCELLED'))::int AS finished_count,
        count(*) FILTER (WHERE status IN ('LIVE', 'HALFTIME', 'FINISHED', 'CANCELLED'))::int AS started_count
      FROM fixtures GROUP BY season_id, round
    ), ticket_totals AS (
      SELECT season_id, round, count(*)::int AS ticket_count,
        count(*) FILTER (WHERE b.status = 'PENDING')::int AS pending_ticket_count,
        COALESCE(sum(stake), 0)::numeric(18, 2) AS staked_credits,
        COALESCE(sum(potential_payout), 0)::numeric(18, 2) AS potential_payout_credits
      FROM (
        SELECT DISTINCT f.season_id, f.round, b.id, b.status, b.stake, b.potential_payout
        FROM fixtures f
        JOIN bet_selections bs ON bs.fixture_id = f.id
        JOIN bets b ON b.id = bs.bet_id
      ) tickets
      GROUP BY season_id, round
    ), payout_totals AS (
      SELECT season_id, round, COALESCE(sum(payout_amount), 0)::numeric(18, 2) AS payout_credits
      FROM (
        SELECT DISTINCT f.season_id, f.round, st.bet_id, st.payout_amount
        FROM fixtures f
        JOIN bet_selections bs ON bs.fixture_id = f.id
        JOIN settlements st ON st.bet_id = bs.bet_id
      ) tickets
      GROUP BY season_id, round
    ), processing_totals AS (
      SELECT season_id, round,
        count(*) FILTER (WHERE status IN ('SETTLED', 'NO_BETS'))::int AS processed_count,
        count(*) FILTER (WHERE status = 'REVIEW')::int AS review_count
      FROM settlement_fixture_records
      GROUP BY season_id, round
    )
    UPDATE settlement_round_records rr SET
      fixture_count = ft.fixture_count,
      finished_fixture_count = ft.finished_count,
      processed_fixture_count = COALESCE(pt.processed_count, 0),
      ticket_count = COALESCE(tt.ticket_count, 0),
      pending_ticket_count = COALESCE(tt.pending_ticket_count, 0),
      staked_credits = COALESCE(tt.staked_credits, 0),
      potential_payout_credits = COALESCE(tt.potential_payout_credits, 0),
      payout_credits = COALESCE(pay.payout_credits, 0),
      status = CASE
        WHEN COALESCE(pt.review_count, 0) > 0 THEN 'REVIEW'
        WHEN ft.started_count = 0 THEN 'WAITING'
        WHEN ft.finished_count < ft.fixture_count THEN 'IN_PROGRESS'
        WHEN COALESCE(pt.processed_count, 0) = ft.fixture_count
          AND COALESCE(tt.ticket_count, 0) = 0 THEN 'NO_BETS'
        WHEN COALESCE(pt.processed_count, 0) = ft.fixture_count THEN 'SETTLED'
        ELSE 'SETTLING'
      END,
      started_at = CASE
        WHEN ft.started_count > 0 THEN COALESCE(rr.started_at, now())
        ELSE rr.started_at
      END,
      completed_at = CASE
        WHEN ft.finished_count = ft.fixture_count AND COALESCE(pt.processed_count, 0) = ft.fixture_count THEN COALESCE(rr.completed_at, now())
        ELSE NULL
      END,
      updated_at = now()
    FROM fixture_totals ft
    LEFT JOIN ticket_totals tt ON tt.season_id = ft.season_id AND tt.round = ft.round
    LEFT JOIN payout_totals pay ON pay.season_id = ft.season_id AND pay.round = ft.round
    LEFT JOIN processing_totals pt ON pt.season_id = ft.season_id AND pt.round = ft.round
    WHERE rr.season_id = ft.season_id AND rr.round = ft.round
  `;
}

export async function runSettlementScan(): Promise<{ fixturesProcessed: number; ticketsSettled: number }> {
  await synchronizeRoundRecords();
  const fixtures = await db<{ id: string }[]>`
    SELECT f.id
    FROM fixtures f
    LEFT JOIN matches m ON m.fixture_id = f.id
    LEFT JOIN settlement_fixture_records sr ON sr.fixture_id = f.id
    WHERE (f.status = 'CANCELLED' OR (f.status = 'FINISHED' AND m.result_hash IS NOT NULL))
      AND (
        sr.fixture_id IS NULL
        OR sr.result_hash IS DISTINCT FROM CASE
          WHEN f.status = 'CANCELLED' THEN 'CANCELLED:' || f.id::text
          ELSE m.result_hash
        END
        OR (
          sr.status NOT IN ('SETTLED', 'NO_BETS', 'REVIEW')
          AND COALESCE(sr.next_attempt_at, now()) <= now()
        )
      )
    ORDER BY f.finished_at NULLS LAST, f.id
    LIMIT 200
  `;
  let fixturesProcessed = 0;
  for (const { id } of fixtures) {
    try {
      if (await processFixture(id)) fixturesProcessed++;
    } catch (error) {
      await recordFixtureFailure(id, error);
    }
  }
  const ticketsSettled = await settleReadyTickets();
  await refreshRoundRecords();
  return { fixturesProcessed, ticketsSettled };
}

export { COORDINATOR_LOCK_ID };
