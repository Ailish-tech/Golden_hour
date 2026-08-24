// ============================================================================
// CORS origin policy.
//
// Expo does not hold a fixed port: when 8081 is taken it moves to 8082, 8083
// and onward. A fixed allowlist turns that into a CORS rejection which reaches
// the app as an unexplained network failure, so local development accepts any
// localhost port — and only there.
// ============================================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const CONFIGURED = ['http://localhost:8081', 'http://localhost:19006'];

/** Mirrors isAllowedOrigin in server.ts. */
function isAllowedOrigin(origin: string | undefined, mode: 'verified' | 'insecure-dev'): boolean {
  if (!origin) return true;
  if (CONFIGURED.includes(origin)) return true;
  if (mode === 'insecure-dev' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return true;
  }
  return false;
}

describe('CORS in local development', () => {
  test('accepts whichever port Expo settled on', () => {
    for (const port of [8081, 8082, 8083, 19006, 3000]) {
      assert.ok(
        isAllowedOrigin(`http://localhost:${port}`, 'insecure-dev'),
        `rejected localhost:${port}`
      );
    }
  });

  test('accepts 127.0.0.1 as well as localhost', () => {
    assert.ok(isAllowedOrigin('http://127.0.0.1:8082', 'insecure-dev'));
  });

  test('still refuses a remote origin', () => {
    for (const origin of ['http://evil.example.com', 'https://localhost.evil.com']) {
      assert.equal(isAllowedOrigin(origin, 'insecure-dev'), false, `allowed ${origin}`);
    }
  });
});

describe('CORS with verified auth', () => {
  test('the localhost widening does NOT apply', () => {
    // A deployed server must not accept an arbitrary localhost port.
    assert.equal(isAllowedOrigin('http://localhost:8082', 'verified'), false);
  });

  test('configured origins are still allowed', () => {
    assert.ok(isAllowedOrigin('http://localhost:8081', 'verified'));
  });

  test('a request with no Origin is unaffected', () => {
    // Native clients and curl send none; CORS does not apply to them.
    assert.ok(isAllowedOrigin(undefined, 'verified'));
  });
});
