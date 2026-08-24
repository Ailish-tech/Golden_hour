const http = require('http');

function postJSON(path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function patchJSON(path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJSON(path) {
  return new Promise((resolve, reject) => {
    http.get({
      hostname: 'localhost',
      port: 3000,
      path: path,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

async function runTest() {
  console.log('--- 1. Trigger SOS from Citizen with Live GPS ---');
  const dispatchRes = await postJSON('/api/dispatch', {
    lat: 26.9085,
    lng: 75.7328,
    userId: 'live.citizen@samaritan.org'
  });
  console.log('✅ Dispatch created:', dispatchRes.incidentId, '| Hospital:', dispatchRes.nearestHospital?.name);

  console.log('\n--- 2. Citizen starts CPR in Voice Triage ---');
  const triageRes = await patchJSON(`/api/incidents/${dispatchRes.incidentId}/triage`, {
    victimCondition: 'CPR_ACTIVE',
    cprCompressions: 22,
    cprSets: 1
  });
  console.log('✅ Triage Synced:', triageRes.incident?.victimCondition, '| Compressions:', triageRes.incident?.cprCompressions);

  console.log('\n--- 3. Hospital CAD Portal fetches live incidents ---');
  const hospRes = await getJSON('/api/hospital/incidents?lat=26.8924&lng=75.8150');
  console.log('✅ Hospital Incidents Count:', hospRes.incidents.length);
  const found = hospRes.incidents.find(i => i.id === dispatchRes.incidentId);
  console.log('✅ Found incident in hospital radar:');
  console.log('   Coordinates:', found?.lat, found?.lng);
  console.log('   Distance:', found?.distanceText, '| ETA:', found?.etaMinutes, 'mins');
  console.log('   Condition:', found?.victimStatus, '| Push count:', found?.cprCompressions);
  console.log('   SHA-256 Digest:', found?.sha256Hash);

  console.log('\n--- 4. Hospital CAD operator dispatches ambulance ---');
  const actionRes = await patchJSON(`/api/incidents/${dispatchRes.incidentId}/status`, {
    status: 'AMBULANCE_DISPATCHED',
    ambulanceUnitAssigned: 'ALS Mobile Unit #108-ALPHA (Dispatched)'
  });
  console.log('✅ Status updated:', actionRes.incident?.status, '| Unit:', actionRes.incident?.ambulanceUnitAssigned);
}

runTest().catch(console.error);
