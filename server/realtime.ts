// ============================================================================
// SAMARITAN SHIELD — Control Room Live Channel
// ============================================================================

import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { getAuth } from 'firebase-admin/auth';
import { getAuthMode } from './middleware/auth';
import User from './models/User';

export type LiveTopic =
  | 'detection-candidate'
  | 'incident-created'
  | 'incident-updated'
  | 'camera-status'
  | 'signal-state'
  | 'corridor-opened'
  | 'corridor-progress'
  | 'corridor-cleared'
  | 'citizen-alert'
  | 'hospital-call';

interface LiveMessage {
  topic: LiveTopic;
  payload: unknown;
}

interface SocketMeta {
  uid: string;
  role: string;
  zone?: string;
  ws: WebSocket;
}

const connections = new Set<SocketMeta>();

export function initLiveChannel(httpServer: HttpServer): {
  broadcast(topic: LiveTopic, payload: unknown): void;
  broadcastToUsers(uids: string[], topic: LiveTopic, payload: unknown): void;
} {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/live' });

  wss.on('connection', (ws: WebSocket) => {
    let meta: SocketMeta | null = null;

    ws.on('message', async (rawData: string) => {
      try {
        const msg = JSON.parse(rawData.toString());

        if (msg.type === 'subscribe') {
          const token = msg.token;
          if (!token) {
            ws.close(1008, 'Missing token');
            return;
          }

          let uid = '';
          const authMode = getAuthMode();

          if (authMode === 'insecure-dev') {
            const parts = token.split(':');
            if (parts.length < 1 || !parts[0]) {
              ws.close(1008, 'Invalid dev token');
              return;
            }
            uid = parts[0];
          } else {
            try {
              const decoded = await getAuth().verifyIdToken(token);
              uid = decoded.uid;
            } catch (err) {
              ws.close(1008, 'Invalid token');
              return;
            }
          }

          const user = await User.findOne({ firebaseUid: uid }).lean();
          if (!user) {
            ws.close(1008, 'User not found');
            return;
          }

          meta = { uid, role: user.role, zone: user.zone, ws };
          connections.add(meta);
          ws.send(JSON.stringify({ type: 'subscribe-success' }));
        }
      } catch (err) {
        console.warn('Live WebSocket parse error', err);
      }
    });

    ws.on('close', () => {
      if (meta) connections.delete(meta);
    });

    ws.on('error', () => {
      if (meta) connections.delete(meta);
    });
  });

  return {
    broadcast(topic: LiveTopic, payload: unknown) {
      const msg = JSON.stringify({ topic, payload });
      for (const client of connections) {
        if (client.ws.readyState === WebSocket.OPEN) {
          // Send camera and detection payloads to control room only
          if (topic === 'detection-candidate' && client.role !== 'control_room') continue;
          client.ws.send(msg);
        }
      }
    },
    broadcastToUsers(uids: string[], topic: LiveTopic, payload: unknown) {
      const msg = JSON.stringify({ topic, payload });
      const targetUids = new Set(uids);
      for (const client of connections) {
        if (targetUids.has(client.uid) && client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(msg);
        }
      }
    }
  };
}

export let liveChannel: ReturnType<typeof initLiveChannel> | null = null;

export function setLiveChannel(channel: ReturnType<typeof initLiveChannel>) {
  liveChannel = channel;
}

export function broadcastToControlRoomZone(zone: string, topic: LiveTopic, payload: unknown) {
  if (!liveChannel) return;
  const msg = JSON.stringify({ topic, payload });
  for (const client of connections) {
    if (client.role === 'control_room' && client.zone === zone && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(msg);
    }
  }
}

export function broadcastToAll(topic: LiveTopic, payload: unknown) {
  if (liveChannel) {
    liveChannel.broadcast(topic, payload);
  }
}

export function broadcastToRole(role: string, topic: LiveTopic, payload: unknown) {
  const msg = JSON.stringify({ topic, payload });
  for (const client of connections) {
    if (client.role === role && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(msg);
    }
  }
}
