// ============================================================================
// SAMARITAN SHIELD — Green corridor
//
// Route the ambulance, find every signal within 80 m of that path, and hold
// those lamps green as the unit approaches. OSRM is preferred; a straight
// line is used when routing is down so dispatch is never blocked on a map API.
// ============================================================================

import https from 'https';
import mongoose from 'mongoose';
import TrafficSignal from '../models/TrafficSignal';
import GreenCorridor, { type IGreenCorridor } from '../models/GreenCorridor';
import { getDistanceKm } from './hospitals';
import {
  incomingApproach,
  polylineLengthKm,
  projectOntoPolyline,
  toLatLng,
  type LatLng,
} from './geo';
import { broadcastToAll } from '../realtime';

export interface CorridorEndpoint {
  lat: number;
  lng: number;
}

export interface OpenCorridorInput {
  incidentId: string;
  from: CorridorEndpoint;
  to: CorridorEndpoint;
  zone?: string;
  originHospitalId?: string;
}

const SIGNAL_RADIUS_M = Number(process.env.GREEN_CORRIDOR_SIGNAL_RADIUS_M || 80);
const LEAD_SECONDS = Number(process.env.GREEN_CORRIDOR_LEAD_SECONDS || 25);
const HOLD_AFTER_SECONDS = Number(process.env.GREEN_CORRIDOR_HOLD_AFTER_SECONDS || 10);
const OSRM_BASE = process.env.OSRM_BASE_URL ?? 'https://router.project-osrm.org';

let ticker: ReturnType<typeof setInterval> | null = null;

interface OsrmRoute {
  coordinates: [number, number][];
  distanceM: number;
  durationS: number;
  degraded: boolean;
}

function httpsJson(url: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'SamaritanShield-Corridor/1.0' } }, (res) => {
      let raw = '';
      res.on('data', (chunk: Buffer) => {
        raw += chunk.toString();
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('OSRM timeout'));
    });
  });
}

export async function fetchOsrmRoute(from: CorridorEndpoint, to: CorridorEndpoint): Promise<OsrmRoute> {
  const fallback: OsrmRoute = {
    coordinates: [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ],
    distanceM: getDistanceKm(from.lat, from.lng, to.lat, to.lng) * 1000,
    durationS: (getDistanceKm(from.lat, from.lng, to.lat, to.lng) / 35) * 3600,
    degraded: true,
  };

  if (!OSRM_BASE || OSRM_BASE === 'off') {
    return fallback;
  }

  const url =
    `${OSRM_BASE.replace(/\/$/, '')}/route/v1/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?overview=full&geometries=geojson`;

  try {
    const body = (await httpsJson(url, 4000)) as {
      code?: string;
      routes?: Array<{
        distance: number;
        duration: number;
        geometry?: { coordinates?: [number, number][] };
      }>;
    };
    const route = body.routes?.[0];
    const coords = route?.geometry?.coordinates;
    if (body.code !== 'Ok' || !route || !coords || coords.length < 2) {
      return fallback;
    }
    return {
      coordinates: coords,
      distanceM: route.distance,
      durationS: route.duration,
      degraded: false,
    };
  } catch (_err) {
    return fallback;
  }
}

