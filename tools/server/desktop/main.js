/* eslint-env node */
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn, execSync } = require('child_process');
const Store = require('electron-store');

const store = new Store();

let mainWindow = null;
let tray = null;
let llamaServerProcess = null;
let isServerRunning = false;

app.isQuitting = false;

// Curated list of verified-real GGUF repos hosted on HuggingFace.
// Each entry must point to a file that actually exists; bad URLs leave users
// stranded on the setup screen with no way to recover.
const MODELS_TO_DOWNLOAD = [
  // Qwen
  {
    name: 'Qwen2.5-7B-Instruct (Q4_K_M, ~4.7 GB)',
    url: 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    filename: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    category: 'Qwen'
  },
  {
    name: 'Qwen2.5-3B-Instruct (Q4_K_M, ~2.0 GB)',
    url: 'https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf',
    filename: 'Qwen2.5-3B-Instruct-Q4_K_M.gguf',
    category: 'Qwen'
  },
  // Llama
  {
    name: 'Llama-3.2-3B-Instruct (Q4_K_M, ~2.0 GB)',
    url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    category: 'Llama'
  },
  {
    name: 'Llama-3.2-1B-Instruct (Q4_K_M, ~0.8 GB)',
    url: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    filename: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    category: 'Llama'
  },
  // Gemma
  {
    name: 'gemma-2-2b-it (Q4_K_M, ~1.7 GB)',
    url: 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf',
    filename: 'gemma-2-2b-it-Q4_K_M.gguf',
    category: 'Gemma'
  },
  // Mistral
  {
    name: 'Mistral-7B-Instruct-v0.3 (Q4_K_M, ~4.4 GB)',
    url: 'https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
    filename: 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
    category: 'Mistral'
  },
  // Phi
  {
    name: 'Phi-3.5-mini-instruct (Q4_K_M, ~2.4 GB)',
    url: 'https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf',
    filename: 'Phi-3.5-mini-instruct-Q4_K_M.gguf',
    category: 'Phi'
  },
  // Small (recommended for first-time users)
  {
    name: 'SmolLM2-1.7B-Instruct (Q4_K_M, ~1.0 GB) — recommended starter',
    url: 'https://huggingface.co/bartowski/SmolLM2-1.7B-Instruct-GGUF/resolve/main/SmolLM2-1.7B-Instruct-Q4_K_M.gguf',
    filename: 'SmolLM2-1.7B-Instruct-Q4_K_M.gguf',
    category: 'Small'
  },
  {
    name: 'SmolLM2-360M-Instruct (Q4_K_M, ~270 MB) — fastest',
    url: 'https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/main/SmolLM2-360M-Instruct-Q4_K_M.gguf',
    filename: 'SmolLM2-360M-Instruct-Q4_K_M.gguf',
    category: 'Small'
  },
  // Bonsai 1-bit (Q1_0) — runs on any PC, very low RAM/VRAM
  {
    name: 'Bonsai-8B (1-bit Q1_0, ~1.1 GB) — runs on any PC',
    url: 'https://huggingface.co/prism-ml/Bonsai-8B-gguf/resolve/main/Bonsai-8B-Q1_0.gguf',
    filename: 'Bonsai-8B-Q1_0.gguf',
    category: 'Bonsai (1-bit)'
  },
  {
    name: 'Bonsai-4B (1-bit Q1_0, ~570 MB) — runs on any PC',
    url: 'https://huggingface.co/prism-ml/Bonsai-4B-gguf/resolve/main/Bonsai-4B-Q1_0.gguf',
    filename: 'Bonsai-4B-Q1_0.gguf',
    category: 'Bonsai (1-bit)'
  },
  {
    name: 'Bonsai-1.7B (1-bit Q1_0, ~250 MB) — runs on any PC',
    url: 'https://huggingface.co/prism-ml/Bonsai-1.7B-gguf/resolve/main/Bonsai-1.7B-Q1_0.gguf',
    filename: 'Bonsai-1.7B-Q1_0.gguf',
    category: 'Bonsai (1-bit)'
  }
];

function checkModelsExist() {
  const modelsDir = getModelsDirectory();
  console.log('Checking for models in:', modelsDir);

  // 1. Prefer the explicitly active model (set via switch-model) if it is valid.
  const activeModelFilename = store.get('activeModelFilename', null);
  if (activeModelFilename) {
    const activePath = path.join(modelsDir, activeModelFilename);
    if (fs.existsSync(activePath)) {
      const stats = fs.statSync(activePath);
      if (stats.size > 1024 * 1024) {
        console.log(`Valid active model found: ${activeModelFilename}`);
        return activeModelFilename;
      }
    }
  }

  // 2. Check curated/selected list next.
  const modelsToCheck = getSelectedModels();
  for (const model of modelsToCheck) {
    const modelPath = path.join(modelsDir, model.filename);
    if (fs.existsSync(modelPath)) {
      const stats = fs.statSync(modelPath);
      if (stats.size > 1024 * 1024) {
        console.log(`Valid curated model found: ${model.filename}`);
        return model.filename;
      }
    }
  }

  // 3. Fallback: scan the whole models directory for ANY valid .gguf file.
  // This is required so that models downloaded via the HuggingFace search
  // (which are not in MODELS_TO_DOWNLOAD) are also detected — without this
  // step the setup UI is shown again immediately after a successful HF
  // download, because the file is invisible to the curated check above.
  if (fs.existsSync(modelsDir)) {
    try {
      const files = fs.readdirSync(modelsDir);
      for (const f of files) {
        if (!f.toLowerCase().endsWith('.gguf')) continue;
        if (f.toLowerCase().startsWith('mmproj-')) continue; // vision projector, not a base model
        const fp = path.join(modelsDir, f);
        const stats = fs.statSync(fp);
        if (stats.size > 1024 * 1024) {
          console.log(`Valid model found via directory scan: ${f}`);
          return f;
        }
      }
    } catch (err) {
      console.error('Error scanning models directory:', err.message);
    }
  }

  console.log('No valid models found');
  return null;
}

function getHtmlDir() {
  const htmlDir = path.join(app.getPath('userData'), 'html');
  if (!fs.existsSync(htmlDir)) {
    fs.mkdirSync(htmlDir, { recursive: true });
  }
  return htmlDir;
}

function getSetupHtmlPath() {
  return path.join(getHtmlDir(), 'setup.html');
}

function generateModelOptions() {
  console.log(`generateModelOptions called, MODELS_TO_DOWNLOAD length = ${MODELS_TO_DOWNLOAD ? MODELS_TO_DOWNLOAD.length : 'undefined'}`);
  if (!MODELS_TO_DOWNLOAD || MODELS_TO_DOWNLOAD.length === 0) {
    console.warn('MODELS_TO_DOWNLOAD is empty or undefined');
    return '<p class="subtitle">No models available to download at this time.</p>';
  }
  const categories = {};
  MODELS_TO_DOWNLOAD.forEach(model => {
    const cat = model.category || 'Other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(model);
  });

  let html = '';
  for (const [category, models] of Object.entries(categories)) {
    html += `<div class="category"><div class="category-title">${category}</div>`;
    models.forEach(model => {
      html += `<div class="model-item">`;
      html += `<input type="checkbox" id="${model.name}" name="model" value="${model.name}">`;
      html += `<label for="${model.name}">${model.name}</label>`;
      html += `</div>`;
    });
    html += `</div>`;
  }
  console.log(`generateModelOptions returning ${html.length} chars of HTML`);
  return html;
}

function getAlpacaPngBase64() {
  // In dev __dirname is the desktop folder; in a packaged app it is
  // .../resources/app.asar.  Files in resources/ are bundled inside the
  // asar (fs.readFileSync works on asar paths).  Files in public/ and
  // bin/ are unpacked to app.asar.unpacked/ because external executables
  // must read them from the real filesystem.
  const pngPaths = [
    // Development: source tree media folder
    path.join(__dirname, '..', '..', '..', 'media', 'alpaca.png'),
    // Packaged: inside app.asar/resources/ (bundled by electron-builder)
    path.join(__dirname, 'resources', 'alpaca.png'),
    // Packaged: unpacked resources/ (if ever added to asarUnpack)
    path.join(__dirname, '..', 'app.asar.unpacked', 'resources', 'alpaca.png'),
    // Packaged: unpacked public/ (build-webui.js copies media here)
    path.join(__dirname, '..', 'app.asar.unpacked', 'public', 'alpaca.png'),
    // Fallback via process.resourcesPath for non-standard Electron layouts
    path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'alpaca.png'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'public', 'alpaca.png'),
    path.join(process.resourcesPath, 'app', 'resources', 'alpaca.png'),
    path.join(process.resourcesPath, 'app', 'public', 'alpaca.png')
  ];
  for (const pngPath of pngPaths) {
    try {
      if (fs.existsSync(pngPath)) {
        return fs.readFileSync(pngPath).toString('base64');
      }
    } catch (_) { /* continue */ }
  }
  return null;
}

let cachedAlpacaPngBase64 = null;
function getCachedAlpacaPngBase64() {
  if (cachedAlpacaPngBase64 === null) {
    cachedAlpacaPngBase64 = getAlpacaPngBase64();
  }
  return cachedAlpacaPngBase64;
}

