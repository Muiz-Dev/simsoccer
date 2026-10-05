import assert from 'node:assert/strict';
import {
  calculateAllPreMatchMarkets,
  CORNER_TOTAL_LINES,
  GOAL_TOTAL_LINES,
  STANDARD_MARKET_MARGIN,
} from '../markets/probability-engine';

const markets = calculateAllPreMatchMarkets(1.35, 1.05);
const byType = new Map(markets.map((market) => [market.marketType, market]));

assert.deepEqual(
  markets.filter((market) => market.marketType.startsWith('TOTAL_GOALS_')).map((market) => market.marketType),
  GOAL_TOTAL_LINES.map((line) => `TOTAL_GOALS_${line}`),
);
assert.deepEqual(
  markets.filter((market) => market.marketType.startsWith('TOTAL_CORNERS_')).map((market) => market.marketType),
  CORNER_TOTAL_LINES.map((line) => `TOTAL_CORNERS_${line}`),
);

for (const market of [
  ...GOAL_TOTAL_LINES.map((line) => byType.get(`TOTAL_GOALS_${line}`)),
  ...CORNER_TOTAL_LINES.map((line) => byType.get(`TOTAL_CORNERS_${line}`)),
]) {
  assert.ok(market);
  assert.equal(market.outcomes.length, 2);
  assert.ok(market.outcomes.every((outcome) => outcome.odds >= 1.01));
  assert.ok(Math.abs(market.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0) - 1) < 0.0002);
}

for (const line of [0.5, 1, 2.5]) {
  const market = byType.get(`TOTAL_GOALS_${line}`);
  assert.ok(market);
  const over = market.outcomes.find((outcome) => outcome.outcomeCode === `OVER_${line}`);
  const under = market.outcomes.find((outcome) => outcome.outcomeCode === `UNDER_${line}`);
  assert.ok(over && under);
  const overround = 1 / over.odds + 1 / under.odds - 1;
  assert.ok(Math.abs(overround - STANDARD_MARKET_MARGIN) < 0.01);
}

const goals55 = byType.get('TOTAL_GOALS_5.5');
assert.ok(goals55);
assert.ok(goals55.outcomes.every((outcome) => outcome.odds >= 1.01));

const corners75 = byType.get('TOTAL_CORNERS_7.5');
const corners95 = byType.get('TOTAL_CORNERS_9.5');
assert.ok(corners75 && corners95);
assert.ok(
  corners75.outcomes.find((outcome) => outcome.outcomeCode === 'OVER_7.5')!.odds
    < corners95.outcomes.find((outcome) => outcome.outcomeCode === 'OVER_9.5')!.odds,
  'Over 7.5 corners should price shorter than Over 9.5 for the same match model.',
);
for (let index = 1; index < CORNER_TOTAL_LINES.length; index++) {
  const previousLine = CORNER_TOTAL_LINES[index - 1];
  const currentLine = CORNER_TOTAL_LINES[index];
  const previousOverOdds = byType.get(`TOTAL_CORNERS_${previousLine}`)!
    .outcomes.find((outcome) => outcome.outcomeCode === `OVER_${previousLine}`)!.odds;
  const currentOverOdds = byType.get(`TOTAL_CORNERS_${currentLine}`)!
    .outcomes.find((outcome) => outcome.outcomeCode === `OVER_${currentLine}`)!.odds;
  assert.ok(currentOverOdds > previousOverOdds, `Over ${currentLine} should be longer odds than Over ${previousLine}.`);
}

const oneXTwo = byType.get('1X2');
assert.ok(oneXTwo);
const oneXTwoOverround = oneXTwo.outcomes.reduce((sum, outcome) => sum + 1 / outcome.odds, 0) - 1;
assert.ok(Math.abs(oneXTwoOverround - STANDARD_MARKET_MARGIN) < 0.01);

console.log('probability engine ladder and pricing checks passed');
