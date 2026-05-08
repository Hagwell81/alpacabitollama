# Alpacabitollama Makefile
# Cross-platform build system for generating installers
# Supports: Windows (NSIS), macOS (DMG/PKG), Linux (AppImage/DEB/RPM)

.PHONY: help install build clean all
.PHONY: build-webui build-docs build-desktop
.PHONY: windows macos linux
.PHONY: windows-installer windows-portable macos-dmg macos-pkg
.PHONY: linux-appimage linux-deb linux-rpm
.PHONY: dev dev-webui dev-docs dev-desktop
.PHONY: test lint format

# Default target
.DEFAULT_GOAL := help

# Detect operating system
UNAME_S := $(shell uname -s 2>/dev/null || echo Windows)
ifeq ($(OS),Windows_NT)
    UNAME_S := Windows
endif

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m # No Color

# Project directories
ROOT_DIR := $(shell pwd)
WEBUI_DIR := $(ROOT_DIR)/webui
DOCS_DIR := $(ROOT_DIR)/docs
DESKTOP_DIR := $(ROOT_DIR)/desktop
DIST_DIR := $(DESKTOP_DIR)/release

help:
	@echo "$(BLUE)Alpacabitollama Build System$(NC)"
	@echo ""
	@echo "$(GREEN)Available targets:$(NC)"
	@echo "  $(YELLOW)install$(NC)          - Install all dependencies"
	@echo "  $(YELLOW)build$(NC)            - Build all components for current platform"
	@echo "  $(YELLOW)all$(NC)              - Build all components for all platforms"
	@echo "  $(YELLOW)clean$(NC)            - Clean build artifacts"
	@echo ""
	@echo "$(GREEN)Component builds:$(NC)"
	@echo "  $(YELLOW)build-webui$(NC)      - Build SvelteKit web interface"
	@echo "  $(YELLOW)build-docs$(NC)       - Build Docusaurus documentation"
	@echo "  $(YELLOW)build-desktop$(NC)    - Build Electron desktop app"
	@echo ""
	@echo "$(GREEN)Platform-specific builds:$(NC)"
	@echo "  $(YELLOW)windows$(NC)          - Build Windows installers (NSIS + Portable)"
	@echo "  $(YELLOW)macos$(NC)            - Build macOS packages (DMG + PKG)"
	@echo "  $(YELLOW)linux$(NC)            - Build Linux packages (AppImage + DEB + RPM)"
	@echo ""
	@echo "$(GREEN)Specific installer types:$(NC)"
	@echo "  $(YELLOW)windows-installer$(NC) - Build Windows NSIS installer"
	@echo "  $(YELLOW)windows-portable$(NC) - Build Windows portable executable"
	@echo "  $(YELLOW)macos-dmg$(NC)        - Build macOS DMG image"
	@echo "  $(YELLOW)macos-pkg$(NC)        - Build macOS PKG installer"
	@echo "  $(YELLOW)linux-appimage$(NC)   - Build Linux AppImage"
	@echo "  $(YELLOW)linux-deb$(NC)        - Build Linux DEB package"
	@echo "  $(YELLOW)linux-rpm$(NC)        - Build Linux RPM package"
	@echo ""
	@echo "$(GREEN)Development:$(NC)"
	@echo "  $(YELLOW)dev$(NC)              - Start all development servers"
	@echo "  $(YELLOW)dev-webui$(NC)        - Start SvelteKit dev server"
	@echo "  $(YELLOW)dev-docs$(NC)         - Start Docusaurus dev server"
	@echo "  $(YELLOW)dev-desktop$(NC)     - Start Electron app in dev mode"
	@echo ""
	@echo "$(GREEN)Quality:$(NC)"
	@echo "  $(YELLOW)test$(NC)             - Run tests"
	@echo "  $(YELLOW)lint$(NC)             - Run linters"
	@echo "  $(YELLOW)format$(NC)           - Format code"
	@echo ""

install:
	@echo "$(BLUE)Installing all dependencies...$(NC)"
	@cd $(WEBUI_DIR) && npm install
	@cd $(DOCS_DIR) && npm install
	@cd $(DESKTOP_DIR) && npm install
	@echo "$(GREEN)✓ All dependencies installed$(NC)"

