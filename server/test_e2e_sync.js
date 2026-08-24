// ============================================================================
// Manual end-to-end smoke test — requires a running server and MongoDB.
//
//   ALLOW_INSECURE_NO_AUTH=true npm run dev      # terminal 1
//   node test_e2e_sync.js                        # terminal 2
//
// In insecure dev mode the bearer token is read as `uid:email`. Against a real
// deployment, replace CITIZEN/HOSPITAL below with genuine Firebase ID tokens.
// ============================================================================

const http = require('http');

const CITIZEN = process.env.CITIZEN_TOKEN || 'citizen-uid-001:responder@example.org';
const HOSPITAL = process.env.HOSPITAL_TOKEN || 'hospital-uid-001:trauma.cad@hospital.org';

function request(method, path, token, payload) {
  return new Promise((resolve, reject) => {
    const data = payload ? JSON.stringify(payload) : null;
    const req = http.request(
      {
        hostname: 'localhost',
        port: process.env.PORT || 3000,
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          } catch (_e) {
            resolve({ status: res.statusCode, body });
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

let failures = 0;
function check(label, condition, detail) {
  console.log(`${condition ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures++;
}

async function run() {
  console.log('--- 1. Unauthenticated calls are rejected ---');
  const anon = await request('GET', '/api/hospital/incidents', '');
  check('hospital feed rejects a missing token', anon.status === 401, `got ${anon.status}`);

  console.log('\n--- 2. Citizen triggers SOS ---');
  const sos = await request('POST', '/api/sos', CITIZEN, { lat: 26.9085, lng: 75.7328 });
  check('SOS accepted', sos.body.status === 'success', `status ${sos.status}`);
  check('incident id returned', !!sos.body.incidentId, sos.body.incidentId);
  check('certificate PDF returned', !!sos.body.pdfBase64);
  const incidentId = sos.body.incidentId;
  const hash = sos.body.hash;
  console.log(`   digest: ${hash}`);

  console.log('\n--- 3. A citizen cannot read the hospital feed ---');
  const forbidden = await request('GET', '/api/hospital/incidents', CITIZEN);
  check('citizen is refused hospital access', forbidden.status === 403, `got ${forbidden.status}`);

  console.log('\n--- 4. Triage telemetry from the reporter ---');
  const triage = await request('PATCH', `/api/incidents/${incidentId}/triage`, CITIZEN, {
    victimCondition: 'CPR_ACTIVE',
    cprCompressions: 22,
    cprSets: 1,
  });
  check('triage synced', triage.body.status === 'success');

  console.log('\n--- 5. A non-reporter cannot push triage for it ---');
  const stranger = await request('PATCH', `/api/incidents/${incidentId}/triage`, 'other-uid:x@y.z', {
    victimCondition: 'RECOVERY_POSITION',
  });
  check('stranger refused', stranger.status === 403, `got ${stranger.status}`);

  console.log('\n--- 6. Hospital desk sees the incident ---');
  const feed = await request('GET', '/api/hospital/incidents?lat=26.8924&lng=75.8150', HOSPITAL);
  check('hospital feed readable', feed.body.status === 'success', `status ${feed.status}`);
  const seen = (feed.body.incidents || []).find((i) => i.id === incidentId);
  check('incident present in feed', !!seen);

  console.log('\n--- 7. The digest the hospital sees matches the certificate ---');
  check(
    'hash matches end to end',
    seen && seen.sha256Hash === hash,
    seen ? `feed=${seen.sha256Hash}` : 'incident missing'
  );

  console.log('\n--- 8. The digest verifies publicly ---');
  const verify = await request('GET', `/api/verify/${hash}`, '');
  check('verify confirms the record', verify.body.verified === true, `status ${verify.status}`);

  console.log('\n--- 9. Hospital dispatches a unit ---');
  const dispatch = await request('PATCH', `/api/incidents/${incidentId}/status`, HOSPITAL, {
    status: 'AMBULANCE_DISPATCHED',
    ambulanceUnitAssigned: 'ALS Mobile Unit #108-ALPHA',
  });
  check('status updated', dispatch.body.status === 'success');

  console.log(failures === 0 ? '\n✅ All end-to-end checks passed.' : `\n❌ ${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error('Run failed:', e.message);
  process.exit(1);
});
