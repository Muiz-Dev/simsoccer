import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { setupWebSocketServer } from './realtime/websocket';

const app = createApp();
const server = http.createServer(app);

// Initialize WebSocket server
setupWebSocketServer(server);

server.listen(env.PORT, () => {
  console.log(`🚀 SIM SOCCER Express API & WebSocket Server running on port ${env.PORT}`);
  console.log(`   Environment: ${env.NODE_ENV}`);
  console.log(`   Simulation Version: ${env.SIMULATION_VERSION}`);
});
