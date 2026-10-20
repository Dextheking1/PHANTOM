import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { getMCPServers, addMCPServer, removeMCPServer } from '../memory/store.js';

class MCPClientHub {
  constructor() {
    /** @type {Map<string, { client: Client, transport: any, config: any, tools: any[], connected: boolean, error?: string }>} */
    this.connections = new Map();
  }

  /**
   * Parse arguments from array or JSON string.
   */
  _parseArgs(rawArgs) {
    if (!rawArgs) return [];
    if (Array.isArray(rawArgs)) return rawArgs.map(String);
    if (typeof rawArgs === 'string') {
      try {
        const parsed = JSON.parse(rawArgs);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        // Space-separated or shell split
        return rawArgs.trim().split(/\s+/).filter(Boolean);
      }
    }
    return [];
  }

  /**
   * Connect to an MCP server given its configuration.
   */
  async connectServer(serverConfig) {
    const key = serverConfig.name || serverConfig.id;
    if (this.connections.has(key)) {
      const existing = this.connections.get(key);
      if (existing.connected) return existing;
    }

    const transportType = (serverConfig.transport || 'stdio').toLowerCase();
    let transport;

    try {
      if (transportType === 'stdio') {
        if (!serverConfig.command) {
          throw new Error('Command is required for stdio transport.');
        }
        const args = this._parseArgs(serverConfig.args);
        const env = { ...process.env, ...(serverConfig.env || {}) };
        transport = new StdioClientTransport({
          command: serverConfig.command,
          args,
          env,
        });
      } else if (transportType === 'sse' || transportType === 'http') {
        const urlStr = serverConfig.url;
        if (!urlStr) throw new Error('URL is required for SSE transport.');
        transport = new SSEClientTransport(new URL(urlStr));
      } else {
        throw new Error(`Unsupported transport: ${transportType}`);
      }

      const client = new Client(
        { name: 'PHANTOM-MCP-Bridge', version: '1.0.0' },
        { capabilities: {} }
      );

      // Connect with timeout
      await Promise.race([
        client.connect(transport),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout (10s)')), 10000))
      ]);

      // Discover exposed tools
      let tools = [];
      try {
        const listResult = await client.listTools();
        tools = listResult?.tools || [];
      } catch (listErr) {
        console.warn(`[MCPClientHub] listTools error for ${key}:`, listErr.message);
      }

      const record = {
        client,
        transport,
        config: serverConfig,
        tools,
        connected: true,
      };

      this.connections.set(key, record);
      if (serverConfig.id && serverConfig.id !== key) {
        this.connections.set(serverConfig.id, record);
      }

      return record;
    } catch (err) {
      console.error(`[MCPClientHub] Failed to connect to MCP server "${key}":`, err.message);
      const record = {
        client: null,
        transport: null,
        config: serverConfig,
        tools: [],
        connected: false,
        error: err.message,
      };
      this.connections.set(key, record);
      return record;
    }
  }

  /**
   * Disconnect and remove an MCP server.
   */
  async disconnectServer(idOrName) {
    const existing = this.connections.get(idOrName);
    if (existing) {
      try {
        if (existing.transport && typeof existing.transport.close === 'function') {
          await existing.transport.close();
        }
      } catch (err) {
        console.warn(`[MCPClientHub] Error closing transport for ${idOrName}:`, err.message);
      }
      this.connections.delete(idOrName);
      if (existing.config?.name) this.connections.delete(existing.config.name);
      if (existing.config?.id) this.connections.delete(existing.config.id);
    }
  }

  /**
   * Configure and save a new MCP server to database, then connect to it immediately.
   */
  async configureServer({ name, transport = 'stdio', command, args, url, env }) {
    if (!name || (!command && !url)) {
      throw new Error('MCP server requires a name and either a command (stdio) or URL (sse).');
    }

    // Save to database
    const id = addMCPServer({
      name,
      transport,
      command: command || null,
      args: args ? (Array.isArray(args) ? args : this._parseArgs(args)) : null,
      url: url || null,
    });

    const serverConfig = {
      id,
      name,
      transport,
      command,
      args,
      url,
      env,
    };

    // Attempt live connection
    const connection = await this.connectServer(serverConfig);

    return {
      success: true,
      id,
      name,
      connected: connection.connected,
      error: connection.error,
      tools: connection.tools,
      toolCount: connection.tools.length,
      message: connection.connected
        ? `MCP Server "${name}" connected successfully! Discovered ${connection.tools.length} tools.`
        : `MCP Server "${name}" saved to configuration. Connection status: ${connection.error || 'Idle'}`,
    };
  }

  /**
   * List all configured servers with connection status.
   */
  async listServers() {
    const stored = getMCPServers();
    return stored.map((s) => {
      const active = this.connections.get(s.id) || this.connections.get(s.name);
      return {
        ...s,
        args: this._parseArgs(s.args),
        connected: active ? active.connected : false,
        error: active ? active.error : null,
        toolCount: active && active.tools ? active.tools.length : 0,
        tools: active && active.tools ? active.tools.map(t => ({ name: t.name, description: t.description })) : [],
      };
    });
  }

  /**
   * Execute a tool on a connected MCP server.
   */
  async callTool(serverNameOrId, toolName, args = {}) {
    let connection = this.connections.get(serverNameOrId);
    if (!connection || !connection.connected) {
      // Find server config from DB
      const stored = getMCPServers().find(s => s.id === serverNameOrId || s.name === serverNameOrId);
      if (!stored) {
        throw new Error(`MCP Server "${serverNameOrId}" is not configured. Use configure_mcp_server first.`);
      }
      connection = await this.connectServer(stored);
      if (!connection.connected) {
        throw new Error(`Failed to connect to MCP server "${serverNameOrId}": ${connection.error}`);
      }
    }

    const { client } = connection;
    if (!client) throw new Error(`MCP Client for "${serverNameOrId}" is not active.`);

    const callResult = await client.callTool({
      name: toolName,
      arguments: args,
    });

    if (callResult.isError) {
      const errorText = (callResult.content || []).map(c => c.text || '').join('\n');
      throw new Error(`MCP Tool error: ${errorText || 'Execution failed'}`);
    }

    const text = (callResult.content || []).map(c => c.text || '').join('\n');
    return text || JSON.stringify(callResult, null, 2);
  }

  /**
   * Get all tools across all active MCP servers for the LLM.
   */
  getAllTools() {
    const list = [];
    for (const [key, record] of this.connections.entries()) {
      if (record.connected && record.tools && record.tools.length > 0) {
        for (const t of record.tools) {
          list.push({
            serverName: record.config.name,
            name: t.name,
            description: t.description || '',
            inputSchema: t.inputSchema,
          });
        }
      }
    }
    return list;
  }
}

export const mcpClientHub = new MCPClientHub();
