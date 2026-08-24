// ============================================================================
// Local dev auth — the app's token must be what the server already decodes.
//
// The app mints `uid:email` (app/session.ts + app/api.ts); the server's
// insecure-dev path splits on ':'. These are separate codebases, so this test
// pins the contract between them.
// ============================================================================

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import type { Server } from 'node:http';

process.env.ALLOW_INSECURE_NO_AUTH = 'true';
delete process.env.FIREBASE_SERVICE_ACCOUNT;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

import { initAuth, requireAuth } from '../middleware/auth';

/** Mirrors devUidForEmail in app/session.ts. */
function devUidForEmail(email: string): string {
  return 'dev-' + email.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

const PORT = 4998;
let server: Server;

function whoami(token: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    http
      .get(
        { host: '127.0.0.1', port: PORT, path: '/whoami', headers: { Authorization: `Bearer ${token}` } },
        (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            let body: any = raw;
            try { body = JSON.parse(raw); } catch (_e) { /* text */ }
            resolve({ status: res.statusCode!, body });
          });
        }
      )
      .on('error', reject);
  });
}

before(async () => {
  initAuth();
  const app = express();
  app.get('/whoami', requireAuth, (req, res) => res.json(req.user));
  await new Promise<void>((resolve) => { server = app.listen(PORT, () => resolve()); });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('local dev token contract', () => {
  test('a uid derived from an email contains no colon', () => {
    // ':' is the field separator, so a uid carrying one would corrupt the token.
    for (const email of ['a.user@example.com', ' Mixed.Case@Example.COM ', "o'brien+tag@sub.domain.co.uk"]) {
      assert.ok(!devUidForEmail(email).includes(':'), `colon in uid for ${email}`);
    }
  });

  test('the same email always yields the same uid', () => {
    // Incidents are keyed by reporter uid; an unstable uid would orphan them.
    assert.equal(devUidForEmail('A.User@Example.com '), devUidForEmail('a.user@example.com'));
  });

  test('different emails yield different uids', () => {
    assert.notEqual(devUidForEmail('one@example.com'), devUidForEmail('two@example.com'));
  });

  test('the server decodes the token the app mints', async () => {
    const email = 'responder@example.com';
    const res = await whoami(`${devUidForEmail(email)}:${email}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.uid, 'dev-responderexamplecom');
    assert.equal(res.body.email, email);
  });

  test('a signed-out app sends no token and is refused', async () => {
    const res = await whoami('');
    assert.equal(res.status, 401);
  });
});
