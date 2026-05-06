---
sidebar_position: 1
title: Architecture Overview
description: System architecture and component design
---

# Architecture Overview

## System Architecture

Alpacabitollama is built on a modular, layered architecture that separates concerns and enables extensibility:

```
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                        │
│  ┌──────────────┬──────────────┬──────────────────────────┐ │
│  │ Chat UI      │ IDE / Editor │ Workspace / Projects    │ │
│  │ (Svelte)     │ (VS Code)    │ (Collaborative)         │ │
│  └──────────────┴──────────────┴──────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│  ┌──────────────┬──────────────┬──────────────────────────┐ │
│  │ Chat Service │ Agentic      │ Knowledge Base Service  │ │
│  │              │ Framework    │                         │ │
│  └──────────────┴──────────────┴──────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────────────┐
│                    Integration Layer                         │
│  ┌──────────────┬──────────────┬──────────────────────────┐ │
│  │ API Manager  │ Provider     │ Workspace Manager       │ │
│  │              │ Adapters     │                         │ │
│  └──────────────┴──────────────┴──────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────────────┐
│                    Services Layer                            │
│  ┌──────────────┬──────────────┬──────────────────────────┐ │
│  │ Local Models │ Cloud APIs   │ Storage & Database      │ │
│  │ (llama.cpp)  │ (OpenAI etc) │                         │ │
│  └──────────────┴──────────────┴──────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Desktop Application (Electron)

**Location**: `desktop/`

**Responsibilities**:
- Window management
- IPC communication with renderer
- File system access
- Process management (llama.cpp server)
- Tray menu and system integration

**Key Files**:
- `main.js` - Main process entry point
- `api-server.js` - API server configuration
- `request-manager.js` - Request queue and circuit breaker
- `preload.js` - IPC channel exposure

### 2. Web UI (Svelte/SvelteKit)

**Location**: `webui/`

**Responsibilities**:
- Chat interface
- Settings and configuration
- Model management
- Real-time updates via SSE

**Key Files**:
- `src/lib/services/chat.service.ts` - Chat API communication
- `src/lib/stores/chat.svelte.ts` - Chat state management
- `src/routes/` - Page routes

### 3. API Management Service

**Location**: `services/api-manager/`

**Responsibilities**:
- Provider credential management
- Model discovery and selection
- Request routing to appropriate provider
- Usage tracking and analytics

**Supported Providers**:
- OpenAI, Google, Anthropic, Mistral
- Open Router, Ollama, LM Studio
- Azure Foundry (local), Custom endpoints

### 4. Agentic Framework

**Location**: `services/agentic/`

**Components**:
- **Agent Engine** - Multi-agent orchestration
- **Tool Registry** - Tool definitions and management
- **Skill System** - Reusable skill components
- **Subagent Delegation** - Task delegation to specialized agents
- **Spec-Driven Development** - Specification-based agent creation

**Based on**:
- Hermes Agent architecture
- Awesome Claude Code Subagents patterns
- Tool Registry standards
- OpenSpec specifications

### 5. Knowledge Base & RAG

**Location**: `services/knowledge-base/`

**Features**:
- Web scraping (Archon integration)
- Document ingestion and processing
- Image processing and OCR
- Vector embeddings and similarity search
- MCP (Model Context Protocol) service

**Based on**:
- Archon web scraping capabilities
- RAG best practices
- MCP service standards

### 6. Workspace Management

**Location**: `services/workspace/`

**Responsibilities**:
- User workspace management
- Application workspace management
- Project structure and organization
- Collaborative features
- File synchronization

### 7. IDE Integration

**Location**: `ide/`

**Features**:
- VS Code-like editor
- Integrated Copilot
- Terminal emulation
- Project management
- Code execution

**Based on**:
- VS Code architecture
- Copilot Chat integration
- Terminal emulation (Warp/Wezterm)

## Data Flow

### Chat Request Flow

```
User Input
    │
    ▼
Chat UI (Svelte)
    │
    ▼
Chat Service (IPC)
    │
    ▼
API Manager
    │
    ├─ Check provider config
    ├─ Select model
    ├─ Route to provider
    │
    ▼
Provider Adapter
    │
    ├─ OpenAI Adapter
    ├─ Google Adapter
    ├─ Anthropic Adapter
    ├─ Local Model Adapter
    │
    ▼
Provider API / Local Server
    │
    ▼
Response Stream
    │
    ▼
