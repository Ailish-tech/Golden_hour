// ============================================================================
// SAMARITAN SHIELD — Backend Server
// Node.js / Express — TypeScript
// ============================================================================

import 'dotenv/config';
import express, { Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
import crypto from 'crypto';
import https from 'https';
import mongoose from 'mongoose';
import { generateLegalShieldPDF } from './certificate';
import Incident, { type IIncident } from './models/Incident';
import User, { type UserRole } from './models/User';
import HospitalStaff from './models/HospitalStaff';
import ControlRoomStaff from './models/ControlRoomStaff';
import Hospital from './models/Hospital';
import { initAuth, requireAuth, requireHospital, getAuthMode } from './middleware/auth';
import { initVoipSignaling } from './signaling';
import { createOrMergeIncident } from './services/incidents';
import { activateEmergencyResponse } from './services/response';
import { closeCorridor, openCorridor } from './services/corridor';
import { initTelephony } from './services/notify';
import { initServiceAuth } from './middleware/serviceAuth';
import { initLiveChannel, setLiveChannel } from './realtime';
import mlRouter from './routes/ml';
import controlRouter from './routes/control';
import trafficRouter from './routes/traffic';
import { getDistanceKm, type ReporterRole } from './services/hospitals';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface SOSRequestBody {
  lat?: number;
  lng?: number;
  audioBase64?: string;
}


interface SOSSuccessResponse {
  status: 'success';
  incidentId: string;
  incidentCode: string;
  role: ReporterRole;
  message: string;
  reporterCount: number;
  hash: string;
  timestamp: string;
  coordinates: { lat: number; lng: number };
  pdfBase64: string;
  nearestHospital: HospitalInfo | null;
  backupHospitals: HospitalInfo[];
}

interface SOSErrorResponse {
  status: 'error';
  message: string;
}

type SOSResponse = SOSSuccessResponse | SOSErrorResponse;

import { type HospitalInfo } from './services/hospitals';

// ---------------------------------------------------------------------------
// App Setup
// ---------------------------------------------------------------------------
const app = express();
const PORT: number = Number(process.env.PORT) || 3000;
const MONGO_URI: string = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/samaritan-shield';
import { PUBLIC_BASE_URL, DEDUP_RADIUS_METERS } from './config';

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
const CORS_ORIGINS: string[] = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * Whether a browser origin may call this API.
 *
 * A request with no Origin header — a native client, curl, a server-to-server
 * call — is not subject to CORS and is allowed through.
 *
 * In local development any localhost port is accepted. Expo moves to 8082,
 * 8083 and onward whenever its preferred port is taken, and a fixed allowlist
 * turns that into a CORS rejection that surfaces in the app as an unexplained
 * network failure. This widening applies only when the server is already
 * running with unverified tokens, so it grants nothing a deployed instance
 * would not already refuse.
 */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (CORS_ORIGINS.includes(origin)) return true;
  if (
    getAuthMode() === 'insecure-dev' &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  ) {
    return true;
  }
  return false;
}

app.use(
  cors({
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    credentials: true,
  })
);
app.use(express.json());

app.use('/api/ml', mlRouter);
app.use('/api/control', controlRouter);
app.use('/api/traffic', trafficRouter);

// ---------------------------------------------------------------------------
// Health-check
// ---------------------------------------------------------------------------
app.get('/api/health', (_req: Request, res: Response): void => {
  res.json({ status: 'ok', uptime: process.uptime(), authMode: getAuthMode() });
});

// Twilio fetches this URL when placing the hospital voice call. Public on
// purpose: the caller is Twilio's servers, not a signed-in user. It speaks
// only the incident code and coordinates — no victim identity.
app.get('/api/voice/twiml', (req: Request, res: Response): void => {
  const code = String(req.query.code || 'UNKNOWN').replace(/[^A-Z0-9-]/gi, '');
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const hospital = String(req.query.hospital || 'the trauma desk').slice(0, 80);
  const spoken =
    `Samaritan Shield emergency. Accident detected at latitude ${Number.isFinite(lat) ? lat.toFixed(3) : 'unknown'}, ` +
    `longitude ${Number.isFinite(lng) ? lng.toFixed(3) : 'unknown'}. Incident ${code}. ` +
    `Please open the hospital command desk at ${hospital} and dispatch an ambulance.`;

  res.type('text/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response><Say voice="Polly.Aditi" language="en-IN">${spoken}</Say></Response>`
  );
});

