// ============================================================================
// SAMARITAN SHIELD — Authentication & Authorization Middleware
// Verifies Firebase ID tokens server-side. Identity is NEVER taken from the
// request body: a caller can claim anything, a signed token cannot.
// ============================================================================

import type { Request, Response, NextFunction } from 'express';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import User from '../models/User';

export interface AuthedUser {
  uid: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export type AuthMode = 'verified' | 'insecure-dev';

let authMode: AuthMode = 'verified';

export function getAuthMode(): AuthMode {
  return authMode;
}

/**
 * Initialise the Firebase Admin SDK.
 *
 * Credentials are read from FIREBASE_SERVICE_ACCOUNT (raw JSON or a path) or
 * from GOOGLE_APPLICATION_CREDENTIALS via applicationDefault().
 *
 * With no credentials the server refuses to start, unless a developer has
 * explicitly opted into insecure mode. There is deliberately no silent
 * fallback: an unauthenticated emergency API leaks victim coordinates and
 * responder identities.
 */
export function initAuth(): AuthMode {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  const allowInsecure = process.env.ALLOW_INSECURE_NO_AUTH === 'true';
  const isProduction = process.env.NODE_ENV === 'production';

  try {
    if (raw) {
      const serviceAccount = raw.trim().startsWith('{')
        ? JSON.parse(raw)
        : // eslint-disable-next-line @typescript-eslint/no-var-requires
          require(raw);
      initializeApp({ credential: cert(serviceAccount) });
      authMode = 'verified';
      return authMode;
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      initializeApp({ credential: applicationDefault() });
      authMode = 'verified';
      return authMode;
    }
  } catch (err) {
    console.error('❌  Firebase Admin initialisation failed:', err);
    process.exit(1);
  }

  if (allowInsecure && !isProduction) {
    authMode = 'insecure-dev';
    console.warn('');
    console.warn('╔════════════════════════════════════════════════════════════╗');
    console.warn('║  ⚠️   INSECURE DEV MODE — TOKENS ARE NOT VERIFIED           ║');
    console.warn('║                                                            ║');
    console.warn('║  Identity is read from the Authorization header without    ║');
    console.warn('║  any signature check. Anyone can impersonate anyone.       ║');
    console.warn('║  Never run this against real incident data.                ║');
    console.warn('╚════════════════════════════════════════════════════════════╝');
    console.warn('');
    return authMode;
  }

  console.error('');
  console.error('❌  Refusing to start: no Firebase credentials configured.');
  console.error('');
  console.error('    Set one of:');
  console.error('      FIREBASE_SERVICE_ACCOUNT      — service-account JSON, or a path to it');
  console.error('      GOOGLE_APPLICATION_CREDENTIALS — path to service-account JSON');
  console.error('');
  console.error('    For local development without Firebase, set:');
  console.error('      ALLOW_INSECURE_NO_AUTH=true   — dev only, never with real data');
  console.error('');
  process.exit(1);
}

function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * In insecure dev mode the bearer value is treated as `uid:email` so local
 * flows remain testable. This path is unreachable once credentials are set.
 */
function decodeInsecure(token: string): AuthedUser | null {
  const [uid, email] = token.split(':');
  if (!uid) return null;
  return { uid, email: email || `${uid}@dev.local` };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = readBearerToken(req);
  if (!token) {
    res.status(401).json({ status: 'error', message: 'Missing bearer token.' });
    return;
  }

  if (authMode === 'insecure-dev') {
    const user = decodeInsecure(token);
    if (!user) {
      res.status(401).json({ status: 'error', message: 'Invalid dev token.' });
      return;
    }
    req.user = user;
    next();
    return;
  }

  try {
    const decoded = await getAuth().verifyIdToken(token);
    req.user = { uid: decoded.uid, email: decoded.email || '' };
    next();
  } catch (_err) {
    res.status(401).json({ status: 'error', message: 'Invalid or expired token.' });
  }
}

/**
 * Requires an authenticated caller whose stored role is 'hospital'.
 *
 * The role is read from the database, never from the request: role is
 * provisioned out-of-band (see scripts/seed-hospital-staff.ts) precisely so a
 * client cannot grant itself access to the live incident feed.
 */
export async function requireHospital(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, async () => {
    try {
      const user = await User.findOne({ firebaseUid: req.user!.uid }).lean();
      if (!user || user.role !== 'hospital') {
        res.status(403).json({ status: 'error', message: 'Hospital access required.' });
        return;
      }
      next();
    } catch (err) {
      console.error('❌ Role lookup failed:', err);
      res.status(500).json({ status: 'error', message: 'Authorization check failed.' });
    }
  });
}
