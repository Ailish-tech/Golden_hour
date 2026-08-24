// ============================================================================
// SAMARITAN SHIELD — Local Development Session
//
// Holds the signed-in identity when the app runs without Firebase
// (EXPO_PUBLIC_ALLOW_INSECURE_NO_AUTH=true). Lives in its own module so
// api.ts and firebaseConfig.ts can both reach it without a circular import.
//
// Development only. The token this produces carries no signature, and the
// server accepts it only under its own matching opt-in.
// ============================================================================

export interface DevSession {
  uid: string;
  email: string;
}

let current: DevSession | null = null;

export function getDevSession(): DevSession | null {
  return current;
}

export function setDevSession(session: DevSession | null): void {
  current = session;
}

/**
 * A stable uid for an email address, so the same person keeps their incidents
 * across restarts. Strips everything but alphanumerics — notably ':', which
 * the server uses to split `uid:email`.
 */
export function devUidForEmail(email: string): string {
  return 'dev-' + email.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
