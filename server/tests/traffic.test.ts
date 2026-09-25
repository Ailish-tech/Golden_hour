import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
import supertest from 'supertest';

// Before requiring server components, set env
process.env.ML_SERVICE_TOKEN = 'test-token';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/samaritan-shield-test';
process.env.ALLOW_INSECURE_NO_AUTH = 'true';
process.env.OSRM_BASE_URL = 'off';

import trafficRouter from '../routes/traffic';
import TrafficSignal from '../models/TrafficSignal';
import GreenCorridor from '../models/GreenCorridor';
import User from '../models/User';
import * as realtime from '../realtime';
import { initAuth } from '../middleware/auth';

const app = express();
app.use(express.json());
app.use('/api/traffic', trafficRouter);

describe('Traffic Control Endpoints', () => {
  before(async () => {
    initAuth();
    test.mock.method(realtime, 'broadcastToControlRoomZone', () => {});
    test.mock.method(realtime, 'broadcastToAll', () => {});
    await mongoose.connect(process.env.MONGO_URI as string);
  });

  beforeEach(async () => {
    await TrafficSignal.deleteMany({});
    await GreenCorridor.deleteMany({});
    await User.deleteMany({});
    
    // Create a control room user
    await User.create({
      firebaseUid: 'cr-user',
      email: 'cr@test.local',
      role: 'control_room',
      zone: 'Jaipur Central',
      pushToken: null,
      lastLocation: {
        type: 'Point',
        coordinates: [75, 26]
      }
    });
    
    // Create a signal for tests
    await TrafficSignal.create({
      signalId: 'JAI-SIG-TEST',
      name: 'Test Signal',
      location: { type: 'Point', coordinates: [75.8, 26.9] },
      approaches: ['N', 'S', 'E', 'W'],
      currentPhase: { approach: 'N', state: 'GREEN', endsAt: new Date(Date.now() + 30000) },
      mode: 'ADAPTIVE'
    });
  });

  after(async () => {
    await mongoose.connection.close();
  });

  test('POST /api/traffic/corridor creates a corridor and preempts signals', async () => {
    const res = await supertest(app)
      .post('/api/traffic/corridor')
      .set('Authorization', 'Bearer cr-user:cr@test.local')
      .send({
        incidentId: 'inc-123',
        ambulanceUnit: 'AMB-01',
        startLat: 26.89,
        startLng: 75.79,
        endLat: 26.91,
        endLng: 75.81,
        zone: 'Jaipur Central',
      });
    
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'success');
    assert.ok(res.body.corridorId);
    assert.equal(res.body.signalsAffected.length, 1);
    assert.equal(res.body.signalsAffected[0], 'JAI-SIG-TEST');

    const signal = await TrafficSignal.findOne({ signalId: 'JAI-SIG-TEST' }).lean();
    assert.ok(signal);
    assert.ok(signal.preemption);
    assert.ok(['N', 'S', 'E', 'W'].includes(signal.preemption?.approach || ''));
    assert.equal(signal.preemption?.corridorId, res.body.corridorId);
    assert.equal(signal.mode, 'PREEMPTED');

    const corridor = await GreenCorridor.findById(res.body.corridorId);
    assert.ok(corridor);
    assert.equal(corridor.status, 'ACTIVE');
  });
});
