export function normaliseAdminSlug(value: string): string {
  const raw = String(value ?? '').trim().toLowerCase();
  const normalised = raw
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return normalised || 'untitled';
}

export function coerceLeagueInput(input: any) {
  const name = String(input?.name ?? '').trim();
  const country = String(input?.country ?? '').trim() || 'Global';
  const slugRaw = String(input?.slug ?? input?.name ?? '').trim();
  const competitionType = String(input?.competitionType ?? 'DOMESTIC_LEAGUE').trim() || 'DOMESTIC_LEAGUE';
  const teamCountValue = Number(input?.teamCount ?? 20);

  return {
    name,
    country,
    slug: normaliseAdminSlug(slugRaw),
    teamCount: Number.isFinite(teamCountValue) ? Math.max(2, Math.min(40, Math.round(teamCountValue))) : 20,
    competitionType,
    active: String(input?.active ?? 'true') === 'false' ? false : true,
  };
}

export function coerceTeamInput(input: any) {
  const name = String(input?.name ?? '').trim();
  const shortName = String(input?.shortName ?? input?.name ?? '').trim() || name.slice(0, 4).toUpperCase();
  const slugRaw = String(input?.slug ?? input?.name ?? '').trim();
  const stadiumName = String(input?.stadiumName ?? '').trim() || null;

  return {
    leagueId: String(input?.leagueId ?? '').trim(),
    name,
    shortName: shortName.slice(0, 8).toUpperCase(),
    slug: normaliseAdminSlug(slugRaw),
    stadiumName,
    active: String(input?.active ?? 'true') === 'false' ? false : true,
  };
}
