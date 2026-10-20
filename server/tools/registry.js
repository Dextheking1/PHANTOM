/**
 * Tool definitions in OpenAI function calling format
 */
export function getToolDefinitions() {
  return [
  {
    type: 'function',
    function: {
      name: 'show_code_demo',
      description: 'Render syntax-highlighted code directly in the user\'s UI. Use this when the user asks for a code demonstration or snippet to be displayed in a clean, highlighted window.',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'The code to render and highlight.',
          },
          language: {
            type: 'string',
            description: 'The programming language of the code (e.g., "javascript", "python", "html").',
          },
          title: {
            type: 'string',
            description: 'The title to display on the preview window.',
          },
        },
        required: ['code', 'language'],
      },
    },
  },
    {
      type: 'function',
      function: {
        name: 'get_system_capabilities',
        description: 'Get a list of all currently available skills and their descriptions, allowing the AI to be self-aware of its capabilities.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_conversations',
        description: 'Search past conversations for context and recall. Provides blazing-fast FTS5 full-text search across all messages.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query to look up in past conversations.',
            },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delegate_task',
        description: 'Spawn an isolated subagent to complete a sub-task or research independently, returning the final result (hierarchical subagent-driven development).',
        parameters: {
          type: 'object',
          properties: {
            task_description: {
              type: 'string',
              description: 'A detailed description of the task for the subagent to perform.',
            },
          },
          required: ['task_description'],
        },
      },
    },

    {
      type: 'function',
      function: {
        name: 'write_skill',
        description: 'Create and register a new AI skill dynamically. This allows you to add new custom tools or scripts to the workspace skills directory.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'The name of the new skill (should be a short, directory-friendly name).',
            },
            description: {
              type: 'string',
              description: 'A description of what the skill does.',
            },
            code: {
              type: 'string',
              description: 'The Python or Bash code for the skill.',
            },
            entry_point: {
              type: 'string',
              description: 'The filename for the main entry point (e.g., "script.py", "run.sh").',
              default: 'script.py',
            },
          },
          required: ['name', 'description', 'code'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'execute_command',
        description: 'Execute a shell command on the local system. Use for running security tools, scripts, system commands, etc. Supports bash syntax including pipes, redirects, and background processes.',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The shell command to execute. Can include pipes (|), redirects (>), background (&), etc.',
            },
            timeout: {
              type: 'integer',
              description: 'Timeout in seconds (default: 120). Set higher for long-running scans.',
              default: 120,
            },
            working_directory: {
              type: 'string',
              description: 'Working directory for the command. Defaults to home directory.',
            },
            use_sudo: {
              type: 'boolean',
              description: 'Whether to prepend sudo to the command. The configured sudo password will be used.',
              default: false,
            },
          },
          required: ['command'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the contents of a file from the filesystem. Use for analyzing configs, logs, source code, scan results, etc.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Absolute or relative path to the file to read.',
            },
            max_lines: {
              type: 'integer',
              description: 'Maximum number of lines to read (default: 500). Use to limit output for large files.',
              default: 500,
            },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write content to a file. Creates parent directories if needed. Use for scripts, configs, payloads, reports.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path where the file should be written.',
            },
            content: {
              type: 'string',
              description: 'The content to write to the file.',
            },
            append: {
              type: 'boolean',
              description: 'If true, append to existing file instead of overwriting.',
              default: false,
            },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'generate_pdf',
        description: 'Create a workspace-local PDF artifact from Markdown or plain text. The result includes a structured artifact path and byte count; paths outside the workspace are rejected.',
        parameters: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'Markdown or plain text content to place in the PDF.',
            },
            filename: {
              type: 'string',
              description: 'Workspace-relative output filename or path. The .pdf extension is added when omitted. Defaults to phantom-document.pdf.',
              default: 'phantom-document.pdf',
            },
            output_path: {
              type: 'string',
              description: 'Optional workspace-relative output path. Use this instead of filename when a nested artifact path is needed.',
            },
            title: {
              type: 'string',
              description: 'Optional document title shown at the top of the PDF.',
            },
          },
          required: ['content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'install_tool',
        description: 'Install a security tool or package with OS-aware package-manager detection. Uses validated identifiers, reproducible local npm installs (never global), and workspace-local git clones.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Name of the tool to install (e.g., "nmap", "sqlmap", "gobuster").',
            },
            method: {
              type: 'string',
              enum: ['auto', 'apt', 'dnf', 'pacman', 'yum', 'zypper', 'brew', 'port', 'winget', 'choco', 'scoop', 'pip', 'pipx', 'go', 'cargo', 'npm', 'git', 'snap'],
              description: 'Installation method. Use "auto" for automatic detection.',
              default: 'auto',
            },
            source: {
              type: 'string',
              description: 'Source URL for git clone or specific package name. Required for "git" method.',
            },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_request',
        description: 'Make an HTTP/HTTPS request. Use for web reconnaissance, API testing, downloading files, etc.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to request.',
            },
            method: {
              type: 'string',
              enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
              description: 'HTTP method.',
              default: 'GET',
            },
            headers: {
              type: 'object',
              description: 'Request headers as key-value pairs.',
            },
            body: {
              type: 'string',
              description: 'Request body (for POST/PUT/PATCH).',
            },
            follow_redirects: {
              type: 'boolean',
              description: 'Whether to follow redirects.',
              default: true,
            },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_web',
        description: 'Search the web for information. Use to find exploits, CVEs, tool documentation, attack techniques, etc.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query.',
            },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'scrape_webpage',
        description: 'Scrape a webpage and extract readable text content. Strips HTML tags, scripts, styles. Use for reading documentation, CVE details, exploit-db pages, blog posts, etc.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL of the webpage to scrape.',
            },
            max_length: {
              type: 'integer',
              description: 'Maximum length of extracted text (default: 30000 chars).',
              default: 30000,
            },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'save_memory',
        description: 'Save important information to the AgentMemory Engine. Supports 4-tier taxonomy (episodic, semantic, procedural, working) and importance scoring.',
        parameters: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: ['episodic', 'semantic', 'procedural', 'working', 'target', 'credential', 'finding', 'vulnerability', 'network', 'note', 'tool_config'],
              description: 'Category/tier of the memory (episodic=session logs/debug, semantic=facts/schemas, procedural=workflows/scripts, working=current context).',
            },
            key: {
              type: 'string',
              description: 'A short descriptive key (e.g., "target_ip", "architecture_rule", "nmap_workflow").',
            },
            value: {
              type: 'string',
              description: 'The information or knowledge to remember.',
            },
            importance: {
              type: 'integer',
              description: 'Importance rating from 1 (transient) to 5 (critical architecture rule/fact). Default is 3.',
            },
          },
          required: ['category', 'key', 'value'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'recall_memory',
        description: 'Search persistent memory via Hybrid RRF Search (BM25 keyword + vector similarity + Ebbinghaus recency decay).',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query to find relevant memories.',
            },
            category: {
              type: 'string',
              enum: ['episodic', 'semantic', 'procedural', 'working', 'target', 'credential', 'finding', 'vulnerability', 'network', 'note', 'tool_config'],
              description: 'Optional category filter.',
            },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_memory_stats',
        description: 'Get AgentMemory Engine stats, total stored items, category breakdown, and top-recalled memories.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_directory',
        description: 'List the contents of a directory with file details.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the directory to list.',
            },
            show_hidden: {
              type: 'boolean',
              description: 'Whether to show hidden files (dotfiles).',
              default: false,
            },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'python_execute',
        description: 'Execute a Python script inline. Use for data processing, exploit development, custom tools, etc.',
        parameters: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'Python code to execute.',
            },
            timeout: {
              type: 'integer',
              description: 'Timeout in seconds.',
              default: 60,
            },
          },
          required: ['code'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'edit_source_code',
        description: 'Edit PHANTOM source code files for self-improvement. Creates backups automatically. Only works within the project directory.',
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Absolute path to the source file to edit.',
            },
            content: {
              type: 'string',
              description: 'The new file content.',
            },
            description: {
              type: 'string',
              description: 'Description of what was changed and why.',
            },
          },
          required: ['file_path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'save_trace',
        description: 'Save an execution trace for self-optimization. Record what worked, what failed, and lessons learned after complex tasks.',
        parameters: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'Brief description of the task attempted.',
            },
            approach: {
              type: 'string',
              description: 'The approach/methodology used.',
            },
            outcome: {
              type: 'string',
              description: 'Result: success, partial, or failure.',
            },
            score: {
              type: 'number',
              description: 'Optional score 0-10 rating the approach effectiveness.',
            },
            notes: {
              type: 'string',
              description: 'Lessons learned and what to try differently next time.',
            },
          },
          required: ['task', 'approach', 'outcome'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'scrapling_fetch',
        description: 'Advanced web scraping powered by Scrapling. Supports 3 modes: "basic" (fast HTTP with TLS fingerprint spoofing), "stealth" (headless browser that bypasses Cloudflare/anti-bot), "dynamic" (full Playwright browser for JS-heavy sites). Can extract data with CSS/XPath selectors or return full page text, title, and links.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL to scrape.',
            },
            mode: {
              type: 'string',
              enum: ['basic', 'stealth', 'dynamic'],
              description: 'Fetcher mode. "basic" = fast HTTP. "stealth" = anti-bot bypass (Cloudflare). "dynamic" = full browser rendering.',
              default: 'basic',
            },
            css_selector: {
              type: 'string',
              description: 'CSS selector to extract specific elements (e.g. ".product h2", "table tr").',
            },
            xpath: {
              type: 'string',
              description: 'XPath selector to extract specific elements.',
            },
            proxy: {
              type: 'string',
              description: 'Proxy URL (e.g. "http://user:pass@proxy:8080").',
            },
            solve_cloudflare: {
              type: 'boolean',
              description: 'Whether to solve Cloudflare challenges in stealth mode. Default true.',
              default: true,
            },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_preview_window',
        description: 'Render interactive HTML, JS, CSS, charts, or graphs directly in the user\'s UI. Use this when the user asks for a visual representation, code demo, or graphical target map.',
        parameters: {
          type: 'object',
          properties: {
            html_content: {
              type: 'string',
              description: 'The HTML code to render. Can include inline <style> and <script> tags for interactivity.',
            },
            title: {
              type: 'string',
              description: 'The title to display on the preview window.',
            },
            open_new_window: {
              type: 'boolean',
              description: 'If true, automatically pops out the preview into a new browser window/tab instead of just showing it in the side panel. Use this for full-page apps or when you want more freedom for the visualization.',
              default: false,
            },
          },
          required: ['html_content', 'title'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'analyze_target_graph',
        description: 'Autonomously generate and visualize an interactive network or structural graph for a given target, displaying it in a new window for the user.',
        parameters: {
          type: 'object',
          properties: {
            target_name: {
              type: 'string',
              description: 'The name or IP of the target to analyze.',
            },
            nodes: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of node names (e.g., open ports, subdomains, related services) to include in the graph.',
            },
            edges: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  source: { type: 'string' },
                  target: { type: 'string' },
                  label: { type: 'string' }
                },
                required: ['source', 'target']
              },
              description: 'Optional list of edges defining complex relationships between nodes or the target.',
            },
          },
          required: ['target_name', 'nodes'],
        },
      },
    },

    // ─── Web research ───

    {
      type: 'function',
      function: {
        name: 'jina_read_url',
        description: 'Read any URL on the internet and get clean, readable Markdown content. Uses Jina Reader — zero config, free, no API key needed. Great for reading articles, docs, blog posts, and any webpage. Returns structured Markdown instead of raw HTML.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to read (e.g., "https://example.com/article").',
            },
            max_length: {
              type: 'integer',
              description: 'Maximum content length in characters (default: 50000).',
              default: 50000,
            },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'rea_capabilities',
        description: 'Report the installed REA reverse-engineering bridge and its safe target policy.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'rea_list_tools',
        description: 'List REA tool names, or supply tool_name to retrieve one exact input schema before calling it.',
        parameters: {
          type: 'object',
          properties: {
            tool_name: { type: 'string', description: 'Optional exact tool name to retrieve its description and input schema.' },
            timeout: { type: 'integer', description: 'MCP startup/request timeout in milliseconds.', default: 330000 },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'rea_call_tool',
        description: 'Call one discovered REA MCP tool for authorized reverse engineering. Discover tools with rea_list_tools first; target paths are restricted to PHANTOM/project workspace unless explicitly enabled by the operator.',
        parameters: {
          type: 'object',
          properties: {
            tool_name: { type: 'string', description: 'Exact REA MCP tool name returned by rea_list_tools.' },
            arguments: { type: 'object', description: 'Arguments accepted by the discovered REA tool.' },
            target: { type: 'string', description: 'Optional local artifact path. It is validated by PHANTOM before being passed to REA.' },
            timeout: { type: 'integer', description: 'MCP startup/request timeout in milliseconds.', default: 330000 },
          },
          required: ['tool_name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'configure_mcp_server',
        description: 'Autonomously configure, save, and connect an MCP (Model Context Protocol) server to PHANTOM. This saves the server configuration to the workbench database and immediately connects to discover its tools.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Unique identifier or name for the MCP server (e.g., "ghidra_mcp", "github_mcp", "filesystem").',
            },
            command: {
              type: 'string',
              description: 'Executable command to start the MCP server (e.g., "npx", "node", "python3", "uvx", or binary path).',
            },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: 'Command line arguments for the MCP server command (e.g., ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]).',
            },
            transport: {
              type: 'string',
              enum: ['stdio', 'sse', 'http'],
              default: 'stdio',
              description: 'Transport type used by the MCP server ("stdio" for process pipe, "sse" for server-sent events).',
            },
            url: {
              type: 'string',
              description: 'URL endpoint when transport is "sse" or "http".',
            },
            env: {
              type: 'object',
              description: 'Optional environment variables needed by the MCP server.',
            },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_mcp_servers',
        description: 'List all configured MCP servers in PHANTOM, their active connection status, and the tools they provide.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'remove_mcp_server',
        description: 'Remove and disconnect a configured MCP server by its name or ID.',
        parameters: {
          type: 'object',
          properties: {
            name_or_id: {
              type: 'string',
              description: 'The name or UUID of the MCP server to remove.',
            },
          },
          required: ['name_or_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'call_mcp_tool',
        description: 'Execute any tool provided by an active MCP server connected to PHANTOM.',
        parameters: {
          type: 'object',
          properties: {
            server_name: {
              type: 'string',
              description: 'The name of the connected MCP server.',
            },
            tool_name: {
              type: 'string',
              description: 'The name of the tool exposed by the MCP server to invoke.',
            },
            arguments: {
              type: 'object',
              description: 'Arguments required by the MCP tool.',
            },
          },
          required: ['server_name', 'tool_name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'manage_skills',
        description: 'List, inspect, or manage custom AI skills registered in PHANTOM.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'info', 'delete'],
              description: 'Action to perform: list all skills, get detailed info on a skill, or delete a skill.',
            },
            name: {
              type: 'string',
              description: 'The name of the skill (required for "info" and "delete").',
            },
          },
          required: ['action'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'agent_browser',
        description: 'Vercel Agent Browser (https://github.com/vercel-labs/agent-browser) - real headless Chromium browser with CDP. Use this whenever browsing, scraping, downloading, or interacting with protected web sites (Cloudflare, PortSwigger, Akamai, Datadome, captchas) without bot blocks.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['open', 'snapshot', 'click', 'fill', 'get_text', 'screenshot', 'download', 'eval'],
              description: 'Browser action to execute: open a URL, capture interactive snapshot, click an element ref (@e1, @e2) or selector, fill an input, get page/element text, take a screenshot, download a file, or evaluate JavaScript.',
            },
            url: {
              type: 'string',
              description: 'Target URL to open or download.',
            },
            selector: {
              type: 'string',
              description: 'Element ref (@e1, @e2) from snapshot or CSS selector to click, fill, or read.',
            },
            text: {
              type: 'string',
              description: 'Text to type/fill into the targeted input element, or JavaScript expression to evaluate.',
            },
            options: {
              type: 'object',
              description: 'Additional options such as annotate (for screenshots) or full (for full snapshot).',
            },
          },
        },
      },
    },
  ];
}
