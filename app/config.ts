// ============================================================================
// SAMARITAN SHIELD — Client Configuration
// ============================================================================

import { Platform } from 'react-native';

/**
 * Backend base URL.
 *
 * Set EXPO_PUBLIC_API_URL for device and deployed builds — a physical phone
 * cannot reach the bundler host's `localhost`, so this must point at a LAN IP
 * or a real hostname. The localhost default only serves web development.
 */
export const API_BASE: string =
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === 'web' ? 'http://localhost:3000' : '');

/**
 * ML service base URL. Camera MJPEG and JPEG snapshots come from here, not
 * from the Express API. Empty on native until EXPO_PUBLIC_ML_URL is set —
 * a phone cannot reach the laptop's localhost either.
 */
export const ML_BASE: string =
  process.env.EXPO_PUBLIC_ML_URL ||
  (Platform.OS === 'web' ? 'http://localhost:8000' : '');

/**
 * Run without Firebase, using a local stand-in identity.
 *
 * The server has a matching opt-in (ALLOW_INSECURE_NO_AUTH); with both set,
 * the whole product runs locally with no Firebase project configured. Neither
 * side verifies anything, so this is for development only.
 */
export const LOCAL_DEV_AUTH: boolean =
  process.env.EXPO_PUBLIC_ALLOW_INSECURE_NO_AUTH === 'true';

export function assertApiConfigured(): void {
  if (!API_BASE) {
    throw new Error(
      'EXPO_PUBLIC_API_URL is not set. A device build cannot reach localhost — ' +
        'point it at your machine\'s LAN address or a deployed backend.'
    );
  }
}

/**
 * The Firebase web config, as inlined at build time.
 * Kept here so callers can test for completeness without importing Firebase.
 */
export const FIREBASE_ENV = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
} as const;

export const MISSING_FIREBASE_VARS: string[] = (
  [
    ['apiKey', 'EXPO_PUBLIC_FIREBASE_API_KEY'],
    ['authDomain', 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN'],
    ['projectId', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID'],
    ['storageBucket', 'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET'],
    ['messagingSenderId', 'EXPO_PUBLIC_FIREBASE_SENDER_ID'],
    ['appId', 'EXPO_PUBLIC_FIREBASE_APP_ID'],
  ] as Array<[keyof typeof FIREBASE_ENV, string]>
)
  .filter(([key]) => !FIREBASE_ENV[key])
  .map(([, envName]) => envName);

export const HAS_FIREBASE_CONFIG: boolean = MISSING_FIREBASE_VARS.length === 0;

/**
 * How the app signs people in.
 *
 * Firebase when it is fully configured and local mode was not requested;
 * otherwise a local stand-in. Deliberately NOT a thrown error: a missing
 * setting is a configuration problem, and taking the whole app down for one —
 * SOS, dispatch and the CPR metronome included — is a worse outcome than
 * running with sign-in that announces what it is. AuthScreen shows a banner
 * whenever this resolves to 'local'.
 */
export const AUTH_MODE: 'firebase' | 'local' =
  !LOCAL_DEV_AUTH && HAS_FIREBASE_CONFIG ? 'firebase' : 'local';

/** Desk accounts seeded by the backend. Password is checked only in Firebase mode. */
export const DEMO_HOSPITAL_EMAIL = 'hospital@local.test';
export const DEMO_CONTROL_EMAIL = 'control@local.test';
export const DEMO_STAFF_PASSWORD = 'password123';
