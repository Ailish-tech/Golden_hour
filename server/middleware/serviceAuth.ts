// ============================================================================
// SAMARITAN SHIELD — ML Service Authentication
// ============================================================================

import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

let configuredToken: string | null = null;

export function initServiceAuth(): void {
  const token = process.env.ML_SERVICE_TOKEN;
  const allowInsecure = process.env.ALLOW_INSECURE_NO_AUTH === 'true';
  const isProduction = process.env.NODE_ENV === 'production';

  if (token) {
    configuredToken = token;
    return;
  }

  if (allowInsecure && !isProduction) {
    // In secure mode we shouldn't allow insecure ML endpoints, but just in case for local dev
    // Wait, the spec says:
    // "If ML_SERVICE_TOKEN is unset the server refuses to start — same posture as initAuth() ... Reuse that pattern and its warning-box style."
  }

  console.error('');
  console.error('❌  Refusing to start: ML_SERVICE_TOKEN is not configured.');
  console.error('');
  console.error('    Set:');
  console.error('      ML_SERVICE_TOKEN      — shared secret for ML<->Node auth');
  console.error('');
  process.exit(1);
}

export function requireServiceToken(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('X-Service-Token');
  
  if (!header || !configuredToken) {
    res.status(401).json({ status: 'error', message: 'Missing or invalid service token.' });
    return;
  }

  try {
    // Both strings must be the same length for timingSafeEqual
    const a = Buffer.from(header);
    const b = Buffer.from(configuredToken);

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.status(401).json({ status: 'error', message: 'Missing or invalid service token.' });
      return;
    }

    next();
  } catch (err) {
    res.status(401).json({ status: 'error', message: 'Missing or invalid service token.' });
  }
}
