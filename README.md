<div align="center">

# 👻 PHANTOM

### AI-Powered Pentesting Command Center

[![CI](https://github.com/OmYarewar110/PHANTOM/actions/workflows/ci.yml/badge.svg)](https://github.com/OmYarewar110/PHANTOM/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://www.linux.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-brightgreen?style=for-the-badge)](https://github.com/pulls)
[![Hlido trust score](https://hlido.eu/badge/omyarewar110-phantom.svg)](https://hlido.eu/check/?agent=omyarewar110-phantom)

**An autonomous AI assistant for penetration testing, security research, and general-purpose tasks.**  
Real-time tool execution • Bounded autonomous operations • Self-improving AI • Beautiful dark UI

<img src="https://img.shields.io/badge/Status-Active-22c55e?style=flat-square" />
<img src="https://img.shields.io/badge/Security-Offensive-ef4444?style=flat-square" />
<img src="https://img.shields.io/badge/AI-Autonomous-6366f1?style=flat-square" />

---

</div>

## ⚡ Installation (Linux / macOS / Windows)

Install **PHANTOM** and configure the `phantom` CLI command across any terminal in a single command:

**Linux & macOS (Bash/Zsh/Fish/etc.):**
```bash
curl -fsSL https://raw.githubusercontent.com/OmYarewar110/PHANTOM/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
iwr -useb https://raw.githubusercontent.com/OmYarewar110/PHANTOM/main/install.ps1 | iex
```

Once installed, launch PHANTOM from **any terminal window** instantly:

```bash
# 🚀 Launch PHANTOM server
phantom start

# 💻 Launch in development mode (Backend + Vite UI)
phantom dev

# 🔌 Specify custom port
phantom start --port 8080

# ❓ View CLI menu & options
phantom --help
```

Open **http://localhost:1337** (or **http://localhost:5173** in dev mode) in your browser.

---

## 👩‍💻 Developer Setup (Manual Installation)

For developers contributing to PHANTOM or customizing the codebase:

```bash
# 1. Clone the repository
git clone https://github.com/OmYarewar110/PHANTOM.git
cd PHANTOM

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env

# 4. Start development mode
npm run dev

# 5. Run test suite
npm test
```

---

## 🤔 Why PHANTOM?

- **Zero-Config Tool Execution:** Tools automatically install system dependencies and parse outputs cleanly, so the AI never gets stuck missing a library.
- **Bounded Agent Loops:** PHANTOM can call tools autonomously while enforcing a configurable iteration limit to prevent runaway jobs.
- **Persistent Context:** The integrated SQLite memory store gives your agent long-term recall across sessions, preventing repetitive scanning or reconnaissance.

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🛡️ **Multi-Agent Defense** | Orchestrator, Planner, and Specialist Agents (Log, Compliance, Threat Modeler) working in parallel via Task Graphs |
| 🤖 **Any LLM Backend** | OpenAI, OpenRouter, Ollama, LM Studio, DeepSeek, Claude — any OpenAI-compatible API |
| ⚡ **Real-Time Streaming** | Live tool execution output, typing animations, and AI thinking display |
| 🛡️ **Safe Defaults** | Localhost-only binding by default, authenticated remote mode, message limits, and bounded tool loops |
| 🧠 **Self-Improving** | Creates its own tools, saves execution traces, learns from past runs |
| 🔑 **Sudo Controls** | Optional sudo validation; avoid enabling remote access without a strong API token |
| 📁 **Workspace System** | Configurable workspace directory for scripts, reports, and file operations |
| 🧩 **MCP Server Hub** | Native Model Context Protocol infrastructure supporting typed JSON schemas and rate-limited endpoints |
| 📦 **Skills System** | Trust-tiered SKILL.md packages utilizing `isolated-vm` sandboxing |
| 🌐 **Web Research** | Built-in web search and webpage scraping for real-time information |
| 💾 **Semantic Memory** | Local Vector Search (`@xenova/transformers`) paired with standard FTS |
| 🛑 **Emergency Stop** | Instant abort button to halt any running operation |
| 🎨 **Focused Workbench UI** | Modern, responsive interface for conversations, workspace files, MCP, and skills |

## ⚙️ Configuration

Edit `.env` or configure via the Web UI Settings panel:

```env
# OpenAI
API_BASE_URL=https://api.openai.com/v1
API_KEY=sk-your-key-here
API_MODEL=gpt-4o
HOST=127.0.0.1
# Required for production or non-local binding
# API_TOKEN=replace-with-a-long-random-token

# OpenRouter (access to 100+ models)
API_BASE_URL=https://openrouter.ai/api/v1
API_KEY=sk-or-your-key-here
MODEL_ID=deepseek/deepseek-chat

# Ollama (local, free)
API_BASE_URL=http://localhost:11434/v1
API_KEY=ollama
MODEL_ID=llama3
```

## 🐳 Docker Deployment

Run PHANTOM in a containerized environment using Docker Compose:

```bash
docker compose up --build
```
Open **http://localhost:3000** in your browser.

## 🏗️ Architecture

```text
PHANTOM/
├── bin/                    # PHANTOM CLI executable script (phantom)
├── install.sh              # 1-line curl installer script
├── server/                 # Backend (Express + WebSocket)
│   ├── ai/
│   │   ├── llm-client.js   # LLM communication & streaming
│   │   └── system-prompt.js # Dynamic system prompt builder
│   ├── tools/
│   │   ├── executor.js      # Tool execution engine (25 tools)
│   │   └── registry.js      # Tool definitions for function calling
│   ├── memory/
│   │   └── store.js         # SQLite persistence layer
│   ├── banner.js            # Colorful ANSI terminal banner
│   ├── config.js            # Configuration management
│   └── index.js             # Server entry point
├── frontend/               # Frontend (Vanilla JS + Vite)
│   ├── css/styles.css       # Dark theme design system
│   ├── js/
│   │   ├── app.js           # Main controller & WebSocket
│   │   ├── chat.js          # Chat rendering & animations
│   │   └── settings.js      # Settings panel
│   └── index.html           # Main page
├── workspace/              # AI workspace (scripts, reports, skills)
├── .env.example            # Configuration template
├── vite.config.js          # Vite dev server config
└── package.json
```

## 🛠️ Available Tools

PHANTOM has **25 built-in tools** that the AI uses autonomously:

| Tool | Purpose |
|------|---------|
| `execute_command` | Run shell commands with auto sudo injection |
| `read_file` | Read file contents |
| `write_file` | Write/create files |
| `list_directory` | List directory contents |
| `install_tool` | Auto-install packages (apt/pacman/pip/npm/go/cargo) |
| `web_request` | HTTP requests for recon & API testing |
| `search_web` | Web search via DuckDuckGo |
| `scrape_webpage` | Fetch & parse webpage content |
| `python_execute` | Execute Python code directly |
| `save_memory` | Store findings to AgentMemory engine (4-tier taxonomy) |
| `recall_memory` | Hybrid RRF search across persistent memory |
| `get_memory_stats` | Get AgentMemory Engine stats & top-recalled items |
| `edit_source_code` | Self-modify PHANTOM's own code |
| `save_trace` | Log execution traces for self-optimization |
| `jina_read_url` | Read any URL as clean Markdown |

## 🧪 Testing

Run the Vitest test suite:

```bash
npm test
```


## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

PHANTOM is designed for **authorized security testing only**. Always obtain proper authorization before testing any systems. The developers are not responsible for misuse of this tool.

---

<div align="center">

**Built with 🖤 for the security community**

</div>
