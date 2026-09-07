/* eslint-env node */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { extractArchive: safeExtractArchive } = require('./security/safe-extractor');

const GITHUB_API_LATEST = 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest';
const GITHUB_API_RELEASES = 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=15';
const GITHUB_DOWNLOAD = 'https://github.com/ggml-org/llama.cpp/releases/download';
const CDN_FALLBACK_API = 'https://catalog.jan.ai/llama.cpp/releases/releases.json';

// How many recent releases to walk backwards through when the newest release
// is missing our backend asset. llama.cpp's CI publishes releases in two
// phases: the release body (with download links) is committed first and the
// ~25 platform-specific binaries are uploaded over several minutes afterward.
// If the user happens to open the app during that window the GitHub API
// returns the release with only a partial `assets` array, producing a
// spurious "No release asset found" error. Falling back to the previous
// release avoids that race without any manual intervention.
const RELEASE_FALLBACK_LIMIT = 10;

const pendingDownloads = new Map();
let artifactVerification = null;

function configureArtifactVerification(options = null) {
  artifactVerification = options && options.artifactVerifier ? { ...options } : null;
  return artifactVerification !== null;
}

function getBackendsDir(app) {
  const dir = path.join(app.getPath('userData'), 'backends');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function mapCapabilitiesToBackend(caps) {
  const platform = process.platform === 'win32' ? 'win'
    : process.platform === 'darwin' ? 'macos'
    : 'ubuntu';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

  if (platform === 'win') {
    if (caps && caps.cuda) return 'win-cuda-12.4-x64';
    if (caps && caps.vulkan) return 'win-vulkan-x64';
    if (caps && caps.rocm) return 'win-hip-radeon-x64';
    return arch === 'arm64' ? 'win-cpu-arm64' : 'win-cpu-x64';
  }
  if (platform === 'macos') {
    return arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  }
  // Linux
  if (caps && caps.vulkan) return 'ubuntu-vulkan-x64';
  if (caps && caps.rocm) return 'ubuntu-rocm-7.2-x64';
  if (arch === 'arm64') return 'ubuntu-arm64';
  return 'ubuntu-x64';
}

function getRequiredDlls(backend) {
  // Core DLLs that should be present for all Windows backends
  // ggml-base.dll is required by newer llama.cpp builds (ggml.dll is a thin shim)
  const core = ['ggml-base.dll', 'ggml.dll', 'llama-common.dll', 'llama.dll'];
  const extra = [];
  if (backend.includes('cuda')) {
    extra.push('ggml-cuda.dll');
  }
  if (backend.includes('vulkan')) {
    extra.push('ggml-vulkan.dll');
  }
  if (backend.includes('hip') || backend.includes('radeon')) {
    extra.push('ggml-hip.dll');
  }
  if (backend.includes('cpu')) {
    extra.push('ggml-cpu.dll');
  }
  return [...core, ...extra];
}

/**
 * Check whether the Microsoft Visual C++ 2015-2022 Redistributable (x64)
 * runtime DLLs are present on the system. These are required by any
 * MSVC-built binary (llama-server.exe, ggml.dll, etc.).
 *
 * @returns {{ok: boolean, missing: string[], systemDir: string|null}}
 */
function verifyVcRuntime() {
  if (process.platform !== 'win32') return { ok: true, missing: [], systemDir: null };

  const sysDirs = [
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
    path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64'),
  ];

  const required = ['vcruntime140.dll', 'msvcp140.dll'];
  const preferred = ['vcruntime140_1.dll', 'msvcp140_1.dll'];

  let systemDir = null;
  for (const dir of sysDirs) {
    if (fs.existsSync(dir) && required.every(dll => fs.existsSync(path.join(dir, dll)))) {
      systemDir = dir;
      break;
    }
  }

  const missing = [];
  if (!systemDir) {
    // Report which exact DLLs are missing from the first system directory
    const firstDir = sysDirs[0];
    for (const dll of required) {
      if (!fs.existsSync(path.join(firstDir, dll))) missing.push(dll);
    }
  }

  const ok = missing.length === 0;
  if (ok && systemDir) {
    // Also warn about preferred but non-critical DLLs
    const preferredMissing = preferred.filter(dll => !fs.existsSync(path.join(systemDir, dll)));
    if (preferredMissing.length > 0) {
      console.warn(`[binary-manager] VC++ runtime preferred DLLs missing: ${preferredMissing.join(', ')}`);
    }
  }

  return { ok, missing, systemDir };
}

function getCudaRuntimeAsset(backend, tag) {
  if (backend.includes('cuda-12.4')) return `cudart-llama-bin-win-cuda-12.4-x64.zip`;
  if (backend.includes('cuda-13.1')) return `cudart-llama-bin-win-cuda-13.1-x64.zip`;
  return null;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'alpacabitollama/1.0',
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

async function getLatestReleaseInfo() {
  try {
    const release = await fetchJson(GITHUB_API_LATEST);
    return { tag: release.tag_name, assets: release.assets || [], source: 'github' };
  } catch (err) {
    console.warn('[binary-manager] GitHub API failed, trying CDN fallback:', err.message);
    try {
      const releases = await fetchJson(CDN_FALLBACK_API);
      const latest = Array.isArray(releases) ? releases[0] : (releases.releases || [])[0];
      if (!latest) throw new Error('No releases found in CDN fallback');
      return { tag: latest.tag_name, assets: latest.assets || [], source: 'cdn' };
    } catch (err2) {
      throw new Error(`Failed to fetch releases: ${err2.message}`);
    }
  }
}

/**
 * Returns up to `RELEASE_FALLBACK_LIMIT` recent releases, newest first.
 * Uses the multi-release GitHub endpoint when available so we can fall
 * back past a freshly-published but not-yet-fully-uploaded release.
 */
async function getRecentReleases() {
  try {
    const releases = await fetchJson(GITHUB_API_RELEASES);
    if (!Array.isArray(releases) || releases.length === 0) {
      throw new Error('Empty releases list from GitHub');
    }
    return releases
      .filter((r) => r && !r.draft)
      .slice(0, RELEASE_FALLBACK_LIMIT)
      .map((r) => ({ tag: r.tag_name, assets: r.assets || [], source: 'github' }));
  } catch (err) {
    console.warn('[binary-manager] Recent releases fetch failed, falling back to CDN:', err.message);
    try {
      const releases = await fetchJson(CDN_FALLBACK_API);
      const list = Array.isArray(releases) ? releases : (releases.releases || []);
      return list
        .slice(0, RELEASE_FALLBACK_LIMIT)
        .map((r) => ({ tag: r.tag_name, assets: r.assets || [], source: 'cdn' }));
    } catch (err2) {
      // Last resort: just return whatever `latest` gives us.
      const latest = await getLatestReleaseInfo();
      return [latest];
    }
  }
}

function assetMatchesBackend(asset, tag, backend) {
  if (!asset || !asset.name) return false;
  const prefix = `llama-${tag}-bin-${backend}`;
  return asset.name.startsWith(prefix) &&
    (asset.name.endsWith('.zip') || asset.name.endsWith('.tar.gz'));
}

/**
 * Walks recent releases (newest → oldest) and returns the first one that
 * actually has the backend asset uploaded. This sidesteps the llama.cpp
 * CI upload race where the latest release has a body listing all binaries
 * but only a subset are fully uploaded.
 *
 * @returns {Promise<{tag:string, assets:Array, source:string}>}
 */
async function findReleaseWithBackendAsset(backend) {
  const candidates = await getRecentReleases();
  if (candidates.length === 0) {
    throw new Error('No releases available from any source');
  }
  for (const release of candidates) {
    const match = release.assets.find((a) => assetMatchesBackend(a, release.tag, backend));
    if (match) {
      if (release !== candidates[0]) {
        console.warn(`[binary-manager] Latest release ${candidates[0].tag} is missing backend "${backend}" (likely still uploading); using ${release.tag} instead.`);
      }
      return release;
    }
  }
  // Nothing found — surface a descriptive error.
  const tried = candidates.map((c) => c.tag).join(', ');
  throw new Error(`No release in the last ${candidates.length} tags (${tried}) contains an asset for backend "${backend}". The llama.cpp CI may still be uploading binaries; please retry in a few minutes.`);
}

function getAssetUrl(tag, assetName) {
  return `${GITHUB_DOWNLOAD}/${tag}/${assetName}`;
}

function extractArchiveLegacy(archivePath, destDir) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    const isZip = archivePath.endsWith('.zip');
    const isTarGz = archivePath.endsWith('.tar.gz');

    if (!isZip && !isTarGz) {
      return reject(new Error(`Unsupported archive format: ${archivePath}`));
    }

    if (process.platform === 'win32' && isZip) {
      const ps = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`
      ], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stderr = '';
      ps.stderr.on('data', d => stderr += d);
      ps.on('close', code => {
        if (code !== 0) return reject(new Error(`Expand-Archive failed (code ${code}): ${stderr}`));
        resolve();
      });
    } else if (isTarGz) {
      const proc = spawn('tar', ['-xzf', archivePath, '-C', destDir], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', d => stderr += d);
      proc.on('close', code => {
        if (code !== 0) return reject(new Error(`tar extraction failed (code ${code}): ${stderr}`));
        resolve();
      });
    } else {
      const proc = spawn('unzip', ['-o', archivePath, '-d', destDir], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', d => stderr += d);
      proc.on('close', code => {
        // unzip returns 1 for warnings (e.g. replacing files) which is fine
        if (code !== 0 && code !== 1) return reject(new Error(`unzip failed (code ${code}): ${stderr}`));
        resolve();
      });
    }
  });
}

async function extractArchive(archivePath, destDir) {
  const applicationRoot = path.resolve(destDir, '..', '..');
  return safeExtractArchive({ archivePath, destination: destDir, applicationRoot });
}
function verifyBackendDlls(backendDir, backend) {
  if (process.platform !== 'win32') return { missing: [], ok: true };
  const required = getRequiredDlls(backend);
  const missing = [];
  for (const dll of required) {
    const dllPath = path.join(backendDir, dll);
    if (!fs.existsSync(dllPath)) {
      missing.push(dll);
    }
  }
  return { missing, ok: missing.length === 0 };
}

async function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(destPath)) {
      try { fs.unlinkSync(destPath); } catch (_) { /* ignore */ }
    }
    const file = fs.createWriteStream(destPath);

    function handleResponse(response) {
      if (response.statusCode === 301 || response.statusCode === 302 ||
          response.statusCode === 307 || response.statusCode === 308) {
        if (!response.headers.location) {
          file.destroy();
          fs.unlink(destPath, () => {});
          return reject(new Error('Redirect with no Location header'));
        }
        const redirectUrl = response.headers.location;
        response.resume();
        https.get(redirectUrl, { headers: { 'User-Agent': 'alpacabitollama/1.0' } }, handleResponse)
          .on('error', err => {
            file.destroy();
            fs.unlink(destPath, () => {});
            reject(err);
          });
        return;
      }

      if (response.statusCode !== 200) {
        file.destroy();
        fs.unlink(destPath, () => {});
        return reject(new Error(`HTTP ${response.statusCode}`));
      }

      const total = parseInt(response.headers['content-length'], 10) || 0;
      let current = 0;
      response.on('data', chunk => {
        current += chunk.length;
        if (onProgress) onProgress(current, total);
      });
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }

    https.get(url, { headers: { 'User-Agent': 'alpacabitollama/1.0' } }, handleResponse)
      .on('error', err => {
        file.destroy();
        fs.unlink(destPath, () => {});
        reject(err);
      })
      .setTimeout(300000, () => {
        file.destroy();
        fs.unlink(destPath, () => {});
        reject(new Error('Download timeout after 5 minutes'));
      });
  });
}

function findExeRecursively(dir, exeName) {
  if (!fs.existsSync(dir)) return null;
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      const found = findExeRecursively(full, exeName);
      if (found) return found;
    } else if (item === exeName) {
      return full;
    }
  }
  return null;
}

async function ensureBackend(app, caps, onProgress, onStatus, options = {}) {
  const verification = options.artifactVerifier ? options : artifactVerification;
  const backend = mapCapabilitiesToBackend(caps);
  const backendKey = `${backend}`;

  // Prevent duplicate concurrent downloads for the same backend
  if (pendingDownloads.has(backendKey)) {
    console.log(`[binary-manager] Backend ${backend} download already in progress, waiting...`);
    if (onStatus) onStatus({ phase: 'waiting', backend });
    const existing = await pendingDownloads.get(backendKey);
    return existing;
  }

  // Walk recent releases (newest → oldest) and use the first one whose
  // backend asset is fully uploaded. This tolerates the ~several-minute
  // window after a new llama.cpp release is published but before all
  // platform binaries finish uploading. See `findReleaseWithBackendAsset`.
  const { tag, assets } = await findReleaseWithBackendAsset(backend);
  const backendsDir = getBackendsDir(app);
  const backendDir = path.join(backendsDir, tag, backend);
  const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const exePath = path.join(backendDir, exeName);

  // Check if already cached
  if (fs.existsSync(exePath)) {
    const dllCheck = verifyBackendDlls(backendDir, backend);
    if (dllCheck.ok) {
      console.log(`[binary-manager] Backend ${backend}@${tag} already cached and verified.`);
      return { exePath, backendDir, tag, backend, fresh: false };
    }
    console.warn(`[binary-manager] Backend ${backend}@${tag} cached but missing DLLs: ${dllCheck.missing.join(', ')}. Re-downloading...`);
  }

  // Some backends may extract into a subfolder; do a recursive search as a fallback
  const existing = findExeRecursively(backendDir, exeName);
  if (existing) {
    const subDir = path.dirname(existing);
    const dllCheck = verifyBackendDlls(subDir, backend);
    if (dllCheck.ok) {
      console.log(`[binary-manager] Backend ${backend}@${tag} already cached (found in subdir).`);
      return { exePath: existing, backendDir: subDir, tag, backend, fresh: false };
    }
    console.warn(`[binary-manager] Backend ${backend}@${tag} found in subdir but missing DLLs: ${dllCheck.missing.join(', ')}. Re-downloading...`);
  }

  // Find the matching asset (supports both .zip and .tar.gz)
  const assetPrefix = `llama-${tag}-bin-${backend}`;
  const asset = assets.find(a => a.name && a.name.startsWith(assetPrefix) && (a.name.endsWith('.zip') || a.name.endsWith('.tar.gz')));
  if (!asset) {
    throw new Error(`No release asset found for backend "${backend}" in tag ${tag}`);
  }

  // Clean old incomplete download
  if (fs.existsSync(backendDir)) {
    try {
      fs.rmSync(backendDir, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  }
  fs.mkdirSync(backendDir, { recursive: true });

  if (onStatus) onStatus({ phase: 'downloading', backend, tag, assetName: asset.name });

  // Download backend archive
  const archivePath = path.join(backendDir, `backend${asset.name.endsWith('.tar.gz') ? '.tar.gz' : '.zip'}`);
  const downloadUrl = asset.browser_download_url || getAssetUrl(tag, asset.name);
  console.log(`[binary-manager] Downloading ${asset.name} from ${downloadUrl}...`);

  const downloadPromise = downloadFile(downloadUrl, archivePath, onProgress);
  pendingDownloads.set(backendKey, downloadPromise.then(async () => {
    if (verification?.artifactVerifier) {
      const trustedArtifact = typeof verification.trustedArtifact === 'function'
        ? await verification.trustedArtifact({ kind: 'backend', backend, tag, assetName: asset.name })
        : verification.trustedArtifact;
      if (!trustedArtifact) throw new Error('Trusted backend artifact metadata was not supplied');
      const verified = await verification.artifactVerifier.verifyArtifact({
        filePath: archivePath, kind: 'archive', source: 'curated-backend', reference: `${tag}/${asset.name}`,
        expectedDigest: trustedArtifact.digest || trustedArtifact, signature: trustedArtifact.signature,
        manifestVersion: trustedArtifact.version
      });
      if (!verified.executable) throw new Error(`Backend artifact verification failed: ${verified.error?.message || verified.status}`);
    }
    // Extract
    if (onStatus) onStatus({ phase: 'extracting', backend, tag });
    console.log(`[binary-manager] Extracting ${asset.name}...`);
    await extractArchive(archivePath, backendDir);
    try { fs.unlinkSync(archivePath); } catch (_) { /* ignore */ }

    // Download CUDA runtime DLLs if needed (Windows CUDA backends)
    const cudaAssetName = getCudaRuntimeAsset(backend, tag);
    if (cudaAssetName) {
      const cudaAsset = assets.find(a => a.name === cudaAssetName);
      if (cudaAsset) {
        const cudaZipPath = path.join(backendDir, 'cuda-runtime.zip');
        const cudaUrl = cudaAsset.browser_download_url || getAssetUrl(tag, cudaAsset.name);
        console.log(`[binary-manager] Downloading CUDA runtime ${cudaAsset.name}...`);
        await downloadFile(cudaUrl, cudaZipPath, null);
        console.log(`[binary-manager] Extracting CUDA runtime...`);
        await extractArchive(cudaZipPath, backendDir);
        try { fs.unlinkSync(cudaZipPath); } catch (_) { /* ignore */ }
      }
    }

    // Verify the binary exists
    let finalExePath = exePath;
    if (!fs.existsSync(exePath)) {
      const found = findExeRecursively(backendDir, exeName);
      if (!found) {
        throw new Error(`llama-server executable not found after extraction in ${backendDir}`);
      }
      finalExePath = found;
    }

    // Verify required DLLs on Windows
    const finalBackendDir = path.dirname(finalExePath);
    const dllCheck = verifyBackendDlls(finalBackendDir, backend);
    if (!dllCheck.ok) {
      console.warn(`[binary-manager] Missing DLLs after extraction: ${dllCheck.missing.join(', ')}. Server may fall back to CPU inference.`);
    }

    const result = { exePath: finalExePath, backendDir: finalBackendDir, tag, backend, fresh: true, dllCheck };
    if (onStatus) onStatus({ phase: 'ready', backend, tag, result });
    return result;
  }).catch(err => {
    if (onStatus) onStatus({ phase: 'error', backend, tag, error: err.message });
    throw err;
  }).finally(() => {
    pendingDownloads.delete(backendKey);
  }));

  return await pendingDownloads.get(backendKey);
}

function getInstalledBackends(app) {
  const backendsDir = getBackendsDir(app);
  if (!fs.existsSync(backendsDir)) return [];
  const versions = fs.readdirSync(backendsDir);
  const result = [];
  for (const version of versions) {
    const versionDir = path.join(backendsDir, version);
    if (!fs.statSync(versionDir).isDirectory()) continue;
    const backends = fs.readdirSync(versionDir);
    for (const backend of backends) {
      const bDir = path.join(versionDir, backend);
      if (!fs.statSync(bDir).isDirectory()) continue;
      const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
      const exePath = path.join(bDir, exeName);
      const buildExePath = path.join(bDir, 'build', 'bin', exeName);
      const installed = fs.existsSync(exePath) || fs.existsSync(buildExePath);
      result.push({ version, backend, path: bDir, installed });
    }
  }
  return result;
}

function deleteBackend(app, tag, backend) {
  const backendDir = path.join(getBackendsDir(app), tag, backend);
  if (fs.existsSync(backendDir)) {
    fs.rmSync(backendDir, { recursive: true, force: true });
    return true;
  }
  return false;
}

module.exports = {
  ensureBackend,
  configureArtifactVerification,
  getInstalledBackends,
  getLatestReleaseInfo,
  mapCapabilitiesToBackend,
  getBackendsDir,
  deleteBackend,
  verifyBackendDlls,
  getRequiredDlls,
  extractArchive,
  downloadFile,
  getAssetUrl,
  verifyVcRuntime,
};
