// ============================================================================
// SAMARITAN SHIELD — WebRTC In-Browser VoIP Service
// Zero phone numbers displayed or exchanged. Peer-to-peer audio over WebRTC.
// ============================================================================

import { Platform } from 'react-native';

export type VoipCallState =
  | 'idle'
  | 'incoming'
  | 'initiating'
  | 'ringing'
  | 'connected'
  | 'ended'
  | 'failed';

export interface VoipCallSession {
  callId: string;
  peerId: string;
  peerName: string;
  state: VoipCallState;
  durationSec: number;
  isMuted: boolean;
}

type IncomingCallHandler = (call: { callId: string; callerId: string; callerName: string }) => void;
type CallStateChangeHandler = (state: VoipCallState, session: VoipCallSession | null) => void;

const STUN_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

class VoipManager {
  private ws: WebSocket | null = null;
  private currentUserId: string = '';
  private currentUserName: string = '';
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteAudioElement: HTMLAudioElement | null = null;
  private ringtoneInterval: number | null = null;
  private callTimerInterval: number | null = null;
  private durationSec: number = 0;
  private isMuted: boolean = false;
  private activeSession: VoipCallSession | null = null;

  private onIncomingCallCallback: IncomingCallHandler | null = null;
  private onCallStateChangeCallback: CallStateChangeHandler | null = null;

