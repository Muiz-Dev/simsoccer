import assert from 'node:assert/strict';
import { gradeOutcome, gradeTicket } from '../rules';

const match = { homeScore: 2, awayScore: 1, statistics: null };
assert.equal(gradeOutcome({ ...match, marketType: '1X2', outcomeCode: '1' }), 'WON');
assert.equal(gradeOutcome({ ...match, marketType: 'DOUBLE_CHANCE', outcomeCode: 'X2' }), 'LOST');
assert.equal(gradeOutcome({ ...match, marketType: 'TOTAL_GOALS_2.5', outcomeCode: 'OVER_2.5' }), 'WON');
assert.equal(gradeOutcome({ ...match, marketType: 'TOTAL_GOALS_2', outcomeCode: 'OVER_2' }), 'WON');
assert.equal(gradeOutcome({ ...match, marketType: 'TOTAL_GOALS_3', outcomeCode: 'UNDER_3' }), 'VOID');
assert.equal(gradeOutcome({ ...match, marketType: 'TOTAL_GOALS_2', outcomeCode: 'UNDER_2' }), 'LOST');
assert.equal(gradeOutcome({ ...match, marketType: 'BTTS', outcomeCode: 'YES' }), 'WON');
assert.equal(gradeOutcome({
  ...match,
  statistics: {
    homeCorners: 2,
    awayCorners: 4,
    homeYellowCards: 1,
    awayYellowCards: 2,
    homeRedCards: 0,
    awayRedCards: 0,
  },
  marketType: 'TOTAL_CORNERS',
  outcomeCode: 'OVER_5.5',
}), 'WON');
assert.equal(gradeOutcome({
  ...match,
  statistics: {
    homeCorners: 3,
    awayCorners: 4,
    homeYellowCards: 1,
    awayYellowCards: 2,
    homeRedCards: 0,
    awayRedCards: 0,
  },
  marketType: 'TOTAL_CORNERS_6.5',
  outcomeCode: 'UNDER_6.5',
}), 'LOST');
assert.equal(gradeOutcome({ ...match, marketType: 'TOTAL_CARDS', outcomeCode: 'UNDER_4.5' }), 'VOID');
assert.throws(() => gradeOutcome({ ...match, marketType: 'UNKNOWN', outcomeCode: 'x' }), /Unsupported market type/);
assert.throws(() => gradeOutcome({ ...match, marketType: '1X2', outcomeCode: 'HOME' }), /Unsupported 1X2 outcome code/);

assert.deepEqual(gradeTicket([
  { status: 'WON', odds: '1.80' },
  { status: 'LOST', odds: '2.10' },
], '10.00'), { status: 'LOST', payout: '0.00' });

assert.deepEqual(gradeTicket([
  { status: 'WON', odds: '1.80' },
  { status: 'VOID', odds: '2.10' },
], '10.00'), { status: 'WON', payout: '18.00' });

assert.deepEqual(gradeTicket([
  { status: 'VOID', odds: '1.80' },
  { status: 'VOID', odds: '2.10' },
], '10.00'), { status: 'VOID', payout: '10.00' });

console.log('settlement rules checks passed');
