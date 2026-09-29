import seedrandom from 'seedrandom';
import crypto from 'crypto';
import {
  MatchSimulationInput,
  DynamicMatchState,
  PlayerState,
  LiveMatchEvent,
  SimulationResult,
  calculateHazardRates,
} from './types';

export class MatchEngine {
  private rng: seedrandom.PRNG;

  constructor(private input: MatchSimulationInput) {
    // PRNG seeded deterministically using fixtureId + simulationVersion + seed
    const fullSeed = `${input.fixtureId}:${input.simulationVersion}:${input.seed}`;
    this.rng = seedrandom(fullSeed);
  }

  /**
   * Initializes dynamic match state from starting lineups and team metadata.
   */
  public initializeState(): DynamicMatchState {
    const homePlayersMap: Record<string, PlayerState> = {};
    for (const p of this.input.homePlayers) {
      homePlayersMap[p.id] = {
        id: p.id,
        name: p.name,
        position: p.position,
        rating: p.rating,
        fatigue: 0,
        yellowCards: 0,
        redCard: false,
        substituted: false,
        onPitch: true,
        minutesPlayed: 0,
        goalsScored: 0,
        assists: 0,
        shots: 0,
        shotsOnTarget: 0,
        foulsCommitted: 0,
      };
    }

    const awayPlayersMap: Record<string, PlayerState> = {};
    for (const p of this.input.awayPlayers) {
      awayPlayersMap[p.id] = {
        id: p.id,
        name: p.name,
        position: p.position,
        rating: p.rating,
        fatigue: 0,
        yellowCards: 0,
        redCard: false,
        substituted: false,
        onPitch: true,
        minutesPlayed: 0,
        goalsScored: 0,
        assists: 0,
        shots: 0,
        shotsOnTarget: 0,
        foulsCommitted: 0,
      };
    }

    return {
      fixtureId: this.input.fixtureId,
      seasonId: this.input.seasonId,
      simulationVersion: this.input.simulationVersion,
      seed: this.input.seed,
      virtualSecond: 0,
      virtualMinute: 0,
      homeScore: 0,
      awayScore: 0,
      homePossessionRatio: 0.52,
      homeAttackingPressure: 1.0,
      awayAttackingPressure: 1.0,
      homeRedCards: 0,
      awayRedCards: 0,
      homePlayers: homePlayersMap,
      awayPlayers: awayPlayersMap,
      homeShots: 0,
      awayShots: 0,
      homeShotsOnTarget: 0,
      awayShotsOnTarget: 0,
      homeCorners: 0,
      awayCorners: 0,
      homeFouls: 0,
      awayFouls: 0,
      homeYellowCards: 0,
      awayYellowCards: 0,
      status: 'SCHEDULED',
      isFullTime: false,
      latentStochasticState: 0.0,
      eventSequence: 0,
    };
  }