function getLoadingScreenHtml(title = 'alpacabitollama', message = 'Starting...') {
  const pngBase64 = getCachedAlpacaPngBase64();
  const imgHtml = pngBase64
    ? `<img src="data:image/png;base64,${pngBase64}" alt="alpacabitollama" style="width:120px;height:120px;margin-bottom:20px;object-fit:contain;" />`
    : '';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      height: 100vh;
      background: #0d1117;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      text-align: center;
    }
    .logo { margin-bottom: 4px; }
    h1 { font-size: 1.6rem; font-weight: 600; margin-bottom: 8px; letter-spacing: 0.5px; }
    p { font-size: 0.95rem; color: #8b949e; margin-bottom: 24px; }
    .progress-track {
      width: 280px;
      height: 4px;
      background: rgba(255,255,255,0.08);
      border-radius: 2px;
      overflow: hidden;
    }
    .progress-fill {
      width: 0%;
      height: 100%;
      background: #667eea;
      border-radius: 2px;
      transition: width 0.4s ease;
    }
  </style>
</head>
<body>
  <div class="logo">${imgHtml}</div>
  <h1>${title}</h1>
  <p>${message}</p>
  <div class="progress-track"><div class="progress-fill" id="progress"></div></div>
  <script>
    (function(){
      var p = 0;
      var el = document.getElementById('progress');
      function tick(){
        p = Math.min(90, p + Math.random() * 8);
        if(el) el.style.width = p + '%';
        if(p < 90) setTimeout(tick, 400 + Math.random() * 400);
      }
      tick();
    })();
  </script>
</body>
</html>`;
}

const LOADING_DATA_URL = `data:text/html,${encodeURIComponent(getLoadingScreenHtml())}`;

function showMainWindowLoading(title = 'alpacabitollama', message = 'Loading...') {
  if (!mainWindow) return;
  const html = getLoadingScreenHtml(title, message);
  const tempPath = path.join(app.getPath('temp'), 'alpacabitollama-transition.html');
  try {
    fs.writeFileSync(tempPath, html, 'utf8');
    mainWindow.loadFile(tempPath);
  } catch (err) {
    console.error('Failed to write transition HTML:', err.message);
    mainWindow.loadURL(`data:text/html,${encodeURIComponent(html)}`);
  }
}

function getSetupHtml(modelOptions = '') {
  const pngBase64 = getCachedAlpacaPngBase64();
  const logoHtml = pngBase64
    ? `<div class="logo"><img src="data:image/png;base64,${pngBase64}" alt="alpacabitollama" style="width:120px;height:120px;object-fit:contain;" /></div>`
    : '<div class="logo" style="font-size:48px;">🦙</div>';
  // The page below is loaded via mainWindow.loadFile() with the same preload
  // script attached, so window.llamaAPI is available. It exposes both the
  // curated model list and a free-form HuggingFace search/download flow so
  // users are never trapped without a way to obtain a model.
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>alpacabitollama Setup</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: #0d1117;
      padding: 20px;
    }
    .container {
      background: #161b22;
      border: 1px solid #30363d;
      padding: 40px;
      border-radius: 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.4);
      max-width: 700px;
      max-height: 90vh;
      overflow-y: auto;
      text-align: center;
    }
    .logo {
      display: flex;
      justify-content: center;
      align-items: center;
      margin-bottom: 8px;
    }
    .logo img {
      width: 120px;
      height: 120px;
      margin-bottom: 16px;
    }
    h1 { color: #e6edf3; margin-bottom: 8px; text-align: center; font-size: 1.6rem; font-weight: 600; letter-spacing: 0.5px; }
    .subtitle { color: #8b949e; font-size: 0.95rem; margin-bottom: 24px; text-align: center; }
    p { color: #8b949e; line-height: 1.6; margin-bottom: 20px; text-align: left; }
    .category {
      margin-bottom: 25px;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 15px;
      background: #0d1117;
    }
    .category-title {
      font-weight: bold;
      color: #e6edf3;
      margin-bottom: 10px;
      font-size: 16px;
      text-align: left;
    }
    .model-item {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
      padding: 8px;
      border-radius: 4px;
      transition: background 0.2s;
    }
    .model-item:hover {
      background: #1c2128;
    }
    .model-item input[type="checkbox"] {
      margin-right: 10px;
      width: 18px;
      height: 18px;
      accent-color: #667eea;
    }
    .model-item label {
      cursor: pointer;
      flex: 1;
      color: #c9d1d9;
      text-align: left;
    }
    .buttons {
      display: flex;
      gap: 10px;
      margin-top: 20px;
      justify-content: center;
    }
    button {
      background: #667eea;
      color: white;
      border: none;
      padding: 12px 24px;
      font-size: 16px;
      border-radius: 5px;
      cursor: pointer;
      transition: background 0.3s;
    }
    button:hover {
      background: #5568d3;
    }
    button.secondary {
      background: #6c757d;
    }
    button.secondary:hover {
      background: #5a6268;
    }
  </style>
</head>
<body>
  <div class="container">
    ${logoHtml}
    <h1>alpacabitollama</h1>
    <p class="subtitle">Setup — choose at least one model to get started</p>
    <p>Pick a curated model below, or paste any HuggingFace GGUF repo to download a custom one. The app will start automatically once a model is ready.</p>

    <h3 style="color:#e6edf3;text-align:left;margin:8px 0 12px;font-size:1rem;">Curated models</h3>
    ${modelOptions || '<p class="subtitle" style="text-align:left;">No models found. Please use the HuggingFace search below.</p>'}
    <div class="buttons">
      <button onclick="downloadSelected()">Download Selected</button>
      <button class="secondary" onclick="selectNone()">Deselect All</button>
      <button class="secondary" onclick="selectAll()">Select All</button>
    </div>

    <div class="category hf-section" style="margin-top:24px;">
      <div class="category-title">Or download any GGUF from HuggingFace</div>
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <input id="hf-repo" placeholder="author/model-name (e.g. bartowski/Llama-3.2-3B-Instruct-GGUF)"
               style="flex:1;padding:10px;border-radius:5px;border:1px solid #30363d;background:#0d1117;color:#c9d1d9;font-size:14px;" />
        <button onclick="searchHF()">Search</button>
      </div>
      <input id="hf-token" type="password" placeholder="HuggingFace token (optional, for gated models)"
             style="width:100%;padding:10px;border-radius:5px;border:1px solid #30363d;background:#0d1117;color:#c9d1d9;font-size:13px;margin-bottom:8px;" />
      <div id="hf-results" style="text-align:left;color:#c9d1d9;font-size:13px;"></div>
    </div>
  </div>

  <script>
    function selectAll() {
      document.querySelectorAll('input[name="model"]').forEach(cb => cb.checked = true);
    }
    function selectNone() {
      document.querySelectorAll('input[name="model"]').forEach(cb => cb.checked = false);
    }

    function showProgress(msg) {
      let el = document.getElementById('progress-area');
      if (!el) {
        el = document.createElement('div');
        el.id = 'progress-area';
        el.style.cssText = 'margin-top:24px;padding:16px;border-radius:8px;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;font-family:monospace;white-space:pre-wrap;text-align:left;';
        document.querySelector('.container').appendChild(el);
      }
      el.textContent = msg;
    }

    function hideSelectionUI() {
      document.querySelector('.buttons').style.display = 'none';
      document.querySelectorAll('.category').forEach(c => { if (!c.classList.contains('hf-section')) c.style.display = 'none'; });
    }

    async function downloadSelected() {
      try {
        const selected = Array.from(document.querySelectorAll('input[name="model"]:checked')).map(cb => cb.value);
        if (selected.length === 0) {
          alert('Please select at least one model to download, or use the HuggingFace search below.');
          return;
        }
        if (!window.llamaAPI || !window.llamaAPI.setSelectedModels || !window.llamaAPI.downloadModels) {
          alert('App bridge not available. Please restart the application.');
          return;
        }
        await window.llamaAPI.setSelectedModels(selected);
        await window.llamaAPI.downloadModels();
        hideSelectionUI();
        showProgress('Download started... Fetching progress...');
        pollUntilDone();
      } catch (err) {
        alert('Error starting download: ' + (err && err.message ? err.message : String(err)));
        console.error('downloadSelected error:', err);
      }
    }

    async function searchHF() {
      const repo = document.getElementById('hf-repo').value.trim();
      const token = document.getElementById('hf-token').value.trim();
      const resultsEl = document.getElementById('hf-results');
      if (!repo) { resultsEl.textContent = 'Enter a repo id like author/model-name.'; return; }
      if (!window.llamaAPI || !window.llamaAPI.searchHuggingFace) {
        resultsEl.textContent = 'HuggingFace search is unavailable in this build.';
        return;
      }
      resultsEl.textContent = 'Searching ' + repo + '...';
      try {
        const r = await window.llamaAPI.searchHuggingFace(repo, token || undefined);
        if (!r || r.error) { resultsEl.textContent = 'Error: ' + (r && r.error ? r.error : 'Unknown error'); return; }
        const files = (r.modelFiles && r.modelFiles.length ? r.modelFiles : (r.ggufFiles || []));
        if (files.length === 0) { resultsEl.textContent = 'No GGUF files found in ' + r.repoId + '.'; return; }
        resultsEl.innerHTML = '';
        const header = document.createElement('div');
        header.style.cssText = 'margin-bottom:8px;color:#8b949e;';
        header.textContent = r.repoId + ' — ' + files.length + ' GGUF file(s):';
        resultsEl.appendChild(header);
        files.forEach(f => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border:1px solid #30363d;border-radius:4px;margin-bottom:6px;background:#161b22;';
          const label = document.createElement('span');
          label.style.cssText = 'flex:1;margin-right:8px;word-break:break-all;';
          label.textContent = f.filename + (f.sizeFormatted ? '  (' + f.sizeFormatted + ')' : '');
          const btn = document.createElement('button');
          btn.textContent = 'Download';
          btn.style.cssText = 'padding:6px 12px;font-size:13px;';
          btn.onclick = () => downloadHF(r.repoId, f.filename, token);
          row.appendChild(label);
          row.appendChild(btn);
          resultsEl.appendChild(row);
        });
      } catch (err) {
        resultsEl.textContent = 'Search failed: ' + (err && err.message ? err.message : String(err));
      }
    }

    async function downloadHF(repoId, filename, token) {
      if (!window.llamaAPI || !window.llamaAPI.downloadHuggingFaceModel) {
        alert('Download API unavailable.');
        return;
      }
      try {
        await window.llamaAPI.downloadHuggingFaceModel(repoId, filename, token || undefined);
        hideSelectionUI();
        document.querySelector('.hf-section').style.display = 'none';
        showProgress('Downloading ' + filename + ' from ' + repoId + '...');
        pollUntilDone();
      } catch (err) {
        alert('Error starting download: ' + (err && err.message ? err.message : String(err)));
      }
    }

    async function pollUntilDone() {
      const api = window.llamaAPI;
      if (!api || !api.getAllDownloadProgress) {
        showProgress('Progress API not available.');
        return;
      }
      let waitedForFirstEntry = 0;
      const poll = async () => {
        try {
          const list = await api.getAllDownloadProgress();
          // Backend now returns an array; tolerate object form too just in case.
          const entries = Array.isArray(list)
            ? list.map(e => [e.downloadId, e])
            : Object.entries(list || {});
          if (entries.length === 0) {
            // Wait up to 30s for the download to register before warning.
            waitedForFirstEntry += 2000;
            if (waitedForFirstEntry >= 30000) {
              showProgress('No active downloads detected. The request may have failed silently — check console.');
              return;
            }
            showProgress('Waiting for download to start...');
            setTimeout(poll, 2000);
            return;
          }
          const lines = entries.map(([id, v]) => {
            const pct = v.total ? Math.round((v.current / v.total) * 100) : 0;
            const mb = v.current ? (v.current / 1024 / 1024).toFixed(1) : '0';
            const totalMb = v.total ? (v.total / 1024 / 1024).toFixed(1) : '?';
            const status = v.status || 'pending';
            return id + ': ' + status + ' ' + pct + '% (' + mb + ' / ' + totalMb + ' MB)' + (v.error ? ' — ' + v.error : '');
          });
          showProgress(lines.join('\\n'));
          const allDone = entries.every(([_, v]) => v.status === 'completed' || v.status === 'error');
          if (allDone) {
            const hasSuccess = entries.some(([_, v]) => v.status === 'completed');
            if (!hasSuccess) {
              showProgress('All downloads failed.\\n\\n' + lines.join('\\n') + '\\n\\nPick another model above or paste a different HuggingFace repo to retry.');
              // Re-show UI so user can try again
              const buttons = document.querySelector('.buttons');
              if (buttons) buttons.style.display = 'flex';
              document.querySelectorAll('.category').forEach(c => c.style.display = '');
              return;
            }
            showProgress('Downloads complete. Starting app...');
            setTimeout(async () => {
              if (api.goBackToMain) {
                await api.goBackToMain();
              } else {
                location.reload();
              }
            }, 1200);
            return;
          }
          setTimeout(poll, 2000);
        } catch (err) {
          showProgress('Error checking progress: ' + (err && err.message ? err.message : String(err)));
          setTimeout(poll, 3000);
        }
      };
      poll();
    }
  </script>
</body>
</html>`;
}

