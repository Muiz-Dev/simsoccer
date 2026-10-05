import { pgTable, uuid, text, integer, boolean, timestamp, numeric, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const leagues = pgTable('leagues', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  country: text('country').notNull(),
  competitionType: text('competition_type').notNull().default('DOMESTIC_LEAGUE'),
  teamCount: integer('team_count').notNull().default(20),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const seasons = pgTable('seasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id').notNull().references(() => leagues.id),
  name: text('name').notNull(), // e.g., "Season 1", "Season 2"; year strings remain accepted as legacy aliases
  seasonNumber: integer('season_number').notNull().default(1),
  status: text('status').notNull().default('DRAFT'), // DRAFT, SCHEDULED, ACTIVE, COMPLETED, CANCELLED
  startAt: timestamp('start_at'),
  endAt: timestamp('end_at'),
  currentRound: integer('current_round').notNull().default(0),
  totalRounds: integer('total_rounds').notNull().default(38),
  simulationVersion: text('simulation_version').notNull().default('1.0.0'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('seasons_league_number_idx').on(table.leagueId, table.seasonNumber),
]);

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id').notNull().references(() => leagues.id),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  slug: text('slug').notNull().unique(),
  stadiumName: text('stadium_name'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const teamRatings = pgTable('team_ratings', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id').notNull().references(() => teams.id),
  seasonId: uuid('season_id').notNull().references(() => seasons.id),

  overallAbility: numeric('overall_ability').notNull().default('75.0'),
  attackStrength: numeric('attack_strength').notNull().default('1.00'),
  defenseStrength: numeric('defense_strength').notNull().default('1.00'),
  creationRating: numeric('creation_rating').notNull().default('1.00'),
  finishingRating: numeric('finishing_rating').notNull().default('1.00'),
  goalkeepingRating: numeric('goalkeeping_rating').notNull().default('1.00'),
  pressingRating: numeric('pressing_rating').notNull().default('1.00'),
  disciplineRating: numeric('discipline_rating').notNull().default('1.00'),
  homeAdvantage: numeric('home_advantage').notNull().default('1.10'),

  form: numeric('form').notNull().default('0.00'), // recent form modifier
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const teamRatingHistory = pgTable('team_rating_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id').notNull().references(() => teams.id),
  matchId: uuid('match_id'),
  attribute: text('attribute').notNull(),
  beforeValue: numeric('before_value').notNull(),
  afterValue: numeric('after_value').notNull(),
  delta: numeric('delta').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const players = pgTable('players', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id').references(() => teams.id),
  name: text('name').notNull(),
  age: integer('age').notNull().default(24),
  primaryPosition: text('primary_position').notNull(), // GK, CB, LB, RB, DM, CM, AM, LW, RW, ST
  secondaryPositions: jsonb('secondary_positions').default([]),

  // Base attributes
  pace: integer('pace').notNull().default(70),
  shooting: integer('shooting').notNull().default(70),
  passing: integer('passing').notNull().default(70),
  dribbling: integer('dribbling').notNull().default(70),
  defending: integer('defending').notNull().default(70),
  physical: integer('physical').notNull().default(70),
  goalkeeping: integer('goalkeeping').notNull().default(10),

  overallRating: integer('overall_rating').notNull().default(75),
  potential: integer('potential').notNull().default(80),
  fitness: integer('fitness').notNull().default(100),
  stamina: integer('stamina').notNull().default(80),
  form: numeric('form').notNull().default('0.00'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const playerRatingHistory = pgTable('player_rating_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').notNull().references(() => players.id),
  matchId: uuid('match_id'),
  beforeRating: integer('before_rating').notNull(),
  afterRating: integer('after_rating').notNull(),
  delta: integer('delta').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const fixtures = pgTable('fixtures', {
  id: uuid('id').primaryKey().defaultRandom(),
  seasonId: uuid('season_id').notNull().references(() => seasons.id),
  round: integer('round').notNull(),
  homeTeamId: uuid('home_team_id').notNull().references(() => teams.id),
  awayTeamId: uuid('away_team_id').notNull().references(() => teams.id),
  scheduledAt: timestamp('scheduled_at').notNull(),
  status: text('status').notNull().default('SCHEDULED'), // SCHEDULED, LIVE, HALFTIME, FINISHED, POSTPONED, CANCELLED
  homeScore: integer('home_score').default(0),
  awayScore: integer('away_score').default(0),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const matches = pgTable('matches', {
  id: uuid('id').primaryKey().defaultRandom(),
  fixtureId: uuid('fixture_id').notNull().references(() => fixtures.id).unique(),
  seed: text('seed').notNull(),
  simulationVersion: text('simulation_version').notNull().default('1.0.0'),

  homeLambda: numeric('home_lambda').notNull().default('1.20'),
  awayLambda: numeric('away_lambda').notNull().default('1.00'),

  homeScore: integer('home_score').notNull().default(0),
  awayScore: integer('away_score').notNull().default(0),

  virtualSecond: integer('virtual_second').notNull().default(0),
  status: text('status').notNull().default('SCHEDULED'),

  resultHash: text('result_hash'),
  timelineHash: text('timeline_hash'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const matchSnapshots = pgTable('match_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  matchId: uuid('match_id').notNull().references(() => matches.id),
  virtualSecond: integer('virtual_second').notNull(),
  matchStateJson: jsonb('match_state_json').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('match_snapshots_match_vsec_idx').on(table.matchId, table.virtualSecond),
]);

export const matchEvents = pgTable('match_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  fixtureId: uuid('fixture_id').notNull().references(() => fixtures.id),
  sequence: integer('sequence').notNull(),
  virtualMinute: integer('virtual_minute').notNull(),
  virtualSecond: integer('virtual_second').notNull(),
  eventType: text('event_type').notNull(), // MATCH_START, KICKOFF, SHOT, SHOT_ON_TARGET, GOAL, CORNER, FOUL, YELLOW_CARD, RED_CARD, INJURY, SUBSTITUTION, HALFTIME, SECOND_HALF_START, MATCH_END
  teamId: uuid('team_id').references(() => teams.id),
  playerId: uuid('player_id').references(() => players.id),
  secondaryPlayerId: uuid('secondary_player_id').references(() => players.id),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('match_events_fixture_sequence_idx').on(table.fixtureId, table.sequence),
]);

export const matchStatistics = pgTable('match_statistics', {
  id: uuid('id').primaryKey().defaultRandom(),
  fixtureId: uuid('fixture_id').notNull().references(() => fixtures.id).unique(),
  homePossession: integer('home_possession').notNull().default(50),
  awayPossession: integer('away_possession').notNull().default(50),
  homeShots: integer('home_shots').notNull().default(0),
  awayShots: integer('away_shots').notNull().default(0),
  homeShotsOnTarget: integer('home_shots_on_target').notNull().default(0),
  awayShotsOnTarget: integer('away_shots_on_target').notNull().default(0),
  homeCorners: integer('home_corners').notNull().default(0),
  awayCorners: integer('away_corners').notNull().default(0),
  homeFouls: integer('home_fouls').notNull().default(0),
  awayFouls: integer('away_fouls').notNull().default(0),
  homeYellowCards: integer('home_yellow_cards').notNull().default(0),
  awayYellowCards: integer('away_yellow_cards').notNull().default(0),
  homeRedCards: integer('home_red_cards').notNull().default(0),
  awayRedCards: integer('away_red_cards').notNull().default(0),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const playerMatchStatistics = pgTable('player_match_statistics', {
  id: uuid('id').primaryKey().defaultRandom(),
  fixtureId: uuid('fixture_id').notNull().references(() => fixtures.id),
  playerId: uuid('player_id').notNull().references(() => players.id),
  teamId: uuid('team_id').notNull().references(() => teams.id),
  minutesPlayed: integer('minutes_played').notNull().default(0),
  goals: integer('goals').notNull().default(0),
  assists: integer('assists').notNull().default(0),
  shots: integer('shots').notNull().default(0),
  shotsOnTarget: integer('shots_on_target').notNull().default(0),
  foulsCommitted: integer('fouls_committed').notNull().default(0),
  yellowCards: integer('yellow_cards').notNull().default(0),
  redCards: integer('red_cards').notNull().default(0),
  rating: numeric('rating').notNull().default('6.0'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const standings = pgTable('standings', {
  id: uuid('id').primaryKey().defaultRandom(),
  seasonId: uuid('season_id').notNull().references(() => seasons.id),
  teamId: uuid('team_id').notNull().references(() => teams.id),
  played: integer('played').notNull().default(0),
  won: integer('won').notNull().default(0),
  drawn: integer('drawn').notNull().default(0),
  lost: integer('lost').notNull().default(0),
  goalsFor: integer('goals_for').notNull().default(0),
  goalsAgainst: integer('goals_against').notNull().default(0),
  goalDifference: integer('goal_difference').notNull().default(0),
  points: integer('points').notNull().default(0),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('standings_season_team_idx').on(table.seasonId, table.teamId),
]);

export const markets = pgTable('markets', {
  id: uuid('id').primaryKey().defaultRandom(),
  fixtureId: uuid('fixture_id').notNull().references(() => fixtures.id),
  marketType: text('market_type').notNull(), // 1X2, DOUBLE_CHANCE, TOTAL_GOALS, BTTS, CORRECT_SCORE, TOTAL_CORNERS, TOTAL_CARDS, TEAM_TOTAL_GOALS, HALFTIME_RESULT, ANYTIME_GOALSCORER, FIRST_GOALSCORER
  marketScope: text('market_scope').notNull().default('FULL_TIME'),
  status: text('status').notNull().default('OPEN'), // OPEN, SUSPENDED, CLOSED, SETTLED, VOID
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const marketOutcomes = pgTable('market_outcomes', {
  id: uuid('id').primaryKey().defaultRandom(),
  marketId: uuid('market_id').notNull().references(() => markets.id),
  outcomeCode: text('outcome_code').notNull(), // e.g., HOME, DRAW, AWAY, OVER_2.5, UNDER_2.5, YES, NO, 2-1
  displayName: text('display_name').notNull(),
  probability: numeric('probability').notNull(),
  odds: numeric('odds').notNull(),
  status: text('status').notNull().default('OPEN'), // OPEN, WIN, LOSS, VOID
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const oddsSnapshots = pgTable('odds_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  marketId: uuid('market_id').notNull().references(() => markets.id),
  outcomeCode: text('outcome_code').notNull(),
  odds: numeric('odds').notNull(),
  virtualSecond: integer('virtual_second').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  authSubject: text('auth_subject').unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  isEmailVerified: boolean('is_email_verified').notNull().default(false),
  firstName: text('first_name'),
  lastName: text('last_name'),
  phone: text('phone'),
  privacyNoticeVersion: text('privacy_notice_version'),
  termsAcceptedAt: timestamp('terms_accepted_at'),
  role: text('role').notNull().default('USER'), // USER, ADMIN, SUPER_ADMIN
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`),
]);

export const authChallenges = pgTable('auth_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  challengeHash: text('challenge_hash').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  purpose: text('purpose').notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
}, (table) => [
  uniqueIndex('auth_challenges_hash_unique').on(table.challengeHash),
  index('auth_challenges_expiry_idx').on(table.expiresAt),
]);

export const authDevices = pgTable('auth_devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  deviceTokenHash: text('device_token_hash').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
  revokedAt: timestamp('revoked_at'),
}, (table) => [
  uniqueIndex('auth_devices_user_token_unique').on(table.userId, table.deviceTokenHash),
  index('auth_devices_user_idx').on(table.userId),
]);

export const authSessions = pgTable('auth_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  familyId: uuid('family_id').notNull(),
  deviceId: uuid('device_id').references(() => authDevices.id, { onDelete: 'set null' }),
  refreshTokenHash: text('refresh_token_hash').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  consumedAt: timestamp('consumed_at'),
  userAgentHash: text('user_agent_hash'),
  ipHash: text('ip_hash'),
}, (table) => [
  uniqueIndex('auth_sessions_refresh_hash_unique').on(table.refreshTokenHash),
  index('auth_sessions_user_idx').on(table.userId),
  index('auth_sessions_family_idx').on(table.familyId),
  index('auth_sessions_expiry_idx').on(table.expiresAt),
  index('auth_sessions_device_idx').on(table.deviceId),
]);

export const wallets = pgTable('wallets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id).unique(),
  currency: text('currency').notNull().default('VIRTUAL'),
  balance: numeric('balance').notNull().default('10000.00'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const walletTransactions = pgTable('wallet_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  walletId: uuid('wallet_id').notNull().references(() => wallets.id),
  type: text('type').notNull(), // INITIAL_CREDIT, BET_DEBIT, BET_REFUND, WIN_PAYOUT, BONUS, ADMIN_ADJUSTMENT
  amount: numeric('amount').notNull(),
  balanceBefore: numeric('balance_before').notNull(),
  balanceAfter: numeric('balance_after').notNull(),
  referenceType: text('reference_type'),
  referenceId: uuid('reference_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const bets = pgTable('bets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  idempotencyKey: text('idempotency_key').unique(),
  publicTicketCodeHash: text('public_ticket_code_hash').unique(),
  stake: numeric('stake').notNull(),
  totalOdds: numeric('total_odds').notNull(),
  potentialPayout: numeric('potential_payout').notNull(),
  status: text('status').notNull().default('PENDING'), // PENDING, WON, LOST, VOID, CANCELLED
  placedAt: timestamp('placed_at').notNull().defaultNow(),
  settledAt: timestamp('settled_at'),
});

export const betSelections = pgTable('bet_selections', {
  id: uuid('id').primaryKey().defaultRandom(),
  betId: uuid('bet_id').notNull().references(() => bets.id),
  fixtureId: uuid('fixture_id').notNull().references(() => fixtures.id),
  marketId: uuid('market_id').notNull().references(() => markets.id),
  outcomeCode: text('outcome_code').notNull(),
  odds: numeric('odds').notNull(),
  status: text('status').notNull().default('PENDING'), // PENDING, WON, LOST, VOID
});

export const settlements = pgTable('settlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  betId: uuid('bet_id').notNull().references(() => bets.id).unique(),
  fixtureId: uuid('fixture_id').notNull().references(() => fixtures.id),
  status: text('status').notNull(), // WON, LOST, VOID
  payoutAmount: numeric('payout_amount').notNull().default('0.00'),
  settledAt: timestamp('settled_at').notNull().defaultNow(),
});

export const marketOutcomeSettlements = pgTable('market_outcome_settlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  fixtureId: uuid('fixture_id').notNull().references(() => fixtures.id),
  marketId: uuid('market_id').notNull().references(() => markets.id),
  marketOutcomeId: uuid('market_outcome_id').notNull().references(() => marketOutcomes.id),
  outcomeCode: text('outcome_code').notNull(),
  status: text('status').notNull(), // WON, LOST, VOID
  fixtureResultHash: text('fixture_result_hash').notNull(),
  rulesVersion: text('rules_version').notNull(),
  settledAt: timestamp('settled_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('market_outcome_settlements_outcome_idx').on(table.marketOutcomeId),
]);

export const bookingSlips = pgTable('booking_slips', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const bookingSlipSelections = pgTable('booking_slip_selections', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingSlipId: uuid('booking_slip_id').notNull().references(() => bookingSlips.id),
  fixtureId: uuid('fixture_id').notNull().references(() => fixtures.id),
  marketId: uuid('market_id').notNull().references(() => markets.id),
  marketOutcomeId: uuid('market_outcome_id').notNull().references(() => marketOutcomes.id),
  quotedOdds: numeric('quoted_odds').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('booking_slip_fixture_idx').on(table.bookingSlipId, table.fixtureId),
]);

export const simulationRuns = pgTable('simulation_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  fixtureId: uuid('fixture_id').notNull().references(() => fixtures.id),
  simulationVersion: text('simulation_version').notNull(),
  seed: text('seed').notNull(),
  status: text('status').notNull().default('PENDING'), // PENDING, RUNNING, COMPLETED, FAILED
  resultHash: text('result_hash'),
  timelineHash: text('timeline_hash'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
  error: text('error'),
});

export const fixturePostMatch = pgTable('fixture_post_match', {
  fixtureId: uuid('fixture_id').primaryKey().references(() => fixtures.id),
  evolutionCompleted: boolean('evolution_completed').notNull().default(false),
  settlementCompleted: boolean('settlement_completed').notNull().default(false),
  completedAt: timestamp('completed_at'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const adminCredentials = pgTable('admin_credentials', {
  id: text('id').primaryKey().default('primary'),
  pinHash: text('pin_hash').notNull(),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const adminSessions = pgTable('admin_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
  idleExpiresAt: timestamp('idle_expires_at').notNull(),
  absoluteExpiresAt: timestamp('absolute_expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
});

export const adminAuditLog = pgTable('admin_audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  summary: text('summary').notNull(),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const worldRuntime = pgTable('world_runtime', {
  id: text('id').primaryKey().default('singleton'),
  status: text('status').notNull().default('WAITING_FOR_SEASON'), // RUNNING, RECOVERING, WAITING_FOR_SEASON, DEGRADED, STOPPED
  activeSeasonId: uuid('active_season_id').references(() => seasons.id),
  currentRound: integer('current_round').notNull().default(0),
  totalRounds: integer('total_rounds').notNull().default(38),
  coordinatorNodeId: text('coordinator_node_id'),
  heartbeatAt: timestamp('heartbeat_at').notNull().defaultNow(),
  lastReconciliationAt: timestamp('last_reconciliation_at'),
  degradedReason: text('degraded_reason'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
