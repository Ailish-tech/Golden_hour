// ============================================================================
// SAMARITAN SHIELD — Control Room Endpoints
// ============================================================================

import { Router, Request, Response } from 'express';
import DetectionEvent from '../models/DetectionEvent';
import Camera from '../models/Camera';
import { requireControlRoom } from '../middleware/auth';
import { createOrMergeIncident } from '../services/incidents';
import { activateEmergencyResponse } from '../services/response';
import { broadcastToControlRoomZone } from '../realtime';

const controlRouter = Router();
controlRouter.use(requireControlRoom);

// ---------------------------------------------------------------------------
// GET /api/control/cameras
// ---------------------------------------------------------------------------
controlRouter.get('/cameras', async (_req: Request, res: Response): Promise<void> => {
  try {
    const cameras = await Camera.find({}).lean();
    res.json({
      status: 'success',
      cameras: cameras.map((c) => ({
        cameraId: c.cameraId,
        name: c.name,
        zone: c.zone,
        source: c.source,
        status: c.status,
        approach: c.approach,
        signalId: c.signalId,
        enabled: c.enabled,
        lastFrameAt: c.lastFrameAt,
        location: { lat: c.location.coordinates[1], lng: c.location.coordinates[0] },
      })),
    });
  } catch (err) {
    console.error('❌ GET /api/control/cameras error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/control/detections
// ---------------------------------------------------------------------------
controlRouter.get('/detections', async (_req: Request, res: Response): Promise<void> => {
  try {
    const events = await DetectionEvent.find({ kind: 'ACCIDENT' })
      .sort({ detectedAt: -1 })
      .limit(40)
      .lean();

    res.json({
      status: 'success',
      detections: events.map((e) => ({
        detectionId: String(e._id),
        cameraId: e.cameraId,
        fusedConfidence: e.fusedConfidence,
        stage1Score: e.stage1Score,
        stage2Score: e.stage2Score ?? null,
        escalated: e.escalated,
        incidentId: e.incidentId,
        snapshotBase64: e.snapshotBase64,
        detectedAt: e.detectedAt,
      })),
    });
  } catch (err) {
    console.error('❌ GET /api/control/detections error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/control/detections/:id/escalate
// ---------------------------------------------------------------------------
controlRouter.post('/detections/:id/escalate', async (req: Request, res: Response): Promise<void> => {
  try {
    const event = await DetectionEvent.findById(req.params.id);
    if (!event) {
      res.status(404).json({ status: 'error', message: 'Detection not found' });
      return;
    }

    if (event.escalated) {
      res.status(400).json({ status: 'error', message: 'Detection already escalated' });
      return;
    }

    const camera = await Camera.findOne({ cameraId: event.cameraId }).lean();
    if (!camera) {
      res.status(404).json({ status: 'error', message: 'Camera not found' });
      return;
    }

    const { incident, primaryHospital } = await createOrMergeIncident({
      lat: camera.location.coordinates[1],
      lng: camera.location.coordinates[0],
      reporterId: `cctv:${event.cameraId}`,
      source: 'CCTV_AI',
      cameraId: event.cameraId,
      aiConfidence: event.fusedConfidence,
      snapshotBase64: event.snapshotBase64,
    });

    event.escalated = true;
    event.incidentId = String(incident._id);
    await event.save();

    void activateEmergencyResponse({
      incident,
      hospital: primaryHospital,
      zone: camera.zone,
      source: 'CCTV_AI',
      confidence: event.fusedConfidence,
    });

    broadcastToControlRoomZone(camera.zone, 'incident-created', {
      incidentId: event.incidentId,
      cameraId: event.cameraId,
    });

    res.json({ status: 'success', incidentId: event.incidentId });
  } catch (err) {
    console.error('❌ POST /api/control/detections/:id/escalate error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/control/detections/:id/dismiss
// ---------------------------------------------------------------------------
controlRouter.post('/detections/:id/dismiss', async (req: Request, res: Response): Promise<void> => {
  try {
    const event = await DetectionEvent.findById(req.params.id);
    if (!event) {
      res.status(404).json({ status: 'error', message: 'Detection not found' });
      return;
    }

    // You could flag it as dismissed in the DB, but just acknowledging is enough
    res.json({ status: 'success' });
  } catch (err) {
    console.error('❌ POST /api/control/detections/:id/dismiss error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

export default controlRouter;
