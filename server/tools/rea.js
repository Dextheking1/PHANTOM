import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRequire } from 'module';
import { existsSync } from 'fs';
import { dirname, isAbsolute, relative, resolve, join } from 'path';
import config from '../config.js';

const require = createRequire(import.meta.url);
const REA_PACKAGE_JSON = require.resolve('rea-agents/package.json');
const REA_ROOT = dirname(REA_PACKAGE_JSON);
const REA_ENTRY = join(REA_ROOT, 'scripts', 'rea.mjs');
const DEFAULT_TIMEOUT_MS = 330_000;

function isWithin(parent, child) {
  const relativePath = relative(resolve(parent), resolve(child));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

export function validateReaTarget(target) {
  if (!target || typeof target !== 'string') {
    throw new Error('REA requires a target path.');
  }

  const resolvedTarget = resolve(target);
  const allowExternal = process.env.REA_ALLOW_EXTERNAL_TARGETS === 'true';
  if (!allowExternal && !isWithin(config.root, resolvedTarget) && !isWithin(config.workspace, resolvedTarget)) {
    throw new Error('REA target is outside the PHANTOM project/workspace. Set REA_ALLOW_EXTERNAL_TARGETS=true only for an authorized target.');
  }

  if (!existsSync(resolvedTarget)) {
    throw new Error(`REA target does not exist: ${resolvedTarget}`);
  }
  return resolvedTarget;
}

function createReaClient(timeoutMs) {
  if (!existsSync(REA_ENTRY)) {
    throw new Error('REA is not installed. Run npm ci or npm install to install the pinned rea-agents dependency.');
  }

  const client = new Client({ name: 'phantom-rea-bridge', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [REA_ENTRY, 'mcp'],
    env: {
      ...process.env,
      // REA may start Ghidra/Hopper and needs a longer request budget than the default MCP timeout.
      REA_SDK_REQUEST_TIMEOUT_MS: String(timeoutMs)
    }
  });
  return { client, transport };
}

export async function reaListTools({ timeout = DEFAULT_TIMEOUT_MS } = {}) {
  const { client, transport } = createReaClient(timeout);
  try {
    await client.connect(transport);
    const result = await client.listTools();
    return result.tools || [];
  } finally {
    await client.close().catch(() => {});
  }
}

export async function reaCallTool({ tool_name, arguments: toolArguments = {}, target, timeout = DEFAULT_TIMEOUT_MS }) {
  if (!tool_name || typeof tool_name !== 'string') {
    throw new Error('REA tool_name is required. Call rea_list_tools first to discover available tools.');
  }

  const safeArguments = { ...toolArguments };
  if (target) {
    safeArguments.path = validateReaTarget(target);
  }

  const { client, transport } = createReaClient(timeout);
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: tool_name, arguments: safeArguments });
    return result;
  } finally {
    await client.close().catch(() => {});
  }
}

export function reaCapabilities() {
  return {
    package: 'rea-agents',
    version: '6.7.0',
    transport: 'stdio MCP',
    entry: 'rea mcp',
    externalTargetsAllowed: process.env.REA_ALLOW_EXTERNAL_TARGETS === 'true'
  };
}
