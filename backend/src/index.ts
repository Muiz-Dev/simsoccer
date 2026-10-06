import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { setupWebSocketServer } from './realtime/websocket';
import { startSolanaPaymentReconciliation } from './payments/reconciliation';

const app = createApp();
const server = http.createServer(app);
const stopPaymentReconciliation = startSolanaPaymentReconciliation();

// Initialize WebSocket server
setupWebSocketServer(server);

server.listen(env.PORT, () => {
  console.log(`🚀 SIM SOCCER Express API & WebSocket Server running on port ${env.PORT}`);
  console.log(`   Environment: ${env.NODE_ENV}`);
  console.log(`   Simulation Version: ${env.SIMULATION_VERSION}`);
});

async function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}. Shutting down API and WebSocket server...`);
  stopPaymentReconciliation();
  server.close(() => {
    process.exit(0);
  });
}

process.once('SIGINT', () => void gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => void gracefulShutdown('SIGTERM'));
