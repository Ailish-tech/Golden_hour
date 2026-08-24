// ============================================================================
// SAMARITAN SHIELD — Firebase Auth Service
//
// Authentication is real or it fails. There is no offline/demo fallback:
// a synthetic session would let an unauthenticated caller reach live incident
// data, and would report success for a login that did not happen.
//
// Role is never chosen by the client. The backend derives it from the
// hospital-staff allowlist and returns it from /api/auth/sync.
// ============================================================================

import { Platform } from 'react-native';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  type UserCredential,
} from 'firebase/auth';
import { authedJson } from './api';

export type UserRole = 'citizen' | 'hospital';

export interface AppUserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  hospitalId?: string;
  hospitalName?: string;
  lat?: number;
  lng?: number;
}

// ---------------------------------------------------------------------------
// Firebase Configuration
//
// Required from the environment. There is deliberately no built-in default:
// a fallback project silently authenticates against someone else's Firebase,
// and because the Admin SDK checks an ID token's audience against its own
// project, the failure surfaces server-side as "incorrect audience" — which
// reads like a broken token rather than a misconfigured app.
//
// These are public project identifiers, not secrets; access is governed by
// Firebase Auth and your security rules.
// ---------------------------------------------------------------------------
const REQUIRED_FIREBASE_ENV = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
} as const;

const ENV_VAR_NAMES: Record<keyof typeof REQUIRED_FIREBASE_ENV, string> = {
  apiKey: 'EXPO_PUBLIC_FIREBASE_API_KEY',
  authDomain: 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  projectId: 'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  storageBucket: 'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'EXPO_PUBLIC_FIREBASE_SENDER_ID',
  appId: 'EXPO_PUBLIC_FIREBASE_APP_ID',
};

const missing = (Object.keys(REQUIRED_FIREBASE_ENV) as Array<keyof typeof REQUIRED_FIREBASE_ENV>)
  .filter((k) => !REQUIRED_FIREBASE_ENV[k])
  .map((k) => ENV_VAR_NAMES[k]);

if (missing.length > 0) {
  throw new Error(
    `Firebase is not configured. Missing in app/.env:\n  ${missing.join('\n  ')}\n\n` +
      'Copy these from the Firebase console: Project settings -> General -> Your apps -> Web app -> SDK setup and configuration.\n' +
      "The project you choose must be the SAME one your backend's service-account key belongs to."
  );
}

const firebaseConfig = REQUIRED_FIREBASE_ENV as Record<keyof typeof REQUIRED_FIREBASE_ENV, string>;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// ---------------------------------------------------------------------------
// Error mapping — by code, not by message substring
// ---------------------------------------------------------------------------
function describeAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid email or password.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Try again later.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Please sign in.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/invalid-email':
      return 'Invalid email address format.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google Sign-In was cancelled.';
    case 'auth/network-request-failed':
      return 'Cannot reach the authentication service. Check your connection.';
    default:
      return (err as { message?: string })?.message || 'Authentication failed.';
  }
}

// ---------------------------------------------------------------------------
// Backend Sync — the server decides role, hospital binding and display name
// ---------------------------------------------------------------------------
interface SyncResponse {
  status: string;
  user: {
    firebaseUid: string;
    email: string;
    displayName: string;
    role: UserRole;
    hospitalId?: string;
    hospitalName?: string;
  };
}

export async function syncUserToBackend(
  coords?: { lat: number; lng: number },
  displayNameHint?: string
): Promise<AppUserProfile> {
  const data = await authedJson<SyncResponse>('/api/auth/sync', {
    method: 'POST',
    body: JSON.stringify({
      displayName: displayNameHint,
      lat: coords?.lat,
      lng: coords?.lng,
    }),
  });

  return {
    uid: data.user.firebaseUid,
    email: data.user.email,
    displayName: data.user.displayName,
    role: data.user.role,
    hospitalId: data.user.hospitalId,
    hospitalName: data.user.hospitalName,
    lat: coords?.lat,
    lng: coords?.lng,
  };
}

// ---------------------------------------------------------------------------
// Email / password
// ---------------------------------------------------------------------------
async function completeSignIn(
  credential: UserCredential,
  coords?: { lat: number; lng: number }
): Promise<AppUserProfile> {
  const hint = credential.user.displayName || undefined;
  return syncUserToBackend(coords, hint);
}

export async function loginWithEmail(
  email: string,
  pass: string,
  coords?: { lat: number; lng: number }
): Promise<AppUserProfile> {
  try {
    const credential = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), pass);
    return await completeSignIn(credential, coords);
  } catch (err) {
    throw new Error(describeAuthError(err));
  }
}

export async function registerWithEmail(
  email: string,
  pass: string,
  coords?: { lat: number; lng: number }
): Promise<AppUserProfile> {
  try {
    const credential = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), pass);
    return await completeSignIn(credential, coords);
  } catch (err) {
    throw new Error(describeAuthError(err));
  }
}

// ---------------------------------------------------------------------------
// Google Sign-In (web)
// ---------------------------------------------------------------------------
export async function loginWithGoogle(
  coords?: { lat: number; lng: number }
): Promise<AppUserProfile> {
  if (Platform.OS !== 'web') {
    throw new Error('Google Sign-In is only supported on web in this configuration.');
  }
  try {
    const credential = await signInWithPopup(auth, new GoogleAuthProvider());
    return await completeSignIn(credential, coords);
  } catch (err) {
    throw new Error(describeAuthError(err));
  }
}

export async function logoutUser(): Promise<void> {
  try {
    await signOut(auth);
  } catch (e) {
    console.warn('Logout failed', e);
  }
}
