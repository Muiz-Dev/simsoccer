import assert from 'node:assert/strict';
import { calculateStraightMultiple, calculateStraightMultipleSettlement } from '../betting/multiple';

const priced = calculateStraightMultiple([
  { fixtureId: 'fixture-a', odds: 1.79 },
  { fixtureId: 'fixture-b', odds: 3.70 },
], 100);

assert.deepEqual(priced, {
  selectionCount: 2,
  totalOdds: '6.62',
  potentialReturn: '662.00',
  potentialProfit: '562.00',
});

assert.throws(
  () => calculateStraightMultiple([
    { fixtureId: 'fixture-a', odds: 1.79 },
    { fixtureId: 'fixture-a', odds: 2.10 },
  ], 10),
  /one selection per fixture/,
);

assert.throws(() => calculateStraightMultiple([], 10), /at least one selection/);
assert.throws(() => calculateStraightMultiple([{ fixtureId: 'fixture-a', odds: 1 }], 10), /valid decimal odds/);
assert.throws(() => calculateStraightMultiple([{ fixtureId: 'fixture-a', odds: 2 }], 0), /greater than zero/);

assert.deepEqual(calculateStraightMultipleSettlement([
  { outcome: 'WON', odds: 1.79 },
  { outcome: 'WON', odds: 3.70 },
], '100.00'), { status: 'WON', payout: '662.00' });

assert.deepEqual(calculateStraightMultipleSettlement([
  { outcome: 'WON', odds: 1.79 },
  { outcome: 'VOID', odds: 3.70 },
], '100.00'), { status: 'WON', payout: '179.00' });

assert.deepEqual(calculateStraightMultipleSettlement([
  { outcome: 'VOID', odds: 1.79 },
  { outcome: 'VOID', odds: 3.70 },
], '100.00'), { status: 'VOID', payout: '100.00' });

assert.deepEqual(calculateStraightMultipleSettlement([
  { outcome: 'WON', odds: 1.79 },
  { outcome: 'LOST', odds: 3.70 },
], '100.00'), { status: 'LOST', payout: '0.00' });

console.log('betting multiple calculation checks passed');