const fs = require('fs');
const path = require('path');

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();

  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach(childItemName => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

function copyFileIfExists(src, dest) {
  if (fs.existsSync(src)) {
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
    console.log('Copied', path.basename(src));
  }
}

// Copy webui files
const sourceDir = path.join(__dirname, '..', 'public');
const targetDir = path.join(__dirname, 'public');

console.log('Copying webui from', sourceDir, 'to', targetDir);

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

copyRecursiveSync(sourceDir, targetDir);
console.log('Webui copy complete!');

// Copy llama-server binary and DLLs
const buildReleaseDir = path.join(__dirname, '..', '..', '..', 'build', 'bin', 'Release');
const binTargetDir = path.join(__dirname, 'bin');

console.log('Copying server binary from', buildReleaseDir, 'to', binTargetDir);

if (!fs.existsSync(binTargetDir)) {
  fs.mkdirSync(binTargetDir, { recursive: true });
}

// Copy llama-server.exe
const serverExeSrc = path.join(buildReleaseDir, 'llama-server.exe');
const serverExeDest = path.join(binTargetDir, 'llama-server.exe');
if (fs.existsSync(serverExeSrc)) {
  fs.copyFileSync(serverExeSrc, serverExeDest);
  console.log('Copied llama-server.exe');
}

// Copy all required DLLs
const dllFiles = fs.readdirSync(buildReleaseDir).filter(f => f.endsWith('.dll'));
dllFiles.forEach(dll => {
  const src = path.join(buildReleaseDir, dll);
  const dest = path.join(binTargetDir, dll);
  fs.copyFileSync(src, dest);
  console.log('Copied', dll);
});

console.log('Server binary copy complete!');
