import { client } from './db/index';
import { redisConnection } from './workers/queues';
import { simulationWorker } from './workers/simulation.worker';
import { settlementWorker } from './workers/settlement.worker';

let shuttingDown = false;

simulationWorker.on('ready', () => {
  console.log('✅ Simulation worker connected and ready.');
});

simulationWorker.on('error', (error) => {
  console.error('❌ Simulation worker error:', error);
});

simulationWorker.on('failed', (job, error) => {
  console.error(`❌ Simulation job ${job?.id ?? 'unknown'} failed:`, error);
});

settlementWorker.on('ready', () => {
  console.log('✅ Bet settlement worker connected and ready.');
});

settlementWorker.on('error', (error) => {
  console.error('❌ Bet settlement worker error:', error);
});

settlementWorker.on('failed', (job, error) => {
  console.error(`❌ Settlement job ${job?.id ?? 'unknown'} failed:`, error);
});

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Stopping simulation worker after ${signal}...`);

  try {
    await simulationWorker.close();
    await settlementWorker.close();
    redisConnection.disconnect();
    await client.end();
  } catch (error) {
    console.error('❌ Worker shutdown failed:', error);
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));