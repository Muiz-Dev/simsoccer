import Decimal from 'decimal.js';
import { BASE_GOALS_PER_TEAM_PER_MATCH } from '../simulation/types';

export interface MarketOddsItem {
  outcomeCode: string;
  displayName: string;
  probability: number;
  odds: number;
}

export interface CalculatedMarket {
  marketType: string;
  outcomes: MarketOddsItem[];
}

export interface TeamGoalRating {
  attackStrength: number;
  defenseStrength: number;
  homeAdvantage?: number;
}

export const STANDARD_MARKET_MARGIN = 0.045;
export const GOAL_TOTAL_LINES = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5] as const;
export const CORNER_TOTAL_LINES = [6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5] as const;

export function calculateExpectedGoals(home: TeamGoalRating, away: TeamGoalRating) {
  return {
    lambdaHome: BASE_GOALS_PER_TEAM_PER_MATCH * home.attackStrength
      * (1 / Math.max(0.5, away.defenseStrength))
      * (home.homeAdvantage ?? 1.10),
    lambdaAway: BASE_GOALS_PER_TEAM_PER_MATCH * away.attackStrength
      * (1 / Math.max(0.5, home.defenseStrength)),
  };
}

/**
 * Applies the standard bookmaker overround and converts fair probabilities to decimal odds.
 */
export function calculateOddsWithMargin(
  probabilities: Array<{ code: string; name: string; prob: number }>,
  margin: number = STANDARD_MARKET_MARGIN,
): MarketOddsItem[] {
  if (!Number.isFinite(margin) || margin < 0 || margin >= 1) {
    throw new Error('Bookmaker margin must be a finite value from 0 up to, but not including, 1.');
  }

  return probabilities.map((p) => {
    if (!Number.isFinite(p.prob) || p.prob < 0 || p.prob > 1) {
      throw new Error(`Outcome probability for '${p.code}' must be between 0 and 1.`);
    }

    const marginProb = p.prob * (1 + margin);
    const rawDecimalOdds = marginProb > 0 ? 1 / marginProb : 100.0;
    const roundedOdds = new Decimal(rawDecimalOdds).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
    const finalOdds = Math.max(1.01, roundedOdds);

    return {
      outcomeCode: p.code,
      displayName: p.name,
      probability: parseFloat(p.prob.toFixed(4)),
      odds: finalOdds,
    };
  });
}

function poisson(k: number, lambda: number): number {
  let factorial = 1;
  for (let i = 1; i <= k; i++) factorial *= i;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial;
}

function poissonCdf(maxValue: number, lambda: number): number {
  if (maxValue < 0) return 0;

  let probability = Math.exp(-lambda);
  let cumulative = probability;
  for (let value = 1; value <= maxValue; value++) {
    probability *= lambda / value;
    cumulative += probability;
  }

  return Math.min(1, cumulative);
}

/**
 * Calculates Poisson goal probability matrix up to 7x7 scorelines given expected goals (lambdaHome, lambdaAway).
 */
export function buildScorelineMatrix(lambdaHome: number, lambdaAway: number): number[][] {
  const matrix: number[][] = Array.from({ length: 8 }, () => Array(8).fill(0));
  let totalProb = 0;

  for (let h = 0; h <= 7; h++) {
    for (let a = 0; a <= 7; a++) {
      const p = poisson(h, lambdaHome) * poisson(a, lambdaAway);
      matrix[h][a] = p;
      totalProb += p;
    }
  }

  if (totalProb > 0) {
    for (let h = 0; h <= 7; h++) {
      for (let a = 0; a <= 7; a++) {
        matrix[h][a] /= totalProb;
      }
    }
  }

  return matrix;
}

/**
 * Calculates pre-match probabilities and decimal odds for all supported betting markets.
 */
