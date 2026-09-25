// ============================================================================
// SAMARITAN SHIELD — ML Ingestion Endpoints
// ============================================================================

import { Router, Request, Response } from 'express';
import express from 'express';
import Camera from '../models/Camera';
import DetectionEvent from '../models/DetectionEvent';
import TrafficSignal from '../models/TrafficSignal';
import { requireServiceToken } from '../middleware/serviceAuth';
import { createOrMergeIncident } from '../services/incidents';
import { activateEmergencyResponse } from '../services/response';
import { broadcastToControlRoomZone } from '../realtime';

const mlRouter = Router();

// Apply a 2MB limit to these endpoints only to accommodate snapshotBase64
mlRouter.use(express.json({ limit: '2mb' }));
mlRouter.use(requireServiceToken);

// Per-camera throttles, cameraId -> next allowed time (ms). Held in memory
// only: losing them on restart costs at most one duplicate incident, and
// persisting them would put a write on the hot path of an emergency.
const escalationCooldowns = new Map<string, number>();
const candidateCooldowns = new Map<string, number>();

const ESCALATION_COOLDOWN_MS = Number(process.env.ESCALATION_COOLDOWN_SECONDS || 90) * 1000;
const CANDIDATE_COOLDOWN_MS = Number(process.env.CANDIDATE_COOLDOWN_SECONDS || 20) * 1000;
const AUTO_ESCALATE_THRESHOLD = Number(process.env.AUTO_ESCALATE_THRESHOLD || 0.80);
const CANDIDATE_THRESHOLD = Number(process.env.CANDIDATE_THRESHOLD || 0.55);

// ---------------------------------------------------------------------------
// GET /api/ml/cameras
// ---------------------------------------------------------------------------
mlRouter.get('/cameras', async (req: Request, res: Response): Promise<void> => {
  try {
    const cameras = await Camera.find({ enabled: true }).lean();
    res.json({
      status: 'success',
      cameras: cameras.map(c => ({
        cameraId: c.cameraId,
        name: c.name,
        source: c.source,
        location: { lat: c.location.coordinates[1], lng: c.location.coordinates[0] },
        zone: c.zone,
        approach: c.approach,
        signalId: c.signalId,
      })),
    });
  } catch (err) {
    console.error('❌ GET /api/ml/cameras error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ml/detection
// ---------------------------------------------------------------------------
mlRouter.post('/detection', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cameraId, stage1Score, stage2Score, fusedConfidence, snapshotBase64, detectedAt } = req.body;

    const camera = await Camera.findOne({ cameraId }).lean();
    if (!camera) {
      res.status(404).json({ status: 'error', message: 'Camera not found' });
      return;
    }

    let escalated = false;
    let incidentId: string | undefined;

    const now = Date.now();

    if (fusedConfidence >= AUTO_ESCALATE_THRESHOLD) {
      // The cooldown is scoped to auto-escalation alone. One crash produces a
      // burst of high-confidence frames, and each would otherwise open its own
      // incident; a borderline sighting must never be able to silence the
      // camera for the genuine collision that follows it seconds later.
      const nextAllowed = escalationCooldowns.get(cameraId) || 0;

      if (now >= nextAllowed) {
        escalated = true;
        escalationCooldowns.set(cameraId, now + ESCALATION_COOLDOWN_MS);

        const { incident, primaryHospital } = await createOrMergeIncident({
          lat: camera.location.coordinates[1],
          lng: camera.location.coordinates[0],
          reporterId: `cctv:${cameraId}`,
          source: 'CCTV_AI',
          cameraId,
          aiConfidence: fusedConfidence,
          snapshotBase64,
        });

        incidentId = String(incident._id);

        void activateEmergencyResponse({
          incident,
          hospital: primaryHospital,
          zone: camera.zone,
          source: 'CCTV_AI',
          confidence: fusedConfidence,
        });
      }
    }

    // Persisted before any broadcast: the operator's CONFIRM button posts to
    // /api/control/detections/:id/escalate, so a candidate that reaches the
    // dashboard without its own id is a candidate nobody can act on.
    const event = await DetectionEvent.create({
      cameraId,
      kind: 'ACCIDENT',
      stage1Score,
      stage2Score,
      fusedConfidence,
      escalated,
      incidentId,
      snapshotBase64,
      detectedAt: new Date(detectedAt),
    });

    if (escalated) {
      broadcastToControlRoomZone(camera.zone, 'incident-created', {
        detectionId: String(event._id),
        incidentId,
        cameraId,
        cameraName: camera.name,
        fusedConfidence,
        stage1Score,
        stage2Score,
        snapshotBase64,
        location: { lat: camera.location.coordinates[1], lng: camera.location.coordinates[0] },
        detectedAt,
      });
    } else if (fusedConfidence >= CANDIDATE_THRESHOLD) {
      // Human-confirmation band. Throttled separately so a flapping detector
      // cannot flood the operator's queue, without touching the escalation
      // cooldown above.
      const nextAllowed = candidateCooldowns.get(cameraId) || 0;

      if (now >= nextAllowed) {
        candidateCooldowns.set(cameraId, now + CANDIDATE_COOLDOWN_MS);

        broadcastToControlRoomZone(camera.zone, 'detection-candidate', {
          detectionId: String(event._id),
          cameraId,
          cameraName: camera.name,
          fusedConfidence,
          stage1Score,
          stage2Score,
          snapshotBase64,
          location: { lat: camera.location.coordinates[1], lng: camera.location.coordinates[0] },
          detectedAt,
        });
      }
    }

    res.json({
      status: 'success',
      escalated,
      incidentId,
      detectionId: String(event._id),
    });
  } catch (err) {
    console.error('❌ POST /api/ml/detection error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ml/heartbeat
// ---------------------------------------------------------------------------
mlRouter.post('/heartbeat', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cameraId, status, fps } = req.body;
    await Camera.findOneAndUpdate(
      { cameraId },
      { $set: { status, lastFrameAt: new Date() } }
    );
    res.json({ status: 'success' });
  } catch (err) {
    console.error('❌ POST /api/ml/heartbeat error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ml/traffic
// ---------------------------------------------------------------------------
mlRouter.post('/traffic', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cameraId, total } = req.body as { cameraId?: string; total?: number };
    if (!cameraId) {
      res.status(400).json({ status: 'error', message: 'cameraId is required' });
      return;
    }

    const camera = await Camera.findOne({ cameraId }).lean();
    if (!camera) {
      res.status(404).json({ status: 'error', message: 'Camera not found' });
      return;
    }

    // Same formula as the reference green_time_signal.py, then clamped so a
    // 50-vehicle queue cannot starve the cross street for two minutes.
    const vehicleCount = Number.isFinite(Number(total)) ? Math.max(0, Number(total)) : 0;
    const adaptiveGreenSeconds = Math.min(90, Math.max(15, 30 + vehicleCount * 2));

    if (camera.signalId) {
      const signal = await TrafficSignal.findOne({ signalId: camera.signalId });
      if (signal && signal.mode !== 'PREEMPTED') {
        const approach = camera.approach;
        if (approach === 'N' || approach === 'S' || approach === 'E' || approach === 'W') {
          signal.lastVehicleCounts[approach] = vehicleCount;
        }
        signal.adaptiveGreenSeconds = adaptiveGreenSeconds;
        await signal.save();
      }
    }

    res.json({ status: 'success', adaptiveGreenSeconds });
  } catch (err) {
    console.error('❌ POST /api/ml/traffic error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

export default mlRouter;
