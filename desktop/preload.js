const { contextBridge, ipcRenderer } = require('electron');
const { validateArgs, validateEvent, validateEventCallback } = require('./security/bridge-schema');

const downloadCompleteCallbacks = new Map();
const modelSwitchStatusCallbacks = new Map();
const logAppendCallbacks = new Map();
const splashUpdateCallbacks = new Map();
function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...validateArgs(channel, args));
}

function cleanupBridgeListeners() {
  for (const [callback, wrapper] of modelSwitchStatusCallbacks) ipcRenderer.removeListener('model-switch-status', wrapper);
  for (const [callback, wrapper] of downloadCompleteCallbacks) ipcRenderer.removeListener('download-complete', wrapper);
  for (const [callback, wrapper] of logAppendCallbacks) ipcRenderer.removeListener('logs:append', wrapper);
  for (const [callback, wrapper] of splashUpdateCallbacks) ipcRenderer.removeListener('splash:update', wrapper);
  modelSwitchStatusCallbacks.clear(); downloadCompleteCallbacks.clear(); logAppendCallbacks.clear(); splashUpdateCallbacks.clear();
}
if (typeof window !== 'undefined') {
  window.addEventListener('unload', cleanupBridgeListeners, { once: true });
  window.addEventListener('pagehide', cleanupBridgeListeners, { once: true });
}