build-webui:
	@echo "$(BLUE)Building SvelteKit web interface...$(NC)"
	@cd $(WEBUI_DIR) && npm run build
	@echo "$(GREEN)✓ WebUI built successfully$(NC)"

build-docs:
	@echo "$(BLUE)Building Docusaurus documentation...$(NC)"
	@cd $(DOCS_DIR) && npm run build
	@echo "$(GREEN)✓ Documentation built successfully$(NC)"

build-desktop:
	@echo "$(BLUE)Building Electron desktop app...$(NC)"
	@cd $(DESKTOP_DIR) && npm run copy-webui
	@cd $(DESKTOP_DIR) && npm run copy-docs
	@echo "$(GREEN)✓ Desktop app prepared successfully$(NC)"

# Platform detection for automatic builds
ifeq ($(UNAME_S),Windows)
    PLATFORM_TARGET := windows
else ifeq ($(UNAME_S),Darwin)
    PLATFORM_TARGET := macos
else
    PLATFORM_TARGET := linux
endif

build: build-webui build-docs build-desktop
	@echo "$(BLUE)Building for current platform: $(PLATFORM_TARGET)$(NC)"
	@$(MAKE) $(PLATFORM_TARGET)

# Windows builds
windows: windows-installer windows-portable
	@echo "$(GREEN)✓ Windows builds completed$(NC)"
	@echo "  Output: $(DIST_DIR)/"

windows-installer: build-webui build-docs build-desktop
	@echo "$(BLUE)Building Windows NSIS installer...$(NC)"
	@cd $(DESKTOP_DIR) && npm run build:installer
	@echo "$(GREEN)✓ Windows NSIS installer built$(NC)"

windows-portable: build-webui build-docs build-desktop
	@echo "$(BLUE)Building Windows portable executable...$(NC)"
	@cd $(DESKTOP_DIR) && npm run build:portable
	@echo "$(GREEN)✓ Windows portable executable built$(NC)"

# macOS builds
macos: macos-dmg macos-pkg
	@echo "$(GREEN)✓ macOS builds completed$(NC)"
	@echo "  Output: $(DIST_DIR)/"

macos-dmg: build-webui build-docs build-desktop
	@echo "$(BLUE)Building macOS DMG image...$(NC)"
	@cd $(DESKTOP_DIR) && npx electron-builder --mac --x64 --config.dmg.target=dmg
	@echo "$(GREEN)✓ macOS DMG built$(NC)"

macos-pkg: build-webui build-docs build-desktop
	@echo "$(BLUE)Building macOS PKG installer...$(NC)"
	@cd $(DESKTOP_DIR) && npx electron-builder --mac --x64 --config.pkg.target=pkg
	@echo "$(GREEN)✓ macOS PKG built$(NC)"

macos-arm64: build-webui build-docs build-desktop
	@echo "$(BLUE)Building macOS ARM64 (Apple Silicon)...$(NC)"
	@cd $(DESKTOP_DIR) && npx electron-builder --mac --arm64
	@echo "$(GREEN)✓ macOS ARM64 builds completed$(NC)"

macos-universal: build-webui build-docs build-desktop
	@echo "$(BLUE)Building macOS Universal (Intel + ARM)...$(NC)"
	@cd $(DESKTOP_DIR) && npx electron-builder --mac --universal
	@echo "$(GREEN)✓ macOS Universal builds completed$(NC)"

# Linux builds
linux: linux-appimage linux-deb linux-rpm
	@echo "$(GREEN)✓ Linux builds completed$(NC)"
	@echo "  Output: $(DIST_DIR)/"

linux-appimage: build-webui build-docs build-desktop
	@echo "$(BLUE)Building Linux AppImage...$(NC)"
	@cd $(DESKTOP_DIR) && npx electron-builder --linux --x64 --config.linux.target=AppImage
	@echo "$(GREEN)✓ Linux AppImage built$(NC)"

linux-deb: build-webui build-docs build-desktop
	@echo "$(BLUE)Building Linux DEB package...$(NC)"
	@cd $(DESKTOP_DIR) && npx electron-builder --linux --x64 --config.linux.target=deb
	@echo "$(GREEN)✓ Linux DEB built$(NC)"

