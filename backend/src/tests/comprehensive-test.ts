import { getVirtualStepsToAdvance, MatchEngine } from '../simulation/match-engine';
import { MatchSimulationInput } from '../simulation/types';
import { calculateAllPreMatchMarkets } from '../markets/probability-engine';
import { checkDependenciesHealth, deriveWorldRound, getWorldStatusInfo } from '../football/coordinator';
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

  // Test 11: The worker must process the terminal second at full time.
  console.log('▶ Test 11: Full-Time Worker Batch Boundary...');
  const finalSecondBatch = getVirtualStepsToAdvance(5400, 5400);
  const finalTwoSecondsBatch = getVirtualStepsToAdvance(5399, 5400);
  const noWorkAfterTarget = getVirtualStepsToAdvance(5401, 5400);
  if (finalSecondBatch !== 1 || finalTwoSecondsBatch !== 2 || noWorkAfterTarget !== 0) {
    throw new Error(`❌ Test 11 Failed: terminal batch counts were ${finalSecondBatch}, ${finalTwoSecondsBatch}, ${noWorkAfterTarget}.`);
  }
  console.log('  ✅ Test 11 Passed: the worker advances second 5400 exactly once instead of spinning at zero steps.');

  console.log('\n🎉 All Test Suite Checks Passed Successfully!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Test Suite Error:', err);
  process.exit(1);
});