export function calculateAllPreMatchMarkets(
  lambdaHome: number,
  lambdaAway: number,
  playersList?: Array<{ id: string; name: string }>
): CalculatedMarket[] {
  const matrix = buildScorelineMatrix(lambdaHome, lambdaAway);

  // 1. 1X2 Market
  let homeWinProb = 0;
  let drawProb = 0;
  let awayWinProb = 0;

  for (let h = 0; h <= 7; h++) {
    for (let a = 0; a <= 7; a++) {
      const p = matrix[h][a];
      if (h > a) homeWinProb += p;
      else if (h === a) drawProb += p;
      else awayWinProb += p;
    }
  }

  const market1X2: CalculatedMarket = {
    marketType: '1X2',
    outcomes: calculateOddsWithMargin([
      { code: '1', name: 'Home Win', prob: homeWinProb },
      { code: 'X', name: 'Draw', prob: drawProb },
      { code: '2', name: 'Away Win', prob: awayWinProb },
    ]),
  };

  // 2. Double Chance Market
  const marketDC: CalculatedMarket = {
    marketType: 'DOUBLE_CHANCE',
    outcomes: calculateOddsWithMargin([
      { code: '1X', name: 'Home or Draw', prob: homeWinProb + drawProb },
      { code: '12', name: 'Home or Away', prob: homeWinProb + awayWinProb },
      { code: 'X2', name: 'Draw or Away', prob: drawProb + awayWinProb },
    ]),
  };

  // Whole-number lines exclude pushes when pricing the two quoted outcomes.
  const goalMarkets: CalculatedMarket[] = GOAL_TOTAL_LINES.map((line) => {
    let underProb = 0;
    let overProb = 0;
    for (let h = 0; h <= 7; h++) {
      for (let a = 0; a <= 7; a++) {
        if (h + a < line) underProb += matrix[h][a];
        else if (h + a > line) overProb += matrix[h][a];
      }
    }
    const nonPushProbability = overProb + underProb;
    if (Number.isInteger(line)) {
      overProb /= nonPushProbability;
      underProb /= nonPushProbability;
    }
    return {
      marketType: `TOTAL_GOALS_${line}`,
      outcomes: calculateOddsWithMargin([
        { code: `OVER_${line}`, name: `Over ${line} ${line === 1 ? 'Goal' : 'Goals'}`, prob: overProb },
        { code: `UNDER_${line}`, name: `Under ${line} ${line === 1 ? 'Goal' : 'Goals'}`, prob: underProb },
      ]),
    };
  });

  // 4. Both Teams To Score (BTTS)
  let bttsYes = 0;
  let bttsNo = 0;
  for (let h = 0; h <= 7; h++) {
    for (let a = 0; a <= 7; a++) {
      if (h > 0 && a > 0) bttsYes += matrix[h][a];
      else bttsNo += matrix[h][a];
    }
  }

  const marketBTTS: CalculatedMarket = {
    marketType: 'BTTS',
    outcomes: calculateOddsWithMargin([
      { code: 'YES', name: 'Both Teams To Score - Yes', prob: bttsYes },
      { code: 'NO', name: 'Both Teams To Score - No', prob: bttsNo },
    ]),
  };

  // 5. Correct Score Market
  const csScores = [
    { h: 0, a: 0 }, { h: 1, a: 0 }, { h: 0, a: 1 }, { h: 1, a: 1 }, { h: 2, a: 0 },
    { h: 0, a: 2 }, { h: 2, a: 1 }, { h: 1, a: 2 }, { h: 2, a: 2 }, { h: 3, a: 0 },
    { h: 0, a: 3 }, { h: 3, a: 1 }, { h: 1, a: 3 }, { h: 3, a: 2 }, { h: 2, a: 3 },
  ];
  const csItems = csScores.map((s) => ({
    code: `${s.h}-${s.a}`,
    name: `${s.h}-${s.a}`,
    prob: matrix[s.h][s.a],
  }));

  const marketCS: CalculatedMarket = {
    marketType: 'CORRECT_SCORE',
    outcomes: calculateOddsWithMargin(csItems, 0.08),
  };

  // 6. Total corners use a separate count model calibrated to the simulator baseline.
  const expectedCornerLambda = Math.max(4.0, (lambdaHome + lambdaAway) * 4.0);
  const marketCorners: CalculatedMarket[] = CORNER_TOTAL_LINES.map((line) => {
    const underProb = poissonCdf(Math.floor(line), expectedCornerLambda);
    const overProb = Math.max(0, 1 - underProb);
    return {
      marketType: `TOTAL_CORNERS_${line}`,
      outcomes: calculateOddsWithMargin([
        { code: `OVER_${line}`, name: `Over ${line} Corners`, prob: overProb },
        { code: `UNDER_${line}`, name: `Under ${line} Corners`, prob: underProb },
      ]),
    };
  });

  // 7. Total Cards (Over / Under 4.5) — Dynamic Poisson Model
  const expectedCardLambda = Math.max(2.0, 4.5 / (0.8 + 0.2 * (lambdaHome + lambdaAway)));
  const under45CardsProb = poissonCdf(4, expectedCardLambda);
  const over45CardsProb = Math.max(0, 1 - under45CardsProb);

  const marketCards: CalculatedMarket = {
    marketType: 'TOTAL_CARDS',
    outcomes: calculateOddsWithMargin([
      { code: 'OVER_4.5', name: 'Over 4.5 Cards', prob: over45CardsProb },
      { code: 'UNDER_4.5', name: 'Under 4.5 Cards', prob: under45CardsProb },
    ]),
  };

  return [market1X2, marketDC, ...goalMarkets, marketBTTS, marketCS, ...marketCorners, marketCards];
}
