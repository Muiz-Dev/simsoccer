import seedrandom from 'seedrandom';

export interface MatchSimulationInput {
  fixtureId: string;
  seasonId: string;
  simulationVersion: string;
  seed: string;

  homeTeam: {
    id: string;
    name: string;
    attackStrength: number;
    defenseStrength: number;
    overallRating: number;
  };

  awayTeam: {
    id: string;
    name: string;
    attackStrength: number;
    defenseStrength: number;
    overallRating: number;
  };

  homePlayers: Array<{ id: string; name: string; position: string; rating: number }>;
  awayPlayers: Array<{ id: string; name: string; position: string; rating: number }>;

  leagueConfig?: {
    averageHomeGoals?: number;
    averageAwayGoals?: number;
    homeAdvantage?: number;
  };
}

export interface PlayerState {
  id: string;
  name: string;
  position: string;
  rating: number;
  fatigue: number;
  yellowCards: number;
  redCard: boolean;
  substituted: boolean;
  onPitch: boolean;
  minutesPlayed: number;
  goalsScored: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  foulsCommitted: number;
}

export interface DynamicMatchState {
  fixtureId: string;
  seasonId: string;
  simulationVersion: string;
  seed: string;

  virtualSecond: number; // 0..5400 (90 mins * 60 secs)
  virtualMinute: number;

  homeScore: number;
  awayScore: number;

  homePossessionRatio: number; // 0.0 - 1.0
  homeAttackingPressure: number; // 0.0 - 2.0
  awayAttackingPressure: number;

  homeRedCards: number;
  awayRedCards: number;

  homePlayers: Record<string, PlayerState>;
  awayPlayers: Record<string, PlayerState>;

  homeShots: number;
  awayShots: number;
  homeShotsOnTarget: number;
  awayShotsOnTarget: number;
  homeCorners: number;
  awayCorners: number;
  homeFouls: number;
  awayFouls: number;
  homeYellowCards: number;
  awayYellowCards: number;

  status: 'SCHEDULED' | 'LIVE' | 'HALFTIME' | 'SECOND_HALF' | 'FINISHED';
  isFullTime: boolean;

  latentStochasticState: number; // bounded -0.5 to +0.5 momentum/variance

  eventSequence: number;
}

export interface EventHazardRates {
  homeGoalHazard: number;
  awayGoalHazard: number;
  homeShotHazard: number;
  awayShotHazard: number;
  homeCornerHazard: number;
  awayCornerHazard: number;
  homeFoulHazard: number;
  awayFoulHazard: number;
  homeInjuryHazard: number;
  awayInjuryHazard: number;
}

export interface LiveMatchEvent {
  fixtureId: string;
  sequence: number;
  virtualMinute: number;
  virtualSecond: number;
  eventType: string; // MATCH_START, KICKOFF, SHOT, SHOT_ON_TARGET, GOAL, CORNER, FOUL, YELLOW_CARD, RED_CARD, INJURY, SUBSTITUTION, HALFTIME, SECOND_HALF_START, MATCH_END
  teamId?: string;
  playerId?: string;
  secondaryPlayerId?: string;
  metadata?: Record<string, any>;
}

export interface SimulationResult {
  fixtureId: string;
  homeScore: number;
  awayScore: number;
  finalState: DynamicMatchState;
  events: LiveMatchEvent[];
  resultHash: string;
  timelineHash: string;
}

/**
 * Calculates current event hazard rates (per second) based on the dynamic match state.
 */
export function calculateHazardRates(state: DynamicMatchState, input: MatchSimulationInput): EventHazardRates {
  const homeAdvantage = input.leagueConfig?.homeAdvantage ?? 1.10;
  const homeAttack = input.homeTeam.attackStrength * homeAdvantage;
  const awayDefense = input.awayTeam.defenseStrength;
  const awayAttack = input.awayTeam.attackStrength;
  const homeDefense = input.homeTeam.defenseStrength;

  // Red card penalties
  const homeRedMod = Math.max(0.4, 1.0 - state.homeRedCards * 0.25);
  const awayRedMod = Math.max(0.4, 1.0 - state.awayRedCards * 0.25);

  // Scoreline feedback modifier (trailing team pushes higher risk)
  let homeTrailingRisk = 1.0;
  let awayTrailingRisk = 1.0;
  if (state.virtualMinute > 60) {
    if (state.homeScore < state.awayScore) homeTrailingRisk = 1.35;
    if (state.awayScore < state.homeScore) awayTrailingRisk = 1.35;
  }

  // Base goal hazard per second (e.g. ~1.3 goals per 5400s)
  const baseGoalRatePerSec = 1.3 / 5400;

  const homeGoalHazard = baseGoalRatePerSec * (homeAttack / awayDefense) * homeRedMod * (1 / awayRedMod) * homeTrailingRisk * (1 + state.latentStochasticState * 0.2);
  const awayGoalHazard = baseGoalRatePerSec * (awayAttack / homeDefense) * awayRedMod * (1 / homeRedMod) * awayTrailingRisk * (1 - state.latentStochasticState * 0.2);

  // Shot hazards (~10-15 shots per team per match)
  const baseShotRate = 12 / 5400;
  const homeShotHazard = baseShotRate * homeAttack * homeRedMod * homeTrailingRisk;
  const awayShotHazard = baseShotRate * awayAttack * awayRedMod * awayTrailingRisk;

  // Corner hazards (~5-6 corners per team per match)
  const baseCornerRate = 5.5 / 5400;
  const homeCornerHazard = baseCornerRate * state.homeAttackingPressure;
  const awayCornerHazard = baseCornerRate * state.awayAttackingPressure;

  // Foul hazards (~11 fouls per team)
  const baseFoulRate = 11 / 5400;
  const homeFoulHazard = baseFoulRate * (1 / homeRedMod);
  const awayFoulHazard = baseFoulRate * (1 / awayRedMod);

  return {
    homeGoalHazard: Math.max(0, homeGoalHazard),
    awayGoalHazard: Math.max(0, awayGoalHazard),
    homeShotHazard: Math.max(0, homeShotHazard),
    awayShotHazard: Math.max(0, awayShotHazard),
    homeCornerHazard: Math.max(0, homeCornerHazard),
    awayCornerHazard: Math.max(0, awayCornerHazard),
    homeFoulHazard: Math.max(0, homeFoulHazard),
    awayFoulHazard: Math.max(0, awayFoulHazard),
    homeInjuryHazard: 0.00002,
    awayInjuryHazard: 0.00002,
  };
}
