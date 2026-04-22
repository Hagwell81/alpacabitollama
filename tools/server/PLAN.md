# Alpacabitollama Enhancement Plan
## Comprehensive Roadmap: From Local LLM Server to Full Agent Platform

**Version:** 1.0  
**Date:** 2026-04-22  
**Scope:** `llama.cpp/tools/server/webui` + `llama.cpp/tools/server/desktop`  

---

## Vision

Transform the current llama.cpp Web UI + Electron Desktop wrapper into a comprehensive, self-improving AI agent platform that:

1. **Surfaces every capability** of the underlying `llama-server` (embeddings, reranking, tokenization, code infill, LoRA hotswap, slots, metrics, speculative decoding, grammar constraints, built-in tools)
2. **Connects to the internet** via web search and content fetching
3. **Integrates external tool ecosystems** via MCP servers, curated subagents, and skill registries
4. **Builds persistent knowledge** through a local vector knowledgebase with document ingestion, crawling, and RAG
5. **Runs autonomous agents** that learn from experience, create their own skills/subagents, and delegate work across a tool-equipped environment

---

## Current State Assessment

### What Already Exists
- **llama-server** (C++ backend) with extensive endpoints: chat completions, completions, embeddings, reranking, tokenize/detokenize, infill, apply-template, lora-adapters hotswap, slots save/load, metrics, built-in tools, multimodal, Anthropic-compatible API, audio transcriptions
- **Web UI** (SvelteKit + Svelte 5): chat interface, model selector (router + model mode), conversations, settings, MCP client, parameter sync, database (IndexedDB)
- **Desktop App** (Electron): system tray, auto-start, model download from HuggingFace, IPC bridge, single-instance lock, port management
- **MCP Integration**: `mcpStore`, `MCPService`, `McpServersSettings`, `McpServersSelector`, `McpResourceBrowser`, `McpResourcePreview`

### What's Missing / Not Surfaced
| Feature | Backend Support | UI Exposure | Desktop IPC |
|---------|----------------|-------------|-------------|
| `/embeddings` | Yes | None | None |
| `/rerank` | Yes | None | None |
| `/tokenize` / `/detokenize` | Yes | None | None |
| `/infill` (code completion) | Yes | None | None |
| `/lora-adapters` hotswap | Yes | None | None |
| `/slots` save/load | Yes | None | None |
| `/metrics` (Prometheus) | Yes | None | None |
| Built-in tools (`--tools`) | Yes | Partial (MCP only) | None |
| Grammar / JSON Schema constraints | Yes | None | None |
| Speculative decoding | Yes | None | None |
| Web search | No | No | No |
| Knowledgebase / RAG | No | No | No |
| Agent loop / self-learning | No | No | No |
| Subagent registry | No | No | No |
| Skill registry | No | No | No |
| MCP server marketplace | No | No | No |

---

## Architecture Overview (Target)

```
┌─────────────────────────────────────────────────────────────────┐
│                    ELECTRON DESKTOP SHELL                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              WEB UI (SvelteKit SPA)                       │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────────────┐   │   │
│  │  │  Chat   │ │  Agent  │ │Knowledge│ │   Registry    │   │   │
│  │  │ Panel   │ │  Panel  │ │  Panel  │ │   Panel       │   │   │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └───────┬───────┘   │   │
│  │       └────────────┴────────────┴────────────┘            │   │
│  │                     ┌─────────────┐                        │   │
│  │                     │  Svelte Stores                      │   │
│  │                     │ (chat, agent, kb, registry)         │   │
│  │                     └──────┬──────┘                        │   │
│  └────────────────────────────┼───────────────────────────────┘   │
│                               │                                  │
│  ┌────────────────────────────┼───────────────────────────────┐  │
│  │    ELECTRON MAIN PROCESS   │                               │  │
│  │  ┌─────────┐  ┌─────────┐  │  ┌─────────┐  ┌─────────────┐  │  │
│  │  │llama-srv│  │ agent   │  │  │ kb svc  │  │ registry    │  │  │
│  │  │process  │  │ worker  │──┘  │ (Python)│  │ services    │  │  │
│  │  └────┬────┘  └────┬────┘     └────┬────┘  └──────┬──────┘  │  │
│  │       └────────────┴────────────────┴───────────────┘       │  │
│  │                     IPC Bridge (preload.js)                │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                               │
                    ┌──────────┼──────────┐
                    ▼          ▼          ▼
            ┌──────────┐ ┌────────┐ ┌──────────┐
            │ Hugging  │ │  Web   │ │  MCP     │
            │  Face    │ │ Search │ │ Servers  │
            └──────────┘ └────────┘ └──────────┘
```

