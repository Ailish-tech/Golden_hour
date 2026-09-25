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
  type Auth,
} from 'firebase/auth';
import { authedJson } from './api';
import { AUTH_MODE, FIREBASE_ENV, MISSING_FIREBASE_VARS } from './config';
import { setDevSession, devUidForEmail } from './session';

export type UserRole = 'citizen' | 'hospital' | 'control_room';

export interface AppUserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  hospitalId?: string;
  hospitalName?: string;
  zone?: string;
  lat?: number;
  lng?: number;
}

// ---------------------------------------------------------------------------
// Firebase Configuration
//
// Initialised only when AUTH_MODE resolves to 'firebase'. A missing setting no
// longer throws at module scope: that took the entire app down — SOS, dispatch
// and the CPR metronome with it — for a configuration problem, and a bundler
// serving a cached build made it look like the setting had been ignored.
//
// The fallback is not silent. AuthScreen shows a banner whenever sign-in is
// the local stand-in, so it cannot be mistaken for real authentication.
// ---------------------------------------------------------------------------
let auth: Auth | null = null;

if (AUTH_MODE === 'firebase') {
  auth = getAuth(initializeApp(FIREBASE_ENV as Record<string, string>));
} else if (MISSING_FIREBASE_VARS.length > 0) {
  console.warn(
    '[Auth] Firebase is not configured — signing in locally instead. Missing: ' +
      MISSING_FIREBASE_VARS.join(', ')
  );
}

const LOCAL_DEV_AUTH = AUTH_MODE === 'local';

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
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled for the Firebase project. Enable Email/Password and Google in Firebase Authentication → Sign-in method.';
    case 'auth/unauthorized-domain':
      return 'This site is not an authorized domain for the Firebase project.';
    case 'auth/popup-blocked':
      return 'The browser blocked the Google Sign-In popup. Allow popups and try again.';
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
    zone?: string;
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
    zone: data.user.zone,
    lat: coords?.lat,
    lng: coords?.lng,
  };
}

// ---------------------------------------------------------------------------
// Email / password
// ---------------------------------------------------------------------------

/** The Firebase instance, or a clear error if the app is in local dev mode. */
function requireAuth(): Auth {
  if (!auth) {
    throw new Error(
      'Firebase is not initialised because the app is running in local development mode.'
    );
  }
  return auth;
}

async function completeSignIn(
  credential: UserCredential,
  coords?: { lat: number; lng: number }
): Promise<AppUserProfile> {
  const hint = credential.user.displayName || undefined;
  return syncUserToBackend(coords, hint);
}

/**
 * Local development sign-in. No password check and no identity verification —
 * it records who you say you are and lets the backend (which has its own
 * matching opt-in) take it at face value.
 *
 * Role is still resolved server-side from the hospital-staff allowlist, so
 * hospital access cannot be claimed here any more than it can in production.
 */
async function devSignIn(
  email: string,
  coords?: { lat: number; lng: number }
): Promise<AppUserProfile> {
  const normalized = email.trim().toLowerCase();
  setDevSession({ uid: devUidForEmail(normalized), email: normalized });
  try {
    return await syncUserToBackend(coords);
  } catch (err) {
    setDevSession(null); // don't leave a half-signed-in session behind
    throw err;
  }
}

export async function loginWithEmail(
  email: string,
  pass: string,
  coords?: { lat: number; lng: number }
): Promise<AppUserProfile> {
  if (LOCAL_DEV_AUTH) return devSignIn(email, coords);
  try {
    const credential = await signInWithEmailAndPassword(requireAuth(), email.trim().toLowerCase(), pass);
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
  if (LOCAL_DEV_AUTH) return devSignIn(email, coords);
  try {
    const credential = await createUserWithEmailAndPassword(requireAuth(), email.trim().toLowerCase(), pass);
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
  if (LOCAL_DEV_AUTH) {
    throw new Error(
      'Google Sign-In needs a Firebase project. This app is running in local development mode — sign in with any email and password instead.'
    );
  }
  if (Platform.OS !== 'web') {
    throw new Error('Google Sign-In is only supported on web in this configuration.');
  }
  try {
    const credential = await signInWithPopup(requireAuth(), new GoogleAuthProvider());
    return await completeSignIn(credential, coords);
  } catch (err) {
    throw new Error(describeAuthError(err));
  }
}

export async function logoutUser(): Promise<void> {
  if (LOCAL_DEV_AUTH) {
    setDevSession(null);
    return;
  }
  try {
    if (auth) await signOut(auth);
  } catch (e) {
    console.warn('Logout failed', e);
  }
}
