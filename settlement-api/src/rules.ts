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
    case 'TOTAL_GOALS':
    case 'TOTAL_GOALS_0.5':
    case 'TOTAL_GOALS_1.5':
    case 'TOTAL_GOALS_2.5':
    case 'TOTAL_GOALS_3.5':
    case 'TOTAL_GOALS_4.5':
    case 'TOTAL_GOALS_5.5': {
      const match = /^(OVER|UNDER)_(\d+(?:\.\d+)?)$/.exec(outcomeCode);
      if (!match) throw new Error(`Unsupported total-goals outcome code: ${outcomeCode}`);
      return winsOnLine(match[1] as 'OVER' | 'UNDER', totalGoals, Number(match[2])) ? 'WON' : 'LOST';
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
    case 'TOTAL_CORNERS':
    case 'TOTAL_CARDS': {
      if (!statistics) return 'VOID';
      const match = /^(OVER|UNDER)_(\d+(?:\.\d+)?)$/.exec(outcomeCode);
      if (!match) throw new Error(`Unsupported ${marketType} outcome code: ${outcomeCode}`);
      const total = marketType === 'TOTAL_CORNERS'
        ? statistics.homeCorners + statistics.awayCorners
        : statistics.homeYellowCards + statistics.awayYellowCards
          + 2 * (statistics.homeRedCards + statistics.awayRedCards);
      return winsOnLine(match[1] as 'OVER' | 'UNDER', total, Number(match[2])) ? 'WON' : 'LOST';
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
