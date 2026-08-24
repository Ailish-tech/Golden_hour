const http = require('http');
const fs = require('fs');

const data = JSON.stringify({
  userId: 'TEST-SAMARITAN-001',
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
    if (json.pdfBase64) {
      const buffer = Buffer.from(json.pdfBase64, 'base64');
      fs.writeFileSync('test_downloaded_cert.pdf', buffer);
      console.log('✅ Generated and saved valid PDF certificate! Size:', buffer.length, 'bytes');
    } else {
      console.error('❌ No PDF base64 received');
    }
  });
});

req.write(data);
req.end();
