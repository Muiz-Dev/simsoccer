import Decimal from 'decimal.js';

export type LegStatus = 'WON' | 'LOST' | 'VOID';
export type TicketStatus = 'WON' | 'LOST' | 'VOID';

export interface FixtureStatistics {
  homeCorners: number;
  awayCorners: number;
  homeYellowCards: number;
  awayYellowCards: number;
  homeRedCards: number;
  awayRedCards: number;
}

export function gradeOutcome(input: {
  marketType: string;
  outcomeCode: string;
  homeScore: number;
  awayScore: number;
  statistics: FixtureStatistics | null;
}): LegStatus {
  const { marketType, outcomeCode, homeScore, awayScore, statistics } = input;
  const totalGoals = homeScore + awayScore;
  const winsOnLine = (prefix: 'OVER' | 'UNDER', value: number, line: number) =>
    prefix === 'OVER' ? value > line : value < line;

  const totalGoalsMarket = /^TOTAL_GOALS(?:_(\d+(?:\.\d+)?))?$/.exec(marketType);
  if (totalGoalsMarket) {
    const match = /^(OVER|UNDER)_(\d+(?:\.\d+)?)$/.exec(outcomeCode);
    if (!match) throw new Error(`Unsupported total-goals outcome code: ${outcomeCode}`);
    const line = Number(match[2]);
    if (totalGoalsMarket[1] !== undefined && Number(totalGoalsMarket[1]) !== line) {
      throw new Error(`Total-goals market line does not match outcome code: ${marketType} / ${outcomeCode}`);
    }
    if (Number.isInteger(line) && totalGoals === line) return 'VOID';
    return winsOnLine(match[1] as 'OVER' | 'UNDER', totalGoals, line) ? 'WON' : 'LOST';
  }

  const totalCornersMarket = /^TOTAL_CORNERS(?:_(\d+(?:\.\d+)?))?$/.exec(marketType);
  if (totalCornersMarket) {
    if (!statistics) return 'VOID';
    const match = /^(OVER|UNDER)_(\d+(?:\.\d+)?)$/.exec(outcomeCode);
    if (!match) throw new Error(`Unsupported ${marketType} outcome code: ${outcomeCode}`);
    const line = Number(match[2]);
    if (totalCornersMarket[1] !== undefined && Number(totalCornersMarket[1]) !== line) {
      throw new Error(`Total-corners market line does not match outcome code: ${marketType} / ${outcomeCode}`);
    }
    const total = statistics.homeCorners + statistics.awayCorners;
    if (Number.isInteger(line) && total === line) return 'VOID';
    return winsOnLine(match[1] as 'OVER' | 'UNDER', total, line) ? 'WON' : 'LOST';
  }

  switch (marketType) {
    case '1X2':
      if (!['1', 'X', '2'].includes(outcomeCode)) {
        throw new Error(`Unsupported 1X2 outcome code: ${outcomeCode}`);
      }
      return outcomeCode === (homeScore > awayScore ? '1' : homeScore === awayScore ? 'X' : '2') ? 'WON' : 'LOST';
    case 'DOUBLE_CHANCE': {
      if (!['1X', '12', 'X2'].includes(outcomeCode)) {
        throw new Error(`Unsupported double-chance outcome code: ${outcomeCode}`);
      }
      const won = outcomeCode === '1X' ? homeScore >= awayScore
        : outcomeCode === '12' ? homeScore !== awayScore
          : homeScore <= awayScore;
      return won ? 'WON' : 'LOST';
    }
    case 'BTTS': {
      if (!['YES', 'NO'].includes(outcomeCode)) {
        throw new Error(`Unsupported BTTS outcome code: ${outcomeCode}`);
      }
      const bothScored = homeScore > 0 && awayScore > 0;
      return outcomeCode === (bothScored ? 'YES' : 'NO') ? 'WON' : 'LOST';
    }
    case 'CORRECT_SCORE':
      if (!/^\d+-\d+$/.test(outcomeCode)) {
        throw new Error(`Unsupported correct-score outcome code: ${outcomeCode}`);
      }
      return outcomeCode === `${homeScore}-${awayScore}` ? 'WON' : 'LOST';
    case 'TOTAL_CARDS': {
      if (!statistics) return 'VOID';
      const match = /^(OVER|UNDER)_(\d+(?:\.\d+)?)$/.exec(outcomeCode);
      if (!match) throw new Error(`Unsupported ${marketType} outcome code: ${outcomeCode}`);
      const line = Number(match[2]);
      const total = statistics.homeYellowCards + statistics.awayYellowCards
        + 2 * (statistics.homeRedCards + statistics.awayRedCards);
      if (Number.isInteger(line) && total === line) return 'VOID';
      return winsOnLine(match[1] as 'OVER' | 'UNDER', total, line) ? 'WON' : 'LOST';
    }
    default:
      throw new Error(`Unsupported market type: ${marketType}`);
  }
}

export function gradeTicket(legs: Array<{ status: LegStatus; odds: string | number }>, stake: string | number) {
  if (!legs.length) throw new Error('Cannot settle a ticket without selections.');
  if (legs.some((leg) => leg.status === 'LOST')) return { status: 'LOST' as const, payout: '0.00' };

  const surviving = legs.filter((leg) => leg.status === 'WON');
  const amount = new Decimal(stake);
  if (!surviving.length) return { status: 'VOID' as const, payout: amount.toFixed(2) };

  const odds = surviving.reduce((total, leg) => total.mul(leg.odds), new Decimal(1))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return {
    status: 'WON' as const,
    payout: amount.mul(odds).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
  };
}
