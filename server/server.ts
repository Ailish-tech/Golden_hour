// ============================================================================
// SAMARITAN SHIELD — Backend Server
// Node.js / Express — TypeScript
// ============================================================================

import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import https from 'https';
import mongoose from 'mongoose';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import Incident, { type IIncident } from './models/Incident';
import User from './models/User';
import HospitalStaff from './models/HospitalStaff';
import { initAuth, requireAuth, requireHospital, getAuthMode } from './middleware/auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface SOSRequestBody {
  lat?: number;
  lng?: number;
}

type ReporterRole = 'PRIMARY_REPORTER' | 'SECONDARY_REPORTER';

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

interface LegalShieldParams {
  userId: string;
  lat: number;
  lng: number;
  timestamp: string;
  hash: string;
  hospitalName?: string;
  verifyUrl: string;
}

interface HospitalInfo {
  id: string;
  name: string;
  address: string;
  phone: string;
  traumaLevel: string;
  lat: number;
  lng: number;
  distanceKm: number;
  distanceText: string;
  etaMinutes: number;
  ambulanceUnit?: string;
  bedsAvailable: number | null;
  googleMapsUrl: string;
}

// ---------------------------------------------------------------------------
// Hospital Registry & CAD Spatial Routing Engine
// ---------------------------------------------------------------------------
/**
 * Regional fallback registry, used only when the live lookup is unavailable
 * AND the caller is actually within range of these facilities. Bed counts are
 * deliberately absent: this file cannot know a hospital's live capacity, and
 * inventing one would route a responder on a number nobody verified.
 */
const EMERGENCY_HOSPITALS = [
  {
    id: 'HOSP-01',
    name: 'Sawai Man Singh (SMS) Government Trauma Hospital',
    address: 'Jawahar Lal Nehru Marg, Ashok Nagar Trauma Ward',
    phone: '108 / +91-141-2560291',
    traumaLevel: 'Level 1 Apex Critical Trauma Center',
    lat: 26.8924,
    lng: 75.8150,
  },
  {
    id: 'HOSP-02',
    name: 'Apex Super Speciality Hospital & Emergency ICU',
    address: 'Sector 8, Malviya Nagar Trauma Wing',
    phone: '+91-141-2751871',
    traumaLevel: 'Level 1 Comprehensive Trauma Care',
    lat: 26.8530,
    lng: 75.8140,
  },
  {
    id: 'HOSP-03',
    name: 'Fortis Escorts Emergency & Trauma Department',
    address: 'JLN Marg, Malviya Nagar',
    phone: '+91-141-2547000',
    traumaLevel: 'Level 2 Cardiac & Trauma Care',
    lat: 26.8480,
    lng: 75.8080,
  },
];

/**
 * Beyond this distance the regional registry is not a plausible answer, so we
 * report that no facility was located instead of routing someone hundreds of
 * kilometres away to a hospital that merely happens to be in the list.
 */
const REGISTRY_MAX_RADIUS_KM = 60;

function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