function loadSettingsWindow() {
  if (!mainWindow) {
    createWindow();
  }
  const settingsHtmlPath = path.join(__dirname, 'settings.html');
  if (fs.existsSync(settingsHtmlPath)) {
    mainWindow.loadFile(settingsHtmlPath);
    mainWindow.show();
    mainWindow.focus();
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'alpacabitollama',
    autoHideMenuBar: true,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: false
    },
    icon: path.join(__dirname, 'resources', 'alpaca.png')
  });

  // Remove the default application menu (File, Edit, View, Window)
  Menu.setApplicationMenu(null);

  // Load initial dark loading screen so the window is never blank
  mainWindow.loadURL(LOADING_DATA_URL);

  // Check if models exist before loading webui
  const validModel = checkModelsExist();
  if (validModel) {
    console.log(`Loading webui with model: ${validModel}`);
    // Auto-start llama-server when models are available
    const serverStarted = await startLlamaServer();
    if (!serverStarted) {
      // Server failed to start (binary or model missing), show setup
      console.error('Failed to start llama-server, showing setup screen');
      const setupHtmlPath = getSetupHtmlPath();
      const setupHtml = getSetupHtml(generateModelOptions());
      try {
        fs.writeFileSync(setupHtmlPath, setupHtml);
      } catch (err) {
        console.error('Failed to write setup.html to userData:', err.message);
      }
      if (fs.existsSync(setupHtmlPath)) {
        mainWindow.loadFile(setupHtmlPath);
      }
    } else {
      // Wait for server to be ready before loading webui
      waitForServerReady('http://localhost:13434/')
        .then(() => {
          console.log('Server is ready, loading webui...');
          showMainWindowLoading('alpacabitollama', 'Launching chat...');
          mainWindow.loadURL('http://localhost:13434');
        })
        .catch((err) => {
          console.error('Server failed to start:', err.message);
          // Force-kill any orphan and retry once
          killProcessOnPort(13434);
          startLlamaServer().then((retryStarted) => {
            if (retryStarted) {
              return waitForServerReady('http://localhost:13434/', 30000);
            }
            throw new Error('Retry failed');
          }).then(() => {
            console.log('Server ready after retry, loading webui...');
            showMainWindowLoading('alpacabitollama', 'Launching chat...');
            mainWindow.loadURL('http://localhost:13434');
          }).catch((retryErr) => {
            console.error('Server retry failed:', retryErr.message);
            const setupHtmlPath = getSetupHtmlPath();
            const setupHtml = getSetupHtml(generateModelOptions());
            try {
              fs.writeFileSync(setupHtmlPath, setupHtml);
            } catch (err) {
              console.error('Failed to write setup.html to userData:', err.message);
            }
            if (fs.existsSync(setupHtmlPath)) {
              mainWindow.loadFile(setupHtmlPath);
            }
          });
        });
    }
  } else {
    // Show setup screen with model selection
    const setupHtmlPath = getSetupHtmlPath();
    const setupHtml = getSetupHtml(generateModelOptions());
    try {
      fs.writeFileSync(setupHtmlPath, setupHtml);
    } catch (err) {
      console.error('Failed to write setup.html to userData:', err.message);
    }
    if (fs.existsSync(setupHtmlPath)) {
      mainWindow.loadFile(setupHtmlPath);
    } else {
      mainWindow.loadURL(LOADING_DATA_URL);
    }
  }

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      
      // Show notification that app is running in tray
      if (process.platform === 'win32' && tray) {
        tray.displayBalloon({
          title: 'alpacabitollama',
          content: 'App is running in the system tray. Click the tray icon to restore.'
        });
      }
    }
  });
}

function createTray() {
  // Create tray icon
  let iconPath;
  if (process.platform === 'win32') {
    iconPath = path.join(__dirname, 'resources', 'alpaca.ico');
  } else {
    iconPath = path.join(__dirname, 'resources', 'alpaca.png');
  }

  // If icon doesn't exist, create a simple one
  if (!fs.existsSync(iconPath)) {
    const nativeIcon = nativeImage.createEmpty();
    tray = new Tray(nativeIcon);
  } else {
    tray = new Tray(iconPath);
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show alpacabitollama',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        loadSettingsWindow();
      }
    },
    {
      label: 'Download Models',
      click: () => {
        downloadModels();
      }
    },
    {
      label: 'Server Status',
      submenu: [
        {
          label: isServerRunning ? 'Running' : 'Stopped',
          enabled: false
        },
        {
          label: 'Start Server',
          click: async () => { await startLlamaServer(); },
          enabled: !isServerRunning
        },
        {
          label: 'Stop Server',
          click: async () => { await stopLlamaServer(); },
          enabled: isServerRunning
        }
      ]
    },
    {
      label: 'View Service Logs',
      click: () => {
        openServiceLogsWindow();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: async () => {
        app.isQuitting = true;
        await stopLlamaServer(5000);
        app.quit();
      }
    }
  ]);

  tray.setToolTip('alpacabitollama');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

async function startLlamaServer() {
  console.log('[startLlamaServer] Called. llamaServerProcess exists:', !!llamaServerProcess);
  if (llamaServerProcess) {
    try {
      process.kill(llamaServerProcess.pid, 0);
      console.log('llama-server is already running (PID:', llamaServerProcess.pid, ')');
      return true;
    } catch (e) {
      console.log('llama-server process is dead, clearing stale reference');
      llamaServerProcess = null;
      isServerRunning = false;
    }
  }

  // Ensure no zombie server is holding the port
  killProcessOnPort(13434);

  // Wait for the OS to release the port
  try {
    console.log('[startLlamaServer] Waiting for port 13434 to be free...');
    await waitForPortFree(13434, 10000);
    console.log('[startLlamaServer] Port 13434 is free.');
  } catch (e) {
    console.error('[startLlamaServer] Port 13434 did not become free in time');
    return false;
  }

  const llamaServerBinary = findLlamaServerBinary();
  if (!llamaServerBinary) {
    console.error('llama-server binary not found');
    return false;
  }

  const modelsDir = getModelsDirectory();

  // Check for explicitly set active model first
  let modelPath = null;
  const activeModelFilename = store.get('activeModelFilename', null);
  if (activeModelFilename) {
    const activeModelPath = path.join(modelsDir, activeModelFilename);
    if (fs.existsSync(activeModelPath)) {
      const stats = fs.statSync(activeModelPath);
      if (stats.size > 1024 * 1024) {
        modelPath = activeModelPath;
        console.log(`Using active model: ${activeModelFilename}`);
      }
    }
  }

  // Fall back to scanning the curated/selected list
  if (!modelPath) {
    const modelsToCheck = getSelectedModels();
    for (const model of modelsToCheck) {
      const currentModelPath = path.join(modelsDir, model.filename);
      if (fs.existsSync(currentModelPath)) {
        const stats = fs.statSync(currentModelPath);
        if (stats.size > 1024 * 1024) {
          modelPath = currentModelPath;
          console.log(`Using model: ${model.filename}`);
          break;
        }
      }
    }
  }

  // Final fallback: scan the whole models directory for ANY valid .gguf file.
  // This catches models downloaded via the HuggingFace search flow that are
  // not present in the curated MODELS_TO_DOWNLOAD list.
  if (!modelPath && fs.existsSync(modelsDir)) {
    try {
      const files = fs.readdirSync(modelsDir);
      for (const f of files) {
        if (!f.toLowerCase().endsWith('.gguf')) continue;
        if (f.toLowerCase().startsWith('mmproj-')) continue;
        const fp = path.join(modelsDir, f);
        const stats = fs.statSync(fp);
        if (stats.size > 1024 * 1024) {
          modelPath = fp;
          console.log(`Using model via directory scan: ${f}`);
          break;
        }
      }
    } catch (err) {
      console.error('Error scanning models directory:', err.message);
    }
  }

  if (!modelPath) {
    console.error('Model not found, please download models first');
    return false;
  }

  const publicDir = getPublicDirectory();

  console.log('Starting llama-server...');
  console.log('Binary:', llamaServerBinary);
  console.log('Model:', modelPath);
  console.log('Public dir:', publicDir);

  const args = [
    '-m', modelPath,
    '--host', '0.0.0.0',
    '--port', '13434'
  ];

  // Check for mmproj (vision/multimodal projector) file
  const mmprojFiles = fs.readdirSync(modelsDir)
    .filter((f) => f.toLowerCase().startsWith('mmproj-') && f.toLowerCase().endsWith('.gguf'))
    .map((f) => path.join(modelsDir, f));
  if (mmprojFiles.length > 0) {
    args.push('--mmproj', mmprojFiles[0]);
    console.log('Using mmproj (vision projector):', mmprojFiles[0]);
  }

  // Only add --path if public directory exists
  if (fs.existsSync(publicDir)) {
    args.push('--path', publicDir);
    console.log('Serving webui from:', publicDir);
  }

  // Prepend bin directory to PATH so sibling DLLs (ggml.dll, llama.dll, etc.)
  // are always resolvable even if the inherited PATH differs between environments.
  // Windows DLL loader also searches the EXE's own directory, so this is an
  // additional safety net.
  const binDir = path.dirname(llamaServerBinary);
  const spawnEnv = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
  };
  const spawnedProcess = spawn(llamaServerBinary, args, { env: spawnEnv });
  llamaServerProcess = spawnedProcess;

  spawnedProcess.stdout.on('data', (data) => {
    appendLog('llama-server', data);
  });

  spawnedProcess.stderr.on('data', (data) => {
    appendLog('llama-server', data);
  });

  spawnedProcess.on('close', (code) => {
    console.log(`llama-server process exited with code ${code}`);
    // Only null out if this is still the current process (prevents race during model switch)
    if (llamaServerProcess === spawnedProcess) {
      llamaServerProcess = null;
      isServerRunning = false;
    }
  });

  // Wait up to 3 s for an immediate crash.  A crash from a missing VC++ runtime
  // or an illegal CPU instruction always produces a non-zero exit code (e.g.
  // 0xC000007B / 0xC0000135 on Windows).  Only flag a non-zero exit as a crash
  // so that a normal code-0 exit in any unusual edge case doesn't cause a false
  // positive and an unnecessary 120-second wait is avoided.
  const crashedEarly = await new Promise((resolve) => {
    let settled = false;
    const guardTimer = setTimeout(() => {
      if (!settled) { settled = true; resolve(false); }
    }, 3000);
    spawnedProcess.once('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(guardTimer);
        if (code !== 0 && code !== null) {
          console.error(`[startLlamaServer] Process exited early with code ${code} — binary crash or missing dependency`);
          resolve(true);
        } else {
          // Code 0 within 3 s is unexpected but not a DLL/CPU crash; don't block.
          console.warn(`[startLlamaServer] Process exited with code ${code} within 3 s`);
          resolve(false);
        }
      }
    });
  });

  if (crashedEarly) {
    llamaServerProcess = null;
    isServerRunning = false;
    return false;
  }

  isServerRunning = true;
  return true;
}

