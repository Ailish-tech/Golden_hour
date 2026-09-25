import crypto from 'crypto';
import Incident, { type IIncident, type IncidentSource, type ICertificateRecord } from '../models/Incident';
import { getNearestHospitals, type HospitalInfo, type ReporterRole } from './hospitals';
import { DEDUP_RADIUS_METERS } from '../config';

export interface CreateIncidentInput {
  lat: number;
  lng: number;
  reporterId: string;
  source: IncidentSource;
  cameraId?: string;
  aiConfidence?: number;
  snapshotBase64?: string;
}

export async function createOrMergeIncident(
  input: CreateIncidentInput
): Promise<{
  incident: IIncident;
  role: ReporterRole;
  certificate?: ICertificateRecord;
  primaryHospital: HospitalInfo | null;
  backupHospitals: HospitalInfo[];
  merged: boolean;
  message: string;
}> {
  const { lat, lng, reporterId, source, cameraId, aiConfidence, snapshotBase64 } = input;

  // --- Input validation ---
  if (lat == null || lng == null || typeof lat !== 'number' || typeof lng !== 'number') {
    throw new Error('Missing or invalid required fields: lat, lng (must be numbers)');
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error('Coordinates out of range: lat [-90,90], lng [-180,180]');
  }

  // --- Server-authoritative timestamp and digest -------------------------
  // Nothing here is taken from the client: not the identity, not the clock.
  const timestamp: string = new Date().toISOString();
  let hash = '';
  
  // AI incidents don't mint a certificate for a human reporter.
  if (source === 'CITIZEN_SOS') {
    hash = crypto
      .createHash('sha256')
      .update(`${reporterId}|${lat}|${lng}|${timestamp}`)
      .digest('hex');
  }

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
      !existingIncident.secondaryReporters.includes(reporterId) &&
      source === 'CITIZEN_SOS'
    ) {
      existingIncident.secondaryReporters.push(reporterId);
    }

    // Each responder gets their own certificate record; re-pressing SOS
    // reuses the one already issued rather than minting a second digest.
    if (source === 'CITIZEN_SOS' && !existingIncident.certificates.some((c) => c.reporterId === reporterId)) {
      existingIncident.certificates.push({ reporterId, hash, issuedAt: new Date(timestamp) });
    }

    await existingIncident.save();
    incident = existingIncident;
    message =
      role === 'SECONDARY_REPORTER'
        ? 'Help is already en route. Please follow first-aid instructions.'
        : 'Your existing report is active. Continue first aid.';
  } else {
    const newIncidentPayload: any = {
      location: { type: 'Point', coordinates: [lng, lat] },
      status: 'REPORTED',
      primaryReporterId: reporterId,
      secondaryReporters: [],
      victimCondition: 'CRITICAL_UNCONSCIOUS',
      assignedHospitalId: primaryHospital?.id,
      assignedHospitalName: primaryHospital?.name,
      source,
      detectedByCameraId: cameraId,
      aiConfidence,
      snapshotBase64,
      certificates: source === 'CITIZEN_SOS' ? [{ reporterId, hash, issuedAt: new Date(timestamp) }] : [],
    };
    incident = await Incident.create(newIncidentPayload);
    role = 'PRIMARY_REPORTER';
    message = 'Emergency recorded and shared with the hospital desk. Initiating voice triage.';
  }

  const certificate = source === 'CITIZEN_SOS' ? incident.certificates.find((c) => c.reporterId === reporterId) : undefined;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🚨  SOS ${role === 'PRIMARY_REPORTER' ? 'RECORDED' : 'MERGED'}`);
  console.log(`    Incident:  ${incident._id}`);
  console.log(`    Reporter:  ${reporterId}`);
  console.log(`    Location:  ${lat}, ${lng}`);
  if (certificate) {
    console.log(`    SHA-256:   ${certificate.hash}`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return {
    incident,
    role,
    certificate,
    primaryHospital,
    backupHospitals,
    merged: !!existingIncident,
    message,
  };
}
