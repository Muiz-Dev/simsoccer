import { db } from '../db/index';
import { bets, betSelections, settlements, wallets, walletTransactions, fixtures, matchStatistics, markets } from '../db/schema/index';
import Decimal from 'decimal.js';
import { eq, and } from 'drizzle-orm';

/**
 * Idempotent settlement worker for all bets associated with a finished fixture, wrapped in ACID db.transaction.
 */
export async function settleFixtureBets(fixtureId: string) {
  console.log(`⚖️ Starting bet settlement for fixture '${fixtureId}'...`);

  // 1. Fetch fixture & statistics
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  if (!fixture || fixture.status !== 'FINISHED' || fixture.homeScore === null || fixture.awayScore === null) {
    throw new Error(`Fixture '${fixtureId}' is not finalized; settlement must wait for its persisted final result.`);
  }

  const homeScore = fixture.homeScore ?? 0;
  const awayScore = fixture.awayScore ?? 0;

  // Fetch statistics for corners/cards markets
  const [stats] = await db.select().from(matchStatistics).where(eq(matchStatistics.fixtureId, fixtureId));
  const totalCorners = stats ? stats.homeCorners + stats.awayCorners : 10;
  const totalCards = stats ? stats.homeYellowCards + stats.awayYellowCards + (stats.homeRedCards + stats.awayRedCards) * 2 : 4;

  // Fetch pending selections for this fixture
  const pendingSelections = await db.select().from(betSelections).where(
    and(eq(betSelections.fixtureId, fixtureId), eq(betSelections.status, 'PENDING'))
  );

  console.log(`📋 Found ${pendingSelections.length} pending bet selections for fixture.`);

  for (const selection of pendingSelections) {
    const [market] = await db.select().from(markets).where(eq(markets.id, selection.marketId));
    if (!market) continue;

    let isWin = false;

    // Evaluate selection against authoritative match outcome
    switch (market.marketType) {
      case '1X2':
        if (selection.outcomeCode === '1' && homeScore > awayScore) isWin = true;
        else if (selection.outcomeCode === 'X' && homeScore === awayScore) isWin = true;
        else if (selection.outcomeCode === '2' && awayScore > homeScore) isWin = true;
        break;

      case 'DOUBLE_CHANCE':
        if (selection.outcomeCode === '1X' && homeScore >= awayScore) isWin = true;
        else if (selection.outcomeCode === '12' && homeScore !== awayScore) isWin = true;
        else if (selection.outcomeCode === 'X2' && awayScore >= homeScore) isWin = true;
        break;

      case 'TOTAL_GOALS':
      case 'TOTAL_GOALS_0.5':
      case 'TOTAL_GOALS_1.5':
      case 'TOTAL_GOALS_2.5':
      case 'TOTAL_GOALS_3.5':
      case 'TOTAL_GOALS_4.5':
        const totalGoals = homeScore + awayScore;
        if (selection.outcomeCode.startsWith('OVER_')) {
          const threshold = parseFloat(selection.outcomeCode.replace('OVER_', ''));
          if (totalGoals > threshold) isWin = true;
        } else if (selection.outcomeCode.startsWith('UNDER_')) {
          const threshold = parseFloat(selection.outcomeCode.replace('UNDER_', ''));
          if (totalGoals < threshold) isWin = true;
        }
        break;

      case 'BTTS':
        const bothScored = homeScore > 0 && awayScore > 0;
        if (selection.outcomeCode === 'YES' && bothScored) isWin = true;
        else if (selection.outcomeCode === 'NO' && !bothScored) isWin = true;
        break;

      case 'CORRECT_SCORE':
        if (selection.outcomeCode === `${homeScore}-${awayScore}`) isWin = true;
        break;

      case 'TOTAL_CORNERS':
        if (selection.outcomeCode === 'OVER_9.5' && totalCorners > 9.5) isWin = true;
        else if (selection.outcomeCode === 'UNDER_9.5' && totalCorners < 9.5) isWin = true;
        break;

      case 'TOTAL_CARDS':
        if (selection.outcomeCode === 'OVER_4.5' && totalCards > 4.5) isWin = true;
        else if (selection.outcomeCode === 'UNDER_4.5' && totalCards < 4.5) isWin = true;
        break;

      default:
        isWin = false;
        break;
    }

    const betResultStatus = isWin ? 'WON' : 'LOST';

    // Wrap single bet settlement & payout inside ACID Database Transaction
    await db.transaction(async (tx) => {
      // Idempotency check: Ensure bet settlement record does not exist
      const [existingSettlement] = await tx.select().from(settlements).where(eq(settlements.betId, selection.betId));
      if (existingSettlement) {
        console.log(`ℹ️ Bet '${selection.betId}' already settled. Skipping duplicate settlement.`);
        return;
      }

      const [bet] = await tx.select().from(bets).where(eq(bets.id, selection.betId));
      if (!bet) return;

      const payoutAmount = isWin ? parseFloat(bet.potentialPayout) : 0.0;

      // Record Settlement
      await tx.insert(settlements).values({
        betId: bet.id,
        fixtureId,
        status: betResultStatus,
        payoutAmount: payoutAmount.toFixed(2),
      });

      // Update Bet & Selection status
      await tx.update(betSelections).set({ status: betResultStatus }).where(eq(betSelections.id, selection.id));
      await tx.update(bets).set({ status: betResultStatus, settledAt: new Date() }).where(eq(bets.id, bet.id));

      // Credit payout for winning bet
      if (isWin && payoutAmount > 0) {
        const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, bet.userId)).for('update');
        if (wallet) {
          const balanceBefore = new Decimal(wallet.balance);
          const payoutDec = new Decimal(payoutAmount);
          const balanceAfter = balanceBefore.add(payoutDec).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

          await tx.update(wallets)
            .set({ balance: balanceAfter.toFixed(2), updatedAt: new Date() })
            .where(eq(wallets.id, wallet.id));

          await tx.insert(walletTransactions).values({
            walletId: wallet.id,
            type: 'WIN_PAYOUT',
            amount: `+${payoutDec.toFixed(2)}`,
            balanceBefore: balanceBefore.toFixed(2),
            balanceAfter: balanceAfter.toFixed(2),
            referenceType: 'BET_PAYOUT',
            referenceId: bet.id,
          });

          console.log(`🎉 Payout credited! User: ${bet.userId}, Amount: +${payoutAmount}, New Balance: ${balanceAfter.toFixed(2)}`);
        }
      }
    });
  }

  console.log(`✅ Settlement complete for fixture '${fixtureId}'.`);
}
