# Llama.cpp Desktop Application

A desktop application wrapper for llama.cpp that provides:
- System tray integration with background operation
- Automatic model downloads on first run
- Windows installer support
- Easy access to the llama.cpp WebUI

## Features

- **System Tray**: Minimize to tray, restore from tray, quit from tray
- **First-run setup screen**: Pick from a curated list of GGUF models, or paste any HuggingFace repo (`author/model-name`) to download a custom model. Optional HF token field for gated repos.
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
1. Show a setup screen with two ways to obtain a model:
   - Tick one or more curated GGUF models from the list and click **Download Selected**.
   - Paste any HuggingFace repo id (e.g. `bartowski/Llama-3.2-3B-Instruct-GGUF`) into the HuggingFace search box, click **Search**, then **Download** the file you want. Add a HuggingFace token if the repo is gated.
2. Once the first download completes, the app starts `llama-server` with that model and switches to the WebUI automatically.
3. Models are stored in `%APPDATA%/alpacabitollama/models/` (Windows) or `~/.config/alpacabitollama/models/` (macOS/Linux).

## Built-in Code Retrieval with jCodeMunch

The app includes an embedded **jCodeMunch** client for structured code retrieval directly from the Electron main process — no separate MCP server configuration required. It works for both web search results and local workspace folders.

### Prerequisites (End Users — No Setup Required)

When the app is **packaged with the bundled jCodeMunch binary**, no Python installation is required. The app auto-detects the bundled executable on startup.

### Prerequisites (Development / Source Builds)

If the bundled binary is not present, the app falls back to system Python:

1. Install Python 3.10+ and jcodemunch-mcp:
   ```bash
   pip install jcodemunch-mcp
   ```
2. The app auto-detects Python and the package on startup.

### Bundling the Standalone Binary (for Distribution)

To build a self-contained app with zero external dependencies:

1. Ensure Python 3.10+ is on your PATH.
2. From the desktop directory, run:
   ```bash
   npm run build:jcm
   ```
   This invokes PyInstaller to bundle jcodemunch-mcp into a single executable and places it in `desktop/bin/`.
3. Build the Electron app as usual:
   ```bash
   npm run build
   ```

The resulting installer/portable executable includes the jCodeMunch binary, so end users do not need Python installed.

### Web Search → GitHub Code Context

The Web Search dialog (globe icon in the chat toolbar) supports DuckDuckGo search and page fetching. When jCodeMunch is available, search results that link to GitHub repositories gain a **Code** button:

1. Click the **Code** button on a GitHub result to index the repository
2. The dialog searches the repo for symbols matching your original query
3. Click any symbol to fetch its exact source code
4. Add structured code context to your chat instead of raw HTML

### Local Workspace Folders

Switch to the **Local Workspace** tab in the search dialog to:

1. Click **Select Folder** to browse and index any local project folder
2. Indexed folders appear as searchable repositories
3. Search for symbols across your own codebase using natural language queries
4. Retrieve exact source code for functions, classes, methods, etc.
5. Add precise code context to the chat for AI-assisted development

> **Tip**: jCodeMunch indexes code locally using tree-sitter AST parsing and retrieves exact symbol source via byte offsets. Indexed data is stored in `%APPDATA%/alpacabitollama/jcodemunch/` (Windows) or `~/.config/alpacabitollama/jcodemunch/` (macOS/Linux).

## System Tray Menu

- **Show Llama.cpp**: Restore the main window
- **Server Status**: View and control llama-server
- **Download Models**: Manually trigger model downloads
- **Quit**: Close the application

## Model Downloads

The curated list points to verified `bartowski/*-GGUF` repos on HuggingFace covering Qwen, Llama, Gemma, Mistral, Phi and SmolLM2 (see `MODELS_TO_DOWNLOAD` in `main.js`). For anything else, use the HuggingFace search box on the setup screen or in **Settings → Models** inside the WebUI.

Downloaded models are stored in:
- Windows: `%APPDATA%/alpacabitollama/models/`
- macOS/Linux: `~/.config/alpacabitollama/models/`

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
