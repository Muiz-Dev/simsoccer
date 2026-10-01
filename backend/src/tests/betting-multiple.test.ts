import assert from 'node:assert/strict';
import { calculateStraightMultiple } from '../betting/multiple';

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

console.log('betting multiple calculation checks passed');