### New Backend Services (Electron Main Process)
All new heavy-lifting services run as **separate Python processes** spawned by `main.js`, communicating via IPC/stdio or HTTP on localhost ports:

1. **Agent Worker** (`services/agent/`) — Core agent loop, self-learning, skill generation
2. **Knowledgebase Service** (`services/knowledgebase/`) — Document ingestion, chunking, embeddings, vector search (SQLite + sqlite-vec or Chroma)
3. **Registry Curator** (`services/registry/`) — Parses subagent/skill repos, indexes them, serves curated lists
4. **Web Search Service** (`services/websearch/`) — DuckDuckGo, Brave, or SerpAPI queries, content extraction (readability/jina.ai)

---

## Phase 1: Foundation — Surface All Existing llama.cpp Features

**Goal:** Every backend endpoint and capability gets a corresponding UI component and desktop IPC handler.

### 1.1 Embeddings Panel
- [ ] Create `EmbeddingsService` in `webui/src/lib/services/embeddings.service.ts`
- [ ] Add route `/embeddings` with text input, model selector, batch file upload
- [ ] Display results as copyable JSON + cosine-similarity comparator (two texts side-by-side)
- [ ] Add IPC `compute-embeddings` in `desktop/main.js` for headless batch processing
- [ ] Electron: add tray menu item "Compute Embeddings" that opens the panel

### 1.2 Reranking Panel
- [ ] Create `RerankService` in `webui/src/lib/services/rerank.service.ts`
- [ ] Add route `/rerank` with query + list of documents input
- [ ] Display ranked results with scores and highlight top-N
- [ ] Add IPC `rerank-documents` in `desktop/main.js`

### 1.3 Tokenizer Playground
- [ ] Create `TokenizerService` with `/tokenize` and `/detokenize` wrappers
- [ ] Add route `/tokenizer` with live bidirectional conversion (text <-> tokens)
- [ ] Show token IDs, token strings, and per-token byte lengths
- [ ] Visualise attention masks / special tokens with color coding

### 1.4 Code Infill (FIM) Panel
- [ ] Create `InfillService` wrapping `/infill`
- [ ] Add route `/infill` with prefix/suffix editor (Monaco/CodeMirror-lite)
- [ ] Support multimodal infill (image + text prefix)
- [ ] Keyboard shortcut `Ctrl+Space` from chat input triggers infill suggestion

### 1.5 LoRA Adapter Manager
- [ ] Extend `ModelsService` with `GET/POST /lora-adapters`
- [ ] Add "Adapters" tab in Settings → Models
- [ ] List loaded adapters with scale sliders (real-time hotswap via POST)
- [ ] File picker to add `.gguf` adapter files from disk
- [ ] Desktop: watch `%APPDATA%/alpacabitollama/adapters/` directory

### 1.6 Slot Save/Load (Session Persistence)
- [ ] Create `SlotsService` wrapping `/slots`
- [ ] Add "Sessions" sidebar panel showing active slots with KV-cache size
- [ ] Save slot to file (`.llama-slot`), load from file, clone slot
- [ ] Auto-save on app hide / quit; auto-restore on launch
- [ ] Desktop IPC: `save-slot`, `load-slot`, `list-slots`

### 1.7 Metrics Dashboard
- [ ] Create `MetricsService` polling `/metrics` (Prometheus format)
- [ ] Add route `/metrics` with real-time graphs (latency, throughput, token/sec, queue depth)
- [ ] Use lightweight chart library (Chart.js or uPlot)
- [ ] Desktop: tray tooltip shows current tokens/sec

