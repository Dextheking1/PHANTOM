import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import router from '../server/routes/api.js';
import config from '../server/config.js';
import { initDB, closeDB, getSetting } from '../server/memory/store.js';

vi.mock('@xenova/transformers', () => ({ pipeline: vi.fn() }));
vi.mock('../server/ai/llm-client.js', () => ({ resetClient: vi.fn(), testConnection: vi.fn() }));

describe('Settings persistence', () => {
  const fakeKey = 'test-provider-key-not-real';
  let app;
  let directory;
  let dbPath;
  let original;

  beforeEach(async () => {
    original = { api: { ...config.api }, workspace: config.workspace, systemPrompt: config.systemPrompt, token: config.server.apiToken };
    directory = await mkdtemp(join(tmpdir(), 'phantom-settings-'));
    dbPath = join(directory, 'settings.db');
    initDB(dbPath);
    config.server.apiToken = 'test-local-auth-token';
    app = express();
    app.use(express.json());
    app.use('/api', router);
  });

  afterEach(async () => {
    closeDB();
    Object.assign(config.api, original.api);
    config.workspace = original.workspace;
    config.systemPrompt = original.systemPrompt;
    config.server.apiToken = original.token;
    await rm(directory, { recursive: true, force: true });
  });

  function api(method, path = '/api/settings') {
    return request(app)[method](path).set('Authorization', 'Bearer test-local-auth-token');
  }

  it('reloads saved credentials and parameters in a fresh Node process', async () => {
    const saved = await api('put').send({
      baseUrl: 'https://provider.example/v1', apiKey: fakeKey, model: 'persisted-model',
      temperature: 0, maxTokens: 8192, autoMaxTokens: true,
      workspace: directory, systemPrompt: 'Persisted test instruction',
    });
    expect(saved.status).toBe(200);
    expect(config.systemPrompt).toBe('Persisted test instruction');
    closeDB();
    const configUrl = new URL('../server/config.js', import.meta.url).href;
    const storeUrl = new URL('../server/memory/store.js', import.meta.url).href;
    // Return only a boolean for key restoration; do not print stored credentials.
    const script = `
      import config, { loadPersistedSettings } from ${JSON.stringify(configUrl)};
      import { initDB, getSetting, closeDB } from ${JSON.stringify(storeUrl)};
      initDB(process.argv[1]);
      loadPersistedSettings(getSetting);
      process.stdout.write(JSON.stringify({
        keyRestored: config.api.apiKey === 'test-provider-key-not-real',
        baseUrl: config.api.baseUrl, model: config.api.model,
        temperature: config.api.temperature, maxTokens: config.api.maxTokens,
        workspaceRestored: config.workspace === process.argv[2],
        systemPrompt: config.systemPrompt,
        autoMaxTokens: getSetting('api_auto_max_tokens')
      }));
      closeDB();
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, dbPath, directory], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: { ...process.env, API_KEY: '', API_MODEL: 'default-model', API_BASE_URL: 'https://default.example/v1', WORKSPACE_DIR: directory },
      encoding: 'utf8', timeout: 15000,
    });
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({
      keyRestored: true, baseUrl: 'https://provider.example/v1', model: 'persisted-model',
      temperature: 0, maxTokens: 8192, workspaceRestored: true,
      systemPrompt: 'Persisted test instruction', autoMaxTokens: 'true',
    });
    initDB(dbPath);
    const restored = await api('get');
    expect(restored.body).toMatchObject({ apiKeySet: true, temperature: 0, maxTokens: 8192, autoMaxTokens: true });
    expect(restored.text).not.toContain(fakeKey);
  });

  it('preserves a stored key when saving parameters or a masked key', async () => {
    await api('put').send({ apiKey: fakeKey, autoMaxTokens: true });
    await api('put').send({ temperature: 0, autoMaxTokens: false });
    const current = await api('get');
    await api('put').send({ apiKey: current.body.apiKey, model: 'changed-model' });
    expect(getSetting('api_key')).toBe(fakeKey);
    expect((await api('get')).body).toMatchObject({ apiKeySet: true, autoMaxTokens: false, model: 'changed-model' });
  });

  it('rejects invalid auto-token flags before changing saved settings', async () => {
    const result = await api('put').send({ model: 'must-not-save', autoMaxTokens: 'false' });
    expect(result.status).toBe(400);
    expect(getSetting('api_model')).toBeNull();
  });

  it('can clear a previously saved custom prompt', async () => {
    await api('put').send({ systemPrompt: 'Temporary test instruction' });
    await api('put').send({ systemPrompt: '' });
    expect(getSetting('system_prompt')).toBe('');
    expect(config.systemPrompt).toBe('');
    expect((await api('get')).body.systemPrompt).toBe('');
  });
});