export async function openCorridor(input: OpenCorridorInput): Promise<IGreenCorridor> {
  const existing = await GreenCorridor.findOne({
    incidentId: input.incidentId,
    status: 'ACTIVE',
  });
  if (existing) return existing;

  const route = await fetchOsrmRoute(input.from, input.to);
  const line: LatLng[] = route.coordinates.map(toLatLng);
  const totalDistanceKm = polylineLengthKm(line);
  const baselineEtaMinutes = Math.max(1, Math.round((route.durationS / 60) * 10) / 10);

  const signals = await TrafficSignal.find({}).lean();
  const onRoute = signals
    .map((s) => {
      const proj = projectOntoPolyline(toLatLng(s.location.coordinates as [number, number]), line);
      return { signal: s, proj };
    })
    .filter((row) => row.proj.distanceKm * 1000 <= SIGNAL_RADIUS_M)
    .sort((a, b) => a.proj.alongKm - b.proj.alongKm);

  const corridorSignals = onRoute.map((row, idx) => {
    const fraction = totalDistanceKm > 0 ? row.proj.alongKm / totalDistanceKm : 0;
    const etaSeconds = Math.max(5, Math.round(route.durationS * fraction));
    return {
      signalId: row.signal.signalId,
      sequenceIndex: idx,
      distanceAlongRouteKm: Math.round(row.proj.alongKm * 1000) / 1000,
      etaSeconds,
      approach: incomingApproach(row.proj.incomingBearing),
    };
  });

  const savedSeconds = corridorSignals.reduce((sum, s) => {
    const match = onRoute.find((r) => r.signal.signalId === s.signalId);
    const green = match?.signal.adaptiveGreenSeconds ?? 30;
    return sum + 0.5 * green;
  }, 0);
  const optimisedEtaMinutes = Math.max(1, Math.round((baselineEtaMinutes - savedSeconds / 60) * 10) / 10);

  const corridor = await GreenCorridor.create({
    incidentId: input.incidentId,
    status: 'ACTIVE',
    originHospitalId: input.originHospitalId,
    routeGeometry: { type: 'LineString', coordinates: route.coordinates },
    totalDistanceKm,
    baselineEtaMinutes,
    optimisedEtaMinutes,
    signals: corridorSignals,
    openedAt: new Date(),
    degraded: route.degraded,
  });

  const now = Date.now();
  for (const s of corridorSignals) {
    const holdFrom = new Date(now + Math.max(0, s.etaSeconds - LEAD_SECONDS) * 1000);
    const holdUntil = new Date(now + (s.etaSeconds + HOLD_AFTER_SECONDS) * 1000);
    await TrafficSignal.updateOne(
      { signalId: s.signalId },
      {
        $set: {
          mode: 'PREEMPTED',
          'currentPhase.approach': s.approach,
          'currentPhase.state': 'GREEN',
          'currentPhase.endsAt': holdUntil,
          preemption: {
            corridorId: String(corridor._id),
            approach: s.approach,
            holdFrom,
            holdUntil,
          },
        },
      }
    );
    broadcastToAll('signal-state', {
      signalId: s.signalId,
      approach: s.approach,
      state: 'GREEN',
      mode: 'PREEMPTED',
      holdUntil: holdUntil.toISOString(),
    });
  }

  broadcastToAll('corridor-opened', {
    corridorId: String(corridor._id),
    incidentId: input.incidentId,
    zone: input.zone,
    degraded: route.degraded,
    totalDistanceKm,
    baselineEtaMinutes,
    optimisedEtaMinutes,
    route: route.coordinates,
    signals: corridorSignals,
  });

  ensureCorridorTicker();

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🚦  GREEN CORRIDOR OPEN${route.degraded ? ' (degraded routing)' : ''}`);
  console.log(`    Incident:  ${input.incidentId}`);
  console.log(`    Distance:  ${totalDistanceKm} km`);
  console.log(`    Signals:   ${corridorSignals.map((s) => s.signalId).join(', ') || 'none on path'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return corridor;
}

export async function closeCorridor(
  incidentId: string,
  reason: 'CLEARED' | 'EXPIRED' = 'CLEARED'
): Promise<void> {
  const corridor = await GreenCorridor.findOne({ incidentId, status: 'ACTIVE' });
  if (!corridor) return;

  corridor.status = reason;
  corridor.clearedAt = new Date();
  await corridor.save();

  const ids = corridor.signals.map((s) => s.signalId);
  await TrafficSignal.updateMany(
    { signalId: { $in: ids } },
    { $set: { mode: 'ADAPTIVE' }, $unset: { preemption: 1 } }
  );

  for (const id of ids) {
    broadcastToAll('signal-state', { signalId: id, mode: 'ADAPTIVE', state: 'RED' });
  }
  broadcastToAll('corridor-cleared', { incidentId, corridorId: String(corridor._id), reason });
}

export function ensureCorridorTicker(): void {
  if (ticker) return;
  ticker = setInterval(() => {
    void tickCorridors();
  }, 1000);
  if (typeof ticker.unref === 'function') ticker.unref();
}

async function tickCorridors(): Promise<void> {
  if (mongoose.connection.readyState !== 1) return;
  const now = new Date();
  let active;
  try {
    active = await GreenCorridor.find({ status: 'ACTIVE' });
  } catch {
    return;
  }

  try {
  for (const corridor of active) {
    const ttlMs = Math.max(2, corridor.baselineEtaMinutes) * 2 * 60 * 1000;
    if (now.getTime() - corridor.openedAt.getTime() > ttlMs) {
      await closeCorridor(corridor.incidentId, 'EXPIRED');
      continue;
    }

    for (const s of corridor.signals) {
      const holdFrom = new Date(corridor.openedAt.getTime() + Math.max(0, s.etaSeconds - LEAD_SECONDS) * 1000);
      const holdUntil = new Date(corridor.openedAt.getTime() + (s.etaSeconds + HOLD_AFTER_SECONDS) * 1000);

      if (now >= holdFrom && now <= holdUntil && !s.preemptedAt) {
        s.preemptedAt = now;
        await TrafficSignal.updateOne(
          { signalId: s.signalId },
          { $set: { mode: 'PREEMPTED', 'currentPhase.state': 'GREEN', 'currentPhase.approach': s.approach } }
        );
        broadcastToAll('corridor-progress', {
          incidentId: corridor.incidentId,
          signalId: s.signalId,
          phase: 'PREEMPTED',
        });
      }

      if (now > holdUntil && s.preemptedAt && !s.clearedAt) {
        s.clearedAt = now;
        await TrafficSignal.updateOne(
          { signalId: s.signalId },
          { $set: { mode: 'ADAPTIVE' }, $unset: { preemption: 1 } }
        );
        broadcastToAll('corridor-progress', {
          incidentId: corridor.incidentId,
          signalId: s.signalId,
          phase: 'CLEARED',
        });
      }
    }
    await corridor.save();
  }
  } catch {
    // A closed test connection or a dropped replica must not surface as an
    // unhandled rejection on the 1 Hz ticker.
  }
}