### 1.8 Built-in Tools Native UI
- [ ] When `llama-server` is started with `--tools all`, detect via `/props`
- [ ] Expose tool schemas in chat settings (toggle per tool)
- [ ] Render tool calls inline in chat messages (expandable JSON + result preview)
- [ ] Add tool permission dialog (dangerous commands require approval)
- [ ] Desktop: `main.js` forwards tool execution requests through approval flow

### 1.9 Grammar & JSON Schema Constraints
- [ ] Extend chat settings with "Constraints" section
- [ ] BNF Grammar editor with preset dropdowns (JSON, Markdown, SQL, etc.)
- [ ] JSON Schema editor (textarea + validate button)
- [ ] Preset library of common schemas stored in IndexedDB

### 1.10 Speculative Decoding Controls
- [ ] If server reports draft model capability, show "Speculative" toggle in chat settings
- [ ] Configurable draft tokens count, temperature, min-probability sliders
- [ ] Visual indicator in chat showing accepted/rejected draft tokens ratio

---

## Phase 2: Web Search & Content Fetch

**Goal:** Chat can search the internet and fetch page content via natural language requests.

### 2.1 Web Search Service (Python microservice)
- [ ] Create `services/websearch/` Python package in desktop app
- [ ] Implement `WebSearchService` class with backends:
  - DuckDuckGo HTML scraping (default, no API key)
  - Brave Search API (optional, user-provided key)
  - SerpAPI (optional, user-provided key)
  - Jina.ai Reader (free tier for content extraction)
- [ ] Expose HTTP API on `localhost:13435` (or dynamic port):
  - `POST /search` `{ "query": "...", "backend": "duckduckgo", "n": 10 }`
  - `POST /fetch` `{ "url": "...", "extract_markdown": true }`
- [ ] Electron `main.js`: spawn websearch service on startup, health-check, auto-restart
- [ ] IPC handlers: `search-web`, `fetch-url`

### 2.2 Search Tool Integration in Chat
- [ ] Add `web_search` tool schema to chat completions (injected into messages when user enables search)
- [ ] Tool handler in `ChatService` calls desktop IPC `search-web` or backend fetch directly
- [ ] UI: toggle "Enable Web Search" in chat settings
- [ ] Inline citation rendering: search results appear as collapsible references below assistant messages
- [ ] Search result cards with title, snippet, source URL (clickable)

### 2.3 URL Attachment / Fetch in Chat
- [ ] When user pastes a URL into chat input, offer "Fetch and summarize?" inline button
- [ ] Fetched content becomes an attachment (similar to PDF attachments)
- [ ] Uses Jina.ai Reader or local readability-lxml extraction
- [ ] Cache fetched content in IndexedDB with TTL (24h)

### 2.4 Search History & Management
- [ ] Store search queries + results in IndexedDB
- [ ] "Search History" panel (sidebar or settings tab)
- [ ] Re-run previous searches, pin favorite results

---

## Phase 3: MCP Server Registry & Management

**Goal:** Browse, install, and manage MCP servers from a central registry within the UI.

### 3.1 Registry Discovery Service
- [ ] Create `services/registry/mcp_registry.py` Python microservice
- [ ] Parse `https://registry.modelcontextprotocol.io/docs` or local cache of registry JSON
- [ ] Normalize entries: name, description, URL, capabilities (tools/resources/prompts), auth requirements
- [ ] Expose HTTP API:
  - `GET /mcp/registry` — list all curated servers
  - `GET /mcp/registry/search?q=...` — search by name/description
  - `GET /mcp/registry/:id` — server details + install instructions
- [ ] Electron: spawn on startup, IPC `get-mcp-registry`, `install-mcp-server`

### 3.2 MCP Marketplace UI
- [ ] New route `/settings/mcp-marketplace`
- [ ] Grid/list view of available MCP servers with capability badges
- [ ] One-click "Add to MCP Servers" — pre-fills URL and headers from registry entry
- [ ] Category filters: databases, development, search, communication, AI/ML
- [ ] User ratings / install count (from registry or local stats)

