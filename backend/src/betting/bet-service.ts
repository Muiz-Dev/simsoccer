import { db } from '../db/index';
import { wallets, walletTransactions, bets, betSelections, markets, marketOutcomes, fixtures } from '../db/schema/index';
import Decimal from 'decimal.js';
import { eq, and } from 'drizzle-orm';

export interface PlaceBetInput {
  userId: string;
  fixtureId: string;
  marketId: string;
  outcomeCode: string;
  stake: number;
  idempotencyKey?: string;
}

/**
 * Places a play-money bet with atomic ACID ledger transaction, balance checks, and idempotency protection.
 */
export async function placePlayMoneyBet(input: PlaceBetInput) {
  const { userId, fixtureId, marketId, outcomeCode, stake, idempotencyKey } = input;

  if (stake <= 0) {
    throw new Error('Stake amount must be strictly greater than zero');
  }

  // Idempotency check
  if (idempotencyKey) {
    const [existingBet] = await db.select().from(bets).where(eq(bets.idempotencyKey, idempotencyKey));
    if (existingBet) {
      console.log(`ℹ️ Bet request with idempotency key '${idempotencyKey}' already processed.`);
      return existingBet;
    }
  }

  // 1. Verify fixture is not yet started or finished
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  if (!fixture) {
    throw new Error('Fixture not found');
  }
  if (fixture.status !== 'SCHEDULED') {
    throw new Error(`Market closed! Cannot place pre-match bet on fixture with status '${fixture.status}'`);
  }

  // 2. Fetch market outcome and current odds
  const [market] = await db.select().from(markets).where(and(eq(markets.id, marketId), eq(markets.fixtureId, fixtureId)));
  if (!market || market.status !== 'OPEN') {
    throw new Error('Market is closed or suspended');
  }

  const [outcome] = await db.select().from(marketOutcomes).where(and(eq(marketOutcomes.marketId, marketId), eq(marketOutcomes.outcomeCode, outcomeCode)));
  if (!outcome) {
    throw new Error(`Invalid outcome code '${outcomeCode}' for market`);
  }

  const acceptedOdds = parseFloat(outcome.odds);
  const potentialPayout = new Decimal(stake).mul(acceptedOdds).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

  // 3. Atomic PostgreSQL Transaction: Debit Wallet + Write Ledger + Create Bet
  return await db.transaction(async (tx) => {
    const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, userId));
    if (!wallet) {
      throw new Error('User wallet not found');
    }

    const currentBalance = new Decimal(wallet.balance);
    const stakeDec = new Decimal(stake);

    if (currentBalance.lessThan(stakeDec)) {
      throw new Error(`Insufficient wallet balance. Available: ${currentBalance.toFixed(2)}, Required: ${stakeDec.toFixed(2)}`);
    }

    const newBalance = currentBalance.sub(stakeDec).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    // Update wallet
    await tx.update(wallets)
      .set({ balance: newBalance.toFixed(2), updatedAt: new Date() })
      .where(eq(wallets.id, wallet.id));

    // Create Bet
    const [newBet] = await tx.insert(bets).values({
      userId,
      idempotencyKey,
      stake: stake.toFixed(2),
      totalOdds: acceptedOdds.toFixed(2),
      potentialPayout: potentialPayout.toFixed(2),
      status: 'PENDING',
    }).returning();

    // Create Bet Selection
    await tx.insert(betSelections).values({
      betId: newBet.id,
      fixtureId,
      marketId,
      outcomeCode,
      odds: acceptedOdds.toFixed(2),
      status: 'PENDING',
    });

    // Write Wallet Ledger Transaction
    await tx.insert(walletTransactions).values({
      walletId: wallet.id,
      type: 'BET_DEBIT',
      amount: `-${stakeDec.toFixed(2)}`,
      balanceBefore: currentBalance.toFixed(2),
      balanceAfter: newBalance.toFixed(2),
      referenceType: 'BET',
      referenceId: newBet.id,
    });

    console.log(`✅ Bet placed successfully! Bet ID: ${newBet.id}, Stake: ${stake}, Odds: ${acceptedOdds}, Potential Payout: ${potentialPayout}`);
    return newBet;
  });
}
