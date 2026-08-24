// ============================================================================
// SAMARITAN SHIELD — Hospital Staff Provisioning
//
// Grants the `hospital` role to a named staff email. This is deliberately an
// operator-run script rather than an API: hospital access exposes live victim
// coordinates, so it is not something a client can request for itself.
//
//   npx ts-node scripts/seed-hospital-staff.ts \
//     --email trauma.cad@hospital.org \
//     --hospitalId HOSP-01 \
//     --hospitalName "Sawai Man Singh (SMS) Govt Trauma Hospital"
// ============================================================================

import 'dotenv/config';
import mongoose from 'mongoose';
import HospitalStaff from '../models/HospitalStaff';
import User from '../models/User';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const email = arg('email')?.trim().toLowerCase();
  const hospitalId = arg('hospitalId')?.trim();
  const hospitalName = arg('hospitalName')?.trim();

  if (!email || !hospitalId || !hospitalName) {
    console.error('Usage: seed-hospital-staff.ts --email <e> --hospitalId <id> --hospitalName <name>');
    process.exit(1);
  }

  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/samaritan-shield';
  await mongoose.connect(uri);

  await HospitalStaff.findOneAndUpdate(
    { email },
    { $set: { email, hospitalId, hospitalName, invitedBy: process.env.USER || 'operator' } },
    { upsert: true, new: true, runValidators: true }
  );

  // Promote an already-registered user immediately, so the grant does not
  // wait on their next login.
  const promoted = await User.findOneAndUpdate(
    { email },
    { $set: { role: 'hospital', hospitalId, hospitalName } },
    { new: true }
  );

  console.log(`✅  ${email} allowlisted for ${hospitalName} (${hospitalId})`);
  console.log(
    promoted
      ? '✅  Existing account promoted to hospital role.'
      : 'ℹ️   No account yet — the role applies on their first login.'
  );

  await mongoose.connection.close();
}

main().catch(async (err) => {
  console.error('❌  Seed failed:', err);
  await mongoose.connection.close();
  process.exit(1);
});
