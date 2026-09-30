import { startCoordinatorLoop, stopCoordinatorLoop } from './football/coordinator';
import { client } from './db/index';

console.log('🏁 Starting Autonomous World Coordinator standalone process...');

startCoordinatorLoop(5000);

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}. Stopping Autonomous World Coordinator...`);
  await stopCoordinatorLoop();
  try {
    await client.end();
  } catch (_) {}
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