Chat Service (SSE)
    │
    ▼
Chat UI (Update)
    │
    ▼
User Sees Response
```

### Agent Execution Flow

```
Agent Request
    │
    ▼
Agent Engine
    │
    ├─ Parse request
    ├─ Create execution plan
    ├─ Initialize tools
    │
    ▼
Agent Loop
    │
    ├─ Call LLM
    ├─ Parse response
    ├─ Execute tools
    ├─ Update context
    │
    ▼
Tool Execution
    │
    ├─ Tool Registry lookup
    ├─ Parameter validation
    ├─ Execute tool
    ├─ Return result
    │
    ▼
Agent Loop (continue or delegate)
    │
    ├─ Subagent delegation (if needed)
    ├─ Collect results
    │
    ▼
Final Response
```

## IPC Channels

### Chat Operations
- `send-message` - Send chat message
- `get-chat-history` - Retrieve conversation history
- `clear-chat` - Clear current conversation

### API Management
- `get-api-settings` - Get API configuration
- `set-api-settings` - Update API configuration
- `get-available-providers` - List available providers
- `get-provider-models` - Get models for provider
- `add-provider-credential` - Add API key
- `remove-provider-credential` - Remove API key

### Health & Monitoring
- `api:health` - Server health check
- `api:count-tokens` - Estimate token count
- `api:queue-status` - Request queue status

### Workspace
- `get-workspace-projects` - List projects
- `create-project` - Create new project
- `open-project` - Open project
- `save-project` - Save project

### IDE
- `open-file` - Open file in editor
- `save-file` - Save file
- `execute-code` - Execute code
- `run-terminal-command` - Run terminal command

## Database Schema

### Core Tables

**conversations**
```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  provider TEXT,
  model TEXT,
  system_prompt TEXT
);
```

**messages**
```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  role TEXT,
  content TEXT,
  tokens INTEGER,
  created_at TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
```

**api_credentials**
```sql
CREATE TABLE api_credentials (
  id TEXT PRIMARY KEY,
  provider TEXT,
  name TEXT,
  encrypted_key TEXT,
  created_at TIMESTAMP,
  last_used TIMESTAMP
);
```

**agents**
```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT,
  config JSON,
  tools JSON,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**projects**
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT,
  path TEXT,
  type TEXT,
  config JSON,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

## Configuration

### Application Config
Located in `~/.alpacabitollama/config.json`:

```json
{
  "apiServer": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 13434,
    "cors": true,
    "requestTimeout": 300000,
    "maxConcurrentRequests": 10
  },
  "providers": {
    "openai": {
      "enabled": true,
      "baseUrl": "https://api.openai.com/v1"
    }
  },
  "workspace": {
    "defaultPath": "~/alpacabitollama-workspace"
  }
}
```

## Performance Optimizations

### Request Management
- **Circuit Breaker**: Prevents cascading failures
- **Request Queue**: Manages concurrency
- **Heartbeat Detection**: Detects unresponsive servers
- **Caching**: Response caching for repeated queries

### Streaming
- **Chunked Processing**: Process data as it arrives
- **Backpressure Handling**: Manage flow control
- **Error Recovery**: Graceful error handling

### Storage
- **Database Indexing**: Fast query performance
- **Lazy Loading**: Load data on demand
- **Compression**: Reduce storage footprint

## Security

### API Key Management
- Encrypted storage using system keyring
- No keys in logs or memory dumps
- Automatic key rotation support

### Communication
- HTTPS for cloud APIs
- Local-only for llama.cpp server
- IPC for inter-process communication

### Access Control
- User authentication (future)
- Role-based access control (future)
- API rate limiting

## Extensibility

### Adding Providers
1. Create provider adapter in `services/api-manager/providers/`
2. Implement `IProvider` interface
3. Register in provider registry
4. Add configuration schema

### Adding Tools
1. Create tool in `services/agentic/tools/`
2. Implement `ITool` interface
3. Register in tool registry
4. Add documentation

### Adding Skills
1. Create skill in `services/agentic/skills/`
2. Implement `ISkill` interface
3. Register in skill registry
4. Create usage examples

## Next Steps

- **[Project Structure](./project-structure.md)** - Directory organization
- **[Adding Providers](./adding-providers.md)** - Extend provider support
- **[Creating Agents](./creating-agents.md)** - Build agentic systems
- **[API Reference](../api/rest-api.md)** - API documentation
