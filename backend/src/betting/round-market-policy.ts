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