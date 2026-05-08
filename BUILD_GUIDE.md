# Alpacabitollama Build Guide

This guide explains how to use the Makefile and build system to generate installer packages for Windows, macOS, and Linux.

## Overview

Alpacabitollama now includes a comprehensive Makefile that simplifies cross-platform building. The build system uses:
- **Makefile**: Cross-platform build orchestration
- **electron-builder**: Packaging for all platforms
- **NSIS**: Windows installer with custom configuration
- **Native formats**: DMG/PKG (macOS), AppImage/DEB/RPM/Snap (Linux)

## Prerequisites

### Common Requirements (All Platforms)
- Node.js 18+
- npm 9+
- Git

### Windows
- Windows 10 or later
- Visual Studio Build Tools (for native modules)
- NSIS (included with electron-builder)

### macOS
- macOS 10.15 (Catalina) or later
- Xcode Command Line Tools
- Xcode (for code signing, optional)

### Linux
- Any modern Linux distribution
- Build tools: gcc, make, python
- Package manager tools: dpkg-deb, rpmbuild (for DEB/RPM)

## Quick Start

### 1. Install Dependencies

```bash
# Install all project dependencies
make install
```

Or manually:
```bash
cd webui && npm install
cd ../docs && npm install
cd ../desktop && npm install
```

### 2. Build for Current Platform

```bash
# Automatically detects your platform and builds appropriate installers
make build
```

### 3. View All Available Targets

```bash
make help
```

## Platform-Specific Builds

### Windows

#### Build All Windows Installers
```bash
make windows
```
This creates:
- `Alpacabitollama-Setup-{version}.exe` (NSIS installer)
- `Alpacabitollama-Portable-{version}.exe` (Portable executable)

#### Build NSIS Installer Only
```bash
make windows-installer
```

#### Build Portable Only
```bash
make windows-portable
```

#### Using npm scripts
```bash
npm run build:windows
npm run build:installer
npm run build:portable
```

**Output Location**: `desktop/release/`

### macOS

#### Build All macOS Packages
```bash
make macos
```
This creates:
- `Alpacabitollama-{version}-macOS.dmg` (Disk image)
- `Alpacabitollama-{version}-macOS.pkg` (Installer package)

#### Build DMG Only
```bash
make macos-dmg
```

#### Build PKG Only
```bash
make macos-pkg
```

#### Build for Apple Silicon (ARM64)
```bash
make macos-arm64
```

#### Build Universal Binary (Intel + ARM)
```bash
make macos-universal
```

#### Using npm scripts
```bash
npm run build:mac
npm run build:dmg
npm run build:pkg
```

**Output Location**: `desktop/release/`

**Note**: macOS builds require a macOS machine. Cross-platform builds from Windows/Linux are not supported.

### Linux

#### Build All Linux Packages
```bash
make linux
```
This creates:
- `Alpacabitollama-{version}-linux.AppImage` (Universal AppImage)
- `alpacabitollama_{version}_amd64.deb` (Debian/Ubuntu)
- `alpacabitollama-{version}.x86_64.rpm` (Fedora/RHEL)
- `alpacabitollama_{version}_amd64.snap` (Snap store)

#### Build AppImage Only
```bash
make linux-appimage
```

#### Build DEB Only
```bash
make linux-deb
```

#### Build RPM Only
```bash
make linux-rpm
```

#### Build Snap Only
```bash
make linux-snap
```

#### Using npm scripts
```bash
npm run build:linux
npm run build:appimage
npm run build:deb
npm run build:rpm
npm run build:snap
```

**Output Location**: `desktop/release/`

## Development

### Start Development Servers
```bash
# Start all development servers (webui, docs, desktop)
make dev
```

### Individual Development Servers
```bash
# SvelteKit web interface
make dev-webui
# or
npm run dev:webui

# Docusaurus documentation
make dev-docs
# or
npm run dev:docs

# Electron desktop app
make dev-desktop
# or
npm start
```

## Building Components

### Build WebUI Only
```bash
make build-webui
# or
npm run build:webui
```

### Build Documentation Only
```bash
make build-docs
# or
npm run build:docs
```

### Build Desktop App (No Packaging)
```bash
make build-desktop
# or
npm run build:desktop
```

## Cleaning Build Artifacts

### Clean Build Outputs
```bash
make clean
```
This removes:
- WebUI build artifacts (`.svelte-kit`, `build`)
- Desktop release directory
- Documentation build (`.docusaurus`, `build`)
- Public directory

### Clean All (Including Dependencies)
```bash
make clean-all
```
This removes everything from `clean` plus:
- All `node_modules` directories

## Code Quality

### Run Tests
```bash
make test
# or
npm test
```

### Run Linters
```bash
make lint
# or
npm run lint
```

### Format Code
```bash
make format
# or
npm run format
```

## Cross-Platform Building

Building for platforms other than your current OS requires:

### Option 1: Use CI/CD
Recommended for production builds. Use GitHub Actions, GitLab CI, or similar with matrix builds:
- Windows runner → Windows installers
- macOS runner → macOS packages
- Linux runner → Linux packages

