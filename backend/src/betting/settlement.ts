import { db } from '../db/index';
import {
  bets,
  betSelections,
  fixtures,
  marketOutcomeSettlements,
  marketOutcomes,
  markets,
  matchStatistics,
  matches,
  settlements,
  wallets,
  walletTransactions,
} from '../db/schema/index';
import Decimal from 'decimal.js';
import { and, eq, inArray } from 'drizzle-orm';
import { calculateStraightMultipleSettlement, type MultipleLegOutcome } from './multiple';

const SETTLEMENT_RULES_VERSION = 'prematch-v1';

function resultForOutcome(input: {
  marketType: string;
  outcomeCode: string;
  homeScore: number;
  awayScore: number;
  statistics: typeof matchStatistics.$inferSelect | undefined;
}): MultipleLegOutcome {
  const { marketType, outcomeCode, homeScore, awayScore, statistics } = input;
  const totalGoals = homeScore + awayScore;
  const total = (prefix: 'OVER_' | 'UNDER_', value: number, threshold: number) =>
    prefix === 'OVER_' ? value > threshold : value < threshold;

  switch (marketType) {
    case '1X2': {
      const winningOutcome = homeScore > awayScore ? '1' : homeScore === awayScore ? 'X' : '2';
      return outcomeCode === winningOutcome ? 'WON' : 'LOST';
    }
    case 'DOUBLE_CHANCE': {
      const homeWin = homeScore > awayScore;
      const draw = homeScore === awayScore;
      const awayWin = homeScore < awayScore;
      const won = outcomeCode === '1X' ? homeWin || draw
        : outcomeCode === '12' ? homeWin || awayWin
          : outcomeCode === 'X2' ? draw || awayWin
            : false;
      return won ? 'WON' : 'LOST';
    }
    case 'TOTAL_GOALS':
    case 'TOTAL_GOALS_0.5':
    case 'TOTAL_GOALS_1.5':
    case 'TOTAL_GOALS_2.5':
    case 'TOTAL_GOALS_3.5':
    case 'TOTAL_GOALS_4.5': {
      const match = /^(OVER|UNDER)_(\d+(?:\.\d+)?)$/.exec(outcomeCode);
      if (!match) return 'VOID';
      const won = total(match[1] === 'OVER' ? 'OVER_' : 'UNDER_', totalGoals, Number(match[2]));
      return won ? 'WON' : 'LOST';
    }
    case 'BTTS': {
      const bothScored = homeScore > 0 && awayScore > 0;
      const won = outcomeCode === 'YES' ? bothScored : outcomeCode === 'NO' ? !bothScored : false;
      return won ? 'WON' : 'LOST';
    }
    case 'CORRECT_SCORE':
      return outcomeCode === `${homeScore}-${awayScore}` ? 'WON' : 'LOST';
    case 'TOTAL_CORNERS':
    case 'TOTAL_CARDS': {
      if (!statistics) return 'VOID';
      const value = marketType === 'TOTAL_CORNERS'
        ? statistics.homeCorners + statistics.awayCorners
        : statistics.homeYellowCards + statistics.awayYellowCards
          + (statistics.homeRedCards + statistics.awayRedCards) * 2;
      const match = /^(OVER|UNDER)_(\d+(?:\.\d+)?)$/.exec(outcomeCode);
      if (!match) return 'VOID';
      return total(match[1] === 'OVER' ? 'OVER_' : 'UNDER_', value, Number(match[2])) ? 'WON' : 'LOST';
    }
    default:
      return 'VOID';
  }
}

/**
 * Idempotent settlement worker for all bets associated with a finished fixture, wrapped in ACID db.transaction.
 */
