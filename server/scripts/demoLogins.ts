// ============================================================================
// Demo staff logins for hospital CAD and the control room.
//
// Local insecure mode accepts any password for these emails. Once the app
// talks to real Firebase, the same addresses must exist as Auth users or
// sign-in fails with "Invalid email or password."
// ============================================================================

import { existsSync } from 'fs';
import { initializeApp, cert, getApps, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export const DEMO_HOSPITAL_EMAIL = 'hospital@local.test';
export const DEMO_CONTROL_EMAIL = 'control@local.test';
export const DEMO_STAFF_PASSWORD = process.env.DEMO_STAFF_PASSWORD || 'password123';

function initAdminFromEnv(): boolean {
  if (getApps().length > 0) return true;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const serviceAccount = raw.trim().startsWith('{')
      ? JSON.parse(raw)
      : existsSync(raw)
        ? // eslint-disable-next-line @typescript-eslint/no-var-requires
          require(raw)
        : null;
    if (!serviceAccount) {
      console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT path is not a file — skipping Firebase demo logins.');
      return false;
    }
    initializeApp({ credential: cert(serviceAccount) });
    return true;
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp({ credential: applicationDefault() });
    return true;
  }

  return false;
}

export async function ensureFirebaseLogin(
  email: string,
  displayName: string
): Promise<'created' | 'updated' | 'skipped'> {
  if (!initAdminFromEnv()) return 'skipped';

  const auth = getAuth();
  try {
    const existing = await auth.getUserByEmail(email);
    await auth.updateUser(existing.uid, {
      password: DEMO_STAFF_PASSWORD,
      displayName,
      emailVerified: true,
      disabled: false,
    });
    return 'updated';
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code !== 'auth/user-not-found') throw err;
    await auth.createUser({
      email,
      password: DEMO_STAFF_PASSWORD,
      displayName,
      emailVerified: true,
    });
    return 'created';
  }
}

export async function ensureDemoStaffLogins(): Promise<void> {
  const rows: Array<[string, string]> = [
    [DEMO_HOSPITAL_EMAIL, 'Hospital CAD'],
    [DEMO_CONTROL_EMAIL, 'Control Room'],
  ];

  for (const [email, name] of rows) {
    const result = await ensureFirebaseLogin(email, name);
    if (result === 'skipped') {
      console.log(`ℹ️   Firebase not configured — ${email} works only in local sign-in mode.`);
      return;
    }
    console.log(`✅  Firebase ${result} ${email} (password: ${DEMO_STAFF_PASSWORD})`);
  }
}
