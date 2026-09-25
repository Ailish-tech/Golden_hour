import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createOrMergeIncident } from '../services/incidents';
import Incident from '../models/Incident';
import crypto from 'crypto';

describe('createOrMergeIncident', () => {
  before(async () => {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/samaritan-shield-test');
  });

  beforeEach(async () => {
    await Incident.deleteMany({});
  });

  after(async () => {
    await mongoose.connection.close();
  });

  test('creates a new CITIZEN_SOS incident and mints a certificate', async () => {
    const res = await createOrMergeIncident({
      lat: 26.91,
      lng: 75.81,
      reporterId: 'reporter-1',
      source: 'CITIZEN_SOS',
    });

    assert.equal(res.merged, false);
    assert.equal(res.role, 'PRIMARY_REPORTER');
    assert.ok(res.certificate);
    
    const inc = await Incident.findById(res.incident._id);
    assert.ok(inc);
    assert.equal(inc.certificates.length, 1);
    assert.equal(inc.certificates[0].hash, res.certificate.hash);
  });

  test('merges a secondary CITIZEN_SOS incident and mints a second certificate', async () => {
    const res1 = await createOrMergeIncident({
      lat: 26.91,
      lng: 75.81,
      reporterId: 'reporter-1',
      source: 'CITIZEN_SOS',
    });

    const res2 = await createOrMergeIncident({
      lat: 26.9101,
      lng: 75.8101, // Very close
      reporterId: 'reporter-2',
      source: 'CITIZEN_SOS',
    });

    assert.equal(res2.merged, true);
    assert.equal(res2.role, 'SECONDARY_REPORTER');
    assert.ok(res2.certificate);
    assert.notEqual(res2.certificate.hash, res1.certificate?.hash);

    const inc = await Incident.findById(res2.incident._id);
    assert.equal(inc!.certificates.length, 2);
  });

  test('creates an AI incident with no certificate', async () => {
    const res = await createOrMergeIncident({
      lat: 26.91,
      lng: 75.81,
      reporterId: 'cctv:cam-1',
      source: 'CCTV_AI',
      cameraId: 'cam-1',
      aiConfidence: 0.9,
    });

    assert.equal(res.merged, false);
    assert.equal(res.certificate, undefined);
    assert.equal(res.incident.certificates.length, 0);
    assert.equal(res.incident.detectedByCameraId, 'cam-1');
  });

  test('merges an AI incident but does not mint a certificate for it', async () => {
    // First, citizen reports
    await createOrMergeIncident({
      lat: 26.91,
      lng: 75.81,
      reporterId: 'reporter-1',
      source: 'CITIZEN_SOS',
    });

    // Then AI detects nearby
    const resAI = await createOrMergeIncident({
      lat: 26.91,
      lng: 75.81,
      reporterId: 'cctv:cam-1',
      source: 'CCTV_AI',
      cameraId: 'cam-1',
      aiConfidence: 0.85,
    });

    assert.equal(resAI.merged, true);
    assert.equal(resAI.certificate, undefined);
    
    const inc = await Incident.findById(resAI.incident._id);
    assert.equal(inc!.certificates.length, 1); // Still just the citizen's
  });
});
