const https = require('https');

async function fetchRealHospitals(lat, lng) {
  const query = `[out:json][timeout:8];(node["amenity"="hospital"](around:10000,${lat},${lng});way["amenity"="hospital"](around:10000,${lat},${lng}););out center 10;`;
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'SamaritanShield-EmergencyApp/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

fetchRealHospitals(26.9090, 75.7325)
  .then(res => {
    console.log(`Found ${res.elements.length} real live hospitals nearby:`);
    res.elements.forEach((el, idx) => {
      const name = el.tags?.name || el.tags?.['name:en'] || 'Local Medical Center';
      const hLat = el.lat || el.center?.lat;
      const hLng = el.lon || el.center?.lon;
      const street = el.tags?.['addr:street'] || el.tags?.['addr:suburb'] || el.tags?.['addr:city'] || 'Emergency Ward';
      const phone = el.tags?.phone || el.tags?.['contact:phone'] || '108 / 112';
      console.log(`${idx + 1}. ${name} — (${hLat}, ${hLng}) — ${street} — Phone: ${phone}`);
    });
  })
  .catch(err => {
    console.error('Error fetching:', err);
  });