  constructor() {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      let audio = document.getElementById('voip-remote-audio') as HTMLAudioElement;
      if (!audio) {
        audio = document.createElement('audio');
        audio.id = 'voip-remote-audio';
        audio.autoplay = true;
        (audio as unknown as { playsInline?: boolean }).playsInline = true;
        document.body.appendChild(audio);
      }
      this.remoteAudioElement = audio;
    }
  }

  public init(userId: string, userName: string) {
    this.currentUserId = userId;
    this.currentUserName = userName;
    this.connectSignaling();
    this.requestNotificationPermission();
  }

  public setHandlers(
    onIncomingCall: IncomingCallHandler,
    onCallStateChange: CallStateChangeHandler
  ) {
    this.onIncomingCallCallback = onIncomingCall;
    this.onCallStateChangeCallback = onCallStateChange;
  }

  private getWsUrl(): string {
    if (typeof window !== 'undefined') {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname || 'localhost';
      return `${proto}//${host}:3000/ws`;
    }
    return 'ws://localhost:3000/ws';
  }

  private connectSignaling() {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !this.currentUserId) return;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(this.getWsUrl());

      this.ws.onopen = () => {
        this.sendSignaling({
          type: 'register',
          userId: this.currentUserId,
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleSignalingMessage(msg);
        } catch (_e) {}
      };

      this.ws.onclose = () => {
        // Reconnect after 3 seconds
        setTimeout(() => {
          if (this.currentUserId) this.connectSignaling();
        }, 3000);
      };

      this.ws.onerror = () => {};
    } catch (_err) {}
  }

  private sendSignaling(data: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private async handleSignalingMessage(msg: {
    type: string;
    callId?: string;
    callerId?: string;
    callerName?: string;
    sdp?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
    message?: string;
  }) {
    switch (msg.type) {
      case 'incoming-call': {
        if (!msg.callId || !msg.callerId) return;
        this.activeSession = {
          callId: msg.callId,
          peerId: msg.callerId,
          peerName: msg.callerName || 'Emergency Caller',
          state: 'incoming',
          durationSec: 0,
          isMuted: false,
        };

        this.startRingtone();
        this.showPushNotification(this.activeSession.peerName);
        if (this.onIncomingCallCallback) {
          this.onIncomingCallCallback({
            callId: msg.callId,
            callerId: msg.callerId,
            callerName: msg.callerName || 'Emergency Caller',
          });
        }
        this.notifyState('incoming');
        break;
      }

      case 'webrtc-offer': {
        if (!msg.sdp || !this.activeSession) return;
        try {
          if (!this.pc) this.setupPeerConnection(this.activeSession.peerId, this.activeSession.callId);
          await this.pc!.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        } catch (err) {
          console.warn('[VoIP] Error handling offer:', err);
        }
        break;
      }

      case 'webrtc-answer': {
        if (!msg.sdp || !this.pc) return;
        try {
          await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          this.stopRingtone();
          this.startCallTimer();
          this.notifyState('connected');
        } catch (err) {
          console.warn('[VoIP] Error handling answer:', err);
        }
        break;
      }

      case 'ice-candidate': {
        if (!msg.candidate || !this.pc) return;
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } catch (err) {
          console.warn('[VoIP] Error adding ICE candidate:', err);
        }
        break;
      }

      case 'call-decline':
      case 'call-hangup': {
        this.endCallInternal('ended');
        break;
      }

      case 'target-unavailable': {
        this.endCallInternal('failed');
        break;
      }
    }
  }

  public async answerCall(): Promise<boolean> {
    this.stopRingtone();
    if (!this.activeSession) return false;

    try {
      // 1. Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.localStream = stream;

      // 2. Setup RTCPeerConnection
      if (!this.pc) {
        this.setupPeerConnection(this.activeSession.peerId, this.activeSession.callId);
      }

      stream.getTracks().forEach((track) => {
        this.pc!.addTrack(track, stream);
      });

      // 3. Create and send SDP answer
      const answer = await this.pc!.createAnswer();
      await this.pc!.setLocalDescription(answer);

      this.sendSignaling({
        type: 'webrtc-answer',
        callId: this.activeSession.callId,
        targetUserId: this.activeSession.peerId,
        sdp: answer,
      });

      this.startCallTimer();
      this.notifyState('connected');
      return true;
    } catch (err) {
      console.warn('[VoIP] Failed to answer call:', err);
      this.endCallInternal('failed');
      return false;
    }
  }

  public declineCall() {
    this.stopRingtone();
    if (this.activeSession) {
      this.sendSignaling({
        type: 'call-decline',
        callId: this.activeSession.callId,
        targetUserId: this.activeSession.peerId,
      });
    }
    this.endCallInternal('ended');
  }

  public hangupCall() {
    this.stopRingtone();
    if (this.activeSession) {
      this.sendSignaling({
        type: 'call-hangup',
        callId: this.activeSession.callId,
        targetUserId: this.activeSession.peerId,
      });
    }
    this.endCallInternal('ended');
  }

  public async startOutgoingCall(targetUserId: string, targetUserName?: string): Promise<boolean> {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return false;

    if (!this.currentUserId) {
      this.currentUserId = 'caller-' + Math.random().toString(36).substring(2, 9);
      this.connectSignaling();
    }

    const callId = 'call-' + Date.now();
    this.activeSession = {
      callId,
      peerId: targetUserId,
      peerName: targetUserName || 'Civilian Responder',
      state: 'initiating',
      durationSec: 0,
      isMuted: false,
    };
    this.notifyState('initiating');

    try {
      // 1. Get microphone audio
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.localStream = stream;

      // 2. Setup RTCPeerConnection
      this.setupPeerConnection(targetUserId, callId);
      stream.getTracks().forEach((track) => {
        this.pc!.addTrack(track, stream);
      });

      // 3. Send call-initiate signaling message
      this.sendSignaling({
        type: 'call-initiate',
        callId,
        callerId: this.currentUserId,
        callerName: this.currentUserName || 'Emergency Rescuer / Bystander',
        targetUserId,
      });

      // 4. Create WebRTC offer
      const offer = await this.pc!.createOffer();
      await this.pc!.setLocalDescription(offer);

      this.sendSignaling({
        type: 'webrtc-offer',
        callId,
        callerId: this.currentUserId,
        targetUserId,
        sdp: offer,
      });

      this.notifyState('ringing');
      return true;
    } catch (err) {
      console.warn('[VoIP] Outgoing call initiation error:', err);
      this.endCallInternal('failed');
      return false;
    }
  }

  public toggleMute(): boolean {
    if (!this.localStream) return false;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      this.isMuted = !audioTrack.enabled;
      if (this.activeSession) this.activeSession.isMuted = this.isMuted;
      this.notifyState(this.activeSession?.state || 'connected');
      return this.isMuted;
    }
    return false;
  }

  private setupPeerConnection(targetUserId: string, callId: string) {
    this.pc = new RTCPeerConnection(STUN_CONFIG);

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignaling({
          type: 'ice-candidate',
          callId,
          targetUserId,
          candidate: event.candidate,
        });
      }
    };

    this.pc.ontrack = (event) => {
      if (this.remoteAudioElement && event.streams[0]) {
        this.remoteAudioElement.srcObject = event.streams[0];
        this.remoteAudioElement.play().catch(() => {});
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc?.connectionState === 'connected') {
        this.startCallTimer();
        this.notifyState('connected');
      } else if (
        this.pc?.connectionState === 'disconnected' ||
        this.pc?.connectionState === 'failed' ||
        this.pc?.connectionState === 'closed'
      ) {
        this.endCallInternal('ended');
      }
    };
  }

  private endCallInternal(finalState: VoipCallState) {
    this.stopRingtone();
    this.stopCallTimer();

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }

    if (this.remoteAudioElement) {
      this.remoteAudioElement.srcObject = null;
    }

    this.notifyState(finalState);
    setTimeout(() => {
      this.activeSession = null;
      this.durationSec = 0;
      this.isMuted = false;
      this.notifyState('idle');
    }, 1500);
  }

  private startCallTimer() {
    this.stopCallTimer();
    this.durationSec = 0;
    this.callTimerInterval = window.setInterval(() => {
      this.durationSec++;
      if (this.activeSession) {
        this.activeSession.durationSec = this.durationSec;
        this.notifyState('connected');
      }
    }, 1000);
  }

  private stopCallTimer() {
    if (this.callTimerInterval) {
      clearInterval(this.callTimerInterval);
      this.callTimerInterval = null;
    }
  }

  private startRingtone() {
    this.stopRingtone();
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      const playChime = () => {
        try {
          const ctx = new AudioCtx();
          if (ctx.state === 'suspended') ctx.resume();

          const osc1 = ctx.createOscillator();
          const osc2 = ctx.createOscillator();
          const gain = ctx.createGain();

          osc1.type = 'sine';
          osc1.frequency.setValueAtTime(440, ctx.currentTime); // A4
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(480, ctx.currentTime); // B4

          gain.gain.setValueAtTime(0.2, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.2);

          osc1.connect(gain);
          osc2.connect(gain);
          gain.connect(ctx.destination);

          osc1.start();
          osc2.start();
          osc1.stop(ctx.currentTime + 1.2);
          osc2.stop(ctx.currentTime + 1.2);
        } catch (_e) {}
      };

      playChime();
      this.ringtoneInterval = window.setInterval(playChime, 2500);

      // Trigger device haptics
      if ('vibrate' in navigator) {
        navigator.vibrate([400, 200, 400, 200, 400]);
      }
    } catch (_err) {}
  }

  private stopRingtone() {
    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
    }
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(0);
    }
  }

  private requestNotificationPermission() {
    if (
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'default'
    ) {
      Notification.requestPermission().catch(() => {});
    }
  }

  private showPushNotification(callerName: string) {
    if (
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      try {
        const notif = new Notification('🚨 Incoming Emergency VoIP Call', {
          body: `${callerName} is calling via your Samaritan Shield QR Pass. Tap to answer.`,
          requireInteraction: true,
          tag: 'voip-call',
        });
        notif.onclick = () => {
          window.focus();
          notif.close();
        };
      } catch (_e) {}
    }
  }

  private notifyState(state: VoipCallState) {
    if (this.activeSession) {
      this.activeSession.state = state;
    }
    if (this.onCallStateChangeCallback) {
      this.onCallStateChangeCallback(state, this.activeSession);
    }
  }

  public getSession(): VoipCallSession | null {
    return this.activeSession;
  }
}

export const voipService = new VoipManager();
