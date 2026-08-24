const fs = require('fs');
const path = require('path');
const https = require('https');

const imgUrl = "https://lh3.googleusercontent.com/aida/AEtjO1XqVs3Hm5Kb_Nd9yMdVV11qXHUS-40dxQY580WncPEpts6fUNluzlCYuQD3PCN3o8dFqZsGxK-pzYsO0-pWTTbZxUPmwe4JCA6yYU2zRK7AfjN73zpMAn4Te6lx1oSZlAuWNO_sVLNM7CaMN1D6cTSC3dJc0KxvSmmS-cvmkvf7qCGz81pC5J2y-PaVfC_Uomv1B7QabpRvuSIPqd1Vya0p6lU76Epbjb_wSWQV1XktrhfclQgJVRchiYf6";
const htmlUrl = "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzAwMDY1OWI3YmExYTBmZDkwMjA3Yjg4OTRlM2NmMWI1EgsSBxDj2KDf6AgYAZIBJAoKcHJvamVjdF9pZBIWQhQxMzg2OTU2OTIzOTg0Mjc4NTUxOA&filename=&opi=89354086";

const outDir = path.join(__dirname, 'stitch_assets');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const artifactDir = "C:\\Users\\Ailish\\.gemini\antigravity-ide\\brain\\7b37e550-0a65-4fe1-8ca7-9d45367032c7";

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve());
      });
    }).on('error', reject);
  });
}

async function run() {
  const imgPath = path.join(outDir, 'active_transmission_hub.png');
  const htmlPath = path.join(outDir, 'active_transmission_hub.html');
  const artifactImgPath = path.join(artifactDir, 'active_transmission_hub.png');

  console.log('Downloading Active Transmission Hub screenshot...');
  await download(imgUrl, imgPath);
  console.log('Saved screenshot to:', imgPath, fs.statSync(imgPath).size, 'bytes');

  console.log('Downloading Active Transmission Hub HTML...');
  await download(htmlUrl, htmlPath);
  console.log('Saved HTML to:', htmlPath, fs.statSync(htmlPath).size, 'bytes');

  fs.copyFileSync(imgPath, artifactImgPath);
  console.log('Copied screenshot to artifact directory:', artifactImgPath);
}

run().catch(console.error);