### Option 2: Virtual Machines
- Use Docker for Linux builds
- Use Windows VM for Windows builds from macOS/Linux
- Use macOS VM for macOS builds from Windows/Linux (requires macOS license)

### Option 3: Cloud Services
- Use cloud build services like Electron Build Service
- Use GitHub Actions with pre-built runners

## NSIS Installer Configuration (Windows)

The Windows installer uses NSIS with custom configuration in `desktop/installer.nsh`:

### Features
- **VC++ Redistributable Check**: Automatically detects if VC++ runtime is installed
- **Silent Installation**: Installs VC++ redistributable silently if needed
- **User Data Directories**: Creates directories for models, backends, and logs
- **Custom Installation Path**: Allows users to choose installation directory
- **Desktop Shortcut**: Creates desktop shortcut
- **Start Menu Shortcut**: Creates Start menu entry
- **Auto-Run**: Launches app after installation
- **Clean Uninstall**: Removes application files (user data preserved by default)

### Customization
Edit `desktop/installer.nsh` to customize:
- Installation behavior
- Registry checks
- File cleanup on uninstall
- Custom pages

## Electron Builder Configuration

All platform-specific configurations are in `desktop/package.json` under the `build` section:

### Windows Configuration
```json
"win": {
  "target": ["nsis", "portable"],
  "icon": "resources/alpaca.ico"
}
```

### macOS Configuration
```json
"mac": {
  "target": ["dmg", "pkg"],
  "icon": "resources/alpaca.icns",
  "category": "public.app-category.developer-tools"
}
```

### Linux Configuration
```json
"linux": {
  "target": ["AppImage", "deb", "rpm", "snap"],
  "icon": "resources/alpaca.png",
  "category": "Development"
}
```

## Build Output

All installers are output to:
```
desktop/release/
```

### Windows
- `Alpacabitollama-Setup-{version}.exe` - NSIS installer
- `Alpacabitollama-Portable-{version}.exe` - Portable executable

### macOS
- `Alpacabitollama-{version}-macOS.dmg` - Disk image
- `Alpacabitollama-{version}-macOS.pkg` - Installer package
- `Alpacabitollama-{version}-macOS-arm64.dmg` - Apple Silicon DMG (if built)
- `Alpacabitollama-{version}-macOS-universal.dmg` - Universal DMG (if built)

### Linux
- `Alpacabitollama-{version}-linux.AppImage` - AppImage
- `alpacabitollama_{version}_amd64.deb` - Debian package
- `alpacabitollama-{version}.x86_64.rpm` - RPM package
- `alpacabitollama_{version}_amd64.snap` - Snap package

## Troubleshooting

### Make Command Not Found (Windows)
Windows doesn't include Make by default. Solutions:
1. Install MinGW or MSYS2
2. Use npm scripts instead (e.g., `npm run build:windows`)
3. Use WSL (Windows Subsystem for Linux)

### Permission Errors (Linux/macOS)
```bash
# Fix permissions
sudo chown -R $USER:$USER .
```

### Missing Dependencies
```bash
# Reinstall all dependencies
make clean-all
make install
```

### Build Fails on macOS
Ensure Xcode Command Line Tools are installed:
```bash
xcode-select --install
```

### NSIS Errors (Windows)
NSIS is included with electron-builder. If you encounter issues:
1. Update electron-builder: `cd desktop && npm install electron-builder@latest`
2. Check NSIS version compatibility

### Code Signing Errors (macOS)
For development builds, disable code signing:
```json
"mac": {
  "hardenedRuntime": false,
  "gatekeeperAssess": false
}
```

For production, obtain a Apple Developer certificate and configure signing.

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Build

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: make install
      - run: make build
      - uses: actions/upload-artifact@v3
        with:
          name: ${{ matrix.os }}-artifacts
          path: desktop/release/*
```

## Advanced Usage

### Custom Build Configuration

Edit `desktop/package.json` to customize:
- App metadata (name, version, description)
- Build targets
- File inclusions/exclusions
- Platform-specific settings

### Environment Variables

Set environment variables to customize builds:

```bash
# Set build number
export BUILD_NUMBER=123
make build

# Set custom output directory
export OUTPUT_DIR=custom-release
make build
```

### Parallel Builds

Build multiple platforms in parallel (requires multiple machines):

```bash
# On Windows machine
make windows &

# On macOS machine
make macos &

# On Linux machine
make linux &
```

## Support

For issues or questions:
1. Check this guide first
2. Review the main README.md
3. Check electron-builder documentation: https://www.electron.build/
4. Open an issue on GitHub

## Summary

The Makefile provides a simple, consistent interface for building Alpacabitollama across all platforms. Key commands:

- `make help` - Show all available targets
- `make install` - Install dependencies
- `make build` - Build for current platform
- `make windows` - Build Windows installers
- `make macos` - Build macOS packages
- `make linux` - Build Linux packages
- `make clean` - Clean build artifacts
- `make dev` - Start development servers