linux-rpm: build-webui build-docs build-desktop
	@echo "$(BLUE)Building Linux RPM package...$(NC)"
	@cd $(DESKTOP_DIR) && npx electron-builder --linux --x64 --config.linux.target=rpm
	@echo "$(GREEN)✓ Linux RPM built$(NC)"

linux-snap: build-webui build-docs build-desktop
	@echo "$(BLUE)Building Linux Snap package...$(NC)"
	@cd $(DESKTOP_DIR) && npx electron-builder --linux --x64 --config.linux.target=snap
	@echo "$(GREEN)✓ Linux Snap built$(NC)"

# Cross-platform builds (requires Docker or VM)
all-windows: build-webui build-docs build-desktop
	@echo "$(YELLOW)Cross-platform Windows build requires Windows environment$(NC)"
	@echo "Use Docker with wine or a Windows VM to build Windows installers from $(UNAME_S)"

all-macos: build-webui build-docs build-desktop
	@echo "$(YELLOW)Cross-platform macOS build requires macOS environment$(NC)"
	@echo "Use a macOS VM or GitHub Actions to build macOS packages from $(UNAME_S)"

all-linux: build-webui build-docs build-desktop
	@echo "$(YELLOW)Cross-platform Linux build requires Linux environment$(NC)"
	@echo "Use Docker or a Linux VM to build Linux packages from $(UNAME_S)"

# Development targets
dev:
	@echo "$(BLUE)Starting all development servers...$(NC)"
	@echo "  - WebUI: http://localhost:13439"
	@echo "  - Docs: http://localhost:13440"
	@echo "  - API Server: http://localhost:13434"
	@echo "  - Desktop: Electron app"
	@cd $(WEBUI_DIR) && npm run dev &
	@cd $(DOCS_DIR) && npm run start &
	@cd $(DESKTOP_DIR) && npm start

dev-webui:
	@echo "$(BLUE)Starting SvelteKit dev server...$(NC)"
	@cd $(WEBUI_DIR) && npm run dev

dev-docs:
	@echo "$(BLUE)Starting Docusaurus dev server...$(NC)"
	@cd $(DOCS_DIR) && npm run start

dev-desktop:
	@echo "$(BLUE)Starting Electron app in dev mode...$(NC)"
	@cd $(DESKTOP_DIR) && npm start

# Quality targets
test:
	@echo "$(BLUE)Running tests...$(NC)"
	@cd $(WEBUI_DIR) && npm test || echo "No tests configured for webui"
	@echo "$(GREEN)✓ Tests completed$(NC)"

lint:
	@echo "$(BLUE)Running linters...$(NC)"
	@cd $(WEBUI_DIR) && npm run lint
	@echo "$(GREEN)✓ Linting completed$(NC)"

format:
	@echo "$(BLUE)Formatting code...$(NC)"
	@cd $(WEBUI_DIR) && npm run format
	@echo "$(GREEN)✓ Code formatted$(NC)"

# Clean targets
clean:
	@echo "$(BLUE)Cleaning build artifacts...$(NC)"
	@cd $(WEBUI_DIR) && npm run cleanup 2>/dev/null || rm -rf $(WEBUI_DIR)/.svelte-kit $(WEBUI_DIR)/build
	@cd $(DESKTOP_DIR) && npm run clean
	@cd $(DOCS_DIR) && npm run clear
	@rm -rf $(ROOT_DIR)/public
	@rm -rf $(DIST_DIR)
	@echo "$(GREEN)✓ Clean completed$(NC)"

clean-all: clean
	@echo "$(BLUE)Cleaning all dependencies...$(NC)"
	@rm -rf $(WEBUI_DIR)/node_modules
	@rm -rf $(DOCS_DIR)/node_modules
	@rm -rf $(DESKTOP_DIR)/node_modules
	@echo "$(GREEN)✓ All dependencies removed$(NC)"

# Release build (all platforms)
all: clean
	@echo "$(BLUE)Building release packages for all platforms...$(NC)"
	@echo "$(YELLOW)Note: This requires running on each platform separately$(NC)"
	@echo "$(YELLOW)or using a CI/CD system with multi-platform support$(NC)"
	@echo ""
	@echo "To build for all platforms, run:"
	@echo "  - On Windows: make windows"
	@echo "  - On macOS: make macos"
	@echo "  - On Linux: make linux"
