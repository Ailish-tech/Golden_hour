// ============================================================================
// SAMARITAN SHIELD — WebRTC VoIP Signaling Server
// Handles peer-to-peer in-browser audio call signaling over WebSockets.
// Zero phone numbers are stored or transmitted.
// ============================================================================

import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

interface SignalingMessage {
  type:
    | 'register'
    | 'call-initiate'
    | 'incoming-call'
    | 'webrtc-offer'
    | 'webrtc-answer'
    | 'ice-candidate'
    | 'call-accept'
    | 'call-decline'
    | 'call-hangup'
    | 'target-unavailable'
    | 'ping'
    | 'pong';
  userId?: string;
  targetUserId?: string;
  callerId?: string;
  callerName?: string;
  callId?: string;
  sdp?: unknown;
  candidate?: unknown;
  timestamp?: number;
}

interface ClientMeta {
  userId: string;
  ws: WebSocket;
  activeCallWith?: string;
}

export function initVoipSignaling(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const clients = new Map<string, ClientMeta>();
  const socketToUser = new Map<WebSocket, string>();

  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', (rawData: string) => {
      try {
        const msg: SignalingMessage = JSON.parse(rawData.toString());

        switch (msg.type) {
          case 'register': {
            if (msg.userId) {
              const cleanId = String(msg.userId).trim();
              clients.set(cleanId, { userId: cleanId, ws });
              socketToUser.set(ws, cleanId);
              ws.send(JSON.stringify({ type: 'register-success', userId: cleanId }));
            }
            break;
          }

          case 'call-initiate': {
            const targetId = msg.targetUserId ? String(msg.targetUserId).trim() : '';
            const target = clients.get(targetId);

            if (!target || target.ws.readyState !== WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'target-unavailable',
                  callId: msg.callId,
                  message: 'Civilian is currently offline or connecting.',
                })
              );
              return;
            }

            // Forward incoming call alert to civilian
            target.ws.send(
              JSON.stringify({
                type: 'incoming-call',
                callId: msg.callId,
                callerId: msg.callerId || 'bystander',
                callerName: msg.callerName || 'Emergency Bystander / Rescuer',
                timestamp: Date.now(),
              })
            );
            break;
          }

          case 'webrtc-offer': {
            const targetId = msg.targetUserId ? String(msg.targetUserId).trim() : '';
            const target = clients.get(targetId);
            if (target && target.ws.readyState === WebSocket.OPEN) {
              target.ws.send(
                JSON.stringify({
                  type: 'webrtc-offer',
                  callId: msg.callId,
                  callerId: msg.callerId,
                  sdp: msg.sdp,
                })
              );
            }
            break;
          }

          case 'webrtc-answer': {
            const targetId = msg.targetUserId ? String(msg.targetUserId).trim() : '';
            const target = clients.get(targetId);
            if (target && target.ws.readyState === WebSocket.OPEN) {
              target.ws.send(
                JSON.stringify({
                  type: 'webrtc-answer',
                  callId: msg.callId,
                  sdp: msg.sdp,
                })
              );
            }
            break;
          }

          case 'ice-candidate': {
            const targetId = msg.targetUserId ? String(msg.targetUserId).trim() : '';
            const target = clients.get(targetId);
            if (target && target.ws.readyState === WebSocket.OPEN) {
              target.ws.send(
                JSON.stringify({
                  type: 'ice-candidate',
                  callId: msg.callId,
                  candidate: msg.candidate,
                })
              );
            }
            break;
          }

          case 'call-decline': {
            const targetId = msg.targetUserId ? String(msg.targetUserId).trim() : '';
            const target = clients.get(targetId);
            if (target && target.ws.readyState === WebSocket.OPEN) {
              target.ws.send(
                JSON.stringify({
                  type: 'call-decline',
                  callId: msg.callId,
                })
              );
            }
            break;
          }

          case 'call-hangup': {
            const targetId = msg.targetUserId ? String(msg.targetUserId).trim() : '';
            const target = clients.get(targetId);
            if (target && target.ws.readyState === WebSocket.OPEN) {
              target.ws.send(
                JSON.stringify({
                  type: 'call-hangup',
                  callId: msg.callId,
                })
              );
            }
            break;
          }

          case 'ping': {
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
          }
        }
      } catch (err) {
        console.warn('[Signaling] Parse error:', err);
      }
    });

    ws.on('close', () => {
      const userId = socketToUser.get(ws);
      if (userId) {
        clients.delete(userId);
        socketToUser.delete(ws);
      }
    });

    ws.on('error', () => {
      const userId = socketToUser.get(ws);
      if (userId) {
        clients.delete(userId);
        socketToUser.delete(ws);
      }
    });
  });

  return wss;
}