// ---------------------------------------------------------------------------
// POST /api/auth/sync — Upsert user to MongoDB after every login/register
// ---------------------------------------------------------------------------
app.post('/api/auth/sync', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({
        status: 'error',
        message: 'Cannot reach the database. Make sure MongoDB is running, then try again.',
      });
      return;
    }

    // Identity comes from the verified token only. A client may propose a
    // display name and its coordinates; it may not propose who it is, nor
    // what role it holds.
    const firebaseUid = req.user!.uid;
    const email = req.user!.email;
    const { displayName, lat, lng } = req.body as {
      displayName?: string;
      lat?: number;
      lng?: number;
    };

    if (!email) {
      res.status(400).json({ status: 'error', message: 'Token carries no email address.' });
      return;
    }

    // Role is resolved server-side: an existing role is preserved, otherwise
    // the hospital-staff allowlist decides. Everyone else is a citizen.
    const existing = await User.findOne({ firebaseUid }).lean();

    let role: UserRole = existing?.role && existing.role !== 'citizen' ? existing.role : 'citizen';
    let hospitalId = existing?.hospitalId;
    let hospitalName = existing?.hospitalName;
    let zone = existing?.zone;

    if (role !== 'hospital' && role !== 'control_room') {
      const staff = await HospitalStaff.findOne({ email: email.toLowerCase() }).lean();
      if (staff) {
        role = 'hospital';
        hospitalId = staff.hospitalId;
        hospitalName = staff.hospitalName;
      }
    }

    if (role === 'citizen') {
      const control = await ControlRoomStaff.findOne({ email: email.toLowerCase() }).lean();
      if (control) {
        role = 'control_room';
        zone = control.zone;
      }
    }

    const setPayload: Record<string, unknown> = {
      email,
      displayName: displayName || existing?.displayName || 'Samaritan User',
      role,
      hospitalId: role === 'hospital' ? hospitalId : undefined,
      hospitalName: role === 'hospital' ? hospitalName : undefined,
      zone: role === 'control_room' ? zone : undefined,
      lastLoginAt: new Date(),
    };

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      setPayload.lastKnownLat = lat;
      setPayload.lastKnownLng = lng;
      setPayload.lastLocation = {
        type: 'Point',
        coordinates: [lng as number, lat as number],
      };
    }

    const user = await User.findOneAndUpdate(
      { firebaseUid },
      {
        $set: setPayload,
        $setOnInsert: { firebaseUid },
      },
      { upsert: true, new: true, runValidators: true }
    );

    console.log(`✅ [Auth Sync] ${email} (${role}) synced → ${user._id}`);

    res.json({
      status: 'success',
      user: {
        id: String(user._id),
        firebaseUid: user.firebaseUid,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        hospitalId: user.hospitalId,
        hospitalName: user.hospitalName,
        zone: user.zone,
        lastKnownLat: user.lastKnownLat,
        lastKnownLng: user.lastKnownLng,
      },
    });
  } catch (err: unknown) {
    console.error('\u274c Auth sync error:', err);
    const name = (err as { name?: string })?.name || '';
    if (
      name === 'MongoServerSelectionError' ||
      name === 'MongoNotConnectedError' ||
      name === 'MongooseError' ||
      mongoose.connection.readyState !== 1
    ) {
      res.status(503).json({
        status: 'error',
        message: 'Cannot reach the database. Make sure MongoDB is running, then try again.',
      });
      return;
    }
    res.status(500).json({ status: 'error', message: 'Failed to sync user.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/sos — the single emergency write path
//
// This previously ran as two endpoints the client called in parallel:
// /api/sos hashed and rendered a certificate but persisted nothing, while
// /api/dispatch created the incident. The digest on a responder's certificate
// therefore existed only in their app's memory, and the hospital saw a
// different digest recomputed from createdAt. Both also queried Overpass, so
// one button press cost two upstream lookups.
//
// One call now: dedup, create-or-merge, hash, persist, route, render.
// ---------------------------------------------------------------------------
app.post('/api/sos', requireAuth, async (req: Request<{}, SOSResponse, SOSRequestBody>, res: Response<SOSResponse>): Promise<void> => {
  try {
    const { lat, lng, audioBase64 } = req.body;
    const reporterId: string = req.user!.uid;

    // --- Input validation ---
    if (lat == null || lng == null || typeof lat !== 'number' || typeof lng !== 'number') {
      res.status(400).json({
        status: 'error',
        message: 'Missing or invalid required fields: lat, lng (must be numbers)',
      });
      return;
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      res.status(400).json({
        status: 'error',
        message: 'Coordinates out of range: lat [-90,90], lng [-180,180]',
      });
      return;
    }

    const {
      incident,
      role,
      certificate,
      primaryHospital,
      backupHospitals,
      merged,
      message
    } = await createOrMergeIncident({
      lat,
      lng,
      reporterId,
      source: 'CITIZEN_SOS'
    });

    if (!merged) {
      void activateEmergencyResponse({
        incident,
        hospital: primaryHospital,
        source: 'CITIZEN_SOS',
        reporterUid: reporterId,
        audioBase64,
      });
    }

    const pdfBase64: string = await generateLegalShieldPDF({
      userId: reporterId,
      lat,
      lng,
      timestamp: certificate!.issuedAt.toISOString(),
      hash: certificate!.hash,
      hospitalName: incident.assignedHospitalName || primaryHospital?.name,
      verifyUrl: `${PUBLIC_BASE_URL}/api/verify/${certificate!.hash}`,
    });

    res.status(merged ? 200 : 201).json({
      status: 'success',
      incidentId: String(incident._id),
      incidentCode: `CAD-${String(incident._id).slice(-4).toUpperCase()}`,
      role,
      message,
      reporterCount: 1 + incident.secondaryReporters.length,
      hash: certificate!.hash,
      timestamp: certificate!.issuedAt.toISOString(),
      coordinates: { lat, lng },
      pdfBase64,
      nearestHospital: primaryHospital,
      backupHospitals,
    });
  } catch (err: unknown) {
    console.error('❌ SOS endpoint error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error while processing SOS.',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/verify/:hash — public integrity check
//
// A certificate's value rests on someone being able to check it. This returns
// only what confirms the record exists and is unmodified: no coordinates, no
// responder identity, no victim condition.
// ---------------------------------------------------------------------------
app.get('/api/verify/:hash', async (req: Request, res: Response): Promise<void> => {
  try {
    const hash = String(req.params.hash || '').toLowerCase();

    if (!/^[a-f0-9]{64}$/.test(hash)) {
      res.status(400).json({ status: 'error', message: 'Not a valid SHA-256 digest.' });
      return;
    }

    const incident = await Incident.findOne({ 'certificates.hash': hash }).lean();
    if (!incident) {
      res.status(404).json({
        status: 'not_found',
        verified: false,
        message: 'No emergency record matches this digest.',
      });
      return;
    }

    const certificate = incident.certificates.find((c) => c.hash === hash)!;

    res.json({
      status: 'success',
      verified: true,
      incidentCode: `CAD-${String(incident._id).slice(-4).toUpperCase()}`,
      issuedAt: certificate.issuedAt.toISOString(),
      recordedAt: incident.createdAt.toISOString(),
      routedHospital: incident.assignedHospitalName,
      message: 'This digest matches an emergency record held by Samaritan Shield.',
    });
  } catch (err: unknown) {
    console.error('❌ Verify error:', err);
    res.status(500).json({ status: 'error', message: 'Verification failed.' });
  }
});

// ---------------------------------------------------------------------------
// GET /civilian-id & GET /api/civilian-card — public emergency civilian ID card
//
// When someone scans the citizen's QR code with their mobile phone, this serves
// a clean, high-urgency, mobile-first Emergency Identity & Medical Card with
// tap-to-call, live maps routing, and Section 134A legal protections.
// ---------------------------------------------------------------------------
app.get(['/civilian-id', '/api/civilian-card'], (req: Request, res: Response): void => {
  const callId = String(req.query.callId || req.query.id || 'civilian-responder');
  const name = String(req.query.name || 'Civilian Responder');
  const address = String(req.query.address || 'Live Emergency Coordinates');
  const lat = String(req.query.lat || '');
  const lng = String(req.query.lng || '');
  const blood = String(req.query.blood || 'O+ Positive');

  const mapsUrl = lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : `https://www.google.com/maps/search/${encodeURIComponent(address)}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Civilian Emergency ID — Samaritan Shield</title>
  <style>
    :root {
      --bg: #F6F8FA;
      --card: #FFFFFF;
      --text: #0F172A;
      --muted: #64748B;
      --mint: #10B981;
      --mint-wash: #E2F7EB;
      --coral: #FF3B5C;
      --border: #E2E8F0;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      justify-content: center;
      padding: 20px 14px 40px;
    }
    .container {
      width: 100%;
      max-width: 440px;
      background: var(--card);
      border-radius: 24px;
      padding: 24px;
      border: 1px solid var(--border);
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      background: var(--mint-wash);
      color: #059669;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      margin-bottom: 14px;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--mint);
      animation: pulse 1.6s infinite;
      display: inline-block;
    }
    @keyframes pulse {
      0% { transform: scale(0.9); opacity: 0.8; }
      50% { transform: scale(1.3); opacity: 1; }
      100% { transform: scale(0.9); opacity: 0.8; }
    }
    h1 {
      font-size: 24px;
      font-weight: 800;
      color: var(--text);
      margin-bottom: 4px;
    }
    .subtitle {
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 20px;
    }
    .card-section {
      background: #F8FAFC;
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px;
      margin-bottom: 14px;
    }
    .voip-box {
      border: 2px solid #10B981;
      background: #F0FDF4;
    }
    .voip-desc {
      font-size: 12px;
      color: #334155;
      margin: 8px 0 14px;
      line-height: 1.5;
    }
    .field-label {
      font-size: 10px;
      font-weight: 700;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 4px;
    }
    .field-value {
      font-size: 15px;
      font-weight: 700;
      color: var(--text);
      word-break: break-word;
    }
    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 14px 18px;
      border-radius: 14px;
      font-size: 14px;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }
    .btn:active { opacity: 0.85; transform: scale(0.99); }
    .btn-call {
      background: #10B981;
      color: #FFFFFF;
      box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
    }
    .btn-maps {
      background: #0F172A;
      color: #FFFFFF;
      margin-top: 10px;
    }
    .btn-hangup {
      background: #EF4444;
      color: #FFFFFF;
    }
    .btn-mute {
      background: #334155;
      color: #FFFFFF;
    }
    .call-hud {
      margin-top: 12px;
      padding: 14px;
      background: #FFFFFF;
      border-radius: 14px;
      border: 1px solid #CBD5E1;
      text-align: center;
    }
    .call-status-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .call-timer {
      font-size: 22px;
      font-weight: 800;
      font-family: monospace;
      color: #0F172A;
      margin: 8px 0;
    }
    .sound-waves {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      height: 24px;
      margin: 10px 0;
    }
    .wave-bar {
      width: 4px;
      height: 100%;
      background: #10B981;
      border-radius: 2px;
      animation: wave 1.2s ease-in-out infinite;
    }
    .wave-bar:nth-child(2) { animation-delay: 0.2s; }
    .wave-bar:nth-child(3) { animation-delay: 0.4s; }
    .wave-bar:nth-child(4) { animation-delay: 0.6s; }
    .wave-bar:nth-child(5) { animation-delay: 0.8s; }
    @keyframes wave {
      0%, 100% { height: 6px; }
      50% { height: 22px; }
    }
    .call-actions-grid {
      display: flex;
      gap: 10px;
      margin-top: 10px;
    }
    .statute-box {
      margin-top: 18px;
      background: #EFF6FF;
      border: 1px solid #BFDBFE;
      border-radius: 14px;
      padding: 14px;
      font-size: 12px;
      color: #1E40AF;
      line-height: 1.5;
    }
    .statute-title {
      font-weight: 800;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .footer {
      text-align: center;
      font-size: 11px;
      color: var(--muted);
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">
      <span class="pulse-dot"></span>
      VERIFIED CIVILIAN PASS
    </div>
    <h1>${name}</h1>
    <div class="subtitle">Samaritan Shield Emergency Identity & Telemetry</div>

    <!-- Secure In-Browser VoIP Audio Section (NO Phone Numbers Displayed) -->
    <div class="card-section voip-box">
      <div class="field-label" style="color: #059669; display: flex; align-items: center; gap: 6px;">
        <span class="pulse-dot"></span> SECURE BROWSER VOIP AUDIO
      </div>
      <div class="voip-desc">
        Direct peer-to-peer WebRTC internet voice call. Connects instantly with the civilian responder's device without revealing personal phone numbers.
      </div>

      <button id="btnCallNow" class="btn btn-call" onclick="startEmergencyCall()">
        <span style="font-size: 18px;">📞</span> CALL NOW — FREE INTERNET AUDIO
      </button>

      <!-- Active Call HUD -->
      <div id="activeCallHud" class="call-hud" style="display: none;">
        <div class="call-status-row">
          <span id="callStatusDot" class="pulse-dot"></span>
          <span id="callStatusLabel" style="font-weight: 700; font-size: 13px;">Connecting audio...</span>
        </div>

        <div id="callTimerDisplay" class="call-timer" style="display: none;">00:00</div>

        <div id="soundWaves" class="sound-waves" style="display: none;">
          <span class="wave-bar"></span>
          <span class="wave-bar"></span>
          <span class="wave-bar"></span>
          <span class="wave-bar"></span>
          <span class="wave-bar"></span>
        </div>

        <div class="call-actions-grid">
          <button id="btnMuteToggle" class="btn btn-mute" style="flex: 1;" onclick="toggleMuteMic()">
            🎤 Mute
          </button>
          <button id="btnHangupCall" class="btn btn-hangup" style="flex: 1;" onclick="hangupEmergencyCall()">
            🔴 End Call
          </button>
        </div>
      </div>
    </div>

    <!-- Live Address & Directions -->
    <div class="card-section">
      <div class="field-label">Live / Emergency Address</div>
      <div class="field-value">${address}</div>
      ${lat && lng ? `<div style="font-size:12px;color:var(--muted);margin-top:4px;">GPS: ${lat}° N, ${lng}° E</div>` : ''}
      <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-maps">
        🗺️ Navigate to Location in Maps
      </a>
    </div>

    <!-- Critical Medical Details -->
    <div class="card-section" style="display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div class="field-label">Blood Group / Medical</div>
        <div class="field-value">${blood}</div>
      </div>
      <div style="background:#FFE4E6;color:#E11D48;padding:4px 10px;border-radius:10px;font-size:12px;font-weight:800;">
        CRITICAL ID
      </div>
    </div>

    <div class="statute-box">
      <div class="statute-title">🛡️ Section 134A — Motor Vehicles Act</div>
      Good Samaritan Protection: A person who aids an accident victim or emergency casualty is exempt from civil and criminal liability. Responders cannot be detained, questioned without consent, or compelled to disclose further identity.
    </div>

    <div class="footer">
      Powered by Samaritan Shield • Encrypted VoIP Telemetry
    </div>
  </div>

  <audio id="remoteAudioPlayer" autoplay playsinline style="display: none;"></audio>

  <script>
    const targetUserId = "${callId}";
    const callerId = "caller-" + Math.random().toString(36).substring(2, 9);
    const callId = "call-" + Date.now();

    let ws = null;
    let pc = null;
    let localStream = null;
    let callTimerInterval = null;
    let secondsElapsed = 0;
    let isMuted = false;
    let audioContext = null;
    let ringbackOscillator = null;

    function getWsUrl() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return proto + '//' + location.hostname + ':3000/ws';
    }

    function initSignaling() {
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      ws = new WebSocket(getWsUrl());

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'register', userId: callerId }));
      };

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'webrtc-answer') {
            if (pc && msg.sdp) {
              await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
              stopRingback();
              setConnectedState();
            }
          } else if (msg.type === 'ice-candidate') {
            if (pc && msg.candidate) {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            }
          } else if (msg.type === 'call-decline') {
            stopRingback();
            showStatus('Call declined by civilian responder.', false);
            setTimeout(resetUi, 2500);
          } else if (msg.type === 'call-hangup') {
            stopRingback();
            showStatus('Call ended.', false);
            setTimeout(resetUi, 2000);
          } else if (msg.type === 'target-unavailable') {
            stopRingback();
            showStatus(msg.message || 'Civilian is currently unavailable.', false);
            setTimeout(resetUi, 3000);
          }
        } catch (e) {
          console.error(e);
        }
      };

      ws.onclose = () => {
        setTimeout(initSignaling, 3000);
      };
    }

    initSignaling();

    async function startEmergencyCall() {
      document.getElementById('btnCallNow').style.display = 'none';
      document.getElementById('activeCallHud').style.display = 'block';
      showStatus('Requesting microphone permissions...', true);

      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (err) {
        showStatus('Microphone access denied. Please allow microphone to talk.', false);
        setTimeout(resetUi, 3500);
        return;
      }

      showStatus('Ringing civilian responder...', true);
      playRingback();

      pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

      pc.onicecandidate = (event) => {
        if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'ice-candidate',
            callId: callId,
            targetUserId: targetUserId,
            candidate: event.candidate
          }));
        }
      };

      pc.ontrack = (event) => {
        const remotePlayer = document.getElementById('remoteAudioPlayer');
        if (remotePlayer && event.streams[0]) {
          remotePlayer.srcObject = event.streams[0];
          remotePlayer.play().catch(() => {});
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          stopRingback();
          setConnectedState();
        } else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
          hangupEmergencyCall();
        }
      };

      // Create Offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'call-initiate',
          callId: callId,
          callerId: callerId,
          callerName: 'Emergency Bystander / Rescuer',
          targetUserId: targetUserId
        }));

        ws.send(JSON.stringify({
          type: 'webrtc-offer',
          callId: callId,
          callerId: callerId,
          targetUserId: targetUserId,
          sdp: offer
        }));
      }
    }

    function showStatus(text, isPulse) {
      document.getElementById('callStatusLabel').innerText = text;
      document.getElementById('callStatusDot').style.display = isPulse ? 'inline-block' : 'none';
    }

    function setConnectedState() {
      showStatus('Connected • Live Emergency Audio', true);
      document.getElementById('callTimerDisplay').style.display = 'block';
      document.getElementById('soundWaves').style.display = 'flex';
      startTimer();
    }

    function startTimer() {
      clearInterval(callTimerInterval);
      secondsElapsed = 0;
      callTimerInterval = setInterval(() => {
        secondsElapsed++;
        const mins = String(Math.floor(secondsElapsed / 60)).padStart(2, '0');
        const secs = String(secondsElapsed % 60).padStart(2, '0');
        document.getElementById('callTimerDisplay').innerText = mins + ':' + secs;
      }, 1000);
    }

    function toggleMuteMic() {
      if (!localStream) return;
      const track = localStream.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        isMuted = !track.enabled;
        document.getElementById('btnMuteToggle').innerText = isMuted ? '🔇 Unmute' : '🎤 Mute';
        document.getElementById('btnMuteToggle').style.background = isMuted ? '#EF4444' : '#334155';
      }
    }

    function hangupEmergencyCall() {
      stopRingback();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'call-hangup',
          callId: callId,
          targetUserId: targetUserId
        }));
      }
      cleanupCall();
      showStatus('Call ended.', false);
      setTimeout(resetUi, 2000);
    }

    function cleanupCall() {
      clearInterval(callTimerInterval);
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
      }
      if (pc) {
        pc.close();
        pc = null;
      }
      const remotePlayer = document.getElementById('remoteAudioPlayer');
      if (remotePlayer) remotePlayer.srcObject = null;
    }

    function resetUi() {
      cleanupCall();
      document.getElementById('activeCallHud').style.display = 'none';
      document.getElementById('btnCallNow').style.display = 'flex';
      document.getElementById('callTimerDisplay').style.display = 'none';
      document.getElementById('soundWaves').style.display = 'none';
      document.getElementById('btnMuteToggle').innerText = '🎤 Mute';
      document.getElementById('btnMuteToggle').style.background = '#334155';
      isMuted = false;
    }

    function playRingback() {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        audioContext = new AudioCtx();
        ringbackOscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        ringbackOscillator.type = 'sine';
        ringbackOscillator.frequency.setValueAtTime(440, audioContext.currentTime);
        gain.gain.setValueAtTime(0.08, audioContext.currentTime);
        ringbackOscillator.connect(gain);
        gain.connect(audioContext.destination);
        ringbackOscillator.start();
      } catch (e) {}
    }

    function stopRingback() {
      try {
        if (ringbackOscillator) {
          ringbackOscillator.stop();
          ringbackOscillator.disconnect();
          ringbackOscillator = null;
        }
        if (audioContext && audioContext.state !== 'closed') {
          audioContext.close();
          audioContext = null;
        }
      } catch (e) {}
    }
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});


// ---------------------------------------------------------------------------
// PATCH /api/incidents/:id/triage — Live Voice Triage & CPR Pacing Telemetry Sync
// ---------------------------------------------------------------------------
app.patch('/api/incidents/:id/triage', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { victimCondition, cprCompressions, cprSets } = req.body as {
      victimCondition?: string;
      cprCompressions?: number;
      cprSets?: number;
    };

    // Only a reporter on this incident may push triage telemetry for it.
    const incident = await Incident.findById(id).lean();
    if (!incident) {
      res.status(404).json({ status: 'error', message: 'Incident not found.' });
      return;
    }

    const callerUid = req.user!.uid;
    const isReporter =
      incident.primaryReporterId === callerUid ||
      (incident.secondaryReporters || []).includes(callerUid);

    if (!isReporter) {
      res.status(403).json({ status: 'error', message: 'Not a reporter on this incident.' });
      return;
    }

    const updateFields: Record<string, unknown> = {};
    if (victimCondition) updateFields.victimCondition = victimCondition;
    if (typeof cprCompressions === 'number') updateFields.cprCompressions = cprCompressions;
    if (typeof cprSets === 'number') updateFields.cprSets = cprSets;

    const updated = await Incident.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true }
    );

    if (updated) {
      console.log(`📡 [Triage Sync] Incident ${id} → ${victimCondition || 'UPDATED'} (Push: ${cprCompressions || 0})`);
    }

    res.json({ status: 'success', incident: updated });
  } catch (err: unknown) {
    console.error('❌ Triage sync error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to update triage telemetry.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/incidents/:id — Single incident, scoped to its reporters
// Lets a responder follow their own incident without reading everyone else's.
// ---------------------------------------------------------------------------
app.get('/api/incidents/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const incident = await Incident.findById(req.params.id).lean();
    if (!incident) {
      res.status(404).json({ status: 'error', message: 'Incident not found.' });
      return;
    }

    const callerUid = req.user!.uid;
    const isReporter =
      incident.primaryReporterId === callerUid ||
      (incident.secondaryReporters || []).includes(callerUid);

    if (!isReporter) {
      res.status(403).json({ status: 'error', message: 'Not a reporter on this incident.' });
      return;
    }

    res.json({
      status: 'success',
      incident: {
        id: String(incident._id),
        incidentCode: `CAD-${String(incident._id).slice(-4).toUpperCase()}`,
        status: incident.status,
        victimCondition: incident.victimCondition,
        ambulanceUnitAssigned: incident.ambulanceUnitAssigned,
        icuBedReserved: incident.icuBedReserved,
        assignedHospitalId: incident.assignedHospitalId,
        assignedHospitalName: incident.assignedHospitalName,
        hash: incident.certificates.find((c) => c.reporterId === callerUid)?.hash,
        createdAt: incident.createdAt.toISOString(),
        updatedAt: incident.updatedAt.toISOString(),
      },
    });
  } catch (err: unknown) {
    console.error('❌ Incident fetch error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to fetch incident.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/hospital/incidents — Live emergencies sorted by distance from hospital
// ---------------------------------------------------------------------------
app.get('/api/hospital/incidents', requireHospital, async (req: Request, res: Response): Promise<void> => {
  try {
    const hospitalLat = parseFloat(req.query.lat as string) || 26.8924;
    const hospitalLng = parseFloat(req.query.lng as string) || 75.8150;

    // Only fetch incidents from the last 2 hours to prevent stale test data
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const rawIncidents = await Incident.find({
      status: { $in: ['REPORTED', 'AMBULANCE_DISPATCHED', 'ICU_RESERVED'] },
      createdAt: { $gte: twoHoursAgo }
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const formatted = rawIncidents.map((inc) => {
      const incLng = inc.location.coordinates[0];
      const incLat = inc.location.coordinates[1];
      const dist = getDistanceKm(hospitalLat, hospitalLng, incLat, incLng);
      const eta = Math.max(3, Math.round(dist * 2.2 + 2));
      const distText = dist < 1 ? `${Math.round(dist * 1000)} m away` : `${dist.toFixed(1)} km away`;

      let condition: string = inc.victimCondition || 'CRITICAL_UNCONSCIOUS';
      let statusMapped = 'PENDING_DISPATCH';
      if (inc.status === 'AMBULANCE_DISPATCHED') statusMapped = 'AMBULANCE_EN_ROUTE';
      if (inc.status === 'ICU_RESERVED') statusMapped = 'ICU_RESERVED';

      return {
        id: String(inc._id),
        incidentCode: `CAD-${String(inc._id).slice(-4).toUpperCase()}`,
        responderId: inc.primaryReporterId,
        lat: incLat,
        lng: incLng,
        distanceKm: dist,
        distanceText: distText,
        etaMinutes: eta,
        timestamp: inc.createdAt.toISOString(),
        victimStatus: condition,
        status: statusMapped,
        cprCompressions: inc.cprCompressions || 0,
        cprSets: inc.cprSets || 1,
        ambulanceUnitAssigned: inc.ambulanceUnitAssigned,
        // The digest the primary responder's certificate actually carries.
        // This used to be recomputed from createdAt when no hash was stored —
        // which was always — so it never matched the certificate they held.
        sha256Hash: inc.certificates.find((c) => c.reporterId === inc.primaryReporterId)?.hash,
        reporterCount: 1 + (inc.secondaryReporters?.length || 0),
        googleMapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${incLat},${incLng}`,
      };
    });

    formatted.sort((a, b) => a.distanceKm - b.distanceKm);

    res.json({ status: 'success', count: formatted.length, incidents: formatted });
  } catch (err: unknown) {
    console.error('❌ Hospital incidents error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to fetch hospital incidents.' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/hospitals/me/capacity — a desk reports its own ICU availability
// Scoped to the caller's bound hospital: a desk cannot edit another's numbers.
// ---------------------------------------------------------------------------
app.patch('/api/hospitals/me/capacity', requireHospital, async (req: Request, res: Response): Promise<void> => {
  try {
    const { icuBedsAvailable } = req.body as { icuBedsAvailable?: number };

    if (typeof icuBedsAvailable !== 'number' || !Number.isInteger(icuBedsAvailable) || icuBedsAvailable < 0) {
      res.status(400).json({ status: 'error', message: 'icuBedsAvailable must be a non-negative integer.' });
      return;
    }

    const user = await User.findOne({ firebaseUid: req.user!.uid }).lean();
    if (!user?.hospitalId) {
      res.status(409).json({ status: 'error', message: 'Account is not bound to a hospital.' });
      return;
    }

    const record = await Hospital.findOneAndUpdate(
      { hospitalId: user.hospitalId },
      {
        $set: {
          hospitalId: user.hospitalId,
          name: user.hospitalName || user.hospitalId,
          icuBedsAvailable,
          reportedBy: req.user!.email,
        },
      },
      { upsert: true, new: true, runValidators: true }
    );

    res.json({
      status: 'success',
      hospital: {
        hospitalId: record.hospitalId,
        name: record.name,
        icuBedsAvailable: record.icuBedsAvailable,
        updatedAt: record.updatedAt.toISOString(),
      },
    });
  } catch (err: unknown) {
    console.error('❌ Capacity update error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to update capacity.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/hospitals/me — the desk's own hospital record
// ---------------------------------------------------------------------------
app.get('/api/hospitals/me', requireHospital, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findOne({ firebaseUid: req.user!.uid }).lean();
    if (!user?.hospitalId) {
      res.status(409).json({ status: 'error', message: 'Account is not bound to a hospital.' });
      return;
    }
    const record = await Hospital.findOne({ hospitalId: user.hospitalId }).lean();
    res.json({
      status: 'success',
      hospital: {
        hospitalId: user.hospitalId,
        name: user.hospitalName || user.hospitalId,
        icuBedsAvailable: record?.icuBedsAvailable ?? null,
        updatedAt: record?.updatedAt?.toISOString() ?? null,
      },
    });
  } catch (err: unknown) {
    console.error('❌ Hospital fetch error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to fetch hospital.' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/incidents/:id/status — Update incident status & ambulance assignment
// ---------------------------------------------------------------------------
app.patch('/api/incidents/:id/status', requireHospital, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, ambulanceUnitAssigned, icuBedReserved } = req.body as {
      status?: string;
      ambulanceUnitAssigned?: string;
      icuBedReserved?: boolean;
    };

    const validStatuses = ['REPORTED', 'AMBULANCE_DISPATCHED', 'ICU_RESERVED', 'RESOLVED'];
    if (status && !validStatuses.includes(status)) {
      res.status(400).json({
        status: 'error',
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
      return;
    }

    const updateFields: Record<string, unknown> = {};
    if (status) updateFields.status = status;
    if (ambulanceUnitAssigned) updateFields.ambulanceUnitAssigned = ambulanceUnitAssigned;
    if (typeof icuBedReserved === 'boolean') updateFields.icuBedReserved = icuBedReserved;

    const updated = await Incident.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (!updated) {
      res.status(404).json({ status: 'error', message: 'Incident not found.' });
      return;
    }

    if (status === 'AMBULANCE_DISPATCHED') {
      const [lng, lat] = updated.location.coordinates;
      void openCorridor({
        incidentId: String(updated._id),
        from: { lat, lng },
        to: { lat: 26.8924, lng: 75.815 },
        originHospitalId: updated.assignedHospitalId,
      });
    }

    if (status === 'RESOLVED') {
      void closeCorridor(String(updated._id), 'CLEARED');
    }

    console.log(`📋  Incident ${id} updated → ${status || 'ACTION'} (${ambulanceUnitAssigned || 'No unit'})`);
    res.json({ status: 'success', incident: updated });
  } catch (err: unknown) {
    console.error('❌ Status update error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to update incident status.' });
  }
});

// ---------------------------------------------------------------------------
// Connect to MongoDB & Start Server
// ---------------------------------------------------------------------------
async function startServer(): Promise<void> {
  try {
    console.log('');
    initAuth();
    initServiceAuth();
    initTelephony();
    console.log('⏳  Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log(`✅  MongoDB connected: ${mongoose.connection.host}`);

    const httpServer = http.createServer(app);
    initVoipSignaling(httpServer);
    setLiveChannel(initLiveChannel(httpServer));

    httpServer.listen(PORT, (): void => {
      console.log('');
      console.log('╔══════════════════════════════════════════════╗');
      console.log('║   🛡️  SAMARITAN SHIELD — Backend Online      ║');
      console.log(`║   📡  Listening on http://localhost:${PORT}      ║`);
      console.log('║   🔐  SHA-256 Hashing Active                 ║');
      console.log('║   📄  PDF Generation Ready                   ║');
      console.log('║   🗄️  MongoDB Spatial Queries Active          ║');
      console.log('║   📡  CAD Dispatch Engine Ready               ║');
      console.log('║   📞  WebRTC VoIP Signaling Ready (/ws)      ║');
      console.log('╚══════════════════════════════════════════════╝');
      console.log('');
    });
  } catch (err: unknown) {
    console.error('❌  Failed to connect to MongoDB:', err);
    console.error('');
    console.error('💡  Make sure MongoDB is running:');
    console.error('    • Local: mongod --dbpath /data/db');
    console.error('    • Docker: docker run -d -p 27017:27017 mongo');
    console.error('    • Atlas: Set MONGO_URI env variable');
    console.error('');
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async (): Promise<void> => {
  console.log('\n🛑  Shutting down gracefully...');
  await mongoose.connection.close();
  console.log('✅  MongoDB connection closed.');
  process.exit(0);
});

if (require.main === module) {
  startServer();
}
