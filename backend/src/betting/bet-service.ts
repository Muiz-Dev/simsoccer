import { db } from '../db/index';
import {
  bets,
  betSelections,
  fixtures,
  leagues,
  marketOutcomes,
  markets,
  seasons,
  wallets,
  walletTransactions,
  users,
  worldRuntime,
} from '../db/schema/index';
import Decimal from 'decimal.js';
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getRoundCutoffAt, normalizeTimestamp } from './round-market-policy';
import { createTicketAccessCode, hashTicketAccessCode, isTicketAccessCode } from './ticket-access';

const MAX_BET_SELECTIONS = 20;
const MINIMUM_BET_STAKE = new Decimal(100);

export interface PlaceBetSelectionInput {
  fixtureId: string;
  marketId: string;
  outcomeCode: string;
}

export interface PlaceBetInput {
  userId: string;
  selections: PlaceBetSelectionInput[];
  stake: string;
  idempotencyKey: string;
  ticketCode?: string;
}

export function calculateAcceptedMultiple(stakeValue: string, oddsValues: string[]) {
  const stake = new Decimal(stakeValue);
  const totalOdds = oddsValues.reduce((total, odds) => total.mul(odds), new Decimal(1))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const potentialPayout = stake.mul(totalOdds).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { totalOdds, potentialPayout };
}

/**
 * Places a play-money bet with atomic ACID ledger transaction, balance checks, and idempotency protection.
 */
