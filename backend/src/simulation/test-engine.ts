import { MatchEngine } from './match-engine';
import { MatchSimulationInput } from './types';

async function testMatchEngine() {
  console.log('⚽ Testing Stateful Deterministic Match Simulation Engine...');

  const input: MatchSimulationInput = {
    fixtureId: 'test-fixture-101',
    seasonId: 'test-season-2026',
    simulationVersion: '1.0.0',
    seed: 'deterministic-seed-abc123',
    homeTeam: {
      id: 'team-arsenal',
      name: 'Arsenal',
      attackStrength: 1.25,
      defenseStrength: 1.30,
      overallRating: 86,
    },
    awayTeam: {
      id: 'team-chelsea',
      name: 'Chelsea',
      attackStrength: 1.18,
      defenseStrength: 1.10,
      overallRating: 82,
    },
    homePlayers: [
      { id: 'ars-p1', name: 'Saka', position: 'RW', rating: 88 },
      { id: 'ars-p2', name: 'Odegaard', position: 'AM', rating: 87 },
      { id: 'ars-p3', name: 'Saliba', position: 'CB', rating: 87 },
    ],
    awayPlayers: [
      { id: 'che-p1', name: 'Palmer', position: 'AM', rating: 86 },
      { id: 'che-p2', name: 'Caicedo', position: 'DM', rating: 83 },
      { id: 'che-p3', name: 'Colwill', position: 'CB', rating: 81 },
    ],
  };

  const engine1 = new MatchEngine(input);
  const result1 = engine1.simulate();

  console.log(`\n📊 Match Result Run 1: Arsenal ${result1.homeScore} - ${result1.awayScore} Chelsea`);
  console.log(`   Events generated: ${result1.events.length}`);
  console.log(`   Result Hash: ${result1.resultHash}`);
  console.log(`   Timeline Hash: ${result1.timelineHash}`);

  // Test 100% Deterministic Reproducibility with same seed
  const engine2 = new MatchEngine(input);
  const result2 = engine2.simulate();

  console.log(`\n🔄 Match Result Run 2 (Same Seed): Arsenal ${result2.homeScore} - ${result2.awayScore} Chelsea`);
  console.log(`   Result Hash Match: ${result1.resultHash === result2.resultHash ? '✅ EXACT MATCH' : '❌ MISMATCH'}`);
  console.log(`   Timeline Hash Match: ${result1.timelineHash === result2.timelineHash ? '✅ EXACT MATCH' : '❌ MISMATCH'}`);

  if (result1.resultHash !== result2.resultHash || result1.timelineHash !== result2.timelineHash) {
    throw new Error('Deterministic simulation check failed!');
  }

  // Print sample events
  console.log('\n📜 First 8 Events Sample:');
  result1.events.slice(0, 8).forEach((e) => {
    console.log(`   [Min ${e.virtualMinute}' / Sec ${e.virtualSecond}s] ${e.eventType} ${e.teamId || ''}`);
  });
}

testMatchEngine().catch(console.error);
