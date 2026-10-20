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
    this.loadConnectedTools();

    document.getElementById('refresh-tools-btn')?.addEventListener('click', () => this.loadConnectedTools());
    document.getElementById('show-add-tool-btn')?.addEventListener('click', () => {
      const form = document.getElementById('custom-connector-form');
      if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('cancel-custom-tool-btn')?.addEventListener('click', () => {
      const form = document.getElementById('custom-connector-form');
      if (form) form.style.display = 'none';
    });
    document.getElementById('save-custom-tool-btn')?.addEventListener('click', () => this.addCustomTool());

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isOpen) this.close();
    });
  },

  toggle(id) {
    const input = document.getElementById(id);
    if (input) input.type = input.type === 'password' ? 'text' : 'password';
  },

  open() {
    this.panel?.classList.remove('hidden');
    this.isOpen = true;
    this.loadConnectedTools();
  },
  close() { this.panel?.classList.add('hidden'); this.isOpen = false; },

  async loadConnectedTools() {
    const container = document.getElementById('connected-tools-list');
    if (!container) return;
    try {
      const res = await fetch('/api/connected-tools');
      const data = await res.json();
      if (!data.success || !Array.isArray(data.tools)) throw new Error(data.error || 'Failed to load tools');

      container.innerHTML = data.tools.map(tool => {
        const isConnected = tool.connected;
        const statusClass = isConnected ? 'online' : (tool.installed ? 'warning' : 'offline');
        const statusText = isConnected ? 'Connected' : (tool.installed ? 'Installed' : 'Not installed');
        const actionLabel = isConnected ? '✓ Active' : (tool.installed ? 'Connect' : 'Install & Connect');
        const btnDisabled = isConnected ? 'disabled' : '';

        return `
          <div class="mcp-item" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; margin-bottom: 8px;">
            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="status-dot ${statusClass}" style="width: 8px; height: 8px; flex-shrink: 0;"></span>
                <strong style="font-size: 12.5px; color: var(--text-primary);">${this.esc(tool.name)}</strong>
                ${tool.version ? `<small style="font-size: 10px; color: var(--accent);">v${this.esc(tool.version)}</small>` : ''}
              </div>
              <p style="font-size: 11px; color: var(--text-muted); margin-top: 3px; line-height: 1.35;">${this.esc(tool.description)}</p>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <button type="button" class="btn btn-secondary btn-sm" ${btnDisabled} style="padding: 5px 9px; font-size: 11px;" onclick="Settings.connectTool('${tool.id}')">
                ${actionLabel}
              </button>
              ${tool.isCustom ? `<button type="button" class="btn-icon-sm" style="color: var(--danger); font-size: 12px;" title="Delete connector" onclick="Settings.deleteCustomTool('${tool.id}')">✕</button>` : ''}
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      container.innerHTML = `<p class="mcp-empty" style="color: var(--danger);">Failed to load connected tools: ${this.esc(err.message)}</p>`;
    }
  },

  async connectTool(toolId) {
    window.Toast?.show(`Connecting ${toolId}…`, 'info');
    try {
      const res = await fetch('/api/connected-tools/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: toolId, action: 'connect' })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Connection failed');
      window.Toast?.show(data.message || `Connected ${toolId}`, 'success');
      this.loadConnectedTools();
    } catch (err) {
      window.Toast?.show(err.message, 'error');
    }
  },

  async addCustomTool() {
    const name = document.getElementById('new-tool-name')?.value.trim();
    const binary = document.getElementById('new-tool-binary')?.value.trim();
    const installMethod = document.getElementById('new-tool-method')?.value;
    const pkg = document.getElementById('new-tool-pkg')?.value.trim();

    if (!name || !binary) {
      window.Toast?.show('Name and Command/Binary are required', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/connected-tools/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, binary, installMethod, pkg: pkg || binary })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to add connector');

      window.Toast?.show(`Connector ${name} created`, 'success');
      const form = document.getElementById('custom-connector-form');
      if (form) form.style.display = 'none';
      document.getElementById('new-tool-name').value = '';
      document.getElementById('new-tool-binary').value = '';
      document.getElementById('new-tool-pkg').value = '';
      this.loadConnectedTools();
    } catch (err) {
      window.Toast?.show(err.message, 'error');
    }
  },

  async deleteCustomTool(toolId) {
    if (!confirm('Remove this custom connector?')) return;
    try {
      const res = await fetch(`/api/connected-tools/custom/${encodeURIComponent(toolId)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to delete connector');
      window.Toast?.show('Connector removed', 'success');
      this.loadConnectedTools();
    } catch (err) {
      window.Toast?.show(err.message, 'error');
    }
  },

  esc(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, m => map[m]);
  },

  async load() {
    try {
      const response = await fetch('/api/settings');
      if (!response.ok) throw new Error('Could not retrieve saved settings');
      const data = await response.json();
      const values = {
        'setting-base-url': data.baseUrl || '',
        'setting-api-key': data.apiKeySet ? '••••••••' : '',
        'setting-model': data.model || '',
        'setting-temperature': data.temperature ?? 0.7,
        'setting-max-tokens': data.maxTokens ?? 4096,
        'setting-workspace': data.workspace || '',
        'setting-system-prompt': data.systemPrompt || '',
      };
      Object.entries(values).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.value = value; });
      const autoTokens = document.getElementById('setting-auto-tokens');
      if (autoTokens) autoTokens.checked = data.autoMaxTokens === true;
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
      autoMaxTokens: document.getElementById('setting-auto-tokens')?.checked === true,
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
      // Do not retain newly entered secrets in the form after saving them.
      const apiKeyInput = document.getElementById('setting-api-key');
      if (apiKeyInput && apiKey) { apiKeyInput.value = '••••••••'; apiKeyInput.type = 'password'; }
      const sudoInput = document.getElementById('setting-sudo-password');
      if (sudoInput) { sudoInput.value = ''; sudoInput.type = 'password'; }
      const model = document.getElementById('current-model');
      if (model) model.textContent = settings.model || 'No Model';
      if (button) button.textContent = 'Saved';
      window.Toast?.show('Settings saved', 'success');
      return true;
    } catch (error) {
      window.Toast?.show(error.message, 'error');
      if (button) button.textContent = 'Save Settings';
      return false;
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
    if (!await this.save()) {
      if (result) { result.className = 'test-result error'; result.textContent = 'Save settings successfully before testing the connection.'; }
      return;
    }
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
