// ============================================================================
// SAMARITAN SHIELD — Control-room live channel client
//
// Connects to /ws/live with the same bearer token api.ts uses, so local-dev
// and Firebase sessions both work. Reconnects with a capped backoff; a dropped
// socket must not take the dashboard down.
//
// Clients now send their GPS coordinates on subscribe and can push periodic
// location updates so the server can geo-filter broadcasts (nearby SOS).
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
  | 'nearby-sos'
  | 'hospital-call';

export type LiveHandler = (payload: Record<string, unknown>) => void;

function liveUrl(): string {
  const proto = API_BASE.startsWith('https') ? 'wss' : 'ws';
  const host = API_BASE.replace(/^https?:\/\//, '');
  return `${proto}://${host}/ws/live`;
}

export interface LiveConnection {
  /** Tear down the socket and stop reconnecting. */
  disconnect: () => void;
  /** Push a location update to the server so nearby-sos filtering works. */
  updateLocation: (lat: number, lng: number) => void;
}

export function connectLive(
  handlers: Partial<Record<LiveTopic, LiveHandler>>,
  initialLocation?: { lat: number; lng: number } | null,
): LiveConnection {
  let closed = false;
  let socket: WebSocket | null = null;
  let delay = 1000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastLat: number | undefined = initialLocation?.lat;
  let lastLng: number | undefined = initialLocation?.lng;

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
      const subscribeMsg: Record<string, unknown> = { type: 'subscribe', token };
      if (lastLat != null && lastLng != null) {
        subscribeMsg.lat = lastLat;
        subscribeMsg.lng = lastLng;
      }
      ws.send(JSON.stringify(subscribeMsg));
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

  return {
    disconnect() {
      closed = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    },
    updateLocation(lat: number, lng: number) {
      lastLat = lat;
      lastLng = lng;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'location-update', lat, lng }));
      }
    },
  };
}
