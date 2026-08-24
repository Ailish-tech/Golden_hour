const fs = require('fs');
const path = require('path');
const https = require('https');

const imgUrl = "https://lh3.googleusercontent.com/aida/AEtjO1Xdq1tji-h8RU3XdFwVl7hc1fxsoA5bRcDKbMEC1VMFQDOMVvtIGzWBagHE43yAIMcKCL3N-gyXG3MMNOTmKQsXoJmfuqZcbEZa16ac_D2blorfCWc29yWx9sssCFKMY8WcyHTmrg1PEs7v8lbvsm1Xt5TlUfnu5o3cDQUJe8O08zbnFtkTZrID3BdixTpBTx6dtZ3MlpJ-pFiJAZWBoaGLqzuo0Hc-OVTjbt-6FUYhmfRQjWxVlpTEOM4";
const htmlUrl = "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzAwMDY1OWI3YjhjMWE2OTIwMzM4NWM4Nzg2MWJjZjM3EgsSBxDj2KDf6AgYAZIBJAoKcHJvamVjdF9pZBIWQhQxMzg2OTU2OTIzOTg0Mjc4NTUxOA&filename=&opi=89354086";

const outDir = path.join(__dirname, 'stitch_assets');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const artifactDir = path.join('C:', 'Users', 'Ailish', '.gemini', 'antigravity-ide', 'brain', '7b37e550-0a65-4fe1-8ca7-9d45367032c7');

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
  const imgPath = path.join(outDir, 'legal_shield_certificate.png');
  const htmlPath = path.join(outDir, 'legal_shield_certificate.html');
  const artifactImgPath = path.join(artifactDir, 'legal_shield_certificate.png');

  console.log('Downloading Legal Shield Certificate screenshot...');
  await download(imgUrl, imgPath);
  console.log('Saved screenshot to:', imgPath, fs.statSync(imgPath).size, 'bytes');

  console.log('Downloading Legal Shield Certificate HTML...');
  await download(htmlUrl, htmlPath);
  console.log('Saved HTML to:', htmlPath, fs.statSync(htmlPath).size, 'bytes');

  fs.copyFileSync(imgPath, artifactImgPath);
  console.log('Copied screenshot to artifact directory:', artifactImgPath);
}

run().catch(console.error);
