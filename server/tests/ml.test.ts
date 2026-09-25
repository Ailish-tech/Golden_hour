import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
import supertest from 'supertest';

// Before requiring server components, set env
process.env.ML_SERVICE_TOKEN = 'test-token';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/samaritan-shield-test';
process.env.OSRM_BASE_URL = 'off';

import mlRouter from '../routes/ml';
import Camera from '../models/Camera';
import DetectionEvent from '../models/DetectionEvent';
import Incident from '../models/Incident';
import * as realtime from '../realtime';
import { initServiceAuth } from '../middleware/serviceAuth';

// Mock the realtime broadcast so we don't need a live channel
let broadcastSpy: any;

const app = express();
app.use(express.json());
app.use('/api/ml', mlRouter);

describe('ML Ingestion Endpoints', () => {
  before(async () => {
    initServiceAuth();
    broadcastSpy = test.mock.method(realtime, 'broadcastToControlRoomZone', () => {});
    await mongoose.connect(process.env.MONGO_URI as string);
  });

  beforeEach(async () => {
    await Camera.deleteMany({});
    await DetectionEvent.deleteMany({});
    await Incident.deleteMany({});
    
    // Create a camera for tests
    await Camera.create({
      cameraId: 'cam-test',
      name: 'Test Cam',
      zone: 'Zone 1',
      location: { type: 'Point', coordinates: [75, 26] },
      status: 'ONLINE',
      approach: 'N',
      source: 'MUNICIPAL'
    });
  });

  after(async () => {
    await mongoose.connection.close();
  });

  test('rejects missing service token', async () => {
    const res = await supertest(app)
      .post('/api/ml/detection')
      .send({ cameraId: 'cam-test', fusedConfidence: 0.9, stage1Score: 0.9, stage2Score: 0.9 });
    
    assert.equal(res.status, 401);
  });

  test('auto-escalates if confidence >= AUTO_ESCALATE_THRESHOLD', async () => {
    const res = await supertest(app)
      .post('/api/ml/detection')
      .set('X-Service-Token', 'test-token')
      .send({
        cameraId: 'cam-test',
        fusedConfidence: 0.9,
        stage1Score: 0.9,
        stage2Score: 0.9,
        detectedAt: new Date().toISOString()
      });
    
    assert.equal(res.status, 200);
    assert.equal(res.body.escalated, true);
    assert.ok(res.body.incidentId);

    const event = await DetectionEvent.findById(res.body.detectionId);
    assert.ok(event);
    assert.equal(event.escalated, true);
  });

  test('requires manual review if CANDIDATE_THRESHOLD <= confidence < AUTO_ESCALATE', async () => {
    const res = await supertest(app)
      .post('/api/ml/detection')
      .set('X-Service-Token', 'test-token')
      .send({
        cameraId: 'cam-test',
        fusedConfidence: 0.7,
        stage1Score: 0.7,
        stage2Score: 0.7,
        detectedAt: new Date().toISOString()
      });
    
    assert.equal(res.status, 200);
    assert.equal(res.body.escalated, false);
    assert.equal(res.body.incidentId, undefined);

    const event = await DetectionEvent.findById(res.body.detectionId);
    assert.ok(event);
    assert.equal(event.escalated, false);
  });
});