function killProcessOnPort(port) {
  if (process.platform !== 'win32') return;
  try {
    const output = execSync('netstat -ano').toString();
    const lines = output.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('TCP')) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 5 || parts[3] !== 'LISTENING') continue;
      const localAddr = parts[1];
      const portMatch = localAddr.match(/:(\d+)$/);
      if (!portMatch || parseInt(portMatch[1]) !== port) continue;
      const pid = parts[parts.length - 1];
      if (!pid || isNaN(parseInt(pid))) continue;
      try {
        execSync(`taskkill /F /T /PID ${pid}`);
        console.log(`Killed zombie process ${pid} on port ${port}`);
      } catch (e) {
        // Process may have already exited
      }
    }
  } catch (e) {
    // no process on port
  }
  // Nuclear option: kill all llama-server.exe instances regardless of port
  try {
    execSync('taskkill /F /IM llama-server.exe');
    console.log('Killed all llama-server.exe instances');
  } catch (e) {
    // No llama-server.exe processes found
  }
}

async function stopLlamaServer(timeoutMs = 10000) {
  return new Promise((resolve) => {
    if (!llamaServerProcess) {
      killProcessOnPort(13434);
      isServerRunning = false;
      resolve();
      return;
    }

    const processToKill = llamaServerProcess;
    const pid = processToKill.pid;
    let resolved = false;

    // If the process has already exited, resolve immediately
    if (processToKill.exitCode !== null || processToKill.killed) {
      if (llamaServerProcess === processToKill) {
        llamaServerProcess = null;
        isServerRunning = false;
      }
      killProcessOnPort(13434);
      resolve();
      return;
    }

    function finish() {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      // Only clear the global reference if it still points to this process
      if (llamaServerProcess === processToKill) {
        llamaServerProcess = null;
        isServerRunning = false;
      }
      killProcessOnPort(13434);
      resolve();
    }

    // Listen for the process to actually exit
    processToKill.once('close', () => {
      console.log(`llama-server process ${pid} exited`);
      finish();
    });

    // Fallback timeout in case the event never fires
    const timeout = setTimeout(() => {
      console.warn(`Timeout waiting for llama-server ${pid} to exit, forcing cleanup`);
      finish();
    }, timeoutMs);

    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /T /PID ${pid}`);
      } else {
        processToKill.kill('SIGTERM');
      }
    } catch (e) {
      console.error('Error killing llama-server process:', e.message);
      // Process may have already exited between the existence check and the kill attempt
      if (processToKill.exitCode !== null || processToKill.killed) {
        finish();
      }
    }
  });
}

function findLlamaServerBinary() {
  const possiblePaths = [
    // Packaged app with asarUnpack: binary in app.asar.unpacked/bin/
    path.join(__dirname, '..', 'app.asar.unpacked', 'bin', 'llama-server.exe'),
    path.join(__dirname, '..', 'app.asar.unpacked', 'bin', 'llama-server'),
    // Packaged app: binary next to main.js in bin/
    path.join(__dirname, 'bin', 'llama-server.exe'),
    path.join(__dirname, 'bin', 'llama-server'),
    // Development paths
    path.join(__dirname, '..', '..', '..', 'build', 'bin', 'Release', 'llama-server.exe'),
    path.join(__dirname, '..', '..', '..', 'build', 'bin', 'Release', 'llama-server'),
    path.join(__dirname, '..', '..', '..', 'build', 'bin', 'llama-server.exe'),
    path.join(__dirname, '..', '..', '..', 'build', 'bin', 'llama-server'),
    path.join(__dirname, 'llama-server.exe'),
    path.join(__dirname, 'llama-server')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

function getPublicDirectory() {
  // In packaged app with asarUnpack: files are in app.asar.unpacked
  // Must check this FIRST because external processes (llama-server.exe)
  // cannot read from the asar archive, only from unpacked paths
  const unpackedDir = path.join(__dirname, '..', 'app.asar.unpacked', 'public');
  if (fs.existsSync(unpackedDir)) {
    return unpackedDir;
  }
  // In dev: public is in the same directory as main.js
  const devDir = path.join(__dirname, 'public');
  if (fs.existsSync(devDir)) {
    return devDir;
  }
  // Fallback: relative to executable
  const execDir = path.dirname(process.execPath);
  const resourcesDir = path.join(execDir, 'resources');
  const fallbackPaths = [
    path.join(resourcesDir, 'app.asar.unpacked', 'public'),
    path.join(resourcesDir, 'app', 'public'),
    path.join(resourcesDir, 'public')
  ];
  for (const p of fallbackPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return unpackedDir; // Return unpacked path as default even if not found
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const net = require('net');
    const server = net.createServer();
    server.once('error', (err) => {
      server.close();
      resolve(err.code === 'EADDRINUSE');
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port, '127.0.0.1');
  });
}

function waitForPortFree(port, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const checkInterval = 500;

    const check = async () => {
      const inUse = await isPortInUse(port);
      if (!inUse) {
        console.log(`Port ${port} is free`);
        resolve();
        return;
      }
      const elapsed = Date.now() - startTime;
      if (elapsed > timeoutMs) {
        reject(new Error(`Port ${port} did not become free within ${timeoutMs}ms`));
        return;
      }
      setTimeout(check, checkInterval);
    };

    check();
  });
}

function waitForServerReady(url, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const checkInterval = 1000;

    console.log(`Waiting for server at ${url}...`);

    const check = () => {
      const req = http.get(url, (res) => {
        // Any HTTP response means the server is up and listening
        console.log(`Server responded with status: ${res.statusCode}`);
        resolve();
      });

      req.on('error', (err) => {
        const elapsed = Date.now() - startTime;
        if (elapsed > timeoutMs) {
          reject(new Error(`Server did not start within ${timeoutMs}ms: ${err.message}`));
        } else {
          console.log(`Server not ready yet, retrying in ${checkInterval}ms... (${elapsed}ms elapsed)`);
          setTimeout(check, checkInterval);
        }
      });

      req.on('timeout', () => {
        req.destroy();
        const elapsed = Date.now() - startTime;
        if (elapsed > timeoutMs) {
          reject(new Error(`Server did not start within ${timeoutMs}ms: connection timeout`));
        } else {
          console.log(`Server request timed out, retrying... (${elapsed}ms elapsed)`);
          setTimeout(check, checkInterval);
        }
      });
    };

    check();
  });
}

function getModelsDirectory() {
  const modelsDir = path.join(app.getPath('userData'), 'models');
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }
  return modelsDir;
}

function getAppDataDirectory() {
  const appDataDir = app.getPath('userData');
  const subdirs = ['models', 'chats', 'settings', 'logs'];
  for (const subdir of subdirs) {
    const dir = path.join(appDataDir, subdir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  return appDataDir;
}

function getServicesLogPath() {
  return path.join(getAppDataDirectory(), 'logs', 'services.log');
}

function appendLog(source, data) {
  const logPath = getServicesLogPath();
  const lines = data.toString().split(/\r?\n/).filter((l) => l.trim().length > 0);
  const now = new Date().toISOString();
  const entries = lines.map((l) => `[${now}] [${source}] ${l}\n`).join('');
  try {
    fs.appendFileSync(logPath, entries);
  } catch (_) {
    // Ignore write errors to avoid disrupting the main process
  }
  // Also mirror to console
  console.log(`[${source}]`, data.toString().trimEnd());
}

function getChatsDirectory() {
  const chatsDir = path.join(app.getPath('userData'), 'chats');
  if (!fs.existsSync(chatsDir)) {
    fs.mkdirSync(chatsDir, { recursive: true });
  }
  return chatsDir;
}

function openServiceLogsWindow() {
  const logPath = getServicesLogPath();

  // Ensure the file exists so tail/Get-Content don't fail
  if (!fs.existsSync(logPath)) {
    try {
      fs.writeFileSync(logPath, '# Service logs will appear here once a server starts.\n');
    } catch (_) {
      // ignore
    }
  }

  if (process.platform === 'win32') {
    // Use Windows PowerShell (powershell.exe) which is guaranteed on all Windows versions.
    // PowerShell 7 (pwsh.exe) is optional and may not be installed.
    const psCommand = `Get-Content -LiteralPath '${logPath}' -Wait`;
    const child = spawn('powershell.exe', ['-NoExit', '-Command', psCommand], {
      detached: true,
      windowsHide: false,
      stdio: 'ignore',
    });
    child.on('error', (err) => {
      console.error('Failed to open PowerShell for logs:', err.message);
      shell.openPath(logPath);
    });
  } else if (process.platform === 'darwin') {
    const appleScript = `tell application "Terminal" to do script "tail -f '${logPath}'"`;
    try {
      spawn('osascript', ['-e', appleScript], { detached: true, stdio: 'ignore' });
    } catch (err) {
      console.error('Failed to open Terminal for logs:', err);
      shell.openPath(logPath);
    }
  } else {
    // Linux — try common terminal emulators
    const terminals = [
      { cmd: 'gnome-terminal', args: ['--', 'tail', '-f', logPath] },
      { cmd: 'konsole', args: ['-e', 'tail', '-f', logPath] },
      { cmd: 'xterm', args: ['-e', 'tail', '-f', logPath] },
    ];
    let launched = false;
    for (const term of terminals) {
      try {
        const resolved = execSync(`which ${term.cmd}`, { encoding: 'utf8', timeout: 3000 }).trim();
        if (resolved) {
          spawn(term.cmd, term.args, { detached: true, stdio: 'ignore' });
          launched = true;
          break;
        }
      } catch (_) {
        // try next terminal
      }
    }
    if (!launched) {
      // Fallback: open in default editor
      shell.openPath(logPath);
    }
  }
}

function getSettingsDirectory() {
  const settingsDir = path.join(app.getPath('userData'), 'settings');
  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true });
  }
  return settingsDir;
}

function getSelectedModels() {
  const selectedModelsPath = path.join(app.getPath('userData'), 'selectedModels.json');
  const selectedModels = store.get('selectedModels', []);
  if (selectedModels.length > 0) {
    return MODELS_TO_DOWNLOAD.filter(model => selectedModels.includes(model.name));
  }
  // Default to all models if no selection exists
  return MODELS_TO_DOWNLOAD;
}

function setSelectedModels(modelNames) {
  store.set('selectedModels', modelNames);
}

async function downloadModels() {
  const modelsDir = getModelsDirectory();
  const modelsToDownload = getSelectedModels();

  console.log('Starting model downloads...');
  console.log('Models directory:', modelsDir);
  console.log(`Models to download: ${modelsToDownload.length}`);

  const downloadPromises = modelsToDownload.map((model) => {
    return new Promise((resolve) => {
      const modelPath = path.join(modelsDir, model.filename);

      if (fs.existsSync(modelPath)) {
        const stats = fs.statSync(modelPath);
        console.log(`Model ${model.name} already exists (${(stats.size / 1024 / 1024).toFixed(2)} MB), skipping download`);
        resolve({ success: true, skipped: true, filename: model.filename });
        return;
      }

      const downloadId = `builtin/${model.filename}`;
      downloadProgress.set(downloadId, { progress: 0, total: 0, current: 0, status: 'downloading' });

      console.log(`Downloading ${model.name} from ${model.url}`);

      const file = fs.createWriteStream(modelPath);
      // Reason: HF often performs multiple redirects (huggingface.co -> cdn-lfs.hf.co
      // -> signed S3 url) and may 403 user-agent-less requests.
      const requestOptions = {
        headers: { 'User-Agent': 'alpacabitollama/1.0', 'Accept': '*/*' }
      };

      function handleSuccess(stream, totalSize) {
        let downloadedSize = 0;
        stream.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize) {
            const progress = downloadedSize / totalSize;
            downloadProgress.set(downloadId, { progress, total: totalSize, current: downloadedSize, status: 'downloading' });
          } else {
            downloadProgress.set(downloadId, { progress: 0, total: 0, current: downloadedSize, status: 'downloading' });
          }
        });
        stream.pipe(file);
        file.on('finish', () => {
          file.close();
          downloadProgress.set(downloadId, { progress: 1, total: totalSize, current: totalSize, status: 'completed' });
          console.log(`Downloaded ${model.name} successfully`);
          notifyDownloadComplete(model.filename, true);
          resolve({ success: true, filename: model.filename });
        });
      }

      function fail(message) {
        fs.unlink(modelPath, () => {});
        downloadProgress.set(downloadId, { status: 'error', error: message });
        console.error(`Error downloading ${model.name}: ${message}`);
        notifyDownloadComplete(model.filename, false, message);
        resolve({ success: false, error: message });
      }

      function fetchWithRedirects(url, hops) {
        if (hops > 5) { fail('Too many redirects'); return; }
        https.get(url, requestOptions, (response) => {
          const code = response.statusCode;
          if (code === 301 || code === 302 || code === 307 || code === 308) {
            const next = response.headers.location;
            if (!next) { fail(`Redirect ${code} with no Location header`); return; }
            response.resume(); // discard body
            fetchWithRedirects(next, hops + 1);
            return;
          }
          if (code === 200) {
            const totalSize = parseInt(response.headers['content-length'], 10) || 0;
            handleSuccess(response, totalSize);
            return;
          }
          fail(`HTTP ${code}`);
        }).on('error', (err) => fail(err.message));
      }

      fetchWithRedirects(model.url, 0);
    });
  });

  console.log('Model download initiated. Check console for progress.');
  return Promise.all(downloadPromises);
}

// Download progress tracking for HuggingFace downloads
const downloadProgress = new Map();

function searchHuggingFaceRepo(repoId, hfToken) {
  return new Promise((resolve) => {
    // Clean the repo ID to handle various input formats
    const cleanRepoId = repoId
      .replace(/^https?:\/\/huggingface\.co\//, '')
      .replace(/^huggingface\.co\//, '')
      .replace(/\/$/, '')
      .trim();

    if (!cleanRepoId || !cleanRepoId.includes('/')) {
      resolve({ error: 'Invalid repository ID. Format: author/model-name' });
      return;
    }

    const apiUrl = `https://huggingface.co/api/models/${cleanRepoId}?blobs=true&files_metadata=true`;
    const urlObj = new URL(apiUrl);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'alpacabitollama/1.0'
      }
    };

    if (hfToken) {
      options.headers.Authorization = `Bearer ${hfToken}`;
    }

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 404) {
          resolve({ error: 'Repository not found' });
          return;
        }
        if (res.statusCode === 401) {
          resolve({ error: 'Unauthorized. The repository may require a HuggingFace token, or the token provided is invalid.' });
          return;
        }
        if (res.statusCode !== 200) {
          resolve({ error: `Failed to fetch repository: HTTP ${res.statusCode}` });
          return;
        }

        try {
          const repoData = JSON.parse(data);
          const siblings = repoData.siblings || [];
          const allGgufFiles = siblings
            .filter((file) => file.rfilename.toLowerCase().endsWith('.gguf'))
            .map((file) => {
              const size = file.size || file.lfs?.size || 0;
              return {
                filename: file.rfilename,
                size: size,
                sizeFormatted: formatFileSize(size),
                url: `https://huggingface.co/${cleanRepoId}/resolve/main/${file.rfilename}`,
              };
            });

          const mmprojFiles = allGgufFiles.filter((file) =>
            file.filename.toLowerCase().startsWith('mmproj-')
          );
          const modelFiles = allGgufFiles.filter(
            (file) => !file.filename.toLowerCase().startsWith('mmproj-')
          );

          const tags = repoData.tags || [];
          const visionTags = ['vision', 'multimodal', 'image', 'llava', 'bakllava', 'moondream', 'bunny'];
          const hasVisionSupport = visionTags.some((t) =>
            tags.some((tag) => tag.toLowerCase().includes(t))
          ) || mmprojFiles.length > 0;

          resolve({
            repoId: cleanRepoId,
            author: repoData.author,
            modelId: repoData.modelId,
            tags: tags,
            downloads: repoData.downloads || 0,
            modelFiles: modelFiles,
            mmprojFiles: mmprojFiles,
            ggufFiles: modelFiles, // keep for backward compatibility
            hasVisionSupport: hasVisionSupport,
            readme: `https://huggingface.co/${cleanRepoId}/resolve/main/README.md`,
          });
        } catch (parseErr) {
          resolve({ error: 'Failed to parse repository response' });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ error: `Network error: ${err.message}` });
    });

    req.setTimeout(15000, () => {
      req.destroy();
      resolve({ error: 'Request timed out' });
    });

    req.end();
  });
}

