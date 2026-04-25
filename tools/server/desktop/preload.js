const { contextBridge, ipcRenderer } = require('electron');

const downloadCompleteCallbacks = new Map();

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
  deleteModel: (filename) => ipcRenderer.invoke('delete-model', filename),
  switchModel: (filename) => ipcRenderer.invoke('switch-model', filename),
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
});
