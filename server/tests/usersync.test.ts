// ============================================================================
// First-login upsert — the path POST /api/auth/sync uses.
//
// runValidators + upsert used to reject a new user because firebaseUid is
// required but only lived in the query filter, not in $set.
// ============================================================================

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import User from '../models/User';

process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/samaritan-shield-test';

describe('user auth sync upsert', () => {
  before(async () => {
    await mongoose.connect(process.env.MONGO_URI as string);
  });

  beforeEach(async () => {
    await User.deleteMany({ firebaseUid: { $in: ['sync-uid-1', 'sync-uid-2'] } });
  });

  after(async () => {
    await User.deleteMany({ firebaseUid: { $in: ['sync-uid-1', 'sync-uid-2'] } });
    await mongoose.connection.close();
  });

  test('creates a user on first login without a lastLocation', async () => {
    const firebaseUid = 'sync-uid-1';
    const user = await User.findOneAndUpdate(
      { firebaseUid },
      {
        $set: {
          email: 'first@example.com',
          displayName: 'First User',
          role: 'citizen',
        },
        $setOnInsert: { firebaseUid },
      },
      { upsert: true, new: true, runValidators: true }
    );

    assert.ok(user);
    assert.equal(user.firebaseUid, firebaseUid);
    assert.equal(user.email, 'first@example.com');
    assert.equal(user.role, 'citizen');
  });

  test('stores a GeoJSON point only when coordinates are provided', async () => {
    const firebaseUid = 'sync-uid-2';
    const user = await User.findOneAndUpdate(
      { firebaseUid },
      {
        $set: {
          email: 'geo@example.com',
          displayName: 'Geo User',
          role: 'citizen',
          lastKnownLat: 26.909,
          lastKnownLng: 75.7325,
          lastLocation: { type: 'Point', coordinates: [75.7325, 26.909] },
        },
        $setOnInsert: { firebaseUid },
      },
      { upsert: true, new: true, runValidators: true }
    );

    assert.ok(user);
    assert.deepEqual(user.lastLocation?.coordinates, [75.7325, 26.909]);
  });
});
