# Llama.cpp Desktop Application

A desktop application wrapper for llama.cpp that provides:
- System tray integration with background operation
- Automatic model downloads on first run
- Windows installer support
- Easy access to the llama.cpp WebUI

## Features

- **System Tray**: Minimize to tray, restore from tray, quit from tray
- **Auto Model Downloads**: Downloads Qwen3.5-9B-GGUF and Bonsai-8B-gguf on first launch
- **Background Server**: Automatically starts llama-server in background
- **Windows Installer**: NSIS-based installer for easy deployment

## Prerequisites

1. Build llama.cpp with llama-server
2. Build the webui: `cd tools/server/webui && npm run build`
3. Install Node.js dependencies in this directory

## Installation

```bash
cd tools/server/desktop
npm install
```

## Development

```bash
npm start
```

## Building

```bash
# Build Windows installer
npm run build:installer

# Build portable executable
npm run build:portable

# Build both
npm run build
```

## First Run

On first run, the app will:
1. Download the default models to `%APPDATA%/llama-cpp-desktop/models/`
2. Start llama-server with the first available model
3. Launch the WebUI

## System Tray Menu

- **Show Llama.cpp**: Restore the main window
- **Server Status**: View and control llama-server
- **Download Models**: Manually trigger model downloads
- **Quit**: Close the application

## Model Downloads

Models are downloaded from:
- https://huggingface.co/unsloth/Qwen3.5-9B-GGUF
- https://huggingface.co/prism-ml/Bonsai-8B-gguf

Downloaded models are stored in:
- Windows: `%APPDATA%/llama-cpp-desktop/models/`
- macOS/Linux: `~/.config/llama-cpp-desktop/models/`

## Troubleshooting

### llama-server binary not found
Ensure llama.cpp has been built and the llama-server binary exists in the build directory.

### Models not downloading
Check your internet connection and Hugging Face accessibility.

### WebUI not loading
Ensure the webui has been built: `cd tools/server/webui && npm run build`

## File Structure

```
desktop/
├── main.js           # Electron main process
├── preload.js        # Preload script for security
├── package.json      # Node.js dependencies and scripts
├── resources/        # Icons and assets
├── public/           # Built webui (copied from ../public)
└── models/           # Downloaded models (in userData directory)
```
