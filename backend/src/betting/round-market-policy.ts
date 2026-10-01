export const ROUND_MARKET_CUTOFF_SECONDS = 60;

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

export function isRoundMarketOpen(kickoffs: Date[], now: Date): boolean {
  const cutoffAt = getRoundCutoffAt(kickoffs);
  return cutoffAt !== null && now < cutoffAt;
}

export function selectDefaultBettingRound(
  currentRound: number,
  currentRoundKickoffs: Date[],
  nextRoundKickoffs: Date[],
  now: Date,
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