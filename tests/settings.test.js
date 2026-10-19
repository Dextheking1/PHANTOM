import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Saved settings UI', () => {
  let settings;
  let nodes;
  let fetchMock;
  let document;
  let window;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    nodes = new Map();
    document = {
      getElementById(id) {
        if (!nodes.has(id)) {
          let value = '';
          nodes.set(id, {
            get value() { return value; },
            set value(next) { value = String(next); },
            type: 'password', checked: false, textContent: '',
          });
        }
        return nodes.get(id);
      },
    };
    window = { Toast: { show: vi.fn() } };
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', window);
    vi.stubGlobal('localStorage', {
      setItem() { throw new Error('Provider secrets must not be stored in browser storage'); },
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await import('../frontend/js/settings.js');
    settings = window.Settings;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function load(values = {}) {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({
      baseUrl: 'https://provider.example/v1', apiKeySet: true, model: 'test-model',
      temperature: 0, maxTokens: 8192, autoMaxTokens: true, workspace: 'workspace',
      systemPrompt: 'Test instruction', ...values,
    }) });
    await settings.load();
  }

  it('restores saved parameters, including zero temperature and auto-token sizing', async () => {
    await load();
    expect(nodes.get('setting-temperature').value).toBe('0');
    expect(nodes.get('temperature-value').textContent).toBe(0);
    expect(nodes.get('setting-auto-tokens').checked).toBe(true);
    expect(nodes.get('setting-max-tokens').value).toBe('8192');
    expect(nodes.get('setting-base-url').value).toBe('https://provider.example/v1');
    expect(nodes.get('setting-model').value).toBe('test-model');
    expect(nodes.get('setting-api-key').value).toBe('••••••••');
    expect(nodes.get('setting-system-prompt').value).toBe('Test instruction');
  });

  it('saves changed parameters without replacing an already-stored API key', async () => {
    await load({ autoMaxTokens: false });
    fetchMock.mockResolvedValue({ ok: true });
    expect(await settings.save()).toBe(true);
    const payload = JSON.parse(fetchMock.mock.lastCall[1].body);
    expect(payload).not.toHaveProperty('apiKey');
    expect(payload).toMatchObject({ temperature: 0, maxTokens: 8192, autoMaxTokens: false });
  });

  it('masks a newly saved key and clears the password field after a successful save', async () => {
    await load();
    nodes.get('setting-api-key').value = 'test-provider-key-not-real';
    nodes.get('setting-api-key').type = 'text';
    document.getElementById('setting-sudo-password').value = 'test-password-not-real';
    fetchMock.mockResolvedValue({ ok: true });
    await settings.save();
    const payload = JSON.parse(fetchMock.mock.lastCall[1].body);
    expect(payload.apiKey).toBe('test-provider-key-not-real');
    expect(nodes.get('setting-api-key')).toMatchObject({ value: '••••••••', type: 'password' });
    expect(nodes.get('setting-sudo-password')).toMatchObject({ value: '', type: 'password' });
  });

  it('does not erase the form on a failed settings load', async () => {
    document.getElementById('setting-model').value = 'unsaved-model';
    fetchMock.mockResolvedValue({ ok: false });
    await settings.load();
    expect(nodes.get('setting-model').value).toBe('unsaved-model');
    expect(window.Toast.show).toHaveBeenCalledWith(expect.stringContaining('Could not load settings'), 'error');
  });

  it('keeps an unsaved key for correction and does not test a stale configuration after save failure', async () => {
    await load();
    nodes.get('setting-api-key').value = 'test-provider-key-not-real';
    fetchMock.mockClear().mockResolvedValue({ ok: false, json: async () => ({ error: 'Save failed' }) });
    await settings.testConnection();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/settings');
    expect(nodes.get('setting-api-key').value).toBe('test-provider-key-not-real');
    expect(nodes.get('test-result').textContent).toContain('Save settings successfully');
  });
});
