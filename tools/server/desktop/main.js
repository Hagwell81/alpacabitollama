/* eslint-env node */
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } = require('electron');
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

// Models to download
const MODELS_TO_DOWNLOAD = [
  // Qwen models
  {
    name: 'Qwen3.6-35B-A3B-GGUF',
    url: 'https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF/resolve/main/Qwen3.6-35B-A3B-GGUF-Q4_K_M.gguf',
    filename: 'Qwen3.6-35B-A3B-GGUF-Q4_K_M.gguf',
    category: 'Qwen'
  },
  {
    name: 'Qwen3.5-9B-GGUF',
    url: 'https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-GGUF-Q4_K_M.gguf',
    filename: 'Qwen3.5-9B-GGUF-Q4_K_M.gguf',
    category: 'Qwen'
  },
  // Gemma models
  {
    name: 'gemma-4-26B-A4B-it-GGUF',
    url: 'https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF/resolve/main/gemma-4-26B-A4B-it-GGUF-Q4_K_M.gguf',
    filename: 'gemma-4-26B-A4B-it-GGUF-Q4_K_M.gguf',
    category: 'Gemma'
  },
  {
    name: 'gemma-4-E4B-it-GGUF',
    url: 'https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-GGUF-Q4_K_M.gguf',
    filename: 'gemma-4-E4B-it-GGUF-Q4_K_M.gguf',
    category: 'Gemma'
  },
  // OpenAI models
  {
    name: 'gpt-oss-20b-GGUF',
    url: 'https://huggingface.co/unsloth/gpt-oss-20b-GGUF/resolve/main/gpt-oss-20b-GGUF-Q4_K_M.gguf',
    filename: 'gpt-oss-20b-GGUF-Q4_K_M.gguf',
    category: 'OpenAI'
  },
  // Mistral models
  {
    name: 'Devstral-Small-2505-GGUF',
    url: 'https://huggingface.co/unsloth/Devstral-Small-2505-GGUF/resolve/main/Devstral-Small-2505-GGUF-Q4_K_M.gguf',
    filename: 'Devstral-Small-2505-GGUF-Q4_K_M.gguf',
    category: 'Mistral'
  },
  {
    name: 'Mistral-Small-24B-Instruct-2501-GGUF',
    url: 'https://huggingface.co/unsloth/Mistral-Small-24B-Instruct-2501-GGUF/resolve/main/Mistral-Small-24B-Instruct-2501-GGUF-Q4_K_M.gguf',
    filename: 'Mistral-Small-24B-Instruct-2501-GGUF-Q4_K_M.gguf',
    category: 'Mistral'
  },
  // Bonsai models
  {
    name: 'Bonsai-8B-gguf',
    url: 'https://huggingface.co/prism-ml/Bonsai-8B-gguf/resolve/main/Bonsai-8B.gguf',
    filename: 'Bonsai-8B.gguf',
    category: 'Bonsai'
  },
  {
    name: 'Bonsai-4B-gguf',
    url: 'https://huggingface.co/prism-ml/Bonsai-4B-gguf/resolve/main/Bonsai-4B.gguf',
    filename: 'Bonsai-4B.gguf',
    category: 'Bonsai'
  },
  {
    name: 'Bonsai-1.7B-gguf',
    url: 'https://huggingface.co/prism-ml/Bonsai-1.7B-gguf/resolve/main/Bonsai-1.7B.gguf',
    filename: 'Bonsai-1.7B.gguf',
    category: 'Bonsai'
  }
];