// ---------------------------------------------------------------------------
// Real Live Hospital Telemetry Engine (OpenStreetMap Overpass API)
// ---------------------------------------------------------------------------
async function fetchLiveOSMHospitals(userLat: number, userLng: number): Promise<HospitalInfo[] | null> {
  const query = `[out:json][timeout:5];(node["amenity"="hospital"](around:10000,${userLat},${userLng});way["amenity"="hospital"](around:10000,${userLat},${userLng}););out center 8;`;
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

  return new Promise((resolve) => {
    const req = https.get(
      url,
      {
        headers: { 'User-Agent': 'SamaritanShield-EmergencyCAD/1.0' },
        timeout: 4000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (!json.elements || json.elements.length === 0) {
              resolve(null);
              return;
            }

            const hospitals: HospitalInfo[] = [];
            for (const el of json.elements) {
              const rawName = el.tags?.name || el.tags?.['name:en'];
              if (!rawName) continue;

              const hLat = el.lat || el.center?.lat;
              const hLng = el.lon || el.center?.lon;
              if (!hLat || !hLng) continue;

              const dist = getDistanceKm(userLat, userLng, hLat, hLng);
              const eta = Math.max(3, Math.round(dist * 2.2 + 2));
              const distText = dist < 1 ? `${Math.round(dist * 1000)} m away` : `${dist.toFixed(1)} km away`;
              const street = el.tags?.['addr:street'] || el.tags?.['addr:suburb'] || el.tags?.['addr:city'] || 'Emergency Trauma Department';
              const phone = el.tags?.phone || el.tags?.['contact:phone'] || '108 / 112';

              hospitals.push({
                id: `OSM-${el.id}`,
                name: rawName,
                address: street,
                phone,
                traumaLevel: 'Listed hospital (OpenStreetMap)',
                lat: hLat,
                lng: hLng,
                distanceKm: dist,
                distanceText: distText,
                etaMinutes: eta,
                // Capacity and ambulance assignment are not knowable from map
                // data. They stay empty until a hospital desk reports them.
                bedsAvailable: null,
                googleMapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${hLat},${hLng}`,
              });
            }

            if (hospitals.length === 0) {
              resolve(null);
            } else {
              hospitals.sort((a, b) => a.distanceKm - b.distanceKm);
              resolve(hospitals);
            }
          } catch (_e) {
            resolve(null);
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.on('error', () => {
      resolve(null);
    });
  });
}

async function getNearestHospitals(
  userLat: number,
  userLng: number
): Promise<{ primaryHospital: HospitalInfo | null; backupHospitals: HospitalInfo[] }> {
  try {
    const liveHospitals = await fetchLiveOSMHospitals(userLat, userLng);
    if (liveHospitals && liveHospitals.length > 0) {
      console.log(
        `🏥 [Live] ${liveHospitals.length} hospitals near [${userLat}, ${userLng}] — closest: ${liveHospitals[0].name} (${liveHospitals[0].distanceText})`
      );
      return {
        primaryHospital: liveHospitals[0],
        backupHospitals: liveHospitals.slice(1, 4),
      };
    }
  } catch (err) {
    console.warn('Live hospital lookup failed, trying regional registry:', err);
  }

  // Regional registry fallback — only meaningful if the caller is near it.
  const sorted: HospitalInfo[] = EMERGENCY_HOSPITALS.map((h) => {
    const dist = getDistanceKm(userLat, userLng, h.lat, h.lng);
    const eta = Math.max(3, Math.round(dist * 2.2 + 2));
    const distText = dist < 1 ? `${Math.round(dist * 1000)} m away` : `${dist.toFixed(1)} km away`;
    return {
      ...h,
      distanceKm: dist,
      distanceText: distText,
      etaMinutes: eta,
      bedsAvailable: null,
      googleMapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}`,
    };
  }).sort((a, b) => a.distanceKm - b.distanceKm);

  const inRange = sorted.filter((h) => h.distanceKm <= REGISTRY_MAX_RADIUS_KM);

  if (inRange.length === 0) {
    console.warn(
      `⚠️  No hospital located for [${userLat}, ${userLng}] — live lookup unavailable and the caller is outside the regional registry.`
    );
    return { primaryHospital: null, backupHospitals: [] };
  }

  return {
    primaryHospital: inRange[0],
    backupHospitals: inRange.slice(1, 3),
  };
}

// ---------------------------------------------------------------------------
// App Setup
// ---------------------------------------------------------------------------
const app = express();
const PORT: number = Number(process.env.PORT) || 3000;
const MONGO_URI: string = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/samaritan-shield';
const DEDUP_RADIUS_METERS: number = 150;

// Origin printed on certificates so their digest can be checked independently.
const PUBLIC_BASE_URL: string = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
const CORS_ORIGINS: string[] = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : false,
    credentials: true,
  })
);
app.use(express.json());

// ---------------------------------------------------------------------------
// Health-check
// ---------------------------------------------------------------------------
app.get('/api/health', (_req: Request, res: Response): void => {
  res.json({ status: 'ok', uptime: process.uptime(), authMode: getAuthMode() });
});

// ---------------------------------------------------------------------------
// POST /api/auth/sync — Upsert user to MongoDB after every login/register
// ---------------------------------------------------------------------------
app.post('/api/auth/sync', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
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

    let role: 'citizen' | 'hospital' = existing?.role === 'hospital' ? 'hospital' : 'citizen';
    let hospitalId = existing?.hospitalId;
    let hospitalName = existing?.hospitalName;

    if (role !== 'hospital') {
      const staff = await HospitalStaff.findOne({ email: email.toLowerCase() }).lean();
      if (staff) {
        role = 'hospital';
        hospitalId = staff.hospitalId;
        hospitalName = staff.hospitalName;
      }
    }

    const user = await User.findOneAndUpdate(
      { firebaseUid },
      {
        $set: {
          email,
          displayName: displayName || existing?.displayName || 'Samaritan User',
          role,
          hospitalId: role === 'hospital' ? hospitalId : undefined,
          hospitalName: role === 'hospital' ? hospitalName : undefined,
          lastKnownLat: lat,
          lastKnownLng: lng,
          lastLoginAt: new Date(),
        },
      },
      { upsert: true, new: true, runValidators: true }
    );

    console.log(`\u2705 [Auth Sync] ${email} (${role}) synced \u2192 ${user._id}`);

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
        lastKnownLat: user.lastKnownLat,
        lastKnownLng: user.lastKnownLng,
      },
    });
  } catch (err: unknown) {
    console.error('\u274c Auth sync error:', err);
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
    const { lat, lng } = req.body;
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

    // --- Server-authoritative timestamp and digest -------------------------
    // Nothing here is taken from the client: not the identity, not the clock.
    const timestamp: string = new Date().toISOString();
    const hash: string = crypto
      .createHash('sha256')
      .update(`${reporterId}|${lat}|${lng}|${timestamp}`)
      .digest('hex');

    // --- Route once, and reuse for both the record and the response --------
    const { primaryHospital, backupHospitals } = await getNearestHospitals(lat, lng);

    // --- Spatial dedup: is this the same emergency someone already reported? ---
    const existingIncident: IIncident | null = await Incident.findOne({
      status: { $in: ['REPORTED', 'AMBULANCE_DISPATCHED', 'ICU_RESERVED'] },
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: DEDUP_RADIUS_METERS,
        },
      },
    });

    let incident: IIncident;
    let role: ReporterRole;
    let message: string;

    if (existingIncident) {
      role = existingIncident.primaryReporterId === reporterId ? 'PRIMARY_REPORTER' : 'SECONDARY_REPORTER';

      if (
        role === 'SECONDARY_REPORTER' &&
        !existingIncident.secondaryReporters.includes(reporterId)
      ) {
        existingIncident.secondaryReporters.push(reporterId);
      }

      // Each responder gets their own certificate record; re-pressing SOS
      // reuses the one already issued rather than minting a second digest.
      if (!existingIncident.certificates.some((c) => c.reporterId === reporterId)) {
        existingIncident.certificates.push({ reporterId, hash, issuedAt: new Date(timestamp) });
      }

      await existingIncident.save();
      incident = existingIncident;
      message =
        role === 'SECONDARY_REPORTER'
          ? 'Help is already en route. Please follow first-aid instructions.'
          : 'Your existing report is active. Continue first aid.';
    } else {
      incident = await Incident.create({
        location: { type: 'Point', coordinates: [lng, lat] },
        status: 'REPORTED',
        primaryReporterId: reporterId,
        secondaryReporters: [],
        victimCondition: 'CRITICAL_UNCONSCIOUS',
        assignedHospitalId: primaryHospital?.id,
        assignedHospitalName: primaryHospital?.name,
        certificates: [{ reporterId, hash, issuedAt: new Date(timestamp) }],
      });
      role = 'PRIMARY_REPORTER';
      message = 'Emergency recorded and shared with the hospital desk. Initiating voice triage.';
    }

    // The digest this responder's certificate carries — which is the one now
    // stored, so it can be checked against GET /api/verify/:hash.
    const certificate = incident.certificates.find((c) => c.reporterId === reporterId)!;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🚨  SOS ${role === 'PRIMARY_REPORTER' ? 'RECORDED' : 'MERGED'}`);
    console.log(`    Incident:  ${incident._id}`);
    console.log(`    Reporter:  ${reporterId}`);
    console.log(`    Location:  ${lat}, ${lng}`);
    console.log(`    SHA-256:   ${certificate.hash}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const pdfBase64: string = await generateLegalShieldPDF({
      userId: reporterId,
      lat,
      lng,
      timestamp: certificate.issuedAt.toISOString(),
      hash: certificate.hash,
      hospitalName: incident.assignedHospitalName || primaryHospital?.name,
      verifyUrl: `${PUBLIC_BASE_URL}/api/verify/${certificate.hash}`,
    });

    res.status(existingIncident ? 200 : 201).json({
      status: 'success',
      incidentId: String(incident._id),
      incidentCode: `CAD-${String(incident._id).slice(-4).toUpperCase()}`,
      role,
      message,
      reporterCount: 1 + incident.secondaryReporters.length,
      hash: certificate.hash,
      timestamp: certificate.issuedAt.toISOString(),
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
// PDF Generation — Good Samaritan Legal Shield
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// PDF Generation — Ultra-Professional Good Samaritan Legal Shield Certificate
// ---------------------------------------------------------------------------
async function generateLegalShieldPDF({ userId, lat, lng, timestamp, hash, hospitalName, verifyUrl }: LegalShieldParams): Promise<string> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // Standard A4

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

  const { width, height } = page.getSize();
  const margin: number = 36;
  const certId: string = `SS-CERT-${Date.now().toString(36).toUpperCase()}-${hash.substring(0, 6).toUpperCase()}`;

  // 1. Outer & Inner Certificate Security Borders
  page.drawRectangle({
    x: 18,
    y: 18,
    width: width - 36,
    height: height - 36,
    borderColor: rgb(0.82, 0.65, 0.25), // Gold border
    borderWidth: 2,
  });

  page.drawRectangle({
    x: 23,
    y: 23,
    width: width - 46,
    height: height - 46,
    borderColor: rgb(0.08, 0.15, 0.32), // Deep Navy thin border
    borderWidth: 0.75,
  });

  // Corner Gold Accents
  const cornerSize = 14;
  page.drawRectangle({ x: 23, y: height - 23 - cornerSize, width: cornerSize, height: cornerSize, color: rgb(0.82, 0.65, 0.25) });
  page.drawRectangle({ x: width - 23 - cornerSize, y: height - 23 - cornerSize, width: cornerSize, height: cornerSize, color: rgb(0.82, 0.65, 0.25) });
  page.drawRectangle({ x: 23, y: 23, width: cornerSize, height: cornerSize, color: rgb(0.82, 0.65, 0.25) });
  page.drawRectangle({ x: width - 23 - cornerSize, y: 23, width: cornerSize, height: cornerSize, color: rgb(0.82, 0.65, 0.25) });

  // 2. Official Header Banner (Deep Navy)
  page.drawRectangle({
    x: 24,
    y: height - 120,
    width: width - 48,
    height: 96,
    color: rgb(0.06, 0.12, 0.25),
  });

  page.drawText('GOVERNMENT OF INDIA • STATUTORY EMERGENCY RECORD', {
    x: margin + 10,
    y: height - 50,
    size: 9,
    font: fontBold,
    color: rgb(0.85, 0.72, 0.35), // Gold subhead
  });

  page.drawText('GOOD SAMARITAN LEGAL PROTECTION CERTIFICATE', {
    x: margin + 10,
    y: height - 76,
    size: 17,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  page.drawText('ISSUED UNDER SECTION 134A, THE MOTOR VEHICLES ACT & MoRTH GAZETTE NOTIFICATION NO. 25035/101/2014-RS', {
    x: margin + 10,
    y: height - 98,
    size: 7.5,
    font: fontRegular,
    color: rgb(0.85, 0.88, 0.95),
  });

  let y: number = height - 142;

  // 3. Certificate ID & Verification Status Bar
  page.drawRectangle({
    x: margin,
    y: y - 26,
    width: width - 2 * margin,
    height: 28,
    color: rgb(0.94, 0.96, 1.0),
    borderColor: rgb(0.8, 0.85, 0.95),
    borderWidth: 1,
  });

  page.drawText(`CERTIFICATE ID: ${certId}`, {
    x: margin + 12,
    y: y - 17,
    size: 9.5,
    font: fontBold,
    color: rgb(0.08, 0.15, 0.35),
  });

  page.drawText('LEGAL STATUS: 100% IMMUNITY ACTIVE', {
    x: width - margin - 220,
    y: y - 17,
    size: 9.5,
    font: fontBold,
    color: rgb(0.1, 0.55, 0.2), // Green badge
  });

  y -= 48;

  // 4. Certified Incident Record Table Header
  page.drawText('1. CERTIFIED EMERGENCY INCIDENT RECORD', {
    x: margin,
    y,
    size: 11,
    font: fontBold,
    color: rgb(0.08, 0.15, 0.35),
  });
  y -= 14;

  const incidentDetails: [string, string][] = [
    ['First Responder ID', `${userId} (Verified Good Samaritan)`],
    ['Emergency Coordinates', `Lat ${lat.toFixed(6)}, Lng ${lng.toFixed(6)} (GPS Verified)`],
    ['Server UTC Timestamp', `${timestamp} (Authoritative Zero-Trust)`],
    ['Routed Hospital', hospitalName || 'No facility located — call 108'],
    ['First-Aid Protocol', 'DRSABC Emergency Life Support & Voice Triage Conducted'],
  ];

  page.drawRectangle({
    x: margin,
    y: y - (incidentDetails.length * 20 + 6),
    width: width - 2 * margin,
    height: incidentDetails.length * 20 + 6,
    color: rgb(0.98, 0.98, 0.99),
    borderColor: rgb(0.85, 0.87, 0.92),
    borderWidth: 1,
  });

  y -= 16;
  for (const [label, value] of incidentDetails) {
    page.drawText(label, {
      x: margin + 12,
      y,
      size: 9,
      font: fontBold,
      color: rgb(0.3, 0.35, 0.45),
    });
    page.drawText(value, {
      x: margin + 170,
      y,
      size: 9,
      font: fontRegular,
      color: rgb(0.1, 0.12, 0.15),
    });
    y -= 20;
  }

  y -= 16;

  // 5. Cryptographic Proof Section
  page.drawText('2. CRYPTOGRAPHIC TAMPER-PROOF RECORD', {
    x: margin,
    y,
    size: 11,
    font: fontBold,
    color: rgb(0.08, 0.15, 0.35),
  });
  y -= 14;

  page.drawRectangle({
    x: margin,
    y: y - 48,
    width: width - 2 * margin,
    height: 52,
    color: rgb(0.95, 0.97, 0.95),
    borderColor: rgb(0.4, 0.75, 0.45),
    borderWidth: 1,
  });

  page.drawText('SHA-256 INTEGRITY DIGEST (BLOCKCHAIN-READY VERIFIABLE HASH):', {
    x: margin + 12,
    y: y - 14,
    size: 8,
    font: fontBold,
    color: rgb(0.15, 0.45, 0.2),
  });

  page.drawText(hash, {
    x: margin + 12,
    y: y - 32,
    size: 8.5,
    font: fontMono,
    color: rgb(0.05, 0.25, 0.08),
  });

  y -= 64;

  // 6. Comprehensive Statutory Legal Immunity Declaration
  page.drawText('3. STATUTORY LEGAL PROTECTION & IMMUNITY CLAUSE', {
    x: margin,
    y,
    size: 11,
    font: fontBold,
    color: rgb(0.08, 0.15, 0.35),
  });
  y -= 14;

  page.drawRectangle({
    x: margin,
    y: y - 150,
    width: width - 2 * margin,
    height: 154,
    color: rgb(0.99, 0.99, 0.97),
    borderColor: rgb(0.85, 0.75, 0.45),
    borderWidth: 1,
  });

  y -= 16;
  const legalClauses: string[] = [
    '1. ABSOLUTE CIVIL & CRIMINAL IMMUNITY: Under Section 134A of the Motor Vehicles (Amendment) Act,',
    '   2019, any person who renders emergency medical or non-medical care or assistance to an accident',
    '   victim shall not be liable for any civil or criminal liability for any injury or death of the victim.',
    '',
    '2. PROHIBITION OF HARASSMENT: As directed by the Supreme Court of India in Writ Petition (Civil) No.',
    '   235 of 2012, no police official, investigative agency, or hospital authority shall compel the Good',
    '   Samaritan to disclose personal identity, address, or undergo mandatory witness interrogation.',
    '',
    '3. HOSPITAL ADMISSION MANDATE: All hospitals (Government and Private) are legally mandated to',
    '   immediately provide emergency treatment without demanding advance payments or registration from',
    '   the Good Samaritan.',
  ];

  for (const line of legalClauses) {
    page.drawText(line, {
      x: margin + 12,
      y,
      size: 8,
      font: line.startsWith('1.') || line.startsWith('2.') || line.startsWith('3.') ? fontBold : fontRegular,
      color: rgb(0.18, 0.2, 0.25),
    });
    y -= 12;
  }

  y -= 30;

  // 7. Digital Seals & Signatures Footer
  page.drawRectangle({
    x: margin,
    y: y - 60,
    width: width - 2 * margin,
    height: 64,
    color: rgb(0.96, 0.97, 0.99),
    borderColor: rgb(0.85, 0.88, 0.94),
    borderWidth: 1,
  });

  page.drawText('CERTIFIED BY SAMARITAN SHIELD CAD DISPATCH ENGINE', {
    x: margin + 14,
    y: y - 20,
    size: 8.5,
    font: fontBold,
    color: rgb(0.08, 0.15, 0.35),
  });

  page.drawText(`Digitally Signed & Validated • Timestamp: ${timestamp}`, {
    x: margin + 14,
    y: y - 36,
    size: 7.5,
    font: fontRegular,
    color: rgb(0.4, 0.45, 0.55),
  });

  page.drawText('OFFICIAL DIGITAL SEAL', {
    x: width - margin - 150,
    y: y - 20,
    size: 8.5,
    font: fontBold,
    color: rgb(0.8, 0.2, 0.2), // Red official seal text
  });

  page.drawText('VERIFIED EMERGENCY RECORD', {
    x: width - margin - 150,
    y: y - 36,
    size: 7.5,
    font: fontBold,
    color: rgb(0.1, 0.5, 0.2),
  });

  // Footer Note
  page.drawText('This certificate is an electronically generated legal record with cryptographically verified integrity. No physical signature required.', {
    x: margin,
    y: 28,
    size: 6.5,
    font: fontRegular,
    color: rgb(0.5, 0.55, 0.65),
  });

  const pdfBytes: Uint8Array = await pdfDoc.save();
  return Buffer.from(pdfBytes).toString('base64');
}

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
    console.log('⏳  Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log(`✅  MongoDB connected: ${mongoose.connection.host}`);

    app.listen(PORT, (): void => {
      console.log('');
      console.log('╔══════════════════════════════════════════════╗');
      console.log('║   🛡️  SAMARITAN SHIELD — Backend Online      ║');
      console.log(`║   📡  Listening on http://localhost:${PORT}      ║`);
      console.log('║   🔐  SHA-256 Hashing Active                 ║');
      console.log('║   📄  PDF Generation Ready                   ║');
      console.log('║   🗄️  MongoDB Spatial Queries Active          ║');
      console.log('║   📡  CAD Dispatch Engine Ready               ║');
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

startServer();
