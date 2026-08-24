const http = require('http');

const data = JSON.stringify({
  userId: 'LIVE-TEST-USER-001',
  lat: 26.9090,
  lng: 75.7325
});

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/sos',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    const json = JSON.parse(body);
    console.log('--- SOS Response with Live OSM Hospitals ---');
    console.log('Primary Hospital:', json.nearestHospital?.name);
    console.log('Distance:', json.nearestHospital?.distanceText);
    console.log('Address:', json.nearestHospital?.address);
    console.log('Ambulance ETA:', json.nearestHospital?.etaMinutes, 'mins');
    console.log('Google Maps URL:', json.nearestHospital?.googleMapsUrl);
    console.log('\nBackup Hospitals Count:', json.backupHospitals?.length);
    json.backupHospitals?.forEach((b, i) => {
      console.log(`${i+1}. ${b.name} (${b.distanceText})`);
    });
  });
});

req.write(data);
req.end();