function checkModelsExist() {
  const modelsDir = getModelsDirectory();
  const modelsToCheck = getSelectedModels();
  
  console.log('Checking for models in:', modelsDir);
  
  // Check if any model exists and is valid
  for (const model of modelsToCheck) {
    const modelPath = path.join(modelsDir, model.filename);
    console.log(`Checking ${model.filename}:`, fs.existsSync(modelPath));
    
    if (fs.existsSync(modelPath)) {
      const stats = fs.statSync(modelPath);
      console.log(`File size: ${stats.size} bytes`);
      // Check if file is larger than 1MB (to avoid corrupted files)
      if (stats.size > 1024 * 1024) {
        console.log(`Valid model found: ${model.filename}`);
        return model.filename; // Return the filename of the valid model
      }
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

function getLoadingGifBase64() {
  const gifPaths = [
    path.join(__dirname, '..', '..', '..', 'media', 'alpaca-load-dark.gif'),
    path.join(__dirname, 'alpaca-load-dark.gif'),
    path.join(process.resourcesPath, 'media', 'alpaca-load-dark.gif')
  ];
  for (const gifPath of gifPaths) {
    try {
      if (fs.existsSync(gifPath)) {
        return fs.readFileSync(gifPath).toString('base64');
      }
    } catch (_) { /* continue */ }
  }
  return null;
}

let cachedLoadingGifBase64 = null;
function getCachedLoadingGifBase64() {
  if (cachedLoadingGifBase64 === null) {
    cachedLoadingGifBase64 = getLoadingGifBase64();
  }
  return cachedLoadingGifBase64;
}

function getLoadingScreenHtml(title = 'alpacabitollama', message = 'Starting...') {
  const gifBase64 = getCachedLoadingGifBase64();
  const gifHtml = gifBase64
    ? `<img src="data:image/gif;base64,${gifBase64}" alt="Loading" style="width:120px;height:120px;margin-bottom:24px;" />`
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
    .logo { margin-bottom: 8px; }
    h1 { font-size: 1.6rem; font-weight: 600; margin-bottom: 8px; letter-spacing: 0.5px; }
    p { font-size: 0.95rem; color: #8b949e; }
  </style>
</head>
<body>
  <div class="logo">${gifHtml}</div>
  <h1>${title}</h1>
  <p>${message}</p>
</body>
</html>`;
}

const LOADING_DATA_URL = `data:text/html,${encodeURIComponent(getLoadingScreenHtml())}`;

function getSetupHtml(modelOptions = '') {
  const gifBase64 = getCachedLoadingGifBase64();
  const gifHtml = gifBase64
    ? `<div class="logo"><img src="data:image/gif;base64,${gifBase64}" alt="alpacabitollama" style="width:120px;height:120px;" /></div>`
    : '<div class="logo" style="font-size:48px;">🦙</div>';
  return `<!DOCTYPE html>
<html>
<head>
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
    ${gifHtml}
    <h1>alpacabitollama</h1>
    <p class="subtitle">Setup</p>
    <p>Select the AI models you want to download. Models are large files (1-10GB each), so choose wisely based on your disk space and needs.</p>
    ${modelOptions}
    <div class="buttons">
      <button onclick="downloadSelected()">Download Selected</button>
      <button class="secondary" onclick="selectNone()">Deselect All</button>
      <button class="secondary" onclick="selectAll()">Select All</button>
    </div>
  </div>
  <script>
    function selectAll() {
      document.querySelectorAll('input[name="model"]').forEach(cb => cb.checked = true);
    }
    function selectNone() {
      document.querySelectorAll('input[name="model"]').forEach(cb => cb.checked = false);
    }
    async function downloadSelected() {
      const selected = Array.from(document.querySelectorAll('input[name="model"]:checked')).map(cb => cb.value);
      if (selected.length === 0) {
        alert('Please select at least one model to download.');
        return;
      }
      if (window.llamaAPI && window.llamaAPI.setSelectedModels) {
        await window.llamaAPI.setSelectedModels(selected);
        await window.llamaAPI.downloadModels();
        alert('Download started! Check the system tray for progress.');
      } else {
        alert('Models selected! Right-click the tray icon and select "Download Models" to begin downloading.');
      }
      location.reload();
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    },
    icon: path.join(__dirname, 'resources', 'icon.png')
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
      if (fs.existsSync(setupHtmlPath)) {
        mainWindow.loadFile(setupHtmlPath);
      }
    } else {
      // Wait for server to be ready before loading webui
      waitForServerReady('http://localhost:13434/')
        .then(() => {
          console.log('Server is ready, loading webui...');
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
            mainWindow.loadURL('http://localhost:13434');
          }).catch((retryErr) => {
            console.error('Server retry failed:', retryErr.message);
            const setupHtmlPath = getSetupHtmlPath();
            if (fs.existsSync(setupHtmlPath)) {
              mainWindow.loadFile(setupHtmlPath);
            }
          });
        });
    }
  } else {
    // Show setup screen with model selection
    const setupHtmlPath = getSetupHtmlPath();
    if (fs.existsSync(setupHtmlPath)) {
      mainWindow.loadFile(setupHtmlPath);
    } else {
      // Create setup HTML file if it doesn't exist
      const setupHtml = getSetupHtml();
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
    iconPath = path.join(__dirname, 'resources', 'icon.ico');
  } else {
    iconPath = path.join(__dirname, 'resources', 'icon.png');
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
  // Check if the stored process reference is actually alive
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
    await waitForPortFree(13434, 10000);
  } catch (e) {
    console.error('Port 13434 is still in use, cannot start server:', e.message);
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

  // Fall back to scanning all available models
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

  const spawnedProcess = spawn(llamaServerBinary, args);
  llamaServerProcess = spawnedProcess;

  spawnedProcess.stdout.on('data', (data) => {
    console.log('llama-server stdout:', data.toString());
  });

  spawnedProcess.stderr.on('data', (data) => {
    console.log('llama-server stderr:', data.toString());
  });

  spawnedProcess.on('close', (code) => {
    console.log(`llama-server process exited with code ${code}`);
    // Only null out if this is still the current process (prevents race during model switch)
    if (llamaServerProcess === spawnedProcess) {
      llamaServerProcess = null;
      isServerRunning = false;
    }
  });

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

      req.setTimeout(5000, () => {
        req.destroy();
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
  const subdirs = ['models', 'chats', 'settings'];
  for (const subdir of subdirs) {
    const dir = path.join(appDataDir, subdir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  return appDataDir;
}

function getChatsDirectory() {
  const chatsDir = path.join(app.getPath('userData'), 'chats');
  if (!fs.existsSync(chatsDir)) {
    fs.mkdirSync(chatsDir, { recursive: true });
  }
  return chatsDir;
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

      https.get(model.url, (response) => {
        function handleSuccess(stream, totalSize) {
          let downloadedSize = 0;
          stream.on('data', (chunk) => {
            downloadedSize += chunk.length;
            if (totalSize) {
              const progress = downloadedSize / totalSize;
              downloadProgress.set(downloadId, { progress, total: totalSize, current: downloadedSize, status: 'downloading' });
              console.log(`Downloading ${model.name}: ${(progress * 100).toFixed(2)}% (${(downloadedSize / 1024 / 1024).toFixed(2)} MB / ${(totalSize / 1024 / 1024).toFixed(2)} MB)`);
            }
          });
          stream.pipe(file);
          file.on('finish', () => {
            file.close();
            downloadProgress.set(downloadId, { progress: 1, total: totalSize, current: totalSize, status: 'completed' });
            console.log(`\nDownloaded ${model.name} successfully`);
            notifyDownloadComplete(model.filename, true);
            resolve({ success: true, filename: model.filename });
          });
        }

        if (response.statusCode === 301 || response.statusCode === 302 ||
            response.statusCode === 307 || response.statusCode === 308) {
          const redirectUrl = response.headers.location;
          console.log(`Following redirect to: ${redirectUrl}`);
          https.get(redirectUrl, (redirectResponse) => {
            if (redirectResponse.statusCode === 200) {
              const totalSize = parseInt(redirectResponse.headers['content-length'], 10);
              handleSuccess(redirectResponse, totalSize);
            } else {
              fs.unlink(modelPath, () => {});
              downloadProgress.set(downloadId, { status: 'error', error: `HTTP ${redirectResponse.statusCode}` });
              console.error(`\nError downloading ${model.name}: HTTP ${redirectResponse.statusCode}`);
              notifyDownloadComplete(model.filename, false, `HTTP ${redirectResponse.statusCode}`);
              resolve({ success: false, error: `HTTP ${redirectResponse.statusCode}` });
            }
          }).on('error', (err) => {
            fs.unlink(modelPath, () => {});
            downloadProgress.set(downloadId, { status: 'error', error: err.message });
            console.error(`\nError downloading ${model.name}: ${err.message}`);
            notifyDownloadComplete(model.filename, false, err.message);
            resolve({ success: false, error: err.message });
          });
        } else if (response.statusCode === 200) {
          const totalSize = parseInt(response.headers['content-length'], 10);
          handleSuccess(response, totalSize);
        } else {
          fs.unlink(modelPath, () => {});
          downloadProgress.set(downloadId, { status: 'error', error: `HTTP ${response.statusCode}` });
          console.error(`\nError downloading ${model.name}: HTTP ${response.statusCode}`);
          notifyDownloadComplete(model.filename, false, `HTTP ${response.statusCode}`);
          resolve({ success: false, error: `HTTP ${response.statusCode}` });
        }
      }).on('error', (err) => {
        fs.unlink(modelPath, () => {});
        downloadProgress.set(downloadId, { status: 'error', error: err.message });
        console.error(`\nError downloading ${model.name}: ${err.message}`);
        notifyDownloadComplete(model.filename, false, err.message);
        resolve({ success: false, error: err.message });
      });
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
  const result = [];
  for (const [downloadId, progress] of downloadProgress.entries()) {
    if (progress.status === 'downloading') {
      result.push({ downloadId, ...progress });
    }
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

function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 480,
    height: 320,
    show: false,
    frame: false,
    transparent: false,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  const loadingHtmlPath = path.join(__dirname, 'loading.html');
  if (fs.existsSync(loadingHtmlPath)) {
    loadingWindow.loadFile(loadingHtmlPath);
  } else {
    loadingWindow.loadURL('data:text/html,<body style="background:#0f0f0f;display:flex;align-items:center;justify-content:center;color:#fff;font-family:sans-serif;"><div>Loading...</div></body>');
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
      path.join(__dirname, 'resources', 'models', 'Bonsai-4B.gguf'),
      path.join(__dirname, '..', 'app.asar.unpacked', 'resources', 'models', 'Bonsai-4B.gguf'),
      path.join(process.resourcesPath, 'models', 'Bonsai-4B.gguf')
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

ipcMain.handle('download-models', async () => {
  await downloadModels();
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

// Switch active model and restart server
ipcMain.handle('switch-model', async (event, filename) => {
  const modelsDir = getModelsDirectory();
  const modelPath = path.join(modelsDir, filename);
  if (!fs.existsSync(modelPath)) {
    return { success: false, error: 'Model file not found' };
  }
  const stats = fs.statSync(modelPath);
  if (stats.size <= 1024 * 1024) {
    return { success: false, error: 'Model file is too small or incomplete' };
  }

  store.set('activeModelFilename', filename);

  // Restart server if it's running
  const portBusy = await isPortInUse(13434);
  if (llamaServerProcess || portBusy) {
    console.log(`Gracefully switching to model: ${filename}`);
    try {
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
      const started = await startLlamaServer();
      if (!started) {
        return { success: false, error: 'Failed to start server with new model' };
      }

      // 4. Wait for new server to be ready before telling UI it's done
      await waitForServerReady('http://localhost:13434/', 120000);
      console.log(`Server ready with model: ${filename}`);

      return { success: true, restarted: true, ready: true };
    } catch (err) {
      console.error('Model switch failed:', err.message);
      // Attempt cleanup if something went wrong
      try {
        await stopLlamaServer(5000);
      } catch (_) { /* ignore cleanup errors */ }
      return { success: false, error: err.message };
    }
  }

  return { success: true, restarted: false };
});

// Go back to main UI (chat or setup) from settings
ipcMain.handle('go-back-to-main', () => {
  if (!mainWindow) return;
  const validModel = checkModelsExist();
  if (validModel && isServerRunning) {
    mainWindow.loadURL('http://localhost:13434');
  } else {
    const setupHtmlPath = getSetupHtmlPath();
    if (fs.existsSync(setupHtmlPath)) {
      mainWindow.loadFile(setupHtmlPath);
    }
  }
});
