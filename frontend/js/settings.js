/** Settings for the core security workbench. */
window.Settings = {
  panel: null,
  isOpen: false,

  init() {
    this.panel = document.getElementById('settings-panel');
    document.getElementById('settings-btn')?.addEventListener('click', () => this.open());
    document.getElementById('welcome-settings-btn')?.addEventListener('click', () => this.open());
    document.getElementById('settings-close')?.addEventListener('click', () => this.close());
    document.getElementById('settings-overlay')?.addEventListener('click', () => this.close());

    const temp = document.getElementById('setting-temperature');
    const tempValue = document.getElementById('temperature-value');
    temp?.addEventListener('input', () => { tempValue.textContent = temp.value; });
    const model = document.getElementById('setting-model');
    const maxTokens = document.getElementById('setting-max-tokens');
    const autoTokens = document.getElementById('setting-auto-tokens');
    const syncAutoTokens = () => {
      if (!autoTokens?.checked || !maxTokens) return;
      maxTokens.value = this.recommendedMaxTokens(model?.value);
    };
    model?.addEventListener('input', syncAutoTokens);
    autoTokens?.addEventListener('change', syncAutoTokens);
    document.getElementById('toggle-api-key')?.addEventListener('click', () => this.toggle('setting-api-key'));
    document.getElementById('toggle-sudo-pass')?.addEventListener('click', () => this.toggle('setting-sudo-password'));
    document.getElementById('test-connection')?.addEventListener('click', () => this.testConnection());
    document.getElementById('save-settings')?.addEventListener('click', () => this.save());
    document.getElementById('reset-system-prompt')?.addEventListener('click', () => {
      const prompt = document.getElementById('setting-system-prompt');
      if (prompt) prompt.value = '';
    });

    document.getElementById('setting-api-key')?.addEventListener('input', (event) => {
      if (!event.target.value.trim().startsWith('nvapi-')) return;
      const baseUrl = document.getElementById('setting-base-url');
      const model = document.getElementById('setting-model');
      if (baseUrl && (!baseUrl.value || baseUrl.value === 'https://api.openai.com/v1')) baseUrl.value = 'https://integrate.api.nvidia.com/v1';
      if (model && (!model.value || model.value === 'gpt-4o')) model.value = 'meta/llama-3.3-70b-instruct';
    });

    this.load();
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isOpen) this.close();
    });
  },

  toggle(id) {
    const input = document.getElementById(id);
    if (input) input.type = input.type === 'password' ? 'text' : 'password';
  },

  open() { this.panel?.classList.remove('hidden'); this.isOpen = true; },
  close() { this.panel?.classList.add('hidden'); this.isOpen = false; },

  async load() {
    try {
      const response = await fetch('/api/settings');
      const data = await response.json();
      const values = {
        'setting-base-url': data.baseUrl || '',
        'setting-api-key': data.apiKeySet ? '••••••••' : '',
        'setting-model': data.model || '',
        'setting-temperature': data.temperature || 0.7,
        'setting-max-tokens': data.maxTokens || 4096,
        'setting-workspace': data.workspace || '',
        'setting-system-prompt': data.systemPrompt || '',
      };
      Object.entries(values).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.value = value; });
      const autoTokens = document.getElementById('setting-auto-tokens');
      if (autoTokens) autoTokens.checked = false;
      const tempValue = document.getElementById('temperature-value');
      if (tempValue) tempValue.textContent = values['setting-temperature'];
      const model = document.getElementById('current-model');
      if (model) model.textContent = data.model || 'No Model';
    } catch (error) {
      window.Toast?.show(`Could not load settings: ${error.message}`, 'error');
    }
  },

  async save() {
    const button = document.getElementById('save-settings');
    const apiKey = document.getElementById('setting-api-key')?.value || '';
    const sudoPassword = document.getElementById('setting-sudo-password')?.value || '';
    const settings = {
      baseUrl: document.getElementById('setting-base-url')?.value,
      model: document.getElementById('setting-model')?.value,
      temperature: Number(document.getElementById('setting-temperature')?.value || 0.7),
      maxTokens: document.getElementById('setting-auto-tokens')?.checked
        ? this.recommendedMaxTokens(document.getElementById('setting-model')?.value)
        : Number(document.getElementById('setting-max-tokens')?.value || 4096),
      workspace: document.getElementById('setting-workspace')?.value,
      systemPrompt: document.getElementById('setting-system-prompt')?.value || '',
    };
    if (apiKey && !apiKey.startsWith('••')) settings.apiKey = apiKey;
    if (sudoPassword) settings.sudoPassword = sudoPassword;
    if (button) { button.disabled = true; button.textContent = 'Saving…'; }
    try {
      const response = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
      if (!response.ok) throw new Error((await response.json()).error || 'Save failed');
      const model = document.getElementById('current-model');
      if (model) model.textContent = settings.model || 'No Model';
      if (button) button.textContent = 'Saved';
      window.Toast?.show('Settings saved', 'success');
    } catch (error) {
      window.Toast?.show(error.message, 'error');
      if (button) button.textContent = 'Save Settings';
    } finally {
      if (button) { setTimeout(() => { button.disabled = false; button.textContent = 'Save Settings'; }, 1200); }
    }
  },

  recommendedMaxTokens(model = '') {
    const name = String(model).toLowerCase();
    if (name.includes('gpt-4o') || name.includes('claude') || name.includes('deepseek-r1')) return 8192;
    if (name.includes('llama') || name.includes('mistral') || name.includes('qwen')) return 8192;
    return 4096;
  },

  async testConnection() {
    const result = document.getElementById('test-result');
    if (result) { result.className = 'test-result'; result.textContent = 'Testing…'; }
    await this.save();
    try {
      const response = await fetch('/api/settings/test', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || data.error || 'Connection failed');
      if (result) { result.className = 'test-result success'; result.textContent = `✓ ${data.message}`; }
    } catch (error) {
      if (result) { result.className = 'test-result error'; result.textContent = `✗ ${error.message}`; }
    }
  },
};