  /**
   * Runs complete deterministic match simulation from 0 to 5400 seconds (90 mins).
   */
  public simulate(): SimulationResult {
    const state = this.initializeState();
    const events: LiveMatchEvent[] = [];

    // MATCH_START event
    state.status = 'LIVE';
    state.eventSequence++;
    events.push({
      fixtureId: state.fixtureId,
      sequence: state.eventSequence,
      virtualMinute: 0,
      virtualSecond: 0,
      eventType: 'MATCH_START',
      metadata: { homeTeam: this.input.homeTeam.name, awayTeam: this.input.awayTeam.name },
    });

    // KICKOFF event
    state.eventSequence++;
    events.push({
      fixtureId: state.fixtureId,
      sequence: state.eventSequence,
      virtualMinute: 0,
      virtualSecond: 0,
      eventType: 'KICKOFF',
      teamId: this.input.homeTeam.id,
    });

    for (let second = 1; second <= 5400; second++) {
      state.virtualSecond = second;
      state.virtualMinute = Math.floor(second / 60);

      // Halftime check at second 2700 (45m)
      if (second === 2700) {
        state.status = 'HALFTIME';
        state.eventSequence++;
        events.push({
          fixtureId: state.fixtureId,
          sequence: state.eventSequence,
          virtualMinute: 45,
          virtualSecond: 2700,
          eventType: 'HALFTIME',
          metadata: { homeScore: state.homeScore, awayScore: state.awayScore },
        });

        // Halftime recovery/reset
        state.latentStochasticState *= 0.5;
        state.status = 'SECOND_HALF';

        state.eventSequence++;
        events.push({
          fixtureId: state.fixtureId,
          sequence: state.eventSequence,
          virtualMinute: 45,
          virtualSecond: 2700,
          eventType: 'SECOND_HALF_START',
        });
      }

      // Update fatigue every second for active players on pitch
      for (const p of Object.values(state.homePlayers)) {
        if (p.onPitch) {
          p.minutesPlayed = Math.floor(second / 60);
          p.fatigue = Math.min(100, p.minutesPlayed * 0.8);
        }
      }
      for (const p of Object.values(state.awayPlayers)) {
        if (p.onPitch) {
          p.minutesPlayed = Math.floor(second / 60);
          p.fatigue = Math.min(100, p.minutesPlayed * 0.8);
        }
      }

      // Small mean-reverting drift in latent stochastic state
      state.latentStochasticState = state.latentStochasticState * 0.995 + (this.rng() - 0.5) * 0.02;
      state.latentStochasticState = Math.max(-0.5, Math.min(0.5, state.latentStochasticState));

      // Calculate hazards
      const hazards = calculateHazardRates(state, this.input);

      // Check events stochastically per second
      this.evaluateSecondEvents(state, hazards, events);
    }

    // MATCH_END event
    state.status = 'FINISHED';
    state.isFullTime = true;
    state.eventSequence++;
    events.push({
      fixtureId: state.fixtureId,
      sequence: state.eventSequence,
      virtualMinute: 90,
      virtualSecond: 5400,
      eventType: 'MATCH_END',
      metadata: {
        finalHomeScore: state.homeScore,
        finalAwayScore: state.awayScore,
      },
    });

    const resultHash = crypto
      .createHash('sha256')
      .update(`${state.fixtureId}:${state.homeScore}:${state.awayScore}:${state.eventSequence}`)
      .digest('hex');

    const timelineHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(events))
      .digest('hex');