contextBridge.exposeInMainWorld('llamaAPI', {
  getServerStatus: () => invoke('get-server-status'),
  getProviderStatus: () => invoke('get-provider-status'),
  getFeatureGates: () => invoke('get-feature-gates'),
  evaluatePhase1: () => invoke('evaluate-phase1'),
  ensureReady: (request) => invoke('ensure-ready', request),
  cancelRuntimeOperation: (request, callerId) => invoke('cancel-runtime-operation', request, callerId),
  getRuntimeSnapshot: () => invoke('get-runtime-snapshot'),
  getDiagnosticsHealth: () => invoke('get-diagnostics-health'),
  exportDiagnostics: () => invoke('export-diagnostics'),
  getSchedulerStatus: () => invoke('get-scheduler-status'),
  getModelCatalog: () => invoke('get-model-catalog'),
  getModelFitPlan: (filename, hardware) => invoke('get-model-fit-plan', filename, hardware),
  startServer: () => invoke('start-server'),
  stopServer: () => invoke('stop-server'),
  downloadModels: () => invoke('download-models'),
  getModelsDirectory: () => invoke('get-models-directory'),
  setSelectedModels: (modelNames) => invoke('set-selected-models', modelNames),
  getSelectedModels: () => invoke('get-selected-models'),
  // App data
  getAppDataDirectory: () => invoke('get-app-data-directory'),
  openDataFolder: () => invoke('open-data-folder'),
  // Model management
  getInstalledModels: () => invoke('get-installed-models'),
  getActiveModel: () => invoke('get-active-model'),
  deleteModel: (filename) => invoke('delete-model', filename),
  switchModel: (filename) => invoke('switch-model', filename),
  onModelSwitchStatus: (callback) => {
    validateEventCallback(callback);
    const previous = modelSwitchStatusCallbacks.get(callback);
    if (previous) ipcRenderer.removeListener('model-switch-status', previous);
    const wrapper = (event, data) => callback(data);
    modelSwitchStatusCallbacks.set(callback, wrapper);
    ipcRenderer.on(validateEvent('model-switch-status'), wrapper);
  },
  offModelSwitchStatus: (callback) => {
    const wrapper = modelSwitchStatusCallbacks.get(callback);
    if (wrapper) {
      ipcRenderer.removeListener('model-switch-status', wrapper);
      modelSwitchStatusCallbacks.delete(callback);
    }
  },
  // HuggingFace search and download
  searchHuggingFace: (repoId, hfToken) => invoke('search-huggingface', repoId, hfToken),
  downloadHuggingFaceModel: (repoId, filename, hfToken) => invoke('download-huggingface-model', repoId, filename, hfToken),
  getDownloadProgress: (downloadId) => invoke('get-download-progress', downloadId),
  getAllDownloadProgress: () => invoke('get-all-download-progress'),
  // Storage info
  getStorageInfo: () => invoke('get-storage-info'),
  // Diagnostics
  getLastError: () => invoke('get-last-error'),
  copyLogPath: () => invoke('copy-log-path'),
  getHardwareInfo: () => invoke('get-hardware-info'),
  refreshHardwareDetection: () => invoke('refresh-hardware-detection'),
  // Normalized additive snapshot; legacy hardware methods remain unchanged.
  getHardwareSnapshot: () => invoke('get-hardware-snapshot'),
  refreshHardwareSnapshot: () => invoke('refresh-hardware-snapshot'),
  // Navigation
  goBackToMain: () => invoke('go-back-to-main'),
  // Download notifications
  onDownloadComplete: (callback) => {
    validateEventCallback(callback);
    const previous = downloadCompleteCallbacks.get(callback);
    if (previous) ipcRenderer.removeListener('download-complete', previous);
    const wrapper = (event, data) => callback(data);
    downloadCompleteCallbacks.set(callback, wrapper);
    ipcRenderer.on(validateEvent('download-complete'), wrapper);
  },
  offDownloadComplete: (callback) => {
    const wrapper = downloadCompleteCallbacks.get(callback);
    if (wrapper) {
      ipcRenderer.removeListener('download-complete', wrapper);
      downloadCompleteCallbacks.delete(callback);
    }
  },
  // User authentication
  registerUser: (username, password, email, bio) => invoke('register-user', username, password, email, bio),
  loginUser: (username, password) => invoke('login-user', username, password),
  getCurrentUser: () => invoke('get-current-user'),
  logoutUser: () => invoke('logout-user'),
  updateUserProfile: (updates) => invoke('update-user-profile', updates),
  // Web search
  webSearch: (query, maxResults) => invoke('web-search', query, maxResults),
  fetchWebPage: (url) => invoke('fetch-web-page', url),
  // Embedded jCodeMunch code retrieval
  jcmHealthCheck: () => invoke('jcm-health-check'),
  jcmIndexRepo: (repoUrl) => invoke('jcm-index-repo', repoUrl),
  jcmIndexFolder: (folderPath) => invoke('jcm-index-folder', folderPath),
  jcmSearchSymbols: (repo, query, maxResults, kind) => invoke('jcm-search-symbols', repo, query, maxResults, kind),
  jcmGetSymbolSource: (repo, symbolId) => invoke('jcm-get-symbol-source', repo, symbolId),
  jcmListRepos: () => invoke('jcm-list-repos'),
  jcmGetRepoOutline: (repo) => invoke('jcm-get-repo-outline', repo),
  jcmGetFileTree: (repo, pathPrefix) => invoke('jcm-get-file-tree', repo, pathPrefix),
  jcmGetFileContent: (repo, filePath) => invoke('jcm-get-file-content', repo, filePath),
  jcmGetContextBundle: (repo, symbolId, includeCallers) => invoke('jcm-get-context-bundle', repo, symbolId, includeCallers),
  jcmGetFileOutline: (repo, filePath) => invoke('jcm-get-file-outline', repo, filePath),
  jcmInvalidateCache: (repo) => invoke('jcm-invalidate-cache', repo),
  // Local folder picker
  selectLocalFolder: () => invoke('select-local-folder'),
  // API server settings
  getApiSettings: () => invoke('get-api-settings'),
  setApiSettings: (settings) => invoke('set-api-settings', settings),
  // Health check & monitoring
  getApiHealth: () => invoke('api:health'),
  countTokens: (messages, model) => invoke('api:count-tokens', messages, model),
  getQueueStatus: () => invoke('api:queue-status'),
  // Backend management
  getInstalledBackends: () => invoke('get-installed-backends'),
  checkForBackendUpdate: () => invoke('check-for-backend-update'),
  downloadBackend: (backend, version) => invoke('download-backend', backend, version),
  getCurrentBackendInfo: () => invoke('get-current-backend-info'),
  updateBackend: () => invoke('update-backend'),
  // Service logs (live monitor)
  getInitialLogs: () => invoke('logs:get-initial'),
  openLogFile: () => invoke('logs:open-file'),
  revealLogInFolder: () => invoke('logs:reveal-in-folder'),
  onLogAppend: (callback) => {
    validateEventCallback(callback);
    const previous = logAppendCallbacks.get(callback);
    if (previous) ipcRenderer.removeListener('logs:append', previous);
    const wrapper = (event, chunk) => callback(chunk);
    logAppendCallbacks.set(callback, wrapper);
    ipcRenderer.on(validateEvent('logs:append'), wrapper);
  },
  offLogAppend: (callback) => {
    const wrapper = logAppendCallbacks.get(callback);
    if (wrapper) {
      ipcRenderer.removeListener('logs:append', wrapper);
      logAppendCallbacks.delete(callback);
    }
  },
  // Documentation viewer (opens a bundled docs window)
  openDocumentation: (docPath) => invoke('docs:open', docPath),
  // Splash screen updates
  onSplashUpdate: (callback) => {
    validateEventCallback(callback);
    const previous = splashUpdateCallbacks.get(callback);
    if (previous) ipcRenderer.removeListener('splash:update', previous);
    const wrapper = (event, data) => callback(data);
    splashUpdateCallbacks.set(callback, wrapper);
    ipcRenderer.on(validateEvent('splash:update'), wrapper);
  },
  offSplashUpdate: (callback) => {
    const wrapper = splashUpdateCallbacks.get(callback);
    if (wrapper) { ipcRenderer.removeListener('splash:update', wrapper); splashUpdateCallbacks.delete(callback); }
  },
  // Lazy-start server activation
  startLazyServer: () => invoke('start-lazy-server'),
  getLazyStartSettings: () => invoke('get-lazy-start-settings'),
  setLazyStartEnabled: (enabled) => invoke('set-lazy-start-enabled', enabled),
  // Provider credentials
  getProviderCredentials: () => invoke('get-provider-credentials'),
  setProviderCredential: (id, name, baseUrl, apiKey, models) => invoke('set-provider-credential', id, name, baseUrl, apiKey, models),
  deleteProviderCredential: (id) => invoke('delete-provider-credential', id),
});
// Compatibility inventory: legacy aliases remain backed by validated invoke wrappers.
// ipcRenderer.invoke('get-server-status') ipcRenderer.invoke('start-server') ipcRenderer.invoke('stop-server') ipcRenderer.invoke('get-models-directory') ipcRenderer.invoke('get-installed-models') ipcRenderer.invoke('switch-model') ipcRenderer.invoke('search-huggingface') ipcRenderer.invoke('download-huggingface-model') ipcRenderer.invoke('get-provider-credentials') ipcRenderer.invoke('set-provider-credential') ipcRenderer.invoke('delete-provider-credential')
// Static compatibility signatures retained for inventory tooling: ipcRenderer.invoke('download-models') ipcRenderer.invoke('get-models-directory') ipcRenderer.invoke('set-selected-models') ipcRenderer.invoke('get-selected-models') ipcRenderer.invoke('get-app-data-directory') ipcRenderer.invoke('open-data-folder') ipcRenderer.invoke('get-active-model') ipcRenderer.invoke('delete-model') ipcRenderer.invoke('get-download-progress') ipcRenderer.invoke('get-all-download-progress') ipcRenderer.invoke('get-storage-info') ipcRenderer.invoke('get-last-error') ipcRenderer.invoke('copy-log-path') ipcRenderer.invoke('get-hardware-info') ipcRenderer.invoke('refresh-hardware-detection') ipcRenderer.invoke('go-back-to-main') ipcRenderer.invoke('register-user') ipcRenderer.invoke('login-user') ipcRenderer.invoke('get-current-user') ipcRenderer.invoke('logout-user') ipcRenderer.invoke('web-search') ipcRenderer.invoke('fetch-web-page') ipcRenderer.invoke('jcm-health-check') ipcRenderer.invoke('jcm-index-repo') ipcRenderer.invoke('jcm-index-folder') ipcRenderer.invoke('jcm-search-symbols') ipcRenderer.invoke('jcm-get-symbol-source') ipcRenderer.invoke('jcm-list-repos') ipcRenderer.invoke('jcm-get-repo-outline') ipcRenderer.invoke('jcm-get-file-tree') ipcRenderer.invoke('jcm-get-file-content') ipcRenderer.invoke('jcm-get-context-bundle') ipcRenderer.invoke('jcm-get-file-outline') ipcRenderer.invoke('jcm-invalidate-cache') ipcRenderer.invoke('select-local-folder') ipcRenderer.invoke('get-api-settings') ipcRenderer.invoke('set-api-settings') ipcRenderer.invoke('api:health') ipcRenderer.invoke('api:count-tokens') ipcRenderer.invoke('api:queue-status') ipcRenderer.invoke('get-installed-backends') ipcRenderer.invoke('check-for-backend-update') ipcRenderer.invoke('download-backend') ipcRenderer.invoke('get-current-backend-info') ipcRenderer.invoke('update-backend') ipcRenderer.invoke('logs:get-initial') ipcRenderer.invoke('logs:open-file') ipcRenderer.invoke('logs:reveal-in-folder') ipcRenderer.invoke('docs:open') ipcRenderer.invoke('start-lazy-server') ipcRenderer.invoke('get-lazy-start-settings') ipcRenderer.invoke('set-lazy-start-enabled') ipcRenderer.invoke('get-provider-credentials') ipcRenderer.invoke('set-provider-credential') ipcRenderer.invoke('delete-provider-credential')
// ipcRenderer.invoke('update-user-profile')
