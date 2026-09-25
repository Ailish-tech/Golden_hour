// ============================================================================
// SAMARITAN SHIELD — Traffic Control
// ============================================================================

import { Router, Request, Response } from 'express';
import TrafficSignal from '../models/TrafficSignal';
import GreenCorridor from '../models/GreenCorridor';
import { requireControlRoom } from '../middleware/auth';
import { closeCorridor, openCorridor } from '../services/corridor';

const trafficRouter = Router();
trafficRouter.use(requireControlRoom);

trafficRouter.get('/signals', async (_req: Request, res: Response): Promise<void> => {
  try {
    const signals = await TrafficSignal.find({}).lean();
    res.json({
      status: 'success',
      signals: signals.map((s) => ({
        signalId: s.signalId,
        name: s.name,
        mode: s.mode,
        currentPhase: s.currentPhase,
        lastVehicleCounts: s.lastVehicleCounts,
        adaptiveGreenSeconds: s.adaptiveGreenSeconds,
        preemption: s.preemption,
        location: { lat: s.location.coordinates[1], lng: s.location.coordinates[0] },
      })),
    });
  } catch (err) {
    console.error('❌ GET /api/traffic/signals error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

trafficRouter.get('/corridors/active', async (_req: Request, res: Response): Promise<void> => {
  try {
    const corridors = await GreenCorridor.find({ status: 'ACTIVE' }).sort({ openedAt: -1 }).lean();
    res.json({ status: 'success', corridors });
  } catch (err) {
    console.error('❌ GET /api/traffic/corridors/active error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

trafficRouter.post('/corridor', async (req: Request, res: Response): Promise<void> => {
  try {
    const { incidentId, startLat, startLng, endLat, endLng, zone, originHospitalId } = req.body as {
      incidentId?: string;
      startLat?: number;
      startLng?: number;
      endLat?: number;
      endLng?: number;
      zone?: string;
      originHospitalId?: string;
    };

    if (
      !incidentId ||
      startLat == null ||
      startLng == null ||
      endLat == null ||
      endLng == null
    ) {
      res.status(400).json({ status: 'error', message: 'Missing incidentId or routing coordinates' });
      return;
    }

    const corridor = await openCorridor({
      incidentId,
      from: { lat: Number(startLat), lng: Number(startLng) },
      to: { lat: Number(endLat), lng: Number(endLng) },
      zone,
      originHospitalId,
    });

    res.json({
      status: 'success',
      corridorId: String(corridor._id),
      degraded: Boolean(corridor.degraded),
      totalDistanceKm: corridor.totalDistanceKm,
      baselineEtaMinutes: corridor.baselineEtaMinutes,
      optimisedEtaMinutes: corridor.optimisedEtaMinutes,
      signalsAffected: corridor.signals.map((s) => s.signalId),
      signals: corridor.signals,
    });
  } catch (err) {
    console.error('❌ POST /api/traffic/corridor error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

trafficRouter.post('/corridor/:incidentId/close', async (req: Request, res: Response): Promise<void> => {
  try {
    await closeCorridor(String(req.params.incidentId), 'CLEARED');
    res.json({ status: 'success' });
  } catch (err) {
    console.error('❌ close corridor error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

export default trafficRouter;
