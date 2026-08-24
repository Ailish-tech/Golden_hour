const fs = require('fs');
const path = require('path');
const https = require('https');

const imgUrl = "https://lh3.googleusercontent.com/aida/AEtjO1WRIPdCSfFepWv8Lg3SFIKE0jAn9Bq7GZQyWymFx9mQEU4NcMtXBZuoVr9yxJhDwp-sneEJGc-32pr4qlPqAeEV_NucBlydYQLKPC-fvPuUmYDTVhBOsLBNf8S8wO0AgXGYN9Q3ub7qgGIcRqorDd62rZQPcJzpcBVdrR9ZC51yd3LGboUJnCaQLYtBKAEk6dQeN0zpWnkfeoBjkgb9UqTLrkUjP_ZZA724NcYTcKOFRtSokcpjvtj_LJY";
const htmlUrl = "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzAwMDY1OWI3Yjk5NDYxNjgwOTI1ZDYyNmZhMWJhYTEzEgsSBxDj2KDf6AgYAZIBJAoKcHJvamVjdF9pZBIWQhQxMzg2OTU2OTIzOTg0Mjc4NTUxOA&filename=&opi=89354086";

const outDir = path.join(__dirname, 'stitch_assets');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const artifactDir = "C:\\Users\\Ailish\\.gemini\\antigravity-ide\\brain\\7b37e550-0a65-4fe1-8ca7-9d45367032c7";

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
  const imgPath = path.join(outDir, 'emergency_dashboard.png');
  const htmlPath = path.join(outDir, 'emergency_dashboard.html');
  const artifactImgPath = path.join(artifactDir, 'emergency_dashboard.png');

  console.log('Downloading screenshot...');
  await download(imgUrl, imgPath);
  console.log('Saved screenshot to:', imgPath, fs.statSync(imgPath).size, 'bytes');

  console.log('Downloading HTML code...');
  await download(htmlUrl, htmlPath);
  console.log('Saved HTML code to:', htmlPath, fs.statSync(htmlPath).size, 'bytes');

  fs.copyFileSync(imgPath, artifactImgPath);
  console.log('Copied to artifact directory:', artifactImgPath);
}

run().catch(console.error);
