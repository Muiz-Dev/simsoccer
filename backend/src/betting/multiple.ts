import Decimal from 'decimal.js';

export interface MultipleSelectionPrice {
  fixtureId: string;
  odds: number;
}

export interface MultiplePrice {
  selectionCount: number;
  totalOdds: string;
  potentialReturn: string;
  potentialProfit: string;
}

export function calculateStraightMultiple(
  selections: MultipleSelectionPrice[],
  stake: number,
): MultiplePrice {
  if (selections.length === 0) {
    throw new Error('A multiple must contain at least one selection.');
  }

  if (!Number.isFinite(stake) || stake <= 0) {
    throw new Error('Stake must be a finite amount greater than zero.');
  }

  const fixtureIds = new Set<string>();
  const combinedOdds = selections.reduce((total, selection) => {
    if (!selection.fixtureId) {
      throw new Error('Every selection must belong to a fixture.');
    }
    if (fixtureIds.has(selection.fixtureId)) {
      throw new Error('A straight multiple can include only one selection per fixture.');
    }
    if (!Number.isFinite(selection.odds) || selection.odds < 1.01) {
      throw new Error('Every selection must have valid decimal odds of at least 1.01.');
    }

    fixtureIds.add(selection.fixtureId);
    return total.mul(selection.odds);
  }, new Decimal(1));

  const totalOdds = combinedOdds.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const potentialReturn = new Decimal(stake).mul(totalOdds).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const potentialProfit = potentialReturn.sub(stake).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return {
    selectionCount: selections.length,
    totalOdds: totalOdds.toFixed(2),
    potentialReturn: potentialReturn.toFixed(2),
    potentialProfit: potentialProfit.toFixed(2),
  };
}