export async function settleFixtureBets(fixtureId: string) {
  console.log(`⚖️ Starting bet settlement for fixture '${fixtureId}'...`);

  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  if (!fixture || fixture.status !== 'FINISHED' || fixture.homeScore === null || fixture.awayScore === null) {
    throw new Error(`Fixture '${fixtureId}' is not finalized; settlement must wait for its persisted final result.`);
  }
  const [match] = await db.select({ resultHash: matches.resultHash })
    .from(matches)
    .where(eq(matches.fixtureId, fixtureId))
    .limit(1);
  if (!match?.resultHash) throw new Error(`Fixture '${fixtureId}' has no committed result hash.`);
  const [stats] = await db.select().from(matchStatistics).where(eq(matchStatistics.fixtureId, fixtureId));
  const fixtureMarkets = await db.select().from(markets).where(eq(markets.fixtureId, fixtureId));
  const marketIds = fixtureMarkets.map((market) => market.id);
  const outcomes = marketIds.length === 0
    ? []
    : await db.select().from(marketOutcomes).where(inArray(marketOutcomes.marketId, marketIds));
  const marketById = new Map(fixtureMarkets.map((market) => [market.id, market]));
  const touchedSelections = await db.select({ betId: betSelections.betId })
    .from(betSelections)
    .where(eq(betSelections.fixtureId, fixtureId));

  await db.transaction(async (tx) => {
    for (const outcome of outcomes) {
      const market = marketById.get(outcome.marketId);
      if (!market) continue;
      const existingRows = await tx.select().from(marketOutcomeSettlements)
        .where(eq(marketOutcomeSettlements.marketOutcomeId, outcome.id))
        .limit(1);
      const existing = existingRows[0];
      if (existing && existing.fixtureResultHash !== match.resultHash) {
        throw new Error(`Settlement result hash changed for outcome '${outcome.id}'.`);
      }
      const status = existing?.status as MultipleLegOutcome | undefined ?? resultForOutcome({
        marketType: market.marketType,
        outcomeCode: outcome.outcomeCode,
        homeScore: fixture.homeScore!,
        awayScore: fixture.awayScore!,
        statistics: stats,
      });
      if (!existing) {
        await tx.insert(marketOutcomeSettlements).values({
          fixtureId,
          marketId: market.id,
          marketOutcomeId: outcome.id,
          outcomeCode: outcome.outcomeCode,
          status,
          fixtureResultHash: match.resultHash!,
          rulesVersion: SETTLEMENT_RULES_VERSION,
        }).onConflictDoNothing({ target: marketOutcomeSettlements.marketOutcomeId });
      }

      await tx.update(marketOutcomes)
        .set({ status: status === 'WON' ? 'WIN' : status === 'LOST' ? 'LOSS' : 'VOID', updatedAt: new Date() })
        .where(eq(marketOutcomes.id, outcome.id));
      await tx.update(betSelections)
        .set({ status })
        .where(and(
          eq(betSelections.fixtureId, fixtureId),
          eq(betSelections.marketId, market.id),
          eq(betSelections.outcomeCode, outcome.outcomeCode),
          eq(betSelections.status, 'PENDING'),
        ));
    }

    if (marketIds.length > 0) {
      await tx.update(markets)
        .set({ status: 'SETTLED', updatedAt: new Date() })
        .where(inArray(markets.id, marketIds));
    }
  });

  for (const betId of new Set(touchedSelections.map((selection) => selection.betId))) {
    await settleCompletedTicket(betId, fixtureId);
  }

  console.log(`✅ Market outcomes and completed tickets settled for fixture '${fixtureId}'.`);
}

async function settleCompletedTicket(betId: string, triggerFixtureId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [bet] = await tx.select().from(bets).where(eq(bets.id, betId)).for('update').limit(1);
    if (!bet || bet.status !== 'PENDING') return;

    const [existingSettlement] = await tx.select().from(settlements)
      .where(eq(settlements.betId, bet.id))
      .limit(1);
    if (existingSettlement) return;

    const legs = await tx.select({
      outcome: betSelections.status,
      odds: betSelections.odds,
    })
      .from(betSelections)
      .where(eq(betSelections.betId, bet.id));
    if (legs.length === 0 || legs.some((leg) => !['WON', 'LOST', 'VOID'].includes(leg.outcome))) return;

    const result = calculateStraightMultipleSettlement(
      legs.map((leg) => ({ outcome: leg.outcome as MultipleLegOutcome, odds: Number(leg.odds) })),
      bet.stake,
    );
    const payout = new Decimal(result.payout);

    await tx.insert(settlements).values({
      betId: bet.id,
      fixtureId: triggerFixtureId,
      status: result.status,
      payoutAmount: payout.toFixed(2),
    }).onConflictDoNothing({ target: settlements.betId });
    await tx.update(bets)
      .set({ status: result.status, settledAt: new Date() })
      .where(and(eq(bets.id, bet.id), eq(bets.status, 'PENDING')));

    if (payout.greaterThan(0)) {
      const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, bet.userId)).for('update').limit(1);
      if (!wallet) throw new Error(`Wallet not found for settled ticket '${bet.id}'.`);
      const before = new Decimal(wallet.balance);
      const after = before.add(payout).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      await tx.update(wallets)
        .set({ balance: after.toFixed(2), updatedAt: new Date() })
        .where(eq(wallets.id, wallet.id));
      await tx.insert(walletTransactions).values({
        walletId: wallet.id,
        type: result.status === 'VOID' ? 'BET_REFUND' : 'WIN_PAYOUT',
        amount: `+${payout.toFixed(2)}`,
        balanceBefore: before.toFixed(2),
        balanceAfter: after.toFixed(2),
        referenceType: result.status === 'VOID' ? 'BET_REFUND' : 'BET_PAYOUT',
        referenceId: bet.id,
      });
    }
  });
}