    return {
      fixtureId: state.fixtureId,
      homeScore: state.homeScore,
      awayScore: state.awayScore,
      finalState: state,
      events,
      resultHash,
      timelineHash,
    };
  }

  private evaluateSecondEvents(
    state: DynamicMatchState,
    hazards: ReturnType<typeof calculateHazardRates>,
    events: LiveMatchEvent[]
  ) {
    // 1. Home Goal
    if (this.rng() < hazards.homeGoalHazard) {
      state.homeScore++;
      state.homeShots++;
      state.homeShotsOnTarget++;
      state.latentStochasticState += 0.15; // momentum boost

      const scorer = this.selectActivePlayer(state.homePlayers);
      if (scorer) {
        scorer.goalsScored++;
        scorer.shots++;
        scorer.shotsOnTarget++;
      }

      state.eventSequence++;
      events.push({
        fixtureId: state.fixtureId,
        sequence: state.eventSequence,
        virtualMinute: state.virtualMinute,
        virtualSecond: state.virtualSecond,
        eventType: 'GOAL',
        teamId: this.input.homeTeam.id,
        playerId: scorer?.id,
        metadata: { homeScore: state.homeScore, awayScore: state.awayScore },
      });
      return;
    }

    // 2. Away Goal
    if (this.rng() < hazards.awayGoalHazard) {
      state.awayScore++;
      state.awayShots++;
      state.awayShotsOnTarget++;
      state.latentStochasticState -= 0.15;

      const scorer = this.selectActivePlayer(state.awayPlayers);
      if (scorer) {
        scorer.goalsScored++;
        scorer.shots++;
        scorer.shotsOnTarget++;
      }

      state.eventSequence++;
      events.push({
        fixtureId: state.fixtureId,
        sequence: state.eventSequence,
        virtualMinute: state.virtualMinute,
        virtualSecond: state.virtualSecond,
        eventType: 'GOAL',
        teamId: this.input.awayTeam.id,
        playerId: scorer?.id,
        metadata: { homeScore: state.homeScore, awayScore: state.awayScore },
      });
      return;
    }

    // 3. Home Shot
    if (this.rng() < hazards.homeShotHazard) {
      state.homeShots++;
      const isOnTarget = this.rng() < 0.38;
      if (isOnTarget) state.homeShotsOnTarget++;

      const shooter = this.selectActivePlayer(state.homePlayers);
      if (shooter) {
        shooter.shots++;
        if (isOnTarget) shooter.shotsOnTarget++;
      }

      state.eventSequence++;
      events.push({
        fixtureId: state.fixtureId,
        sequence: state.eventSequence,
        virtualMinute: state.virtualMinute,
        virtualSecond: state.virtualSecond,
        eventType: isOnTarget ? 'SHOT_ON_TARGET' : 'SHOT',
        teamId: this.input.homeTeam.id,
        playerId: shooter?.id,
      });
      return;
    }

    // 4. Away Shot
    if (this.rng() < hazards.awayShotHazard) {
      state.awayShots++;
      const isOnTarget = this.rng() < 0.38;
      if (isOnTarget) state.awayShotsOnTarget++;

      const shooter = this.selectActivePlayer(state.awayPlayers);
      if (shooter) {
        shooter.shots++;
        if (isOnTarget) shooter.shotsOnTarget++;
      }

      state.eventSequence++;
      events.push({
        fixtureId: state.fixtureId,
        sequence: state.eventSequence,
        virtualMinute: state.virtualMinute,
        virtualSecond: state.virtualSecond,
        eventType: isOnTarget ? 'SHOT_ON_TARGET' : 'SHOT',
        teamId: this.input.awayTeam.id,
        playerId: shooter?.id,
      });
      return;
    }

    // 5. Home Corner
    if (this.rng() < hazards.homeCornerHazard) {
      state.homeCorners++;
      state.eventSequence++;
      events.push({
        fixtureId: state.fixtureId,
        sequence: state.eventSequence,
        virtualMinute: state.virtualMinute,
        virtualSecond: state.virtualSecond,
        eventType: 'CORNER',
        teamId: this.input.homeTeam.id,
      });
      return;
    }

    // 6. Away Corner
    if (this.rng() < hazards.awayCornerHazard) {
      state.awayCorners++;
      state.eventSequence++;
      events.push({
        fixtureId: state.fixtureId,
        sequence: state.eventSequence,
        virtualMinute: state.virtualMinute,
        virtualSecond: state.virtualSecond,
        eventType: 'CORNER',
        teamId: this.input.awayTeam.id,
      });
      return;
    }

    // 7. Home Foul & Cards
    if (this.rng() < hazards.homeFoulHazard) {
      state.homeFouls++;
      const fowler = this.selectActivePlayer(state.homePlayers);
      if (fowler) fowler.foulsCommitted++;

      const isYellow = this.rng() < 0.16;
      const isRed = !isYellow && this.rng() < 0.015;

      if (isRed) {
        state.homeRedCards++;
        if (fowler) {
          fowler.redCard = true;
          fowler.onPitch = false;
        }
      } else if (isYellow) {
        state.homeYellowCards++;
        if (fowler) {
          fowler.yellowCards++;
          if (fowler.yellowCards >= 2) {
            fowler.redCard = true;
            fowler.onPitch = false;
            state.homeRedCards++;
          }
        }
      }

      state.eventSequence++;
      events.push({
        fixtureId: state.fixtureId,
        sequence: state.eventSequence,
        virtualMinute: state.virtualMinute,
        virtualSecond: state.virtualSecond,
        eventType: isRed || (fowler && fowler.yellowCards >= 2) ? 'RED_CARD' : isYellow ? 'YELLOW_CARD' : 'FOUL',
        teamId: this.input.homeTeam.id,
        playerId: fowler?.id,
      });
      return;
    }

    // 8. Away Foul & Cards
    if (this.rng() < hazards.awayFoulHazard) {
      state.awayFouls++;
      const fowler = this.selectActivePlayer(state.awayPlayers);
      if (fowler) fowler.foulsCommitted++;

      const isYellow = this.rng() < 0.16;
      const isRed = !isYellow && this.rng() < 0.015;

      if (isRed) {
        state.awayRedCards++;
        if (fowler) {
          fowler.redCard = true;
          fowler.onPitch = false;
        }
      } else if (isYellow) {
        state.awayYellowCards++;
        if (fowler) {
          fowler.yellowCards++;
          if (fowler.yellowCards >= 2) {
            fowler.redCard = true;
            fowler.onPitch = false;
            state.awayRedCards++;
          }
        }
      }

      state.eventSequence++;
      events.push({
        fixtureId: state.fixtureId,
        sequence: state.eventSequence,
        virtualMinute: state.virtualMinute,
        virtualSecond: state.virtualSecond,
        eventType: isRed || (fowler && fowler.yellowCards >= 2) ? 'RED_CARD' : isYellow ? 'YELLOW_CARD' : 'FOUL',
        teamId: this.input.awayTeam.id,
        playerId: fowler?.id,
      });
      return;
    }
  }

  private selectActivePlayer(playersMap: Record<string, PlayerState>): PlayerState | undefined {
    const active = Object.values(playersMap).filter((p) => p.onPitch);
    if (active.length === 0) return undefined;
    const index = Math.floor(this.rng() * active.length);
    return active[index];
  }
}
