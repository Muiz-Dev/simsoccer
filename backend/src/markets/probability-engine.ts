import Decimal from 'decimal.js';

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

/**
 * Applies bookmaker overround margin (e.g., 5-8%) and converts raw probabilities to decimal odds.
 */
export function calculateOddsWithMargin(probabilities: Array<{ code: string; name: string; prob: number }>, margin: number = 0.06): MarketOddsItem[] {
  const totalRawProb = probabilities.reduce((sum, item) => sum + item.prob, 0);
  const normalizedProbs = probabilities.map((p) => ({
    ...p,
    normProb: totalRawProb > 0 ? p.prob / totalRawProb : 1 / probabilities.length,
  }));

  return normalizedProbs.map((p) => {
    const marginProb = p.normProb * (1 + margin);
    const rawDecimalOdds = marginProb > 0 ? 1 / marginProb : 100.0;
    const roundedOdds = new Decimal(rawDecimalOdds).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
    const finalOdds = Math.max(1.01, roundedOdds);

    return {
      outcomeCode: p.code,
      displayName: p.name,
      probability: parseFloat(p.normProb.toFixed(4)),
      odds: finalOdds,
    };
  });
}

function poisson(k: number, lambda: number): number {
  let factorial = 1;
  for (let i = 1; i <= k; i++) factorial *= i;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial;
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

  // 3. Total Goals Markets (0.5, 1.5, 2.5, 3.5, 4.5)
  const goalLines = [0.5, 1.5, 2.5, 3.5, 4.5];
  const goalMarkets: CalculatedMarket[] = goalLines.map((line) => {
    let underProb = 0;
    let overProb = 0;
    for (let h = 0; h <= 7; h++) {
      for (let a = 0; a <= 7; a++) {
        if (h + a < line) underProb += matrix[h][a];
        else overProb += matrix[h][a];
      }
    }
    return {
      marketType: `TOTAL_GOALS_${line}`,
      outcomes: calculateOddsWithMargin([
        { code: `OVER_${line}`, name: `Over ${line} Goals`, prob: overProb },
        { code: `UNDER_${line}`, name: `Under ${line} Goals`, prob: underProb },
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

  // 6. Total Corners (Over / Under 9.5) — Dynamic Poisson Model
  const expectedCornerLambda = Math.max(4.0, (lambdaHome + lambdaAway) * 4.2);
  let under95CornersProb = 0;
  for (let k = 0; k <= 9; k++) {
    under95CornersProb += poisson(k, expectedCornerLambda);
  }
  const over95CornersProb = Math.max(0.01, 1 - under95CornersProb);

  const marketCorners: CalculatedMarket = {
    marketType: 'TOTAL_CORNERS',
    outcomes: calculateOddsWithMargin([
      { code: 'OVER_9.5', name: 'Over 9.5 Corners', prob: over95CornersProb },
      { code: 'UNDER_9.5', name: 'Under 9.5 Corners', prob: under95CornersProb },
    ]),
  };

  // 7. Total Cards (Over / Under 4.5) — Dynamic Poisson Model
  const expectedCardLambda = Math.max(2.0, 4.5 / (0.8 + 0.2 * (lambdaHome + lambdaAway)));
  let under45CardsProb = 0;
  for (let k = 0; k <= 4; k++) {
    under45CardsProb += poisson(k, expectedCardLambda);
  }
  const over45CardsProb = Math.max(0.01, 1 - under45CardsProb);

  const marketCards: CalculatedMarket = {
    marketType: 'TOTAL_CARDS',
    outcomes: calculateOddsWithMargin([
      { code: 'OVER_4.5', name: 'Over 4.5 Cards', prob: over45CardsProb },
      { code: 'UNDER_4.5', name: 'Under 4.5 Cards', prob: under45CardsProb },
    ]),
  };

  return [market1X2, marketDC, ...goalMarkets, marketBTTS, marketCS, marketCorners, marketCards];
}
