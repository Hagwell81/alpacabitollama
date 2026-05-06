# IPC Channels

Communication between the main process and renderer.

## Overview

Alpacabitollama uses Electron's IPC for secure communication.

## Channels

### System Channels

| Channel | Direction | Description |
|---------|-----------|-------------|
| `app:quit` | Renderer → Main | Quit application |
| `app:minimize` | Renderer → Main | Minimize window |
| `app:maximize` | Renderer → Main | Maximize window |

### Server Channels

| Channel | Direction | Description |
|---------|-----------|-------------|
| `server:start` | Renderer → Main | Start llama.cpp server |
| `server:stop` | Renderer → Main | Stop server |
| `server:status` | Bidirectional | Get server status |
| `server:health-check` | Bidirectional | Health check |

### Model Channels

| Channel | Direction | Description |
|---------|-----------|-------------|
| `model:download` | Renderer → Main | Download model |
| `model:download-progress` | Main → Renderer | Download progress |
| `model:list` | Bidirectional | List models |
| `model:select` | Renderer → Main | Select active model |

### Settings Channels

| Channel | Direction | Description |
|---------|-----------|-------------|
| `settings:get` | Bidirectional | Get settings |
| `settings:set` | Renderer → Main | Set settings |
| `settings:api-config` | Bidirectional | API configuration |

### API Channels

| Channel | Direction | Description |
|---------|-----------|-------------|
| `api:health-check` | Bidirectional | API health status |
| `api:token-count` | Bidirectional | Count tokens |
| `api:queue-status` | Bidirectional | Request queue status |

## Usage Examples

### Main Process

```javascript
// main.js
ipcMain.handle('server:start', async (event, config) => {
  await startServer(config);
  return { success: true };
});
```

### Renderer Process

```javascript
// renderer.js
const result = await window.electronAPI.invoke('server:start', {
  model: 'llama-3',
  port: 13434
});
```

### Preload Script

```javascript
// preload.js
contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, callback) => ipcRenderer.on(channel, callback)
});
```

## Security

All IPC channels are validated:
- Whitelist approach
- Input sanitization
- Error handling
- No node integration in renderer