### 3.3 MCP Server Lifecycle Management
- [ ] Extend existing `mcpStore` with:
  - Auto-health-check on add
  - Auto-retry with exponential backoff for disconnected servers
  - Grouping by category tag
- [ ] Desktop: persist MCP server list in Electron store (encrypted headers)
- [ ] Import/export MCP server config as JSON

### 3.4 Built-in MCP Servers
- [ ] Package `services/knowledgebase/` as an internal MCP server (tools: search_kb, add_document, list_sources)
- [ ] Package `services/websearch/` as an internal MCP server (tools: web_search, fetch_url)
- [ ] Package `services/registry/` as an internal MCP server (tools: list_subagents, get_skill, search_skills)
- [ ] These appear in the MCP panel as "Built-in" category, always available

---

## Phase 4: Subagent Registry & Curation Service

**Goal:** Surface the subagents from `awesome-claude-code-subagents` and `awesome-codex-subagents` as a curated, searchable library within the app.

### 4.1 Subagent Curator Service (Python)
- [ ] Create `services/registry/subagent_curator.py`
- [ ] Parse both repositories:
  - `awesome-claude-code-subagents/categories/` — `.md` files with agent definitions
  - `awesome-codex-subagents/categories/` — `.toml` files with Codex agent specs
- [ ] Normalize into unified schema:
  ```json
  {
    "id": "backend-developer",
    "name": "Backend Developer",
    "source": "claude-code-subagents",
    "category": "core-development",
    "description": "...",
    "instructions": "...",
    "tools_suggested": ["file_tools", "terminal_tool"],
    "tags": ["python", "api", "database"],
    "format": "md|toml"
  }
  ```
- [ ] Build inverted index for full-text search (whoosh or sqlite-fts5)
- [ ] Expose HTTP API:
  - `GET /subagents` — list with pagination, category filter
  - `GET /subagents/search?q=...` — full-text search
  - `GET /subagents/:id` — full instructions
  - `POST /subagents/install` — copy to user's agents directory

### 4.2 Subagent Library UI
- [ ] New route `/subagents` (sidebar item)
- [ ] Browse by category grid (Core Dev, Language Specialists, Infra, Quality, Data/AI, etc.)
- [ ] Search bar with instant results
- [ ] Detail view: description, suggested tools, example prompts, "Install" button
- [ ] Installed subagents appear in chat as `@mention` or `/subagent` command

### 4.3 Subagent Runtime
- [ ] When a subagent is invoked, create a **new conversation slot** with:
  - System prompt = subagent instructions + parent conversation context summary
  - Restricted toolset = only tools the subagent is rated for
- [ ] Subagent output streams back to parent chat as a collapsible "delegated work" block
- [ ] Parent agent can review, accept, or retry subagent output

### 4.4 Desktop Integration
- [ ] Electron store: `installedSubagents[]` with metadata
- [ ] Subagent files stored in `%APPDATA%/alpacabitollama/subagents/`
- [ ] IPC: `get-subagent-library`, `install-subagent`, `uninstall-subagent`, `invoke-subagent`

---

## Phase 5: Skills Registry & Management

**Goal:** Integrate skills from `awesome-agent-skills` and `awesome-openclaw-skills` as reusable, composable capabilities.

### 5.1 Skills Curator Service (Python)
- [ ] Create `services/registry/skills_curator.py`
- [ ] Parse repositories:
  - `awesome-agent-skills/README.md` — embedded skill definitions
  - `awesome-openclaw-skills/categories/` — `.md` skill files
- [ ] Normalize schema:
  ```json
  {
    "id": "web-scraping-skill",
    "name": "Web Scraping",
    "source": "openclaw-skills",
    "category": "data-collection",
    "description": "...",
    "prompt_template": "...",
    "parameters": [{"name": "url", "type": "string"}],
    "tags": ["web", "extraction"]
  }
  ```
- [ ] Full-text search index
- [ ] HTTP API: `GET /skills`, `GET /skills/search`, `GET /skills/:id`, `POST /skills/install`