export async function placePlayMoneyBet(input: PlaceBetInput) {
  const { userId, selections, stake, idempotencyKey, ticketCode } = input;
  let stakeAmount: Decimal;
  try {
    stakeAmount = new Decimal(stake);
  } catch {
    throw new Error('Stake must be a valid amount greater than zero.');
  }
  if (!stakeAmount.isFinite() || stakeAmount.lessThanOrEqualTo(0) || stakeAmount.decimalPlaces() > 2) {
    throw new Error('Stake must be a valid amount greater than zero with at most two decimal places.');
  }
  if (stakeAmount.lessThan(MINIMUM_BET_STAKE)) {
    throw new Error('Minimum stake is 100 credits.');
  }
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new Error('A valid idempotency key is required.');
  }
  const resolvedTicketCode = ticketCode ?? createTicketAccessCode();
  if (!isTicketAccessCode(resolvedTicketCode)) {
    throw new Error('A valid ticket code is required.');
  }
  if (selections.length === 0 || selections.length > MAX_BET_SELECTIONS) {
    throw new Error(`A bet must contain between 1 and ${MAX_BET_SELECTIONS} selections.`);
  }
  const fixtureIds = selections.map((selection) => selection.fixtureId);
  if (new Set(fixtureIds).size !== fixtureIds.length) {
    throw new Error('A straight multiple can include only one selection per fixture.');
  }

  const scopedIdempotencyKey = createHash('sha256').update(`${userId}:${idempotencyKey}`).digest('hex');
  return db.transaction(async (tx) => {
    const [account] = await tx.select({
      accountStatus: users.accountStatus,
      isEmailVerified: users.isEmailVerified,
    }).from(users)
      .where(eq(users.id, userId))
      .for('update')
      .limit(1);
    if (!account?.isEmailVerified || account.accountStatus !== 'ACTIVE') {
      throw new Error('This account is unavailable for betting.');
    }

    const [wallet] = await tx.select().from(wallets)
      .where(eq(wallets.userId, userId))
      .for('update')
      .limit(1);
    if (!wallet) throw new Error('User wallet not found.');

    const [existingBet] = await tx.select().from(bets)
      .where(eq(bets.idempotencyKey, scopedIdempotencyKey))
      .limit(1);
    if (existingBet) {
      await tx.update(bets)
        .set({ publicTicketCodeHash: hashTicketAccessCode(resolvedTicketCode) })
        .where(eq(bets.id, existingBet.id));
      const { publicTicketCodeHash: _oldCodeHash, ...safeBet } = existingBet;
      return { ...safeBet, ticketCode: resolvedTicketCode };
    }

    const selectedFixtures = await tx.select({
      id: fixtures.id,
      round: fixtures.round,
      status: fixtures.status,
      seasonId: fixtures.seasonId,
    })
      .from(fixtures)
      .innerJoin(seasons, eq(fixtures.seasonId, seasons.id))
      .innerJoin(leagues, eq(seasons.leagueId, leagues.id))
      .where(and(inArray(fixtures.id, fixtureIds), eq(seasons.status, 'ACTIVE'), eq(leagues.active, true)));
    if (selectedFixtures.length !== selections.length || selectedFixtures.some((fixture) => fixture.status !== 'SCHEDULED')) {
      throw new Error('One or more fixtures are not available for betting.');
    }
    const selectedRound = selectedFixtures[0].round;
    if (selectedFixtures.some((fixture) => fixture.round !== selectedRound)) {
      throw new Error('All selections must belong to the same world round.');
    }

    const [runtime] = await tx.select({
      currentRound: worldRuntime.currentRound,
    })
      .from(worldRuntime)
      .where(eq(worldRuntime.id, 'singleton'))
      .limit(1);
    if (!runtime || selectedRound < runtime.currentRound || selectedRound > runtime.currentRound + 1) {
      throw new Error('Fixture is outside the current betting rounds.');
    }

    const activeSeasons = await tx.select({ id: seasons.id })
      .from(seasons)
      .innerJoin(leagues, eq(seasons.leagueId, leagues.id))
      .where(and(eq(seasons.status, 'ACTIVE'), eq(leagues.active, true)));
    const seasonIds = activeSeasons.map((season) => season.id);
    if (seasonIds.length === 0) throw new Error('No active betting round is available.');

    const roundFixtures = await tx.select({ scheduledAt: fixtures.scheduledAt, status: fixtures.status })
      .from(fixtures)
      .where(and(inArray(fixtures.seasonId, seasonIds), eq(fixtures.round, selectedRound)));
    const cutoffAt = getRoundCutoffAt(
      roundFixtures
        .filter((row) => row.status !== 'CANCELLED' && row.status !== 'POSTPONED')
        .map((row) => row.scheduledAt),
    );
    const [databaseClock] = await tx.select({ now: sql<string>`clock_timestamp()` })
      .from(worldRuntime)
      .where(eq(worldRuntime.id, 'singleton'))
      .limit(1);
    if (!cutoffAt || !databaseClock || normalizeTimestamp(databaseClock.now) >= cutoffAt) {
      throw new Error('Betting for this round is closed.');
    }

    const marketIds = [...new Set(selections.map((selection) => selection.marketId))];
    const quotes = await tx.select({
      marketId: markets.id,
      marketStatus: markets.status,
      marketFixtureId: markets.fixtureId,
      outcomeCode: marketOutcomes.outcomeCode,
      outcomeStatus: marketOutcomes.status,
      odds: marketOutcomes.odds,
    })
      .from(markets)
      .innerJoin(marketOutcomes, eq(marketOutcomes.marketId, markets.id))
      .where(inArray(markets.id, marketIds));
    const quoteByKey = new Map(quotes.map((quote) => [`${quote.marketId}:${quote.outcomeCode}`, quote]));
    const acceptedSelections = selections.map((selection) => {
      const quote = quoteByKey.get(`${selection.marketId}:${selection.outcomeCode}`);
      if (!quote
        || quote.marketFixtureId !== selection.fixtureId
        || quote.marketStatus !== 'OPEN'
        || quote.outcomeStatus !== 'OPEN') {
        throw new Error('Selected odds are no longer available.');
      }
      return { ...selection, odds: quote.odds };
    });

    const { totalOdds, potentialPayout } = calculateAcceptedMultiple(
      stakeAmount.toFixed(2),
      acceptedSelections.map((selection) => selection.odds),
    );
    if (totalOdds.lessThan(1.01)) {
      throw new Error('Accepted combined odds are invalid.');
    }

    const currentBalance = new Decimal(wallet.balance);
    if (currentBalance.lessThan(stakeAmount)) throw new Error('Wallet balance is insufficient.');

    const newBalance = currentBalance.sub(stakeAmount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const [newBet] = await tx.insert(bets).values({
      userId,
      idempotencyKey: scopedIdempotencyKey,
      publicTicketCodeHash: hashTicketAccessCode(resolvedTicketCode),
      stake: stakeAmount.toFixed(2),
      totalOdds: totalOdds.toFixed(2),
      potentialPayout: potentialPayout.toFixed(2),
      status: 'PENDING',
    }).returning();

    await tx.update(wallets)
      .set({ balance: newBalance.toFixed(2), updatedAt: new Date() })
      .where(eq(wallets.id, wallet.id));

    await tx.insert(betSelections).values(acceptedSelections.map((selection) => ({
      betId: newBet.id,
      fixtureId: selection.fixtureId,
      marketId: selection.marketId,
      outcomeCode: selection.outcomeCode,
      odds: new Decimal(selection.odds).toFixed(2),
      status: 'PENDING',
    })));

    await tx.insert(walletTransactions).values({
      walletId: wallet.id,
      type: 'BET_DEBIT',
      amount: `-${stakeAmount.toFixed(2)}`,
      balanceBefore: currentBalance.toFixed(2),
      balanceAfter: newBalance.toFixed(2),
      referenceType: 'BET',
      referenceId: newBet.id,
    });

    const { publicTicketCodeHash: _codeHash, ...safeBet } = newBet;
    return { ...safeBet, ticketCode: resolvedTicketCode };
  });
}
