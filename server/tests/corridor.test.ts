process.env.ML_SERVICE_TOKEN = 'test-token';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/samaritan-shield-test';
process.env.OSRM_BASE_URL = 'off';
process.env.ALLOW_INSECURE_NO_AUTH = 'true';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { incomingApproach, projectOntoPolyline, type LatLng } from '../services/geo';
import { openCorridor, closeCorridor } from '../services/corridor';
import TrafficSignal from '../models/TrafficSignal';
import GreenCorridor from '../models/GreenCorridor';
import * as realtime from '../realtime';

describe('corridor geometry', () => {
  test('a point on the diagonal is ~0 m from the polyline', () => {
    const line: LatLng[] = [
      { lat: 26.89, lng: 75.79 },
      { lat: 26.91, lng: 75.81 },
    ];
    const hit = projectOntoPolyline({ lat: 26.9, lng: 75.8 }, line);
    assert.ok(hit.distanceKm * 1000 < 15);
    assert.ok(hit.alongKm > 0);
  });

  test('northbound traffic enters from the south approach', () => {
    assert.equal(incomingApproach(0), 'S');
    assert.equal(incomingApproach(90), 'W');
    assert.equal(incomingApproach(180), 'N');
    assert.equal(incomingApproach(270), 'E');
  });
});

describe('openCorridor', () => {
  test('picks signals within 80 m in increasing eta order and expires them on close', async () => {
    test.mock.method(realtime, 'broadcastToAll', () => {});
    await mongoose.connect(process.env.MONGO_URI as string);
    await TrafficSignal.deleteMany({});
    await GreenCorridor.deleteMany({});

    await TrafficSignal.create({
      signalId: 'JAI-SIG-ONPATH',
      name: 'On path',
      location: { type: 'Point', coordinates: [75.8, 26.9] },
      approaches: ['N', 'S', 'E', 'W'],
      currentPhase: { approach: 'N', state: 'RED', endsAt: new Date() },
      mode: 'ADAPTIVE',
    });
    await TrafficSignal.create({
      signalId: 'JAI-SIG-FAR',
      name: 'Far away',
      location: { type: 'Point', coordinates: [76.2, 27.2] },
      approaches: ['N', 'S', 'E', 'W'],
      currentPhase: { approach: 'N', state: 'RED', endsAt: new Date() },
      mode: 'ADAPTIVE',
    });

    const corridor = await openCorridor({
      incidentId: 'inc-corridor-1',
      from: { lat: 26.89, lng: 75.79 },
      to: { lat: 26.91, lng: 75.81 },
    });

    assert.equal(corridor.status, 'ACTIVE');
    assert.equal(corridor.degraded, true);
    assert.deepEqual(corridor.signals.map((s) => s.signalId), ['JAI-SIG-ONPATH']);
    assert.ok(corridor.signals[0].etaSeconds >= 0);
    const later = corridor.signals.slice(1);
    for (let i = 1; i < corridor.signals.length; i++) {
      assert.ok(corridor.signals[i].etaSeconds >= corridor.signals[i - 1].etaSeconds);
    }
    void later;

    const onPath = await TrafficSignal.findOne({ signalId: 'JAI-SIG-ONPATH' }).lean();
    const far = await TrafficSignal.findOne({ signalId: 'JAI-SIG-FAR' }).lean();
    assert.equal(onPath?.mode, 'PREEMPTED');
    assert.equal(far?.mode, 'ADAPTIVE');

    await closeCorridor('inc-corridor-1', 'CLEARED');
    const after = await TrafficSignal.findOne({ signalId: 'JAI-SIG-ONPATH' }).lean();
    assert.equal(after?.mode, 'ADAPTIVE');

    await mongoose.connection.close();
  });
});
