// ============================================================================
// Auth middleware — token handling and rejection paths.
//
// Runs without a database: requireAuth is pure token handling. Role checks
// (requireHospital) need MongoDB and live in tests/roles.test.ts.
// ============================================================================

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import type { Server } from 'node:http';

process.env.ALLOW_INSECURE_NO_AUTH = 'true';
delete process.env.FIREBASE_SERVICE_ACCOUNT;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

import { initAuth, requireAuth, getAuthMode } from '../middleware/auth';

const PORT = 4999;
let server: Server;

function get(headers: Record<string, string>): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path: '/protected', headers }, (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let body: any = raw;
          try {
            body = JSON.parse(raw);
          } catch (_e) {
            /* leave as text */
          }
          resolve({ status: res.statusCode!, body });
        });
      })
      .on('error', reject);
  });
}

before(async () => {
  initAuth();
  const app = express();
  app.get('/protected', requireAuth, (req, res) => {
    res.json({ ok: true, uid: req.user!.uid, email: req.user!.email });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(PORT, () => resolve());
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('requireAuth', () => {
  test('rejects a request with no Authorization header', async () => {
    const res = await get({});
    assert.equal(res.status, 401);
    assert.equal(res.body.status, 'error');
  });

  test('rejects a non-Bearer scheme', async () => {
    const res = await get({ Authorization: 'Basic dXNlcjpwYXNz' });
    assert.equal(res.status, 401);
  });

  test('rejects an empty bearer value', async () => {
    const res = await get({ Authorization: 'Bearer ' });
    assert.equal(res.status, 401);
  });

  test('accepts a valid token and attaches the identity', async () => {
    const res = await get({ Authorization: 'Bearer uid123:nurse@hospital.org' });
    assert.equal(res.status, 200);
    assert.equal(res.body.uid, 'uid123');
    assert.equal(res.body.email, 'nurse@hospital.org');
  });

  test('identity comes from the token, not from any client-supplied field', async () => {
    // The caller cannot claim to be someone else: only the token is read.
    const res = await get({
      Authorization: 'Bearer realuid:real@user.org',
      'X-User-Id': 'attacker',
      'X-Role': 'hospital',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.uid, 'realuid');
  });
});

describe('initAuth', () => {
  test('reports insecure-dev only under an explicit opt-in', () => {
    assert.equal(getAuthMode(), 'insecure-dev');
  });
});
