// ============================================================================
// WebRTC VoIP Signaling & Zero-Phone Privacy Tests
// ============================================================================

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { WebSocket } from 'ws';
import { initVoipSignaling } from '../signaling';

describe('WebRTC VoIP Signaling Server', () => {
  let server: http.Server;
  let serverPort: number;

  before(async () => {
    server = http.createServer();
    initVoipSignaling(server);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr) {
          serverPort = addr.port;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  test('clients can register and exchange WebRTC signaling without leaking phone numbers', async () => {
    const wsUrl = `ws://localhost:${serverPort}/ws`;

    const callee = new WebSocket(wsUrl);
    const caller = new WebSocket(wsUrl);

    await Promise.all([
      new Promise<void>((res) => callee.on('open', () => res())),
      new Promise<void>((res) => caller.on('open', () => res())),
    ]);

    // 1. Register callee (civilian)
    const calleeRegistered = new Promise<void>((resolve) => {
      callee.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register-success' && msg.userId === 'civilian-user-123') {
          resolve();
        }
      });
    });

    callee.send(JSON.stringify({ type: 'register', userId: 'civilian-user-123' }));
    await calleeRegistered;

    // 2. Caller initiates call
    const incomingCallReceived = new Promise<any>((resolve) => {
      callee.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'incoming-call') {
          resolve(msg);
        }
      });
    });

    caller.send(
      JSON.stringify({
        type: 'call-initiate',
        callId: 'test-call-1',
        callerId: 'rescuer-456',
        callerName: 'First Responder',
        targetUserId: 'civilian-user-123',
      })
    );

    const incoming = await incomingCallReceived;
    assert.equal(incoming.callId, 'test-call-1');
    assert.equal(incoming.callerName, 'First Responder');
    assert.equal(incoming.phone, undefined, 'No phone number should exist in VoIP signaling');

    // 3. Caller sends WebRTC Offer
    const offerRelayed = new Promise<any>((resolve) => {
      callee.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'webrtc-offer') {
          resolve(msg);
        }
      });
    });

    caller.send(
      JSON.stringify({
        type: 'webrtc-offer',
        callId: 'test-call-1',
        callerId: 'rescuer-456',
        targetUserId: 'civilian-user-123',
        sdp: { type: 'offer', sdp: 'fake-sdp-offer' },
      })
    );

    const offer = await offerRelayed;
    assert.equal(offer.sdp.sdp, 'fake-sdp-offer');

    // Register caller to receive answer
    caller.send(JSON.stringify({ type: 'register', userId: 'rescuer-456' }));
    await new Promise((r) => setTimeout(r, 50));

    // 4. Callee sends WebRTC Answer
    const answerRelayed = new Promise<any>((resolve) => {
      caller.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'webrtc-answer') {
          resolve(msg);
        }
      });
    });

    callee.send(
      JSON.stringify({
        type: 'webrtc-answer',
        callId: 'test-call-1',
        targetUserId: 'rescuer-456',
        sdp: { type: 'answer', sdp: 'fake-sdp-answer' },
      })
    );

    const answer = await answerRelayed;
    assert.equal(answer.sdp.sdp, 'fake-sdp-answer');

    // Cleanup
    callee.close();
    caller.close();
  });
});
