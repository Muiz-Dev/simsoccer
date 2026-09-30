import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { setupWebSocketServer } from './realtime/websocket';
import { startCoordinatorLoop, stopCoordinatorLoop } from './football/coordinator';
import { simulationWorker } from './workers/simulation.worker';

const app = createApp();
const server = http.createServer(app);

// Initialize WebSocket server
setupWebSocketServer(server);

// Initialize Simulation Worker
simulationWorker.on('ready', () => {
  console.log('✅ Simulation worker active & listening for match jobs.');
});

// Start autonomous World Coordinator loop
startCoordinatorLoop(5000);

server.listen(env.PORT, () => {
  console.log(`🚀 SIM SOCCER Express API, WebSocket Server, Simulation Worker & Autonomous World Coordinator running on port ${env.PORT}`);
  console.log(`   Environment: ${env.NODE_ENV}`);
  console.log(`   Simulation Version: ${env.SIMULATION_VERSION}`);
});

async function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}. Shutting down API, Worker, and World Coordinator...`);
  await stopCoordinatorLoop();
  try {
    await simulationWorker.close();
  } catch (_) {}
  server.close(() => {
    process.exit(0);
  });
}

process.once('SIGINT', () => void gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => void gracefulShutdown('SIGTERM'));
