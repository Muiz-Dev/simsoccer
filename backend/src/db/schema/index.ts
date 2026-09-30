import { pgTable, uuid, text, integer, boolean, timestamp, numeric, jsonb } from 'drizzle-orm/pg-core';

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
  name: text('name').notNull(), // e.g., "2024-2025", "2025-2026"
  seasonNumber: integer('season_number').notNull().default(1),
  status: text('status').notNull().default('DRAFT'), // DRAFT, SCHEDULED, ACTIVE, COMPLETED, CANCELLED
  startAt: timestamp('start_at'),
  endAt: timestamp('end_at'),
  currentRound: integer('current_round').notNull().default(0),
  totalRounds: integer('total_rounds').notNull().default(38),
  simulationVersion: text('simulation_version').notNull().default('1.0.0'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

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
});

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
});

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
});

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
  email: text('email').notNull().unique(),
  role: text('role').notNull().default('USER'), // USER, ADMIN, SUPER_ADMIN
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

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
