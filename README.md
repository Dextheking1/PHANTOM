<div align="center">

# 👻 PHANTOM

### From a security question to a working investigation.

An AI security workbench that brings conversations, live tool output, local files,
persistent memory, and reverse-engineering discovery into one browser interface.

[![CI](https://github.com/OmYarewar110/PHANTOM/actions/workflows/ci.yml/badge.svg)](https://github.com/OmYarewar110/PHANTOM/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-24.18.0-339933?logo=node.js&logoColor=white)](.nvmrc)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Contributions welcome](https://img.shields.io/badge/Contributions-welcome-8b5cf6)](CONTRIBUTING.md)

[Get started](#get-started) · [What you can do](#what-you-can-do) · [REA integration](#reverse-engineering-with-rea) · [Contribute](#help-build-phantom)

</div>

> **For authorized work only.** PHANTOM can execute commands and modify files with
> your account's permissions. Use a disposable environment for untrusted targets.
> A local workspace is not a security sandbox. Keep the server private.

## Why PHANTOM?

Security investigations often mean switching between a terminal, browser, notes,
and an AI chat. PHANTOM puts those working pieces together:

- **See the work as it happens.** Stream responses and tool output rather than
  waiting for an unexplained final answer.
- **Keep the context.** Save conversations, findings, and execution traces locally
  in SQLite; search them when you return to an investigation.
- **Use your model endpoint.** Configure an OpenAI-compatible API, including
  hosted endpoints or compatible local servers such as Ollama and LM Studio.
- **Extend deliberately.** Work with skills and MCP infrastructure, or discover
  REA's reverse-engineering tools through an opt-in local bridge.
- **Run it yourself.** A vanilla JavaScript frontend, Node.js backend, pinned
  runtime, lockfile, and Docker setup keep the stack approachable.

## What you can do

| Workflow | Built into PHANTOM |
| --- | --- |
| Investigate an artifact | Read files, run commands, execute Python, and save a report in your workspace |
| Research a question | Search the web, fetch pages, and read URLs through Jina Reader |
| Continue previous work | Search conversations and recall saved findings through memory tools |
| Manage an investigation | Use the workspace browser, settings, skills, and MCP panels |
| Explore reverse engineering | Discover the pinned REA tool catalog and call tools after explicitly enabling execution |
| Customize the workbench | Create skills, retain execution traces, and use the existing self-update flow |

Tool loops have a configurable iteration limit. Stop requests cancel active
generation, but do **not** guarantee immediate termination of every external
tool or child process.

## Get started

### Option 1: Docker on Linux

Requires Git, Docker Engine, and Docker Compose. No global npm installation is
needed. The image uses Node **24.18.0** and includes REA's `procps` prerequisite.

```bash
git clone https://github.com/OmYarewar110/PHANTOM.git
cd PHANTOM
cp .env.example .env
docker compose up -d --build
```

Open **http://localhost:3000**, then configure your model endpoint and API key
in Settings. Compose binds the port to `127.0.0.1` and enables local mode.
The host `.env` is **not** copied into the image: only the variables explicitly
listed in `docker-compose.yml` are passed through.

```bash
docker compose logs -f phantom
docker compose down
```

**Storage:** Compose mounts `./workspace` for generated files. The default
SQLite database lives at `/app/data` inside the container and is not currently
mounted; it can be lost when the container is replaced. Add a persistent volume
for that directory and back it up if you need durable settings and conversations.
Do not publish database files: they can contain keys, passwords, and private chats.

### Option 2: Local development

Use Node **24.18.0**, as pinned in `.nvmrc` and `.node-version`. The commands
below assume `nvm` is already installed; any version manager providing the exact
version is fine. Linux is the reference environment; Windows/macOS paths have
not been verified by this cleanup.

```bash
git clone https://github.com/OmYarewar110/PHANTOM.git
cd PHANTOM
nvm install
nvm use
npm ci
cp .env.example .env
npm run dev
```

Open **http://localhost:5173**. The development proxy expects the backend on
port **1337**; keep that default unless you also update `vite.config.js`.

For the regular server without the Vite dev server:

```bash
npm start
```

Open **http://localhost:1337**. The server currently serves `frontend/` directly;
`npm run build` checks the frontend bundle, but that bundle is not the server's
current static-serving path.

### Try your first investigation

Start with a small, owned artifact or saved log:

> Read the application log in my workspace. Group repeated errors, explain
> what the evidence supports, and save a Markdown summary without including secrets.

Or explore the REA bridge without enabling target execution:

> Show REA's capabilities and available tool names. Do not run an analysis yet.

## Configure your model

Edit `.env` for a local installation, or use Settings. Choose **one** endpoint
configuration; use its actual supported model identifier. PHANTOM expects the
OpenAI-compatible API format, not every provider's native API.

| Setting | Purpose | Default |
| --- | --- | --- |
| `API_BASE_URL` | OpenAI-compatible endpoint | `https://api.openai.com/v1` |
| `API_KEY` | Endpoint credential; keep private | Empty in server configuration |
| `API_MODEL` | Model identifier accepted by your endpoint | `gpt-4o` |
| `MAX_TOKENS` | Output-token limit; also configurable in Settings | `4096` |
| `MAX_TOOL_ITERATIONS` | Maximum tool-call cycles per request | `12` |
| `HOST` / `PORT` | Local server address | `127.0.0.1` / `1337` |
| `API_TOKEN` | Authentication token for non-local API access | Unset |
| `REA_ENABLE_TOOL_CALLS` | Explicit REA execution opt-in | `false` |

For Ollama's compatible local endpoint, for example:

```env
API_BASE_URL=http://localhost:11434/v1
API_KEY=ollama
API_MODEL=llama3
```

Pull and serve the selected model in Ollama first. Inside Docker, `localhost`
means the container, not the host machine; use an address reachable from the
container. Saved settings can override environment defaults. See
[`.env.example`](.env.example) and [`server/config.js`](server/config.js).

## Reverse engineering with REA

PHANTOM includes the official [`morluto/rea`](https://github.com/morluto/rea)
package, pinned to **`rea-agents@6.7.0`**. The bridge communicates with its local
MCP server rather than downloading a changing `latest` package at runtime.

1. Call `rea_capabilities` to check bridge settings.
2. Call `rea_list_tools` for tool names.
3. Call `rea_list_tools` with `tool_name` for one tool's input schema.
4. After reviewing its effects, call `rea_call_tool` with that exact name and
   matching arguments.

Execution is disabled until the operator sets the following in `.env` and
restarts PHANTOM (or recreates the Compose container):

```env
REA_ENABLE_TOOL_CALLS=true
```

REA's catalog spans native binaries, JavaScript/Electron applications, APKs,
managed code, captures, firmware, and runtime observations. **Catalog discovery
does not mean every workflow is ready.** Ghidra, IDA, Hopper, JADX, browsers, and
other providers require their own installation and, where applicable, licenses.
They are not bundled or verified by this bridge. Optional Frida installation
scripts are not approved by this project's install policy.

**Current boundaries:** each call starts a fresh REA server, so retained sessions
do not survive across calls. The optional `target` field checks a convenience
path against the project/workspace, but it does **not** confine arbitrary REA
arguments or provider processes. `REA_ALLOW_EXTERNAL_TARGETS=true` relaxes that
convenience check, not an operating-system sandbox. Isolate untrusted analysis
and never mount credentials into its environment.

The [workspace REA skill](.opencode/skills/rea-reverse-engineering/SKILL.md)
describes discovery, evidence handling, and limitations. Target-derived text
must be treated as evidence, not instructions.

## Test and build

After `npm ci`, the single test command is:

```bash
npm test
```

The suite uses local fixtures and mocks; no model API key or live REA analysis
engine is required. Dependency installation and initial Docker builds do require
network access. Additional checks:

```bash
npm run build
npm run lint
```

To run the installed test suite explicitly without networking using Docker:

```bash
docker run --rm --network none \
  -v "$PWD:/app" -w /app \
  node:24.18.0-bookworm npm test
```

The mounted dependencies must have been installed for the container's Linux
platform and pinned Node version. Native-addon errors usually mean a mismatched
Node version or platform: switch to the pinned runtime and rerun `npm ci` there.
If no compatible prebuilt addon is available, a local compiler toolchain may
be required; Docker is the reference setup.

## Deploy privately

Use the [Docker quick start](#option-1-docker-on-linux) for local deployment.
Before considering network exposure:

- Disable `PHANTOM_LOCAL_MODE` and configure a strong `API_TOKEN`; stock Compose
  intentionally uses local mode and is **not** a public-deployment template.
- Keep the port bound to loopback behind an authenticated HTTPS reverse proxy.
  Configure proxy trust and origins deliberately rather than allowing all origins.
- Persist and back up the database separately from generated workspace files.
- Use a restricted account or disposable container and mount only required data.
- Review dependencies with `npm audit`. Known dependency advisories remain;
  passing tests is not a security certification. Do not apply breaking forced
  upgrades without testing.
- Keep REA execution disabled unless it is required for your authorized task.

Remote authentication, arbitrary tool execution, and self-update are powerful
surfaces. This project is a workbench for trusted operators, not an untrusted
multi-tenant service.

## Find your way around

| Path | Responsibility |
| --- | --- |
| [`frontend/`](frontend/) | Browser interface, chat, workspace, settings, and styles |
| [`server/ai/`](server/ai/) | Model requests, streaming, prompts, and tool loop |
| [`server/tools/`](server/tools/) | Tool definitions, execution, web reading, and REA bridge |
| [`server/memory/`](server/memory/) | SQLite storage, search, and embeddings |
| [`server/skills/`](server/skills/) | Skill loading, trust tiers, and sandbox support |
| [`server/mcp/`](server/mcp/) | MCP server infrastructure |
| [`tests/`](tests/) | Offline regression tests |
| [`bin/phantom.js`](bin/phantom.js) | Project CLI and restart flow |

## Help build PHANTOM

Useful contributions include reproducible bug reports, focused tests,
provider compatibility fixes, accessibility improvements, and clearer setup
guides. Read [CONTRIBUTING.md](CONTRIBUTING.md), run the checks above, and keep
changes small enough to review.

- [Report a bug or request a feature](https://github.com/OmYarewar110/PHANTOM/issues)
- [Browse pull requests](https://github.com/OmYarewar110/PHANTOM/pulls)
- If PHANTOM is useful to you, a star helps other researchers discover it.

## License and responsible use

PHANTOM is [MIT licensed](LICENSE). REA and its dependencies retain their own
licenses; PHANTOM grants no entitlement to commercial analysis tools.

Only inspect systems and software you own or have permission to examine. Do
not include tokens, passwords, private targets, or conversation databases in
issues, screenshots, or pull requests.
