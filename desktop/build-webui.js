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

// ============================================================================
// Copy webui built files
// ============================================================================
// The SvelteKit webui (../webui) is configured to build to ../public.
// We copy those static files into desktop/public so electron-builder
// can bundle them.
// ============================================================================

const webuiBuildDir = path.join(__dirname, '..', 'public');
const webuiTargetDir = path.join(__dirname, 'public');

console.log('Copying webui from', webuiBuildDir, 'to', webuiTargetDir);

if (!fs.existsSync(webuiBuildDir)) {
  console.warn(`Webui build directory not found at ${webuiBuildDir}.`);
  console.warn('Build the webui first: cd ../webui && npm run build');
} else {
  if (!fs.existsSync(webuiTargetDir)) {
    fs.mkdirSync(webuiTargetDir, { recursive: true });
  }
  copyRecursiveSync(webuiBuildDir, webuiTargetDir);
  console.log('Webui copy complete!');
}

// ============================================================================
// Copy bundled llama-server binary and DLLs (optional local build)
// ============================================================================
// If llama.cpp has been built locally, copy the binaries so they are
// bundled and do not need to be downloaded at runtime.
// If no local build exists, binary-manager.js will auto-download the
// correct backend from GitHub releases on first server start.
// ============================================================================

const localBuildDirs = [
  // Local llama.cpp build relative to this standalone project
  path.join(__dirname, '..', '..', 'llama.cpp', 'build', 'bin', 'Release'),
  path.join(__dirname, '..', '..', 'llama.cpp', 'build', 'bin'),
  // If cloned as a submodule or sibling
  path.join(__dirname, '..', '..', '..', 'build', 'bin', 'Release'),
  path.join(__dirname, '..', '..', '..', 'build', 'bin'),
];

const binTargetDir = path.join(__dirname, 'bin');
if (!fs.existsSync(binTargetDir)) {
  fs.mkdirSync(binTargetDir, { recursive: true });
}

let localBuildFound = false;
for (const buildReleaseDir of localBuildDirs) {
  if (!fs.existsSync(buildReleaseDir)) continue;

  const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const serverExeSrc = path.join(buildReleaseDir, exeName);
  const serverExeDest = path.join(binTargetDir, exeName);

  if (fs.existsSync(serverExeSrc)) {
    console.log(`Copying server binary from ${buildReleaseDir}...`);
    fs.copyFileSync(serverExeSrc, serverExeDest);
    console.log(`Copied ${exeName}`);
    localBuildFound = true;

    // Copy all DLLs / shared libraries
    const libExt = process.platform === 'win32' ? '.dll' : (process.platform === 'darwin' ? '.dylib' : '.so');
    const libFiles = fs.readdirSync(buildReleaseDir).filter(f => f.endsWith(libExt));
    libFiles.forEach(lib => {
      const src = path.join(buildReleaseDir, lib);
      const dest = path.join(binTargetDir, lib);
      fs.copyFileSync(src, dest);
      console.log('Copied', lib);
    });
    break;
  }
}

if (!localBuildFound) {
  console.log('No local llama.cpp build found — binaries will be auto-downloaded from GitHub releases at runtime.');
}

console.log('Server binary step complete!');

// ============================================================================
// Copy alpaca media assets
// ============================================================================

const mediaSourceDir = path.join(__dirname, '..', 'media');
const resourcesTargetDir = path.join(__dirname, 'resources');

console.log('Copying alpaca media from', mediaSourceDir, 'to', resourcesTargetDir);

if (!fs.existsSync(resourcesTargetDir)) {
  fs.mkdirSync(resourcesTargetDir, { recursive: true });
}

if (fs.existsSync(mediaSourceDir)) {
  const mediaFiles = fs.readdirSync(mediaSourceDir).filter(f =>
    f.endsWith('.png') || f.endsWith('.ico') || f.endsWith('.svg') || f.endsWith('.gif')
  );
  mediaFiles.forEach(file => {
    const src = path.join(mediaSourceDir, file);
    const dest = path.join(resourcesTargetDir, file);
    fs.copyFileSync(src, dest);
    console.log('Copied media', file);
  });
  console.log('Media copy complete!');
} else {
  console.log('Media directory not found, skipping media copy');
}
