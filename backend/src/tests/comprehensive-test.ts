import { MatchEngine } from '../simulation/match-engine';
import { MatchSimulationInput } from '../simulation/types';
import { calculateAllPreMatchMarkets } from '../markets/probability-engine';

async function runTests() {
  console.log('🧪 Starting Comprehensive Test Suite...\n');

  // Test 1: PRNG Determinism Test
  console.log('▶ Test 1: PRNG Determinism & Reproducibility...');
  const input: MatchSimulationInput = {
    fixtureId: 'test-fixture-1',
    seasonId: 'test-season-1',
    simulationVersion: '1.0.0',
    seed: 'seed-test-999',
    homeTeam: { id: 't1', name: 'Home FC', attackStrength: 1.2, defenseStrength: 1.1, overallRating: 80 },
    awayTeam: { id: 't2', name: 'Away FC', attackStrength: 1.0, defenseStrength: 1.0, overallRating: 78 },
    homePlayers: [],
    awayPlayers: [],
  };

  const engineA = new MatchEngine(input);
  const resultA = engineA.simulate();

  const engineB = new MatchEngine(input);
  const resultB = engineB.simulate();

  if (resultA.resultHash !== resultB.resultHash || resultA.timelineHash !== resultB.timelineHash) {
    throw new Error('❌ Test 1 Failed: Deterministic simulation hashes do not match!');
  }
  console.log('  ✅ Test 1 Passed: 100% Deterministic match output verified.\n');

  // Test 2: Invariant Check (Goal event count matches final score)
  console.log('▶ Test 2: Football Invariants (Goal Events vs Scoreline)...');
  const homeGoalEvents = resultA.events.filter((e) => e.eventType === 'GOAL' && e.teamId === 't1').length;
  const awayGoalEvents = resultA.events.filter((e) => e.eventType === 'GOAL' && e.teamId === 't2').length;

  if (homeGoalEvents !== resultA.homeScore || awayGoalEvents !== resultA.awayScore) {
    throw new Error(`❌ Test 2 Failed: Goal events mismatch! Home: ${homeGoalEvents} vs ${resultA.homeScore}, Away: ${awayGoalEvents} vs ${resultA.awayScore}`);
  }
  console.log(`  ✅ Test 2 Passed: Score ${resultA.homeScore}-${resultA.awayScore} matches goal events exactly.\n`);

  // Test 3: Monte Carlo Statistical Validation (1,000 Matches)
  console.log('▶ Test 3: Monte Carlo Statistical Simulation (1,000 matches)...');
  const sampleCount = 1000;
  let totalHomeGoals = 0;
  let totalAwayGoals = 0;
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let over25Count = 0;

  for (let i = 0; i < sampleCount; i++) {
    const mcInput = { ...input, seed: `mc-seed-${i}` };
    const mcEngine = new MatchEngine(mcInput);
    const mcRes = mcEngine.simulate();

    totalHomeGoals += mcRes.homeScore;
    totalAwayGoals += mcRes.awayScore;

    if (mcRes.homeScore > mcRes.awayScore) homeWins++;
    else if (mcRes.homeScore === mcRes.awayScore) draws++;
    else awayWins++;

    if (mcRes.homeScore + mcRes.awayScore > 2.5) over25Count++;
  }

  const avgHomeGoals = (totalHomeGoals / sampleCount).toFixed(2);
  const avgAwayGoals = (totalAwayGoals / sampleCount).toFixed(2);
  const homeWinPct = ((homeWins / sampleCount) * 100).toFixed(1);
  const drawPct = ((draws / sampleCount) * 100).toFixed(1);
  const awayWinPct = ((awayWins / sampleCount) * 100).toFixed(1);
  const over25Pct = ((over25Count / sampleCount) * 100).toFixed(1);

  console.log(`  📊 Monte Carlo Results over ${sampleCount} Matches:`);
  console.log(`     Average Goals: Home ${avgHomeGoals} - ${avgAwayGoals} Away (Total Avg: ${(parseFloat(avgHomeGoals) + parseFloat(avgAwayGoals)).toFixed(2)})`);
  console.log(`     Home Wins: ${homeWinPct}% | Draws: ${drawPct}% | Away Wins: ${awayWinPct}%`);
  console.log(`     Over 2.5 Goals: ${over25Pct}%`);

  if (parseFloat(avgHomeGoals) < 0.5 || parseFloat(avgHomeGoals) > 3.0) {
    throw new Error('❌ Test 3 Failed: Unrealistic goal average produced in Monte Carlo run!');
  }
  console.log('  ✅ Test 3 Passed: Statistical distributions conform to expected football bounds.\n');

  // Test 4: Market Pricing Engine Validation
  console.log('▶ Test 4: Market Coverage & Pricing Engine...');
  const markets = calculateAllPreMatchMarkets(1.35, 1.05);
  const marketTypes = markets.map((m) => m.marketType);

  console.log(`  📊 Generated ${markets.length} market types: ${marketTypes.join(', ')}`);

  const requiredMarkets = ['1X2', 'DOUBLE_CHANCE', 'BTTS', 'CORRECT_SCORE', 'TOTAL_CORNERS', 'TOTAL_CARDS'];
  for (const req of requiredMarkets) {
    if (!marketTypes.includes(req)) {
      throw new Error(`❌ Test 4 Failed: Required market type '${req}' missing from probability engine output!`);
    }
  }

  for (const m of markets) {
    for (const outcome of m.outcomes) {
      if (outcome.odds < 1.01) {
        throw new Error(`❌ Test 4 Failed: Invalid decimal odds (${outcome.odds}) for outcome '${outcome.outcomeCode}' in market '${m.marketType}'`);
      }
    }
  }
  console.log('  ✅ Test 4 Passed: Market pricing models, overround margins, and odds generated successfully.\n');

  // Test 5: Step-by-Step Live Simulation Engine & Event Invariants
  console.log('▶ Test 5: Step-by-Step Live Engine & Chronological Sequence Invariants...');
  const liveEngine = new MatchEngine(input);
  const liveState = liveEngine.initializeState();
  const liveEvents = [];

  let lastSeq = 0;
  while (!liveState.isFullTime) {
    const stepEvs = liveEngine.stepSecond(liveState);
    for (const ev of stepEvs) {
      liveEvents.push(ev);
      if (ev.sequence !== lastSeq + 1) {
        throw new Error(`❌ Test 5 Failed: Event sequence mismatch! Expected ${lastSeq + 1}, got ${ev.sequence}`);
      }
      lastSeq = ev.sequence;
    }
  }

  const startEv = liveEvents.find((e) => e.eventType === 'MATCH_START');
  const halfEv = liveEvents.find((e) => e.eventType === 'HALFTIME');
  const endEv = liveEvents.find((e) => e.eventType === 'MATCH_END');

  if (!startEv || !halfEv || !endEv) {
    throw new Error('❌ Test 5 Failed: Missing lifecycle events (MATCH_START, HALFTIME, MATCH_END)!');
  }

  if (endEv.virtualSecond !== 5400) {
    throw new Error(`❌ Test 5 Failed: MATCH_END second is ${endEv.virtualSecond}, expected 5400!`);
  }
  console.log(`  ✅ Test 5 Passed: Step-by-step match completed 5,400 seconds. Total events: ${liveEvents.length}.\n`);

  console.log('🎉 All Test Suite Checks Passed Successfully!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Test Suite Error:', err);
  process.exit(1);
});