### 5.2 Skills Library UI
- [ ] New route `/skills` (sidebar item)
- [ ] Browse/search/install flow similar to subagents
- [ ] Skill detail view with parameter form (auto-generated from schema)
- [ ] "Test Skill" button — runs skill in isolated chat with pre-filled parameters

### 5.3 Skill Runtime
- [ ] Skills are injected as **system prompt templates** or **few-shot examples** into chat
- [ ] When a skill is enabled for a conversation, its prompt template is prepended to the system message
- [ ] Skill parameters are filled from user input or auto-extracted from chat context
- [ ] Skills can call tools just like the main agent

### 5.4 Skill Creation (Agent-Generated)
- [ ] After a complex multi-step task, agent proposes: "Save this workflow as a skill?"
- [ ] Agent generates skill definition (name, description, parameters, prompt template) from trajectory
- [ ] User reviews and edits in modal, then saves to local skills directory
- [ ] Saved skills appear in `/skills` under "My Skills" category

---

## Phase 6: Knowledgebase (Archon-Inspired)

**Goal:** A persistent, searchable knowledgebase with document ingestion, web crawling, project/task management, and RAG integration into chat.

### 6.1 Knowledgebase Service (Python)
- [ ] Create `services/knowledgebase/` Python package
- [ ] Use **Chroma** (embedded) or **sqlite-vec** for vector storage (zero external dependencies)
- [ ] Chunking strategies: sentence, paragraph, semantic (using local model if available)
- [ ] Embeddings: use local `llama-server` `/embeddings` endpoint (fall back to sentence-transformers)
- [ ] Database schema (SQLite):
  - `sources` — source metadata (URL, file path, type, crawl date)
  - `chunks` — text chunks with vector embedding, source_id, heading
  - `projects` — project records (name, description, linked sources)
  - `tasks` — tasks under projects (status, assignee, notes)
- [ ] HTTP API:
  - `POST /kb/ingest` — upload file or URL
  - `POST /kb/crawl` — start web crawl with depth limit
  - `GET /kb/search` — hybrid search (vector + BM25)
  - `GET /kb/sources` — list sources
  - `GET /kb/projects` — list projects
  - `POST /kb/projects` — create project
  - `POST /kb/projects/:id/tasks` — add task

### 6.2 Document Ingestion
- [ ] Support formats: PDF, Markdown, TXT, HTML, DOCX (via python-docx), code files
- [ ] Drag-and-drop upload in knowledgebase panel
- [ ] OCR for image-based PDFs (via pytesseract, optional)
- [ ] Auto-extract code examples into separate indexed chunks with language metadata

### 6.3 Web Crawler
- [ ] URL input with depth slider (1-3 levels)
- [ ] Respect robots.txt, configurable crawl delay
- [ ] Content extraction via readability-lxml + html2text
- [ ] Progress indicator: pages discovered, pages indexed, errors
- [ ] Cancel/pause crawl buttons

### 6.4 Knowledgebase Panel UI
- [ ] New route `/knowledge` (sidebar item with book icon)
- [ ] Sources tab: list with search, filter by type, delete, re-index
- [ ] Projects tab: kanban board for tasks (todo/in-progress/done)
- [ ] Search tab: hybrid search with filters (source, date, project)
- [ ] Search results: show matched chunks with highlight, source attribution, relevance score
- [ ] Click result to open source viewer (full document with chunk highlighted)

### 6.5 RAG Integration in Chat
- [ ] "Knowledge Mode" toggle in chat settings (or per-message)
- [ ] When enabled, user's query is embedded and top-K chunks retrieved from KB
- [ ] Retrieved chunks injected into context as system message: "Relevant context: ..."
- [ ] Inline citations in assistant response linking back to source chunks
- [ ] "Add to Knowledge" button on any assistant response (saves as source)

### 6.6 MCP Knowledgebase Server
- [ ] Expose KB as MCP server with tools:
  - `search_knowledge(query)` — hybrid search
  - `add_document(content, metadata)` — manual document add
  - `list_sources()` — list all sources
  - `create_project(name, description)`
  - `create_task(project_id, title, description)`
- [ ] Enables external AI assistants (Claude Desktop, Cursor) to query the same KB

