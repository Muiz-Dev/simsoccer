import assert from 'node:assert/strict';
import { coerceLeagueInput, coerceTeamInput, normaliseAdminSlug } from '../admin/operations';

assert.equal(normaliseAdminSlug(' Premier League '), 'premier-league');
assert.equal(normaliseAdminSlug('City FC'), 'city-fc');

const league = coerceLeagueInput({
  name: ' Premier League ',
  country: ' England ',
  teamCount: '20',
  competitionType: 'DOMESTIC_LEAGUE',
  active: 'true',
});
assert.equal(league.name, 'Premier League');
assert.equal(league.slug, 'premier-league');
assert.equal(league.country, 'England');
assert.equal(league.teamCount, 20);
assert.equal(league.active, true);

const team = coerceTeamInput({
  leagueId: 'league-123',
  name: ' Manchester United ',
  shortName: ' MUN ',
  slug: ' manchester-united ',
  stadiumName: ' Old Trafford ',
  active: 'true',
});
assert.equal(team.name, 'Manchester United');
assert.equal(team.shortName, 'MUN');
assert.equal(team.slug, 'manchester-united');
assert.equal(team.stadiumName, 'Old Trafford');
assert.equal(team.active, true);

console.log('admin operation parsing checks passed');
