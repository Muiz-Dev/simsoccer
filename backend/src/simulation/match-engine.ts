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

  private nextRandom(state: DynamicMatchState): number {
    state.rngCallCount = (state.rngCallCount || 0) + 1;
    return this.rng();
  }

  /**
   * Fast-forwards the PRNG and restores the RNG stream to match exact random call count from state snapshot.
   */
  public restoreRngState(state: DynamicMatchState): void {
    const fullSeed = `${this.input.fixtureId}:${this.input.simulationVersion}:${this.input.seed}`;
    this.rng = seedrandom(fullSeed);
    const count = state.rngCallCount || 0;
    for (let i = 0; i < count; i++) {
      this.rng();
    }
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
   * Advances the match state by one virtual second, returning any events generated during this second.
   */
  public stepSecond(state: DynamicMatchState): LiveMatchEvent[] {
    const events: LiveMatchEvent[] = [];

    // 0. Initial Match Start & Kickoff
    if (state.virtualSecond === 0 && state.status === 'SCHEDULED') {
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

      state.eventSequence++;
      events.push({
        fixtureId: state.fixtureId,
        sequence: state.eventSequence,
        virtualMinute: 0,
        virtualSecond: 0,
        eventType: 'KICKOFF',
        teamId: this.input.homeTeam.id,
      });

      state.virtualSecond = 1;
      return events;
    }

    if (state.isFullTime || state.virtualSecond > 5400) {
      return events;
    }

    const second = state.virtualSecond;
    state.virtualMinute = Math.floor(second / 60);

    // 1. Halftime check at second 2700 (45m)
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

    // 2. Update player fatigue
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

    // 3. Latent state mean-reverting drift
    state.latentStochasticState = state.latentStochasticState * 0.995 + (this.nextRandom(state) - 0.5) * 0.02;
    state.latentStochasticState = Math.max(-0.5, Math.min(0.5, state.latentStochasticState));

    // 4. Calculate hazards and evaluate events
    const hazards = calculateHazardRates(state, this.input);
    this.evaluateSecondEvents(state, hazards, events);

    // 5. Check if Full Time reached
    if (second === 5400) {
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
    } else {
      state.virtualSecond++;
    }

    return events;
  }

  /**
   * Runs complete deterministic match simulation by stepping through all 5400 seconds.
   */
  public simulate(): SimulationResult {
    const state = this.initializeState();
    const allEvents: LiveMatchEvent[] = [];

    while (!state.isFullTime) {
      const stepEvents = this.stepSecond(state);
      allEvents.push(...stepEvents);
    }

    const resultHash = crypto
      .createHash('sha256')
      .update(`${state.fixtureId}:${state.homeScore}:${state.awayScore}:${state.eventSequence}`)
      .digest('hex');

    const timelineHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(allEvents))
      .digest('hex');

    return {
      fixtureId: state.fixtureId,
      homeScore: state.homeScore,
      awayScore: state.awayScore,
      finalState: state,
      events: allEvents,
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
    if (this.nextRandom(state) < hazards.homeGoalHazard) {
      state.homeScore++;
      state.homeShots++;
      state.homeShotsOnTarget++;
      state.latentStochasticState += 0.15;

      const scorer = this.selectActivePlayer(state.homePlayers, state);
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
    if (this.nextRandom(state) < hazards.awayGoalHazard) {
      state.awayScore++;
      state.awayShots++;
      state.awayShotsOnTarget++;
      state.latentStochasticState -= 0.15;

      const scorer = this.selectActivePlayer(state.awayPlayers, state);
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
    if (this.nextRandom(state) < hazards.homeShotHazard) {
      state.homeShots++;
      const isOnTarget = this.nextRandom(state) < 0.38;
      if (isOnTarget) state.homeShotsOnTarget++;

      const shooter = this.selectActivePlayer(state.homePlayers, state);
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
    if (this.nextRandom(state) < hazards.awayShotHazard) {
      state.awayShots++;
      const isOnTarget = this.nextRandom(state) < 0.38;
      if (isOnTarget) state.awayShotsOnTarget++;

      const shooter = this.selectActivePlayer(state.awayPlayers, state);
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
    if (this.nextRandom(state) < hazards.homeCornerHazard) {
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
    if (this.nextRandom(state) < hazards.awayCornerHazard) {
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
    if (this.nextRandom(state) < hazards.homeFoulHazard) {
      state.homeFouls++;
      const fowler = this.selectActivePlayer(state.homePlayers, state);
      if (fowler) fowler.foulsCommitted++;

      const isYellow = this.nextRandom(state) < 0.16;
      const isRed = !isYellow && this.nextRandom(state) < 0.015;

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
    if (this.nextRandom(state) < hazards.awayFoulHazard) {
      state.awayFouls++;
      const fowler = this.selectActivePlayer(state.awayPlayers, state);
      if (fowler) fowler.foulsCommitted++;

      const isYellow = this.nextRandom(state) < 0.16;
      const isRed = !isYellow && this.nextRandom(state) < 0.015;

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

  private selectActivePlayer(playersMap: Record<string, PlayerState>, state: DynamicMatchState): PlayerState | undefined {
    const active = Object.values(playersMap).filter((p) => p.onPitch);
    if (active.length === 0) return undefined;
    const index = Math.floor(this.nextRandom(state) * active.length);
    return active[index];
  }
}
