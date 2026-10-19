import dotenv from 'dotenv';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const envPath = join(ROOT, '.env');
dotenv.config({ path: envPath });

const config = {
  root: ROOT,
  port: parseInt(process.env.PORT || '1337', 10),
  workspace: process.env.WORKSPACE_DIR || join(ROOT, 'workspace'),
  db: {
    path: process.env.DB_PATH || join(ROOT, 'data', 'phantom.db')
  },
  api: {
    baseUrl: process.env.API_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.API_KEY || '',
    model: process.env.API_MODEL || 'gpt-4o',
    provider: process.env.API_PROVIDER || 'openai',
    temperature: parseFloat(process.env.TEMPERATURE || '0.7'),
    maxTokens: parseInt(process.env.MAX_TOKENS || '4096', 10)
  },
  server: {
    port: parseInt(process.env.PORT || '1337', 10),
    host: process.env.HOST || '127.0.0.1',
    apiToken: process.env.API_TOKEN || ''
  },
  limits: {
    maxConcurrentChats: parseInt(process.env.MAX_CONCURRENT_CHATS || '4', 10),
    maxToolIterations: parseInt(process.env.MAX_TOOL_ITERATIONS || '12', 10),
    maxWebSocketMessageBytes: parseInt(process.env.MAX_WS_MESSAGE_BYTES || '262144', 10)
  }
};

// Ensure workspace directory exists safely
try {
  if (!existsSync(config.workspace)) {
    mkdirSync(config.workspace, { recursive: true });
  }
} catch {
  // Ignore permission errors in restricted environments
}

/**
 * Update config at runtime (called from settings API)
 */
export function updateConfig(updates) {
  if (updates.baseUrl !== undefined) config.api.baseUrl = updates.baseUrl;
  if (updates.apiKey !== undefined) config.api.apiKey = updates.apiKey;
  if (updates.model !== undefined) config.api.model = updates.model;
  if (updates.provider !== undefined) config.api.provider = updates.provider;
  if (updates.temperature !== undefined) config.api.temperature = Number(updates.temperature);
  if (updates.maxTokens !== undefined) config.api.maxTokens = Number(updates.maxTokens);
  if (updates.systemPrompt !== undefined) config.systemPrompt = updates.systemPrompt;
  if (updates.workspace !== undefined) {
    config.workspace = updates.workspace;
    try {
      if (!existsSync(config.workspace)) {
        mkdirSync(config.workspace, { recursive: true });
      }
    } catch {}
  }
}

/**
 * Load persisted settings from DB into config (called after DB init)
 */
export function loadPersistedSettings(getSetting) {
  if (typeof getSetting !== 'function') {
    console.warn('[Config] loadPersistedSettings called without a function — skipping persisted settings load.');
    return;
  }

  const baseUrl = getSetting('api_base_url', null);
  const apiKey = getSetting('api_key', null);
  const model = getSetting('api_model', null);
  const provider = getSetting('api_provider', null);
  const temperature = getSetting('api_temperature', null);
  const maxTokens = getSetting('api_max_tokens', null);
  const workspace = getSetting('workspace', null);
  const systemPrompt = getSetting('system_prompt', null);

  if (baseUrl) config.api.baseUrl = baseUrl;
  if (apiKey) config.api.apiKey = apiKey;
  if (model) config.api.model = model;
  if (provider) config.api.provider = provider;
  if (temperature !== null) config.api.temperature = Number(temperature);
  if (maxTokens !== null) config.api.maxTokens = Number(maxTokens);
  if (systemPrompt !== null) config.systemPrompt = systemPrompt;
  if (workspace) {
    config.workspace = workspace;
    try {
      if (!existsSync(config.workspace)) {
        mkdirSync(config.workspace, { recursive: true });
      }
    } catch {}
  }
}

export default config;