function formatFileSize(bytes) {
  if (!bytes) return 'Unknown';
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function getInstalledModels() {
  const modelsDir = getModelsDirectory();
  if (!fs.existsSync(modelsDir)) return [];

  const files = fs.readdirSync(modelsDir);
  const allGgufFiles = files.filter((f) => f.toLowerCase().endsWith('.gguf'));
  const mmprojFiles = allGgufFiles.filter((f) => f.toLowerCase().startsWith('mmproj-'));

  return allGgufFiles
    .filter((f) => !f.toLowerCase().startsWith('mmproj-'))
    .map((f) => {
      const filePath = path.join(modelsDir, f);
      const stats = fs.statSync(filePath);
      return {
        filename: f,
        size: stats.size,
        sizeFormatted: formatFileSize(stats.size),
        modified: stats.mtime.toISOString(),
        path: filePath,
        hasMmproj: mmprojFiles.length > 0,
        mmprojFiles: mmprojFiles,
      };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

async function downloadHuggingFaceModel(repoId, filename, hfToken) {
  return new Promise((resolve, reject) => {
    const modelsDir = getModelsDirectory();
    const cleanRepoId = repoId
      .replace(/^https?:\/\/huggingface\.co\//, '')
      .replace(/\/$/, '')
      .trim();
    const downloadUrl = `https://huggingface.co/${cleanRepoId}/resolve/main/${filename}`;
    const modelPath = path.join(modelsDir, filename);

    // Check if file already exists
    if (fs.existsSync(modelPath)) {
      const stats = fs.statSync(modelPath);
      if (stats.size > 1024 * 1024) {
        resolve({ success: true, skipped: true, filename });
        return;
      }
    }

    const downloadId = `${cleanRepoId}/${filename}`;
    downloadProgress.set(downloadId, { progress: 0, total: 0, current: 0, status: 'downloading' });

    const headers = {};
    if (hfToken) {
      headers.Authorization = `Bearer ${hfToken}`;
    }

    const file = fs.createWriteStream(modelPath);

    https.get(downloadUrl, { headers }, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302 ||
          response.statusCode === 307 || response.statusCode === 308) {
        const redirectUrl = response.headers.location;
        https.get(redirectUrl, { headers }, (redirectResponse) => {
          handleDownloadResponse(redirectResponse, file, filename, downloadId, resolve, reject);
        }).on('error', (err) => {
          fs.unlink(modelPath, () => {});
          downloadProgress.set(downloadId, { status: 'error', error: err.message });
          reject(err);
        });
      } else {
        handleDownloadResponse(response, file, filename, downloadId, resolve, reject);
      }
    }).on('error', (err) => {
      fs.unlink(modelPath, () => {});
      downloadProgress.set(downloadId, { status: 'error', error: err.message });
      reject(err);
    });
  });
}

function handleDownloadResponse(response, file, filename, downloadId, resolve, reject) {
  if (response.statusCode !== 200) {
    fs.unlink(file.path || '', () => {});
    downloadProgress.set(downloadId, { status: 'error', error: `HTTP ${response.statusCode}` });
    reject(new Error(`Download failed: HTTP ${response.statusCode}`));
    return;
  }

  const totalSize = parseInt(response.headers['content-length'], 10) || 0;
  let downloadedSize = 0;

  downloadProgress.set(downloadId, { progress: 0, total: totalSize, current: 0, status: 'downloading' });

  response.on('data', (chunk) => {
    downloadedSize += chunk.length;
    const progress = totalSize ? downloadedSize / totalSize : 0;
    downloadProgress.set(downloadId, {
      progress,
      total: totalSize,
      current: downloadedSize,
      status: 'downloading',
    });
  });

  response.pipe(file);

  file.on('finish', () => {
    file.close();
    downloadProgress.set(downloadId, {
      progress: 1,
      total: totalSize,
      current: totalSize,
      status: 'completed',
    });
    notifyDownloadComplete(filename, true);
    resolve({ success: true, filename });
  });

  file.on('error', (err) => {
    fs.unlink(file.path || '', () => {});
    downloadProgress.set(downloadId, { status: 'error', error: err.message });
    notifyDownloadComplete(filename, false, err.message);
    reject(err);
  });
}

function getDownloadProgress(downloadId) {
  return downloadProgress.get(downloadId) || null;
}

function getAllDownloadProgress() {
  // Include all statuses (downloading, completed, error) so the setup screen
  // can detect when downloads finish and auto-transition to the webui.
  // The webui Models tab also consumes this and was already tolerant of
  // non-downloading entries.
  const result = [];
  for (const [downloadId, progress] of downloadProgress.entries()) {
    result.push({ downloadId, ...progress });
  }
  return result;
}

function notifyDownloadComplete(filename, success, errorMessage) {
  const { BrowserWindow } = require('electron');
  BrowserWindow.getAllWindows().forEach((win) => {
    try {
      win.webContents.send('download-complete', { filename, success, error: errorMessage || null });
    } catch (_) {
      // Window may have been destroyed
    }
  });
}

function deleteModel(filename) {
  const modelsDir = getModelsDirectory();
  const modelPath = path.join(modelsDir, filename);
  if (fs.existsSync(modelPath)) {
    fs.unlinkSync(modelPath);
    return true;
  }
  return false;
}

function getStorageInfo() {
  const appDataDir = getAppDataDirectory();
  const modelsDir = getModelsDirectory();
  const chatsDir = getChatsDirectory();

  const getDirSize = (dir) => {
    if (!fs.existsSync(dir)) return 0;
    let total = 0;
    const files = fs.readdirSync(dir);
    for (const f of files) {
      const fp = path.join(dir, f);
      const s = fs.statSync(fp);
      total += s.size;
    }
    return total;
  };

  return {
    appDataDir,
    modelsSize: getDirSize(modelsDir),
    chatsSize: getDirSize(chatsDir),
    totalSize: getDirSize(appDataDir),
  };
}

let loadingWindow = null;

function getLoadingWindowHtml(pngBase64, title = 'alpacabitollama', message = 'Preparing your model...') {
  const imgHtml = pngBase64
    ? `<img src="data:image/png;base64,${pngBase64}" alt="alpacabitollama" style="width:80px;height:80px;margin-bottom:16px;object-fit:contain;" />`
    : '';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      height: 100vh;
      background: #0f0f0f;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      text-align: center;
      padding: 20px;
    }
    h1 { font-size: 1.2rem; font-weight: 600; margin-bottom: 6px; color: #fff; }
    p { font-size: 0.8rem; color: #999; margin-bottom: 20px; }
    .progress-track {
      width: 240px;
      height: 4px;
      background: rgba(255,255,255,0.08);
      border-radius: 2px;
      overflow: hidden;
    }
    .progress-fill {
      width: 0%;
      height: 100%;
      background: #10a37f;
      border-radius: 2px;
      transition: width 0.3s ease;
    }
    .status { margin-top: 12px; font-size: 0.75rem; color: #666; }
  </style>
</head>
<body>
  ${imgHtml}
  <h1>${title}</h1>
  <p>${message}</p>
  <div class="progress-track"><div class="progress-fill" id="progress"></div></div>
  <div class="status" id="status">Initializing...</div>
  <script>
    (function(){
      var stages = [
        {p: 10, msg: 'Copying model file...'},
        {p: 30, msg: 'Verifying model...'},
        {p: 60, msg: 'Preparing workspace...'},
        {p: 90, msg: 'Almost ready...'}
      ];
      var el = document.getElementById('progress');
      var st = document.getElementById('status');
      stages.forEach(function(s, i){
        setTimeout(function(){
          if(el) el.style.width = s.p + '%';
          if(st) st.textContent = s.msg;
        }, i * 800);
      });
    })();
  </script>
</body>
</html>`;
}

function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 480,
    height: 320,
    show: false,
    frame: false,
    transparent: false,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  const pngBase64 = getCachedAlpacaPngBase64();
  const html = getLoadingWindowHtml(pngBase64);
  // Write to a temp file to avoid data-URL size limits and encoding issues
  const tempHtmlPath = path.join(app.getPath('temp'), 'alpacabitollama-loading.html');
  try {
    fs.writeFileSync(tempHtmlPath, html, 'utf8');
    loadingWindow.loadFile(tempHtmlPath);
  } catch (err) {
    console.error('Failed to write loading HTML, falling back to data URL:', err.message);
    loadingWindow.loadURL(`data:text/html,${encodeURIComponent(html)}`);
  }
  loadingWindow.once('ready-to-show', () => {
    loadingWindow.show();
  });
}

function closeLoadingWindow() {
  if (loadingWindow) {
    loadingWindow.close();
    loadingWindow = null;
  }
}

async function copyDefaultModelIfNeeded() {
  const modelsDir = getModelsDirectory();
  let existingModels = [];
  try {
    existingModels = fs.readdirSync(modelsDir).filter(f => f.toLowerCase().endsWith('.gguf'));
  } catch (_) { /* directory may not exist yet */ }

  if (existingModels.length === 0) {
    const bundledModelPaths = [
      // Bundled inside asar (fs copy works on asar paths)
      path.join(__dirname, 'resources', 'models', 'Bonsai-4B.gguf'),
      // Unpacked resources/ (if ever added to asarUnpack)
      path.join(__dirname, '..', 'app.asar.unpacked', 'resources', 'models', 'Bonsai-4B.gguf'),
      // Fallback via process.resourcesPath
      path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'models', 'Bonsai-4B.gguf'),
      path.join(process.resourcesPath, 'app', 'resources', 'models', 'Bonsai-4B.gguf')
    ];

    for (const bundledPath of bundledModelPaths) {
      if (fs.existsSync(bundledPath)) {
        try {
          const destPath = path.join(modelsDir, 'Bonsai-4B.gguf');
          await fs.promises.copyFile(bundledPath, destPath);
          console.log(`Copied default model to: ${destPath}`);
          return true;
        } catch (err) {
          console.error('Failed to copy default model:', err.message);
        }
      }
    }
  }
  return false;
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  getAppDataDirectory();

  const modelsDir = getModelsDirectory();
  let existingModels = [];
  try {
    existingModels = fs.readdirSync(modelsDir).filter(f => f.toLowerCase().endsWith('.gguf'));
  } catch (_) {}

  if (existingModels.length === 0) {
    createLoadingWindow();
    await copyDefaultModelIfNeeded();
    closeLoadingWindow();
  }

  await createWindow();
  createTray();

  // Don't auto-download models - let user do it manually from tray
  // Don't auto-start server - let user do it manually from tray
});

app.on('window-all-closed', () => {
  // Don't quit on window close, keep running in tray
});

app.on('before-quit', async (event) => {
  if (app.isQuitting && !llamaServerProcess) return;
  if (llamaServerProcess) {
    event.preventDefault();
    app.isQuitting = true;
    try {
      await stopLlamaServer(5000);
    } catch (_) {
      // ignore cleanup errors
    }
    app.quit();
  } else {
    // Safety net: force-kill any orphan llama-server.exe
    killProcessOnPort(13434);
  }
});

app.on('quit', () => {
  killProcessOnPort(13434);
});

// ============================================================================
// User Authentication
// ============================================================================

const crypto = require('crypto');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function registerUser(username, password, email, bio) {
  const users = store.get('users', []);
  if (users.find(u => u.username === username)) {
    return { success: false, error: 'Username already exists' };
  }
  const newUser = {
    id: crypto.randomUUID(),
    username,
    passwordHash: hashPassword(password),
    email: email || '',
    bio: bio || '',
    avatar: '',
    createdAt: Date.now()
  };
  users.push(newUser);
  store.set('users', users);
  // Auto-login after registration
  const { passwordHash, ...safeUser } = newUser;
  store.set('currentUser', safeUser);
  return { success: true, user: safeUser };
}

function loginUser(username, password) {
  const users = store.get('users', []);
  const user = users.find(u => u.username === username);
  if (!user) {
    return { success: false, error: 'User not found' };
  }
  if (user.passwordHash !== hashPassword(password)) {
    return { success: false, error: 'Invalid password' };
  }
  const { passwordHash, ...safeUser } = user;
  store.set('currentUser', safeUser);
  return { success: true, user: safeUser };
}

function getCurrentUser() {
  return store.get('currentUser', null);
}

function logoutUser() {
  store.delete('currentUser');
  return { success: true };
}

function updateUserProfile(updates) {
  const currentUser = store.get('currentUser', null);
  if (!currentUser) {
    return { success: false, error: 'Not logged in' };
  }
  const users = store.get('users', []);
  const idx = users.findIndex(u => u.id === currentUser.id);
  if (idx === -1) {
    return { success: false, error: 'User not found' };
  }
  const allowed = ['email', 'bio', 'avatar'];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      users[idx][key] = updates[key];
      currentUser[key] = updates[key];
    }
  }
  store.set('users', users);
  store.set('currentUser', currentUser);
  return { success: true, user: currentUser };
}

// ============================================================================
// Web Search
// ============================================================================

/**
 * Resolve DuckDuckGo redirect URLs to the actual destination.
 * DDG wraps every result in //duckduckgo.com/l/?uddg=<encoded_url>
 * so we decode the uddg parameter to get the real URL.
 */
function resolveDdgUrl(raw) {
  if (!raw) return raw;
  const uddg = raw.match(/[?&]uddg=([^&]+)/);
  if (uddg) {
    try { return decodeURIComponent(uddg[1]); } catch (_) { /* fallthrough */ }
  }
  if (raw.startsWith('//')) return 'https:' + raw;
  return raw;
}

async function performWebSearch(query, maxResults = 5) {
  return new Promise((resolve) => {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    https.get(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const results = [];
          // Simple regex extraction of DuckDuckGo results
          const resultBlocks = data.match(/<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g) || [];
          const snippetBlocks = data.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g) || [];
          for (let i = 0; i < Math.min(resultBlocks.length, maxResults); i++) {
            const linkMatch = resultBlocks[i].match(/href="([^"]+)"/);
            const titleMatch = resultBlocks[i].replace(/<[^>]+>/g, ' ').trim();
            const snippetMatch = snippetBlocks[i] ? snippetBlocks[i].replace(/<[^>]+>/g, ' ').trim() : '';
            if (linkMatch) {
              results.push({
                title: titleMatch,
                url: resolveDdgUrl(linkMatch[1]),
                snippet: snippetMatch
              });
            }
          }
          resolve({ success: true, results });
        } catch (err) {
          console.error('Web search parsing error:', err);
          resolve({ success: false, error: 'Failed to parse search results' });
        }
      });
    }).on('error', (err) => {
      console.error('Web search request error:', err);
      resolve({ success: false, error: 'Failed to perform web search' });
    });
  });
}

function extractTextFromHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchWebPage(rawUrl) {
  try {
    // Node.js fetch cannot parse protocol-relative URLs (//host/path).
    // Fix them up before the request.
    let url = rawUrl;
    if (url.startsWith('//')) {
      url = 'https:' + url;
    }
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        // Accept-Encoding is intentionally omitted — Node.js undici handles
        // automatic decompression and may skip it if the header is explicit.
        'Cache-Control': 'no-cache',
        'DNT': '1',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    const text = extractTextFromHtml(html);
    return { success: true, content: text.substring(0, 12000), url };
  } catch (err) {
    console.error('Fetch page error:', err);
    return { success: false, error: err.message || 'Failed to fetch page' };
  }
}

// IPC handlers for renderer process
ipcMain.handle('get-server-status', () => {
  return isServerRunning;
});

ipcMain.handle('start-server', async () => {
  const started = await startLlamaServer();
  return started && isServerRunning;
});

ipcMain.handle('stop-server', async () => {
  await stopLlamaServer();
  return !isServerRunning;
});

ipcMain.handle('download-models', () => {
  // Fire-and-forget so the renderer UI stays responsive during multi-GB downloads
  downloadModels().catch((err) => {
    console.error('Background download error:', err);
  });
  return true;
});

ipcMain.handle('get-models-directory', () => {
  return getModelsDirectory();
});

ipcMain.handle('set-selected-models', (event, modelNames) => {
  setSelectedModels(modelNames);
  return true;
});

ipcMain.handle('get-selected-models', () => {
  return store.get('selectedModels', []);
});

// App data directory IPC handlers
ipcMain.handle('get-app-data-directory', () => {
  return getAppDataDirectory();
});

ipcMain.handle('open-data-folder', () => {
  shell.openPath(getAppDataDirectory());
});

// Model management IPC handlers
ipcMain.handle('get-installed-models', () => {
  return getInstalledModels();
});

ipcMain.handle('get-active-model', () => {
  return store.get('activeModelFilename', null);
});

ipcMain.handle('delete-model', (event, filename) => {
  return deleteModel(filename);
});

// HuggingFace search and download IPC handlers
ipcMain.handle('search-huggingface', async (event, repoId, hfToken) => {
  return searchHuggingFaceRepo(repoId, hfToken);
});

ipcMain.handle('download-huggingface-model', async (event, repoId, filename, hfToken) => {
  const cleanRepoId = repoId
    .replace(/^https?:\/\/huggingface\.co\//, '')
    .replace(/\/$/, '')
    .trim();
  const downloadId = `${cleanRepoId}/${filename}`;

  // Start download in background so the UI can poll progress via get-download-progress
  downloadHuggingFaceModel(repoId, filename, hfToken).catch((err) => {
    console.error('Background download failed:', err);
  });

  return { downloadId, started: true };
});

ipcMain.handle('get-download-progress', (event, downloadId) => {
  return getDownloadProgress(downloadId);
});

ipcMain.handle('get-all-download-progress', () => {
  return getAllDownloadProgress();
});

// Storage info IPC handler
ipcMain.handle('get-storage-info', () => {
  return getStorageInfo();
});

// Broadcast model-switch progress to all renderers (settings + main chat).
function broadcastSwitchStatus(payload) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send('model-switch-status', payload);
    }
  }
}

// Switch active model and restart server
ipcMain.handle('switch-model', async (event, filename) => {
  console.log(`[switch-model] IPC called for: ${filename}`);
  const modelsDir = getModelsDirectory();
  const modelPath = path.join(modelsDir, filename);
  console.log(`[switch-model] Checking model path: ${modelPath}`);
  if (!fs.existsSync(modelPath)) {
    console.error(`[switch-model] Model file not found: ${modelPath}`);
    return { success: false, error: 'Model file not found' };
  }
  const stats = fs.statSync(modelPath);
  if (stats.size <= 1024 * 1024) {
    console.error(`[switch-model] Model file too small: ${stats.size} bytes`);
    return { success: false, error: 'Model file is too small or incomplete' };
  }

  console.log(`[switch-model] Setting activeModelFilename to: ${filename}`);
  store.set('activeModelFilename', filename);

  // Restart server if it's running
  const portBusy = await isPortInUse(13434);
  console.log(`[switch-model] llamaServerProcess: ${!!llamaServerProcess}, portBusy: ${portBusy}`);
  if (llamaServerProcess || portBusy) {
    console.log(`Gracefully switching to model: ${filename}`);
    try {
      broadcastSwitchStatus({ phase: 'stopping', filename });
      // 1. Stop the old server gracefully and wait for process exit
      await stopLlamaServer(15000);

      // 1b. Aggressively kill any remaining process on the port
      killProcessOnPort(13434);

      // 2. Wait for port to be fully freed (old process + children gone)
      try {
        await waitForPortFree(13434, 10000);
      } catch (e) {
        console.warn('Port not fully freed after stop, forcing another kill');
        killProcessOnPort(13434);
        await waitForPortFree(13434, 10000);
      }

      // 3. Start new server with the new model
      broadcastSwitchStatus({ phase: 'starting', filename });
      const started = await startLlamaServer();
      if (!started) {
        broadcastSwitchStatus({ phase: 'error', filename, error: 'Failed to start server with new model' });
        return { success: false, error: 'Failed to start server with new model' };
      }

      // 4. Wait for new server to be ready before telling UI it's done
      broadcastSwitchStatus({ phase: 'waiting-ready', filename });
      await waitForServerReady('http://localhost:13434/', 120000);
      console.log(`Server ready with model: ${filename}`);

      // 5. Reload the main chat window so the SSE connection is re-established
      // against the freshly-restarted server.
      if (mainWindow && !mainWindow.isDestroyed()) {
        const currentUrl = mainWindow.webContents.getURL();
        if (currentUrl.startsWith('http://localhost:13434')) {
          mainWindow.webContents.reload();
        }
      }

      broadcastSwitchStatus({ phase: 'ready', filename });
      return { success: true, restarted: true, ready: true };
    } catch (err) {
      console.error('Model switch failed:', err.message);
      // Attempt cleanup if something went wrong
      try {
        await stopLlamaServer(5000);
      } catch (_) { /* ignore cleanup errors */ }
      broadcastSwitchStatus({ phase: 'error', filename, error: err.message });
      return { success: false, error: err.message };
    }
  }

  broadcastSwitchStatus({ phase: 'ready', filename });
  return { success: true, restarted: false };
});

async function transitionToMainApp() {
  if (!mainWindow) return;
  const validModel = checkModelsExist();
  if (validModel) {
    if (!isServerRunning) {
      const started = await startLlamaServer();
      if (!started) {
        const setupHtmlPath = getSetupHtmlPath();
        const setupHtml = getSetupHtml(generateModelOptions());
        try { fs.writeFileSync(setupHtmlPath, setupHtml); } catch (err) {
          console.error('Failed to write setup.html:', err.message);
        }
        if (fs.existsSync(setupHtmlPath)) mainWindow.loadFile(setupHtmlPath);
        return;
      }
    }
    showMainWindowLoading('alpacabitollama', 'Launching chat...');
    await waitForServerReady('http://localhost:13434/', 15000);
    mainWindow.loadURL('http://localhost:13434');
  } else {
    const setupHtmlPath = getSetupHtmlPath();
    const setupHtml = getSetupHtml(generateModelOptions());
    try { fs.writeFileSync(setupHtmlPath, setupHtml); } catch (err) {
      console.error('Failed to write setup.html:', err.message);
    }
    if (fs.existsSync(setupHtmlPath)) {
      mainWindow.loadFile(setupHtmlPath);
    }
  }
}

// ============================================================
// Embedded jCodeMunch MCP Client
// ============================================================
// Spawns jcodemunch-mcp as a stdio subprocess and communicates
// via JSON-RPC 2.0. Provides structured code retrieval for web
// search results, file uploads, and local workspace folders.
//
// Uses a bundled standalone binary if available (no Python required),
// otherwise falls back to system Python 3.10+ with jcodemunch-mcp.
// Storage:  %APPDATA%/alpacabitollama/jcodemunch/
//

let jcmProcess = null;
let jcmRequestId = 0;
const jcmPending = new Map();
let jcmInitialized = false;
let jcmCapabilities = null;
let jcmStoragePath = path.join(getAppDataDirectory(), 'jcodemunch');

function ensureJcmStorage() {
  if (!fs.existsSync(jcmStoragePath)) {
    fs.mkdirSync(jcmStoragePath, { recursive: true });
  }
  return jcmStoragePath;
}

function detectPython() {
  const candidates = ['python3', 'python', 'py'];
  for (const bin of candidates) {
    try {
      const out = execSync(`${bin} --version`, { encoding: 'utf8', timeout: 5000 });
      console.log(`[JCM] Found ${bin}: ${out.trim()}`);
      return bin;
    } catch (_) {
      // continue
    }
  }
  return null;
}

function detectJcmModule(pythonBin) {
  try {
    execSync(`${pythonBin} -c "import jcodemunch_mcp"`, { timeout: 5000 });
    return true;
  } catch (_) {
    return false;
  }
}

function getBundledJcmBinary() {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const binaryName = isWin
    ? 'jcodemunch-mcp.exe'
    : isMac
      ? 'jcodemunch-mcp-macos'
      : 'jcodemunch-mcp-linux';

  const possiblePaths = [
    // Packaged app with asarUnpack
    path.join(__dirname, '..', 'app.asar.unpacked', 'bin', binaryName),
    // Packaged app / development
    path.join(__dirname, 'bin', binaryName),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

function getJcmCommand() {
  // Prefer bundled standalone binary (no Python required)
  const bundled = getBundledJcmBinary();
  if (bundled) {
    return { binary: bundled, args: [] };
  }

  // Fallback: system Python + pip-installed module
  const python = detectPython();
  if (!python) {
    return { error: 'Python not found. Install Python 3.10+ or bundle jcodemunch-mcp binary to use built-in code retrieval.' };
  }
  if (!detectJcmModule(python)) {
    return { error: 'jcodemunch-mcp not found. Run: pip install jcodemunch-mcp, or bundle the standalone binary.' };
  }
  return { binary: python, args: ['-m', 'jcodemunch_mcp.server'] };
}

async function startJcmClient() {
  if (jcmProcess && !jcmProcess.killed) {
    return { success: true, message: 'Already running' };
  }

  const cmd = getJcmCommand();
  if (cmd.error) {
    return { success: false, error: cmd.error };
  }

  ensureJcmStorage();

  const env = {
    ...process.env,
    JCODEMUNCH_STORAGE_PATH: jcmStoragePath,
    JCODEMUNCH_USE_AI_SUMMARIES: 'false',
  };

  try {
    jcmProcess = spawn(cmd.binary, cmd.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      windowsHide: true,
    });

    jcmProcess.stderr.on('data', (data) => {
      appendLog('jcm', data);
    });

    jcmProcess.on('exit', (code) => {
      console.log(`[JCM] Process exited with code ${code}`);
      jcmInitialized = false;
      jcmProcess = null;
    });

    jcmProcess.on('error', (err) => {
      console.error('[JCM] Process error:', err);
      jcmInitialized = false;
      jcmProcess = null;
    });

    // Read JSON-RPC responses
    let buffer = '';
    jcmProcess.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.id !== undefined && jcmPending.has(msg.id)) {
            const { resolve, reject } = jcmPending.get(msg.id);
            jcmPending.delete(msg.id);
            if (msg.error) {
              reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            } else {
              resolve(msg.result);
            }
          }
        } catch (err) {
          console.warn('[JCM] Failed to parse line:', trimmed.slice(0, 200), err.message);
        }
      }
    });

    // Wait a moment for process to start
    await new Promise((r) => setTimeout(r, 500));

    // Send initialize
    const initResult = await jcmSendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'alpacabitollama', version: '1.0.0' },
    });

    jcmCapabilities = initResult?.capabilities;
    jcmInitialized = true;

    // Send initialized notification
    jcmSendNotification('notifications/initialized', {});

    console.log('[JCM] Initialized successfully');
    return { success: true };
  } catch (err) {
    console.error('[JCM] Failed to start:', err);
    return { success: false, error: err.message };
  }
}

function stopJcmClient() {
  if (jcmProcess && !jcmProcess.killed) {
    jcmProcess.kill();
    jcmProcess = null;
  }
  jcmInitialized = false;
  jcmCapabilities = null;
}

function jcmSendNotification(method, params) {
  if (!jcmProcess || jcmProcess.killed) return;
  const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
  jcmProcess.stdin.write(msg + '\n');
}

function jcmSendRequest(method, params) {
  return new Promise((resolve, reject) => {
    if (!jcmProcess || jcmProcess.killed) {
      reject(new Error('jCodeMunch process not running'));
      return;
    }
    const id = ++jcmRequestId;
    jcmPending.set(id, { resolve, reject });
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    jcmProcess.stdin.write(msg + '\n');

    // Timeout
    setTimeout(() => {
      if (jcmPending.has(id)) {
        jcmPending.delete(id);
        reject(new Error(`jCodeMunch request timeout: ${method}`));
      }
    }, 30000);
  });
}

async function jcmCallTool(toolName, args) {
  if (!jcmInitialized) {
    const startRes = await startJcmClient();
    if (!startRes.success) {
      return { success: false, error: startRes.error };
    }
  }
  try {
    const result = await jcmSendRequest('tools/call', {
      name: toolName,
      arguments: args,
    });
    // Extract text content from MCP result
    let contentText = '';
    let isError = false;
    if (result && result.content) {
      for (const item of result.content) {
        if (item.type === 'text') {
          contentText += item.text;
        }
      }
      isError = !!result.isError;
    }
    return { success: !isError, content: contentText, raw: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Higher-level helpers
async function jcmIndexRepo(repoUrl) {
  return jcmCallTool('index_repo', { url: repoUrl });
}

async function jcmIndexFolder(folderPath) {
  // Normalize path for Windows
  const normalized = path.resolve(folderPath);
  return jcmCallTool('index_folder', { path: normalized });
}

async function jcmSearchSymbols(repo, query, maxResults = 10, kind) {
  const args = { repo, query, max_results: maxResults };
  if (kind) args.kind = kind;
  return jcmCallTool('search_symbols', args);
}

async function jcmGetSymbolSource(repo, symbolId) {
  return jcmCallTool('get_symbol_source', { repo, symbol_id: symbolId });
}

async function jcmListRepos() {
  return jcmCallTool('list_repos', {});
}

async function jcmGetRepoOutline(repo) {
  return jcmCallTool('get_repo_outline', { repo });
}

async function jcmGetFileTree(repo, pathPrefix = '') {
  return jcmCallTool('get_file_tree', { repo, path_prefix: pathPrefix });
}

async function jcmGetFileContent(repo, filePath) {
  return jcmCallTool('get_file_content', { repo, file_path: filePath });
}

async function jcmGetContextBundle(repo, symbolId, includeCallers = false) {
  return jcmCallTool('get_context_bundle', { repo, symbol_id: symbolId, include_callers: includeCallers });
}

async function jcmGetFileOutline(repo, filePath) {
  return jcmCallTool('get_file_outline', { repo, file_path: filePath });
}

async function jcmInvalidateCache(repo) {
  return jcmCallTool('invalidate_cache', { repo });
}

// Health check
async function jcmHealthCheck() {
  const cmd = getJcmCommand();
  if (cmd.error) {
    return { available: false, error: cmd.error };
  }
  if (!jcmInitialized) {
    const startRes = await startJcmClient();
    return { available: startRes.success, error: startRes.error };
  }
  return { available: true };
}

// ============================================================

// Go back to main UI (chat or setup) from settings
ipcMain.handle('go-back-to-main', () => {
  transitionToMainApp();
});

// User authentication IPC handlers
ipcMain.handle('register-user', (event, username, password, email, bio) => {
  return registerUser(username, password, email, bio);
});

ipcMain.handle('login-user', (event, username, password) => {
  return loginUser(username, password);
});

ipcMain.handle('get-current-user', () => {
  return getCurrentUser();
});

ipcMain.handle('logout-user', () => {
  return logoutUser();
});

ipcMain.handle('update-user-profile', (event, updates) => {
  return updateUserProfile(updates);
});

// Web search IPC handlers
ipcMain.handle('web-search', async (event, query, maxResults) => {
  return performWebSearch(query, maxResults);
});

ipcMain.handle('fetch-web-page', async (event, url) => {
  return fetchWebPage(url);
});

// Embedded jCodeMunch IPC handlers
ipcMain.handle('jcm-health-check', async () => {
  return jcmHealthCheck();
});

ipcMain.handle('jcm-index-repo', async (event, repoUrl) => {
  return jcmIndexRepo(repoUrl);
});

ipcMain.handle('jcm-index-folder', async (event, folderPath) => {
  return jcmIndexFolder(folderPath);
});

ipcMain.handle('jcm-search-symbols', async (event, repo, query, maxResults, kind) => {
  return jcmSearchSymbols(repo, query, maxResults, kind);
});

ipcMain.handle('jcm-get-symbol-source', async (event, repo, symbolId) => {
  return jcmGetSymbolSource(repo, symbolId);
});

ipcMain.handle('jcm-list-repos', async () => {
  return jcmListRepos();
});

ipcMain.handle('jcm-get-repo-outline', async (event, repo) => {
  return jcmGetRepoOutline(repo);
});

ipcMain.handle('jcm-get-file-tree', async (event, repo, pathPrefix) => {
  return jcmGetFileTree(repo, pathPrefix);
});

ipcMain.handle('jcm-get-file-content', async (event, repo, filePath) => {
  return jcmGetFileContent(repo, filePath);
});

ipcMain.handle('jcm-get-context-bundle', async (event, repo, symbolId, includeCallers) => {
  return jcmGetContextBundle(repo, symbolId, includeCallers);
});

ipcMain.handle('jcm-get-file-outline', async (event, repo, filePath) => {
  return jcmGetFileOutline(repo, filePath);
});

ipcMain.handle('jcm-invalidate-cache', async (event, repo) => {
  return jcmInvalidateCache(repo);
});

// Local folder picker for workspace indexing
ipcMain.handle('select-local-folder', async () => {
  if (!mainWindow) return { canceled: true };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select a local folder to index for code context',
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }
  return { canceled: false, folderPath: result.filePaths[0] };
});
