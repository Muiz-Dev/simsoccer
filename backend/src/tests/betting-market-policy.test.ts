import assert from 'node:assert/strict';
import { getRoundCutoffAt, isRoundMarketOpen } from '../betting/round-market-policy';

const firstKickoff = new Date('2026-10-01T08:05:00.000Z');
const laterKickoff = new Date('2026-10-01T08:06:00.000Z');
const cutoff = new Date('2026-10-01T08:04:00.000Z');

assert.equal(getRoundCutoffAt([laterKickoff, firstKickoff])?.toISOString(), cutoff.toISOString());
assert.equal(getRoundCutoffAt([]), null);
assert.equal(isRoundMarketOpen([firstKickoff, laterKickoff], new Date(cutoff.getTime() - 1)), true);
assert.equal(isRoundMarketOpen([firstKickoff, laterKickoff], cutoff), false);
assert.equal(isRoundMarketOpen([firstKickoff, laterKickoff], new Date(cutoff.getTime() + 1)), false);

console.log('betting round market policy checks passed');
