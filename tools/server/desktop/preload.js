const { contextBridge, ipcRenderer } = require('electron');

const downloadCompleteCallbacks = new Map();
const modelSwitchStatusCallbacks = new Map();

contextBridge.exposeInMainWorld('llamaAPI', {
  getServerStatus: () => ipcRenderer.invoke('get-server-status'),
  startServer: () => ipcRenderer.invoke('start-server'),
  stopServer: () => ipcRenderer.invoke('stop-server'),
  downloadModels: () => ipcRenderer.invoke('download-models'),
  getModelsDirectory: () => ipcRenderer.invoke('get-models-directory'),
  setSelectedModels: (modelNames) => ipcRenderer.invoke('set-selected-models', modelNames),
  getSelectedModels: () => ipcRenderer.invoke('get-selected-models'),
  // App data
  getAppDataDirectory: () => ipcRenderer.invoke('get-app-data-directory'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  // Model management
  getInstalledModels: () => ipcRenderer.invoke('get-installed-models'),
  getActiveModel: () => ipcRenderer.invoke('get-active-model'),
  deleteModel: (filename) => ipcRenderer.invoke('delete-model', filename),
  switchModel: (filename) => ipcRenderer.invoke('switch-model', filename),
  onModelSwitchStatus: (callback) => {
    const wrapper = (event, data) => callback(data);
    modelSwitchStatusCallbacks.set(callback, wrapper);
    ipcRenderer.on('model-switch-status', wrapper);
  },
  offModelSwitchStatus: (callback) => {
    const wrapper = modelSwitchStatusCallbacks.get(callback);
    if (wrapper) {
      ipcRenderer.removeListener('model-switch-status', wrapper);
      modelSwitchStatusCallbacks.delete(callback);
    }
  },
  // HuggingFace search and download
  searchHuggingFace: (repoId, hfToken) => ipcRenderer.invoke('search-huggingface', repoId, hfToken),
  downloadHuggingFaceModel: (repoId, filename, hfToken) => ipcRenderer.invoke('download-huggingface-model', repoId, filename, hfToken),
  getDownloadProgress: (downloadId) => ipcRenderer.invoke('get-download-progress', downloadId),
  getAllDownloadProgress: () => ipcRenderer.invoke('get-all-download-progress'),
  // Storage info
  getStorageInfo: () => ipcRenderer.invoke('get-storage-info'),
  // Navigation
  goBackToMain: () => ipcRenderer.invoke('go-back-to-main'),
  // Download notifications
  onDownloadComplete: (callback) => {
    const wrapper = (event, data) => callback(data);
    downloadCompleteCallbacks.set(callback, wrapper);
    ipcRenderer.on('download-complete', wrapper);
  },
  offDownloadComplete: (callback) => {
    const wrapper = downloadCompleteCallbacks.get(callback);
    if (wrapper) {
      ipcRenderer.removeListener('download-complete', wrapper);
      downloadCompleteCallbacks.delete(callback);
    }
  },
  // User authentication
  registerUser: (username, password, email, bio) => ipcRenderer.invoke('register-user', username, password, email, bio),
  loginUser: (username, password) => ipcRenderer.invoke('login-user', username, password),
  getCurrentUser: () => ipcRenderer.invoke('get-current-user'),
  logoutUser: () => ipcRenderer.invoke('logout-user'),
  updateUserProfile: (updates) => ipcRenderer.invoke('update-user-profile', updates),
  // Web search
  webSearch: (query, maxResults) => ipcRenderer.invoke('web-search', query, maxResults),
  fetchWebPage: (url) => ipcRenderer.invoke('fetch-web-page', url),
  // Embedded jCodeMunch code retrieval
  jcmHealthCheck: () => ipcRenderer.invoke('jcm-health-check'),
  jcmIndexRepo: (repoUrl) => ipcRenderer.invoke('jcm-index-repo', repoUrl),
  jcmIndexFolder: (folderPath) => ipcRenderer.invoke('jcm-index-folder', folderPath),
  jcmSearchSymbols: (repo, query, maxResults, kind) => ipcRenderer.invoke('jcm-search-symbols', repo, query, maxResults, kind),
  jcmGetSymbolSource: (repo, symbolId) => ipcRenderer.invoke('jcm-get-symbol-source', repo, symbolId),
  jcmListRepos: () => ipcRenderer.invoke('jcm-list-repos'),
  jcmGetRepoOutline: (repo) => ipcRenderer.invoke('jcm-get-repo-outline', repo),
  jcmGetFileTree: (repo, pathPrefix) => ipcRenderer.invoke('jcm-get-file-tree', repo, pathPrefix),
  jcmGetFileContent: (repo, filePath) => ipcRenderer.invoke('jcm-get-file-content', repo, filePath),
  jcmGetContextBundle: (repo, symbolId, includeCallers) => ipcRenderer.invoke('jcm-get-context-bundle', repo, symbolId, includeCallers),
  jcmGetFileOutline: (repo, filePath) => ipcRenderer.invoke('jcm-get-file-outline', repo, filePath),
  jcmInvalidateCache: (repo) => ipcRenderer.invoke('jcm-invalidate-cache', repo),
  // Local folder picker
  selectLocalFolder: () => ipcRenderer.invoke('select-local-folder'),
});
