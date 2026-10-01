export const ROUND_MARKET_CUTOFF_SECONDS = 60;

export function normalizeTimestamp(value: Date | string): Date {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error('Invalid database timestamp.');
  }
  return timestamp;
}

export function getRoundCutoffAt(
  kickoffs: Date[],
  cutoffSeconds = ROUND_MARKET_CUTOFF_SECONDS,
): Date | null {
  const validKickoffs = kickoffs
    .map((kickoff) => kickoff.getTime())
    .filter(Number.isFinite);
  if (validKickoffs.length === 0) return null;
  return new Date(Math.min(...validKickoffs) - cutoffSeconds * 1000);
}

export function isRoundMarketOpen(kickoffs: Date[], now: Date | string): boolean {
  const cutoffAt = getRoundCutoffAt(kickoffs);
  return cutoffAt !== null && normalizeTimestamp(now) < cutoffAt;
}

export function selectDefaultBettingRound(
  currentRound: number,
  currentRoundKickoffs: Date[],
  nextRoundKickoffs: Date[],
  now: Date | string,
): number {
  if (isRoundMarketOpen(currentRoundKickoffs, now)) return currentRound;
  if (isRoundMarketOpen(nextRoundKickoffs, now)) return currentRound + 1;
  return currentRound;
}

export function selectVisibleBettingRound(
  worldRound: number,
  totalRounds: number,
  currentRoundOpen: boolean,
  currentCutoffAt: string | null,
  serverNow: string,
): number {
  const cutoffPassed = currentCutoffAt !== null
    && Date.parse(serverNow) >= Date.parse(currentCutoffAt);
  if ((!currentRoundOpen || cutoffPassed) && worldRound < totalRounds) return worldRound + 1;
  return worldRound;
}