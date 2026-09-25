// ============================================================================
// SAMARITAN SHIELD — City Infrastructure Provisioning
//
// Seeds cameras, traffic signals, and control room staff for Jaipur.
// ============================================================================

import 'dotenv/config';
import mongoose from 'mongoose';
import Camera from '../models/Camera';
import TrafficSignal from '../models/TrafficSignal';
import ControlRoomStaff from '../models/ControlRoomStaff';
import User from '../models/User';
import { ensureFirebaseLogin } from './demoLogins';

async function main(): Promise<void> {
  const ifEmpty = process.argv.includes('--if-empty');
  const staffEmail = process.argv
    .slice(2)
    .filter((a) => a !== '--if-empty')
    .find((a) => !a.startsWith('-'))
    ?.trim()
    .toLowerCase();

  if (!staffEmail) {
    console.error('Usage: ts-node scripts/seed-city.ts [--if-empty] <staff_email>');
    process.exit(1);
  }

  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/samaritan-shield';
  const ZONE = 'Jaipur Central';
  await mongoose.connect(uri);

  const ensureControlStaff = async (): Promise<void> => {
    await ControlRoomStaff.findOneAndUpdate(
      { email: staffEmail },
      { $set: { email: staffEmail, zone: ZONE, invitedBy: process.env.USER || 'operator' } },
      { upsert: true, new: true, runValidators: true }
    );
    await User.findOneAndUpdate(
      { email: staffEmail },
      { $set: { role: 'control_room', zone: ZONE } },
      { new: true }
    );
    const firebase = await ensureFirebaseLogin(staffEmail, `${ZONE} Control Room`);
    if (firebase === 'created' || firebase === 'updated') {
      console.log(`✅  Firebase login ready for ${staffEmail}`);
    }
    console.log(`✅  ${staffEmail} allowlisted for ${ZONE} control room`);
  };

  // Cameras + signals are the city. If either collection already has rows,
  // a relaunch must not reset sources, phases or staff over live data.
  if (ifEmpty) {
    const [cameraCount, signalCount] = await Promise.all([
      Camera.countDocuments(),
      TrafficSignal.countDocuments(),
    ]);
    if (cameraCount > 0 || signalCount > 0) {
      console.log(
        `SKIPPED: city already seeded (${cameraCount} cameras, ${signalCount} signals)`
      );
      await ensureControlStaff();
      await mongoose.connection.close();
      return;
    }
  }

  // 1. Seed Traffic Signals
  const signals = [
    {
      signalId: 'JAI-SIG-001',
      name: 'Tonk Road / Gandhi Circle',
      location: { type: 'Point', coordinates: [75.8055, 26.8833] },
      approaches: ['N', 'S', 'E', 'W'],
      currentPhase: { approach: 'N', state: 'GREEN', endsAt: new Date(Date.now() + 30000) },
      mode: 'ADAPTIVE'
    },
    {
      signalId: 'JAI-SIG-002',
      name: 'Ajmer Road / 200 Ft Bypass',
      location: { type: 'Point', coordinates: [75.7483, 26.8922] },
      approaches: ['N', 'S', 'E', 'W'],
      currentPhase: { approach: 'E', state: 'GREEN', endsAt: new Date(Date.now() + 30000) },
      mode: 'ADAPTIVE'
    },
    {
      signalId: 'JAI-SIG-003',
      name: 'JLN Marg / Trauma Centre',
      location: { type: 'Point', coordinates: [75.8150, 26.8924] },
      approaches: ['N', 'S', 'E', 'W'],
      currentPhase: { approach: 'N', state: 'GREEN', endsAt: new Date(Date.now() + 30000) },
      mode: 'ADAPTIVE'
    },
    {
      signalId: 'JAI-SIG-004',
      name: 'Sikar Road / Collectorate',
      location: { type: 'Point', coordinates: [75.7925, 26.9298] },
      approaches: ['N', 'S', 'E', 'W'],
      currentPhase: { approach: 'S', state: 'GREEN', endsAt: new Date(Date.now() + 30000) },
      mode: 'ADAPTIVE'
    }
  ];

  for (const s of signals) {
    await TrafficSignal.findOneAndUpdate(
      { signalId: s.signalId },
      { $set: s },
      { upsert: true, runValidators: true }
    );
  }
  console.log(`✅  Seeded ${signals.length} Traffic Signals`);

  // 2. Seed Cameras
  // Every virtual camera points at the same downloaded clip until more footage
  // is dropped into ml/data/videos. The worker resolves a bare filename under
  // that directory, so adding test_video_2.mp4 later is a one-field change.
  const cameras = [
    {
      cameraId: 'JAI-CAM-014',
      name: 'Tonk Road / Gandhi Circle — North approach',
      zone: ZONE,
      location: { type: 'Point', coordinates: [75.8055, 26.8835] },
      source: 'test_video_1.mp4',
      approach: 'N',
      signalId: 'JAI-SIG-001',
      status: 'OFFLINE'
    },
    {
      cameraId: 'JAI-CAM-015',
      name: 'Tonk Road / Gandhi Circle — South approach',
      zone: ZONE,
      location: { type: 'Point', coordinates: [75.8055, 26.8831] },
      source: 'test_video_1.mp4',
      approach: 'S',
      signalId: 'JAI-SIG-001',
      status: 'OFFLINE'
    },
    {
      cameraId: 'JAI-CAM-020',
      name: 'Ajmer Road / 200 Ft Bypass — East approach',
      zone: ZONE,
      location: { type: 'Point', coordinates: [75.7485, 26.8922] },
      source: 'test_video_1.mp4',
      approach: 'E',
      signalId: 'JAI-SIG-002',
      status: 'OFFLINE'
    },
    {
      cameraId: 'JAI-CAM-022',
      name: 'JLN Marg / Trauma Centre — North approach',
      zone: ZONE,
      location: { type: 'Point', coordinates: [75.8150, 26.8926] },
      source: 'test_video_1.mp4',
      approach: 'N',
      signalId: 'JAI-SIG-003',
      status: 'OFFLINE'
    },
    {
      cameraId: 'JAI-CAM-030',
      name: 'MI Road / Panch Batti — West approach',
      zone: ZONE,
      location: { type: 'Point', coordinates: [75.8066, 26.9152] },
      source: 'test_video_1.mp4',
      approach: 'W',
      status: 'OFFLINE'
    },
    {
      cameraId: 'JAI-CAM-035',
      name: 'Ring Road / Sitapura — South approach',
      zone: ZONE,
      location: { type: 'Point', coordinates: [75.8340, 26.7725] },
      source: 'test_video_1.mp4',
      approach: 'S',
      status: 'OFFLINE'
    }
  ];

  for (const c of cameras) {
    await Camera.findOneAndUpdate(
      { cameraId: c.cameraId },
      { $set: c },
      { upsert: true, runValidators: true }
    );
  }
  console.log(`✅  Seeded ${cameras.length} Cameras`);

  // 3. Seed Control Room Staff
  await ensureControlStaff();

  await mongoose.connection.close();
}

main().catch(async (err) => {
  console.error('❌  Seed failed:', err);
  await mongoose.connection.close();
  process.exit(1);
});
