// ============================================================================
// SAMARITAN SHIELD — Control-room live channel client
//
// Connects to /ws/live with the same bearer token api.ts uses, so local-dev
// and Firebase sessions both work. Reconnects with a capped backoff; a dropped
// socket must not take the dashboard down.
// ============================================================================

import { API_BASE } from './config';
import { getBearerToken } from './api';

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

export type LiveHandler = (payload: Record<string, unknown>) => void;

function liveUrl(): string {
  const proto = API_BASE.startsWith('https') ? 'wss' : 'ws';
  const host = API_BASE.replace(/^https?:\/\//, '');
  return `${proto}://${host}/ws/live`;
}

export function connectLive(handlers: Partial<Record<LiveTopic, LiveHandler>>): () => void {
  let closed = false;
  let socket: WebSocket | null = null;
  let delay = 1000;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const open = async (): Promise<void> => {
    if (closed) return;

    let token: string;
    try {
      token = await getBearerToken();
    } catch (_err) {
      timer = setTimeout(open, delay);
      delay = Math.min(delay * 2, 30000);
      return;
    }

    const ws = new WebSocket(liveUrl());
    socket = ws;

    ws.onopen = () => {
      delay = 1000;
      ws.send(JSON.stringify({ type: 'subscribe', token }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as { topic?: LiveTopic; payload?: Record<string, unknown> };
        if (msg.topic && handlers[msg.topic] && msg.payload) {
          handlers[msg.topic]!(msg.payload);
        }
      } catch (_err) {
        // A malformed frame is not worth tearing the socket down over.
      }
    };

    ws.onclose = () => {
      if (closed) return;
      timer = setTimeout(open, delay);
      delay = Math.min(delay * 2, 30000);
    };

    ws.onerror = () => {
      ws.close();
    };
  };

  void open();

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    socket?.close();
  };
}
