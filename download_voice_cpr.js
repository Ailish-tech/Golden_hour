const fs = require('fs');
const path = require('path');
const https = require('https');

const imgUrl = "https://lh3.googleusercontent.com/aida/AEtjO1XQwtEk5EBefwBhQ6LtmfKCUXgfbSNmqq0nLBLvg5p1qwIqdGI41uAEFjJSkxQNmnM79VPIcpOzC3-_qfJ4yDz0x-QamOS9HU40zRFeIs4L2cgzMPJejo-LM1506zue6YIY16V6ESyLcZ66YKK_bDX5OmiE3RJriggnNwipG_R9xUai9-IhLIPBpWdts_lumy-Mn8gwBNzUc7tb4FgO5R5Ss-ZJmK2tkBKXU_1Pi8ln9OF9pk0yKNdy7fzK";
const htmlUrl = "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzAwMDY1OWI3YjkzZWY5YTcwMWE2MDlkNGU2MTU4YzFmEgsSBxDj2KDf6AgYAZIBJAoKcHJvamVjdF9pZBIWQhQxMzg2OTU2OTIzOTg0Mjc4NTUxOA&filename=&opi=89354086";

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
  const imgPath = path.join(outDir, 'voice_cpr_engine.png');
  const htmlPath = path.join(outDir, 'voice_cpr_engine.html');
  const artifactImgPath = path.join(artifactDir, 'voice_cpr_engine.png');

  console.log('Downloading Voice AI & CPR Engine screenshot...');
  await download(imgUrl, imgPath);
  console.log('Saved screenshot to:', imgPath, fs.statSync(imgPath).size, 'bytes');

  console.log('Downloading Voice AI & CPR Engine HTML...');
  await download(htmlUrl, htmlPath);
  console.log('Saved HTML to:', htmlPath, fs.statSync(htmlPath).size, 'bytes');

  fs.copyFileSync(imgPath, artifactImgPath);
  console.log('Copied screenshot to artifact directory:', artifactImgPath);
}

run().catch(console.error);