### 6.7 Desktop Integration
- [ ] Electron: KB service auto-starts with app, stores data in `%APPDATA%/alpacabitollama/knowledge/`
- [ ] IPC: `kb-ingest`, `kb-search`, `kb-get-sources`, `kb-get-projects`, `kb-add-task`
- [ ] Tray menu: "Open Knowledgebase", "Quick Search" (global shortcut)

---

## Phase 7: Agent System (Hermes-Inspired)

**Goal:** A self-improving agent loop with persistent memory, skill generation, subagent delegation, and cross-session learning.

### 7.1 Agent Core (Python)
- [ ] Create `services/agent/` Python package
- [ ] `AgentLoop` class inspired by hermes-agent's `run_conversation()`:
  ```python
  class AgentLoop:
      def run(self, user_message, conversation_history, tools, config):
          while not done and iterations < max_iterations:
              response = llm.chat(messages=messages, tools=tool_schemas)
              if response.tool_calls:
                  for tc in response.tool_calls:
                      result = execute_tool(tc.name, tc.arguments)
                      messages.append(tool_result(result))
              else:
                  return response.content
  ```
- [ ] Tool execution dispatcher:
  - Built-in tools (file read/write, terminal, code execution) → local sandbox
  - MCP tools → proxy to `mcpStore` / MCPService
  - Subagent tools → spawn isolated agent loop with subagent prompt
  - Web search tools → proxy to websearch service
  - KB tools → proxy to knowledgebase service
- [ ] Streaming: agent thinking, tool calls, tool results stream as SSE events

### 7.2 Persistent Memory
- [ ] `MemoryStore` class (SQLite with FTS5):
  - `memories` — user facts, preferences, project context (auto-extracted by agent)
  - `sessions` — conversation summaries with embedding for semantic search
  - `skills_generated` — agent-created skills with usage stats
- [ ] Memory operations:
  - `remember(key, value, importance)` — store fact
  - `recall(query)` — semantic search across memories
  - `summarize_session(session_id)` — generate session summary, store with embedding
  - `get_user_profile()` — aggregated user model
- [ ] Agent automatically nudges itself: "Should I remember that the user prefers X?"

### 7.3 Self-Learning Loop
- [ ] After complex multi-step tasks (≥5 tool calls), agent reflects:
  1. "What was the goal?"
  2. "What steps did I take?"
  3. "What worked? What failed?"
  4. "Can I generalize this into a reusable skill?"
- [ ] Generate skill YAML/JSON with prompt template from trajectory
- [ ] Propose to user: "I've learned a new skill 'X'. Enable it?"
- [ ] Track skill usage statistics; deprecated skills get archived
- [ ] Self-improve: when a skill is used, agent evaluates output quality and refines the prompt template

### 7.4 Subagent Delegation
- [ ] Agent can decide to delegate work to specialized subagents:
  ```
  User: "Build a REST API in Python with auth and tests"
  Agent: "I'll delegate this to the Backend Developer subagent."
  → Spawns subagent with:
     - System prompt = backend-developer instructions
     - Context = project requirements from KB
     - Tools = file_tools, terminal_tool, code_execution
  → Streams subagent progress back to parent
  → Reviews output, asks user for approval
  ```
- [ ] Subagent results are persisted as "work units" attached to the conversation
- [ ] Parallel delegation: agent can spawn multiple subagents simultaneously for independent tasks

### 7.5 Agent UI Panel
- [ ] New route `/agent` (sidebar item with robot icon)
- [ ] Agent status: idle / thinking / executing tools / delegating
- [ ] Activity feed: real-time log of agent reasoning, tool calls, subagent spawns
- [ ] Memory inspector: browse stored memories, edit/delete, search
- [ ] Skills manager: view generated skills, enable/disable, edit templates
- [ ] Session timeline: visual timeline of all agent sessions with search
- [ ] Configuration: max iterations, auto-delegate toggle, reflection depth

### 7.6 Agent Settings & Safety
- [ ] Command approval levels: none / dangerous-only / all (dangerous = file delete, exec, network)
- [ ] Approval queue: pending dangerous commands shown as toasts/modals
- [ ] Sandbox mode: all file writes go to temporary directory until approved
- [ ] Max iterations / budget limits (token count, time)
- [ ] Kill switch: stop agent mid-execution

