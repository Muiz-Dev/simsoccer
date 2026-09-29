import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { db } from '../db/index';
import { matchEvents } from '../db/schema/index';
import { eq, gte, asc } from 'drizzle-orm';

export interface ClientSubscription {
  ws: WebSocket;
  fixtureId: string;
}

const subscriptions: ClientSubscription[] = [];

/**
 * Attaches WebSocket server for live match event broadcasting and catch-up queries.
 */
export function setupWebSocketServer(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    console.log('📡 [WS] New WebSocket client connected.');

    ws.on('message', async (message: string) => {
      try {
        const payload = JSON.parse(message.toString());

        if (payload.type === 'SUBSCRIBE_MATCH') {
          const { fixtureId, lastSequence } = payload;
          subscriptions.push({ ws, fixtureId });

          ws.send(JSON.stringify({ type: 'SUBSCRIBED', fixtureId }));
          console.log(`📡 [WS] Client subscribed to fixture '${fixtureId}'`);

          // Catch-up logic: If client reconnects with lastSequence, send missed events
          if (typeof lastSequence === 'number') {
            const missedEvents = await db
              .select()
              .from(matchEvents)
              .where(eq(matchEvents.fixtureId, fixtureId))
              .orderBy(asc(matchEvents.sequence));

            const eventsToCatchup = missedEvents.filter((ev) => ev.sequence > lastSequence);
            for (const ev of eventsToCatchup) {
              ws.send(JSON.stringify({ type: 'MATCH_EVENT', fixtureId, event: ev }));
            }
          }
        }
      } catch (err: any) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid WebSocket payload' }));
      }
    });

    ws.on('close', () => {
      const idx = subscriptions.findIndex((s) => s.ws === ws);
      if (idx !== -1) subscriptions.splice(idx, 1);
      console.log('📡 [WS] WebSocket client disconnected.');
    });
  });

  return wss;
}

/**
 * Broadcasts a live match tick event to all subscribed WebSocket clients.
 */
export function broadcastMatchEvent(fixtureId: string, event: any) {
  const targets = subscriptions.filter((s) => s.fixtureId === fixtureId);
  const payload = JSON.stringify({ type: 'MATCH_EVENT', fixtureId, event });

  for (const client of targets) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}
