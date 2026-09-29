export interface FixturePairing {
  round: number;
  homeTeamIndex: number;
  awayTeamIndex: number;
}

/**
 * Generates a standard double round-robin fixture list for N teams (where N is even).
 * For 20 teams, produces 38 rounds with 10 matches per round = 380 total fixtures.
 */
export function generateDoubleRoundRobin(teamCount: number): FixturePairing[] {
  if (teamCount % 2 !== 0) {
    throw new Error('Team count must be an even number for standard round-robin scheduling');
  }

  const pairings: FixturePairing[] = [];
  const numRoundsLeg1 = teamCount - 1; // 19 rounds for 20 teams
  const matchesPerRound = teamCount / 2; // 10 matches per round

  const indices = Array.from({ length: teamCount }, (_, i) => i);

  // Leg 1: First 19 rounds
  for (let round = 1; round <= numRoundsLeg1; round++) {
    for (let match = 0; match < matchesPerRound; match++) {
      let home = indices[match];
      let away = indices[teamCount - 1 - match];

      // Alternate home/away for index 0 to balance home games
      if (match === 0 && round % 2 === 0) {
        const temp = home;
        home = away;
        away = temp;
      }

      pairings.push({
        round,
        homeTeamIndex: home,
        awayTeamIndex: away,
      });
    }

    // Rotate indices clockwise keeping index 0 fixed
    const last = indices.pop()!;
    indices.splice(1, 0, last);
  }

  // Leg 2: Rounds 20..38 (Invert home/away)
  for (let round = 1; round <= numRoundsLeg1; round++) {
    const leg2Round = round + numRoundsLeg1;
    const leg1Matches = pairings.filter((p) => p.round === round);

    for (const match of leg1Matches) {
      pairings.push({
        round: leg2Round,
        homeTeamIndex: match.awayTeamIndex,
        awayTeamIndex: match.homeTeamIndex,
      });
    }
  }

  return pairings;
}