### 7.7 Desktop Integration
- [ ] Electron: agent worker runs as Python subprocess, IPC bridge
- [ ] Agent can show native notifications: "Task complete", "Approval needed", "Error occurred"
- [ ] Global shortcut (e.g., `Ctrl+Shift+A`) opens agent panel from tray
- [ ] Agent state persisted across app restarts (resume interrupted tasks)

---

## Phase 8: Integration, Polish & Release

### 8.1 Unified Settings Architecture
- [ ] Single settings store (`settingsStore`) with sections:
  - General (theme, language, shortcuts)
  - Models (model directory, active model, aliases)
  - Server (port, threads, GPU layers, advanced args)
  - Chat (default params, constraints, knowledge mode)
  - MCP Servers (list, add, marketplace)
  - Subagents (library, installed, runtime)
  - Skills (library, installed, generated)
  - Knowledgebase (sources, projects, crawl settings)
  - Agent (memory, learning, safety, delegation)
  - Web Search (backend, API keys, defaults)
- [ ] Settings sync across devices (optional, via cloud or local export)

### 8.2 Sidebar Navigation Redesign
- [ ] Collapsible sidebar with sections:
  - **Core**: Chat, Agent, Embeddings, Infill, Tokenizer
  - **Knowledge**: Knowledgebase, Search History
  - **Libraries**: Subagents, Skills, MCP Marketplace
  - **System**: Models, Server Settings, Metrics, Logs
- [ ] Badges on sidebar items: unread messages, pending approvals, new skills available

### 8.3 Onboarding Flow
- [ ] First-launch wizard:
  1. Welcome → model download suggestion
  2. Configure web search backend (skip allowed)
  3. Quick KB tour (drag a file)
  4. Agent setup (enable/disable, safety level)
  5. Done → land in chat
- [ ] Contextual tips: "Did you know you can @mention subagents?"

### 8.4 Performance & Reliability
- [ ] Lazy-load all non-chat panels (code-splitting)
- [ ] Service health dashboard: llama-server, websearch, kb, agent, registry — all with restart buttons
- [ ] Auto-recovery: if a Python service crashes, auto-restart with backoff
- [ ] Resource monitoring: warn if RAM/VRAM usage is high
- [ ] Background tasks: crawls, embedding jobs, agent reflections run in background with progress indicators

### 8.5 Testing Strategy
- [ ] Unit tests for all new services (Pytest for Python, Vitest for Svelte)
- [ ] Integration tests: full chat → search → KB → agent flow
- [ ] Desktop E2E: Playwright tests for critical paths
- [ ] Service isolation tests: kill each service, verify auto-recovery

### 8.6 Packaging
- [ ] Desktop installer bundles Python runtime (via `embedded-python` or `uv`)
- [ ] All Python services packaged as wheels in `desktop/services/`
- [ ] Auto-install Python dependencies on first launch
- [ ] Signed releases (Windows code signing already in place)
- [ ] Update mechanism: check GitHub releases, download delta updates

---

## Data Models & API Contracts

### Subagent Record (Unified)
```typescript
interface SubagentRecord {
  id: string;
  name: string;
  source: 'claude-code' | 'codex' | 'user-created';
  category: string;
  description: string;
  instructions: string;
  suggestedTools: string[];
  tags: string[];
  installed: boolean;
  installDate?: string;
  usageCount: number;
}
```

### Skill Record
```typescript
interface SkillRecord {
  id: string;
  name: string;
  source: 'agent-skills' | 'openclaw-skills' | 'agent-generated' | 'user-created';
  category: string;
  description: string;
  promptTemplate: string;
  parameters: { name: string; type: string; description: string; required: boolean }[];
  tags: string[];
  enabled: boolean;
  generatedFromSession?: string;
  usageCount: number;
  avgQuality?: number; // agent self-rated 1-5
}
```

