import { getTargetVirtualSecond, getVirtualStepsToAdvance, MatchEngine } from '../simulation/match-engine';
import { calculateHazardRates, MatchSimulationInput } from '../simulation/types';
import {
  calculateAllPreMatchMarkets,
  calculateExpectedGoals,
  calculateOddsWithMargin,
  STANDARD_MARKET_MARGIN,
} from '../markets/probability-engine';
import { calculateStraightMultiple } from '../betting/multiple';
import { isRoundMarketOpen, selectDefaultBettingRound, selectVisibleBettingRound } from '../betting/round-market-policy';
import { checkDependenciesHealth, deriveWorldRound, deriveWorldRoundAfterBreak, getRoundKickoffStartAt, getWorldStatusInfo } from '../football/coordinator';
import { parseVirtualSeasonName, resolveCompetitionDataset } from '../football/seed';
import { env } from '../config/env';

async function runTests() {
  console.log('🧪 Starting Comprehensive Autonomous World Test Suite...\n');

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

  const calibrationExpectedGoals = calculateExpectedGoals(input.homeTeam, input.awayTeam);
  const calibratedMarkets = calculateAllPreMatchMarkets(calibrationExpectedGoals.lambdaHome, calibrationExpectedGoals.lambdaAway);
  const calibratedOneXTwo = calibratedMarkets.find((market) => market.marketType === '1X2');
  const calibratedOverUnder = calibratedMarkets.find((market) => market.marketType === 'TOTAL_GOALS_2.5');
  const modeledProbabilities = [
    calibratedOneXTwo?.outcomes.find((outcome) => outcome.outcomeCode === '1')?.probability ?? 0,
    calibratedOneXTwo?.outcomes.find((outcome) => outcome.outcomeCode === 'X')?.probability ?? 0,
    calibratedOneXTwo?.outcomes.find((outcome) => outcome.outcomeCode === '2')?.probability ?? 0,
    calibratedOverUnder?.outcomes.find((outcome) => outcome.outcomeCode === 'OVER_2.5')?.probability ?? 0,
  ];
  const simulatedProbabilities = [
    homeWins / sampleCount,
    draws / sampleCount,
    awayWins / sampleCount,
    over25Count / sampleCount,
  ];
  if (modeledProbabilities.some((probability, index) => Math.abs(probability - simulatedProbabilities[index]) > 0.05)) {
    throw new Error(`❌ Test 3 Failed: Poisson pricing probabilities diverge from simulator frequencies. Model ${modeledProbabilities.map((value) => value.toFixed(3)).join('/')} vs simulated ${simulatedProbabilities.map((value) => value.toFixed(3)).join('/')}.`);
  }

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

  const oneXTwo = markets.find((market) => market.marketType === '1X2');
  const doubleChance = markets.find((market) => market.marketType === 'DOUBLE_CHANCE');
  const correctScore = markets.find((market) => market.marketType === 'CORRECT_SCORE');
  const totalGoals25 = markets.find((market) => market.marketType === 'TOTAL_GOALS_2.5');
  const outcomeProbability = (market: typeof oneXTwo, code: string) =>
    market?.outcomes.find((outcome) => outcome.outcomeCode === code)?.probability ?? 0;

  if (Math.abs(
    outcomeProbability(doubleChance, '1X') - outcomeProbability(oneXTwo, '1') - outcomeProbability(oneXTwo, 'X')
  ) > 0.0002) {
    throw new Error('❌ Test 4 Failed: Double Chance probabilities must preserve overlapping event probabilities.');
  }

  for (const outcome of doubleChance?.outcomes ?? []) {
    const expectedImpliedProbability = outcome.probability * (1 + STANDARD_MARKET_MARGIN);
    if (Math.abs((1 / outcome.odds) - expectedImpliedProbability) > 0.003) {
      throw new Error(`❌ Test 4 Failed: Double Chance price for '${outcome.outcomeCode}' does not match its event probability and margin.`);
    }
  }

  const standardMarginMarkets = [oneXTwo, totalGoals25, markets.find((market) => market.marketType === 'BTTS')];
  for (const market of standardMarginMarkets) {
    const impliedOverround = (market?.outcomes ?? []).reduce((sum, outcome) => sum + 1 / outcome.odds, 0) - 1;
    if (!market || Math.abs(impliedOverround - STANDARD_MARKET_MARGIN) > 0.008) {
      throw new Error(`❌ Test 4 Failed: market '${market?.marketType ?? 'unknown'}' should price near a ${(STANDARD_MARKET_MARGIN * 100).toFixed(1)}% overround, got ${(impliedOverround * 100).toFixed(2)}%.`);
    }
  }

  const balancedMarketOdds = calculateAllPreMatchMarkets(1.3, 1.3);
  const favoriteMarketOdds = calculateAllPreMatchMarkets(2.0, 0.9);
  const higherScoringMarketOdds = calculateAllPreMatchMarkets(1.8, 1.6);
  const marketOdds = (calculated: typeof markets, marketType: string, outcomeCode: string) =>
    calculated.find((market) => market.marketType === marketType)?.outcomes
      .find((outcome) => outcome.outcomeCode === outcomeCode)?.odds ?? Number.NaN;
  if (marketOdds(favoriteMarketOdds, '1X2', '1') >= marketOdds(balancedMarketOdds, '1X2', '1')
    || marketOdds(higherScoringMarketOdds, 'TOTAL_GOALS_2.5', 'OVER_2.5') >= marketOdds(balancedMarketOdds, 'TOTAL_GOALS_2.5', 'OVER_2.5')) {
    throw new Error('❌ Test 4 Failed: odds must shorten as an outcome becomes more probable.');
  }

  let invalidProbabilityRejected = false;
  try {
    calculateOddsWithMargin([{ code: 'INVALID', name: 'Invalid', prob: 1.1 }]);
  } catch {
    invalidProbabilityRejected = true;
  }
  if (!invalidProbabilityRejected) {
    throw new Error('❌ Test 4 Failed: pricing must reject probabilities outside the [0, 1] range.');
  }

  const listedCorrectScoreProbability = correctScore?.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0) ?? 0;
  if (listedCorrectScoreProbability >= 0.99) {
    throw new Error('❌ Test 4 Failed: Listed Correct Score probabilities must not be renormalized to cover unlisted scores.');
  }

  const multiplePrice = calculateStraightMultiple([
    { fixtureId: 'fixture-a', odds: 1.79 },
    { fixtureId: 'fixture-b', odds: 3.70 },
  ], 100);
  if (multiplePrice.totalOdds !== '6.62' || multiplePrice.potentialReturn !== '662.00' || multiplePrice.potentialProfit !== '562.00') {
    throw new Error('❌ Test 4 Failed: Straight multiple price or return calculation is incorrect.');
  }

  const firstKickoff = new Date('2026-10-01T08:05:00.000Z');
  const laterKickoff = new Date('2026-10-01T08:06:00.000Z');
  const cutoff = new Date('2026-10-01T08:04:00.000Z');
  if (!isRoundMarketOpen([firstKickoff, laterKickoff], new Date(cutoff.getTime() - 1))
    || isRoundMarketOpen([firstKickoff, laterKickoff], cutoff)) {
    throw new Error('❌ Test 4 Failed: Round market cutoff must close exactly 60 seconds before the earliest kickoff.');
  }
  if (!isRoundMarketOpen(
    [new Date('2026-10-01T12:32:59.253Z')],
    '2026-10-01 11:12:26.941445+00',
  )) {
    throw new Error('❌ Test 4 Failed: string-valued database timestamps must keep pre-cutoff markets open.');
  }
  const nextBettingRound = selectDefaultBettingRound(
    5,
    [firstKickoff],
    [new Date('2026-10-02T08:05:00.000Z')],
    new Date('2026-10-01T08:04:00.000Z'),
  );
  if (nextBettingRound !== 6) {
    throw new Error(`❌ Test 4 Failed: expected the next open betting round 6, got ${nextBettingRound}.`);
  }
  const displayedBettingRound = selectVisibleBettingRound(
    5,
    38,
    false,
    '2026-10-01T08:50:45.143Z',
    '2026-10-01T10:15:08.047Z',
  );
  if (displayedBettingRound !== 6) {
    throw new Error(`❌ Test 4 Failed: a closed Round 5 should display Round 6, got Round ${displayedBettingRound}.`);
  }
  const expectedGoals = calculateExpectedGoals(
    { attackStrength: 1.2, defenseStrength: 1.5, homeAdvantage: 1.1 },
    { attackStrength: 1, defenseStrength: 4 },
  );
  if (Math.abs(expectedGoals.lambdaAway - (1.3 / 1.5)) > 0.0001) {
    throw new Error('❌ Test 4 Failed: away expected goals must use the simulator baseline and home defence rating.');
  }
  const pricingInput: MatchSimulationInput = {
    ...input,
    homeTeam: { ...input.homeTeam, defenseStrength: 1.5 },
    awayTeam: { ...input.awayTeam, defenseStrength: 4 },
  };
  const pricingState = new MatchEngine(pricingInput).initializeState();
  const initialHazards = calculateHazardRates(pricingState, pricingInput);
  if (Math.abs(expectedGoals.lambdaHome - initialHazards.homeGoalHazard * 5400) > 0.0001
    || Math.abs(expectedGoals.lambdaAway - initialHazards.awayGoalHazard * 5400) > 0.0001) {
    throw new Error('❌ Test 4 Failed: pricing expected goals diverge from initial simulator goal hazards.');
  }

  const impliedOneXTwoOverround = (oneXTwo?.outcomes ?? []).reduce((sum, outcome) => sum + 1 / outcome.odds, 0) - 1;
  if (Math.abs(impliedOneXTwoOverround - STANDARD_MARKET_MARGIN) > 0.008) {
    throw new Error(`❌ Test 4 Failed: expected approximately ${(STANDARD_MARKET_MARGIN * 100).toFixed(1)}% 1X2 overround, got ${(impliedOneXTwoOverround * 100).toFixed(2)}%.`);
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

  // Test 6: Checkpoint Restore & RNG Stream Synchronization
  console.log('▶ Test 6: Checkpoint Restore & State Resumption...');
  const engineOriginal = new MatchEngine(input);
  const stateOriginal = engineOriginal.initializeState();

  // Step 2,700 seconds (halftime)
  while (stateOriginal.virtualSecond < 2700) {
    engineOriginal.stepSecond(stateOriginal);
  }

  const savedVirtualSecond = stateOriginal.virtualSecond;
  const stateJson = JSON.parse(JSON.stringify(stateOriginal));

  // Resume with new engine instance restored from halftime snapshot
  const engineResumed = new MatchEngine(input);
  engineResumed.restoreRngState(stateJson);

  while (!stateJson.isFullTime) {
    engineResumed.stepSecond(stateJson);
  }

  // Compare result with full continuous run
  const engineContinuous = new MatchEngine(input);
  const resContinuous = engineContinuous.simulate();

  if (stateJson.homeScore !== resContinuous.homeScore || stateJson.awayScore !== resContinuous.awayScore) {
    throw new Error(`❌ Test 6 Failed: Restored match score ${stateJson.homeScore}-${stateJson.awayScore} does not match continuous run ${resContinuous.homeScore}-${resContinuous.awayScore}`);
  }
  console.log(`  ✅ Test 6 Passed: Checkpoint restored at second ${savedVirtualSecond} and produced identical final score (${stateJson.homeScore}-${stateJson.awayScore}).\n`);

  // Test 7: Runtime Health, Dependency Verification & Migration Check
  console.log('▶ Test 7: Runtime Health, Migration Verification & Readiness Reporting...');
  const health = await checkDependenciesHealth();
  console.log(`  📊 Dependencies health check: PostgreSQL=${health.postgres}, Redis=${health.redis}, MigrationOk=${health.migrationOk}`);

  if (typeof health.migrationOk !== 'boolean') {
    throw new Error('❌ Test 7 Failed: Migration health field missing or invalid.');
  }

  const statusInfo = await getWorldStatusInfo();
  console.log(`  📊 World Status: ${statusInfo.status}, Season: ${statusInfo.activeSeasonName || 'None'}, Round: ${statusInfo.currentRound}/${statusInfo.totalRounds}`);

  if (typeof statusInfo.status !== 'string' || typeof statusInfo.isCoordinatorLeader !== 'boolean') {
    throw new Error('❌ Test 7 Failed: World status info shape is invalid.');
  }
  console.log('  ✅ Test 7 Passed: Runtime status and migration health endpoints validated.\n');

  // Test 8: DB-backed Recovery & Runtime Status Invariants
  console.log('▶ Test 8: DB Checkpoint Restore & Runtime Status Invariants...');
  if (health.postgres && health.migrationOk) {
    console.log('  📊 PostgreSQL is active. Testing DB-backed runtime reconciliation...');
    if (statusInfo.activeSeasonId && statusInfo.status !== 'RUNNING') {
      throw new Error(`❌ Test 8 Failed: Active season present (${statusInfo.activeSeasonId}) but status is '${statusInfo.status}' instead of 'RUNNING'`);
    }
    console.log('  ✅ Test 8 Passed: DB-backed state reconciliation validated.');
  } else {
    console.log('  ℹ️ Test 8 Skipped: Database or migration unavailable in current environment (unit test mode).');
  }

  // Test 9: Virtual season naming should work without a real-world calendar year
  console.log('▶ Test 9: Virtual Season Naming Compatibility...');
  const seasonOneDataset = resolveCompetitionDataset('Season 1');
  const seasonTwoDataset = resolveCompetitionDataset('Season 2');
  const legacyYearDataset = resolveCompetitionDataset('2025-2026');

  if (!seasonOneDataset || !seasonTwoDataset || !legacyYearDataset) {
    throw new Error('❌ Test 9 Failed: virtual or legacy season resolution returned an invalid dataset.');
  }

  if (!seasonOneDataset['premier-league'] || !seasonTwoDataset['premier-league']) {
    throw new Error('❌ Test 9 Failed: virtual season datasets do not include the expected competitions.');
  }

  if (parseVirtualSeasonName(['Season', '1']) !== 'Season 1') {
    throw new Error('❌ Test 9 Failed: CLI parsing split virtual season arguments incorrectly.');
  }

  if (seasonOneDataset['premier-league'].teams.length !== legacyYearDataset['premier-league'].teams.length) {
    throw new Error('❌ Test 9 Failed: Season dataset compatibility changed the competition roster size.');
  }
  console.log('  ✅ Test 9 Passed: Virtual Season 1/2 naming resolves to the canonical competition dataset and remains compatible with legacy season keys.');

  // Test 10: Reconcile stale persisted round against unfinished fixtures
  console.log('▶ Test 10: Shared Round Recovery from Fixture State...');
  const recoveredRound = deriveWorldRound([
    { round: 1, status: 'FINISHED' },
    { round: 1, status: 'LIVE' },
    { round: 2, status: 'SCHEDULED' },
  ], 38);
  const nextRound = deriveWorldRound([
    { round: 1, status: 'FINISHED' },
    { round: 2, status: 'SCHEDULED' },
  ], 38);

  if (recoveredRound !== 1 || nextRound !== 2) {
    throw new Error(`❌ Test 10 Failed: fixture state selected rounds ${recoveredRound} and ${nextRound}, expected 1 and 2.`);
  }
  console.log('  ✅ Test 10 Passed: unfinished fixtures take precedence over a stale runtime round.');

  // Test 11: Do not start the next shared round before the configured break.
  console.log('▶ Test 11: Shared Round Break Timing...');
  const previousRoundFinishedAt = new Date('2026-10-01T00:00:00.000Z');
  const roundTransitionFixtures = [
    { round: 1, status: 'FINISHED', finishedAt: previousRoundFinishedAt },
    { round: 2, status: 'SCHEDULED', finishedAt: null },
  ];
  const beforeBreak = deriveWorldRoundAfterBreak(
    roundTransitionFixtures, 2, new Date('2026-10-01T00:09:59.000Z'), 600
  );
  const afterBreak = deriveWorldRoundAfterBreak(
    roundTransitionFixtures, 2, new Date('2026-10-01T00:10:00.000Z'), 600
  );
  if (beforeBreak !== 1 || afterBreak !== 2) {
    throw new Error(`❌ Test 11 Failed: break selected rounds ${beforeBreak} and ${afterBreak}, expected 1 and 2.`);
  }
  const recoveredKickoff = getRoundKickoffStartAt(
    previousRoundFinishedAt,
    new Date('2026-10-01T01:00:00.000Z'),
    600
  );
  if (recoveredKickoff.toISOString() !== '2026-10-01T01:00:00.000Z') {
    throw new Error(`❌ Test 11 Failed: recovered kickoff was ${recoveredKickoff.toISOString()}, expected it to start now without an extra buffer delay.`);
  }
  console.log('  ✅ Test 11 Passed: the world waits through the break and safely reschedules stale kickoffs without extending the break.');

  // Test 12: Ninety real minutes map to one full simulated match.
  console.log('▶ Test 12: Real-Time Match Duration...');
  const halftimeAt45Minutes = getTargetVirtualSecond(45 * 60 * 1000, 90 * 60);
  const fullTimeAt90Minutes = getTargetVirtualSecond(90 * 60 * 1000, 90 * 60);
  if (halftimeAt45Minutes !== 2700 || fullTimeAt90Minutes !== 5400) {
    throw new Error(`❌ Test 12 Failed: 45/90-minute targets were ${halftimeAt45Minutes}/${fullTimeAt90Minutes}, expected 2700/5400.`);
  }
  console.log('  ✅ Test 12 Passed: 90 real minutes map to 5,400 virtual seconds.');

  // Test 13: The worker must process the terminal second at full time.
  console.log('▶ Test 13: Full-Time Worker Batch Boundary...');
  const finalSecondBatch = getVirtualStepsToAdvance(5400, 5400);
  const finalTwoSecondsBatch = getVirtualStepsToAdvance(5399, 5400);
  const noWorkAfterTarget = getVirtualStepsToAdvance(5401, 5400);
  if (finalSecondBatch !== 1 || finalTwoSecondsBatch !== 2 || noWorkAfterTarget !== 0) {
    throw new Error(`❌ Test 13 Failed: terminal batch counts were ${finalSecondBatch}, ${finalTwoSecondsBatch}, ${noWorkAfterTarget}.`);
  }
  console.log('  ✅ Test 13 Passed: the worker advances second 5400 exactly once instead of spinning at zero steps.');

  console.log('\n🎉 All Test Suite Checks Passed Successfully!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Test Suite Error:', err);
  process.exit(1);
});