### Knowledge Source Record
```typescript
interface KnowledgeSource {
  id: string;
  title: string;
  type: 'upload' | 'url' | 'crawl' | 'paste';
  url?: string;
  filePath?: string;
  contentType: string;
  chunkCount: number;
  indexedAt: string;
  sizeBytes: number;
  metadata: Record<string, unknown>;
}
```

### Agent Memory Record
```typescript
interface AgentMemory {
  id: string;
  type: 'fact' | 'preference' | 'project_context' | 'session_summary' | 'skill_feedback';
  key: string;
  value: string;
  embedding?: number[];
  importance: number; // 1-10
  createdAt: string;
  lastAccessedAt: string;
  accessCount: number;
  sessionId?: string;
}
```

### Agent Work Unit (Subagent Delegation)
```typescript
interface AgentWorkUnit {
  id: string;
  parentSessionId: string;
  subagentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  goal: string;
  context: string;
  result?: string;
  toolCalls: ToolCallRecord[];
  startedAt: string;
  completedAt?: string;
}
```

---

## Technology Stack (New Components)

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Agent / KB / Registry Services | Python 3.11+ | Hermes-agent and Archon are Python; rich ecosystem for ML/NLP |
| Vector DB | sqlite-vec or Chroma | Zero external DB server, embeddable, SQLite is already ubiquitous |
| Embeddings (local) | llama-server `/embeddings` | Use existing backend, no extra model download |
| Embeddings (fallback) | sentence-transformers (Python) | If llama-server doesn't expose embeddings endpoint |
| Web Crawler | crawl4ai or requests + readability-lxml | Lightweight, no heavy browser automation needed |
| Python Packaging | `uv` + `pyproject.toml` | Fast dependency resolution, modern standard |
| IPC (Electron ↔ Python) | stdio JSON-RPC or HTTP localhost | Simple, debuggable, cross-platform |
| UI Charts | uPlot or Chart.js | Lightweight, sufficient for metrics dashboard |
| Code Editor (infill) | Monaco Editor ( lite ) or CodeMirror 6 | Industry standard, supports grammar highlighting |

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Python service startup is slow | Pre-bundle `uv` virtual env; lazy-start services; show splash screen |
| Large installer size | Optional components (agent, KB) as downloadable modules |
| Windows AV false positives on bundled Python | Sign all executables; use standard Python embeddable distribution |
| llama-server port conflicts | Dynamic port allocation; desktop manages all ports |
| Agent runs dangerous commands | Approval gates; sandbox file writes; timeout limits; kill switch |
| KB vector search slow on large corpora | Incremental indexing; BM25 fallback; optional Chroma for power users |
| Subagent/skill repos change structure | Curator service normalizes; update via periodic re-parse |

---

## Success Criteria (Per Phase)

| Phase | Criteria |
|-------|----------|
| 1 | All 10 feature areas have working UI panels; desktop IPC covers all; 0 backend capabilities hidden |
| 2 | User can ask "What's the weather in Tokyo?" and agent answers via web search with citations |
| 3 | User can browse MCP marketplace, click "Add Brave Search MCP", and use it in chat within 3 clicks |
| 4 | User can search "backend developer", find subagent, install it, and `@backend-developer build an API` |
| 5 | User can browse skills library, install "web scraping", and apply it to a URL in chat |
| 6 | User can upload 10 PDFs, search "what did we decide about Q3 budget?", and get exact page reference |
| 7 | Agent completes a 5-step task autonomously, generates a skill from it, and offers to save; KB reflects new knowledge |
| 8 | First-launch onboarding < 3 minutes; all services auto-recover from crashes; installer < 500MB |

---

## Notes

- **Backward compatibility:** All existing chat functionality must remain 100% functional. New features are additive.
- **Modularity:** Each phase can be developed and shipped independently. User can disable entire phases (e.g., turn off Agent if they only want a chat UI).
- **Open source alignment:** All new Python services use permissive licenses. Skill/subagent curation respects original repo licenses (attribution in UI).
- **Local-first:** All data (KB, memories, skills, configs) stored locally by default. Optional cloud sync can be added later.

---

*Plan maintained as Markdown. Update checklists as phases complete. Mark `[x]` when done, `[-]` when in progress.*
