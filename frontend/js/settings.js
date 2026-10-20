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
    document.getElementById('btn-validate-sudo-setting')?.addEventListener('click', () => this.validateAndSaveSudo());
    document.getElementById('btn-elevate-windows')?.addEventListener('click', () => this.elevateWindows());
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

    this.connectorsPanel = document.getElementById('connectors-panel');
    document.getElementById('open-connectors-btn')?.addEventListener('click', () => this.openConnectors());
    document.getElementById('connectors-close')?.addEventListener('click', () => this.closeConnectors());
    document.getElementById('connectors-overlay')?.addEventListener('click', () => this.closeConnectors());
    document.getElementById('connectors-back-to-settings')?.addEventListener('click', () => {
      this.closeConnectors();
      this.open();
    });

    this.load();

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
      if (event.key === 'Escape') {
        if (this.isConnectorsOpen) {
          this.closeConnectors();
        } else if (this.isOpen) {
          this.close();
        }
      }
    });
  },

  toggle(id) {
    const input = document.getElementById(id);
    if (input) input.type = input.type === 'password' ? 'text' : 'password';
  },

  open() {
    this.panel?.classList.remove('hidden');
    this.isOpen = true;
  },
  close() { this.panel?.classList.add('hidden'); this.isOpen = false; },

  openConnectors() {
    this.close(); // slide out settings
    this.connectorsPanel?.classList.remove('hidden');
    this.isConnectorsOpen = true;
    this.loadConnectedTools();
  },

  closeConnectors() {
    this.connectorsPanel?.classList.add('hidden');
    this.isConnectorsOpen = false;
  },

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

        const isPhoneTool = tool.category === 'mobile-phone' || tool.id === 'adb' || tool.id === 'scrcpy' || tool.id === 'frida';
        const badgeColor = isPhoneTool ? '#10b981' : 'var(--accent)';
        const categoryLabel = isPhoneTool ? '📱 Phone / Mobile' : (tool.category ? `⚙️ ${tool.category}` : 'Security Tool');

        const actionButtons = isConnected
          ? `
            <span style="font-size: 11px; padding: 4px 7px; border-radius: 4px; background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); font-weight: 600; white-space: nowrap;">✓ Active</span>
            <button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 8px; font-size: 11px; white-space: nowrap;" title="Reactivate and test tool connection" onclick="Settings.reactivateTool('${tool.id}', '${this.esc(tool.name)}', '${tool.category || ''}')">
              🔄 Reactivate
            </button>
          `
          : `
            <button type="button" class="btn btn-primary btn-sm" style="padding: 5px 9px; font-size: 11px; white-space: nowrap;" onclick="Settings.connectTool('${tool.id}', '${this.esc(tool.name)}', '${tool.category || ''}')">
              ${tool.installed ? 'Connect' : 'Install & Connect'}
            </button>
          `;

        return `
          <div class="mcp-item" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; margin-bottom: 8px;">
            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span class="status-dot ${statusClass}" style="width: 8px; height: 8px; flex-shrink: 0;"></span>
                <strong style="font-size: 12.5px; color: var(--text-primary);">${this.esc(tool.name)}</strong>
                ${tool.version ? `<small style="font-size: 10px; color: var(--accent);">v${this.esc(tool.version)}</small>` : ''}
                <span style="font-size: 9.5px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.06); color: ${badgeColor}; border: 1px solid rgba(255,255,255,0.08);">${categoryLabel}</span>
              </div>
              <p style="font-size: 11px; color: var(--text-muted); margin-top: 3px; line-height: 1.35;">${this.esc(tool.description)}</p>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
              ${actionButtons}
              ${tool.isCustom ? `<button type="button" class="btn-icon-sm" style="color: var(--danger); font-size: 12px;" title="Delete connector" onclick="Settings.deleteCustomTool('${tool.id}')">✕</button>` : ''}
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      container.innerHTML = `<p class="mcp-empty" style="color: var(--danger);">Failed to load connected tools: ${this.esc(err.message)}</p>`;
    }
  },

  async reactivateTool(toolId, toolName, category) {
    // 1. Notify backend to ensure active state is saved
    try {
      await fetch('/api/connected-tools/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: toolId, action: 'reactivate' })
      });
    } catch {
      // Non-blocking
    }

    // 2. Close drawer
    this.closeConnectors();

    const displayName = toolName || toolId;
    window.Toast?.show(`Reactivating & verifying ${displayName}…`, 'info');

    // 3. Dispatch reactivation & verification prompt to AI
    const isPhoneTool = category === 'mobile-phone' || toolId === 'adb' || toolId === 'scrcpy' || toolId === 'frida';
    const promptText = isPhoneTool
      ? `Please reactivate and test the connection for mobile security tool **${displayName}** (\`${toolId}\`):
1. Run diagnostic checks (\`adb devices -l\` or tool status) to verify current connectivity and authorization status.
2. If no device is detected or device is 'unauthorized', instruct the user to check their phone screen and tap 'Always allow from this computer'.
3. Confirm connection readiness and report diagnostic results.`
      : `Please reactivate and verify the operational connection for security tool **${displayName}** (\`${toolId}\`):
1. Run a quick verification or version check command to confirm the binary/service is responsive.
2. Confirm readiness for offensive/defensive operations and display the status.`;

    if (window.App && typeof window.App.sendPrompt === 'function') {
      window.App.sendPrompt(promptText);
    } else {
      const messageInput = document.getElementById('message-input');
      const sendBtn = document.getElementById('send-btn');
      if (messageInput && sendBtn) {
        messageInput.value = promptText;
        messageInput.dispatchEvent(new Event('input', { bubbles: true }));
        sendBtn.click();
      }
    }

    // 4. Poll status so UI stays in sync
    setTimeout(() => this.loadConnectedTools(), 1000);
  },

  async connectTool(toolId, toolName, category) {
    // 1. Immediately notify the backend to register / connect
    try {
      await fetch('/api/connected-tools/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: toolId, action: 'connect' })
      });
    } catch {
      // Non-blocking background attempt
    }

    // 2. Close connectors drawer so user is seamlessly in the chat session
    this.closeConnectors();

    const displayName = toolName || toolId;
    window.Toast?.show(`Requesting AI to install & connect ${displayName}…`, 'info');

    // 3. Dispatch structured instructions to AI in the chat session
    const isPhoneTool = category === 'mobile-phone' || toolId === 'adb' || toolId === 'scrcpy' || toolId === 'frida';
    const promptText = isPhoneTool
      ? `Please install and connect the mobile/phone security tool **${displayName}** (\`${toolId}\`) to the PHANTOM environment now.
1. Check if \`${toolId}\` is already executable or install it using \`install_tool\` (or \`execute_command\` with auto-sudo if needed).
2. Discover any connected Android phone or mobile device (e.g., using \`adb devices\`, wireless ADB pairing, or scrcpy discovery).
3. If no phone is plugged in yet, guide the user with clear, quick steps on enabling USB Debugging on their phone so they can connect seamlessly.
4. Verify the tool's operational status and confirm it is connected and ready.`
      : `Please install and connect the security tool **${displayName}** (\`${toolId}\`) to the PHANTOM environment now. 
1. Check if \`${toolId}\` is already executable or install it using \`install_tool\` (or \`execute_command\` with auto-sudo if needed).
2. Verify its version and operational status by running its help or version check command.
3. Confirm that it is connected and ready for offensive/defensive operations.`;

    if (window.App && typeof window.App.sendPrompt === 'function') {
      window.App.sendPrompt(promptText);
    } else {
      const messageInput = document.getElementById('message-input');
      const sendBtn = document.getElementById('send-btn');
      if (messageInput && sendBtn) {
        messageInput.value = promptText;
        messageInput.dispatchEvent(new Event('input', { bubbles: true }));
        sendBtn.click();
      }
    }

    // 4. Poll status so the red dot becomes green as soon as the tool is ready
    let attempts = 0;
    const pollInterval = setInterval(async () => {
      attempts++;
      await this.loadConnectedTools();
      if (attempts >= 15) clearInterval(pollInterval);
    }, 4000);
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

      const sudoStatus = document.getElementById('sudo-setting-status');
      const sudoInput = document.getElementById('setting-sudo-password');
      if (data.sudoConfigured) {
        if (sudoStatus) sudoStatus.innerHTML = '<span style="color:var(--accent, #22c55e);">✅ Active &amp; Verified</span>';
        if (sudoInput) sudoInput.placeholder = '•••••••• (Configured & Saved)';
      } else {
        if (sudoStatus) sudoStatus.innerHTML = '<span style="color:var(--text-muted);">Not configured</span>';
        if (sudoInput) sudoInput.placeholder = 'Enter sudo password';
      }

      const winGroup = document.getElementById('windows-admin-group');
      const winBadge = document.getElementById('windows-admin-badge');
      const winBtn = document.getElementById('btn-elevate-windows');
      if (data.isWindows) {
        if (winGroup) winGroup.style.display = 'block';
        if (data.windowsAdmin) {
          if (winBadge) winBadge.innerHTML = '<span style="color:var(--accent, #22c55e);">🛡️ Running as Administrator</span>';
          if (winBtn) { winBtn.disabled = true; winBtn.textContent = 'Elevated ✅'; }
        } else {
          if (winBadge) winBadge.innerHTML = '<span style="color:var(--warning, #eab308);">⚠️ Normal User Mode</span>';
          if (winBtn) { winBtn.disabled = false; winBtn.textContent = 'Grant Admin Once 🛡️'; }
        }
      } else {
        if (winGroup) winGroup.style.display = 'none';
      }
    } catch (error) {
      window.Toast?.show(`Could not load settings: ${error.message}`, 'error');
    }
  },

  async validateAndSaveSudo() {
    const sudoInput = document.getElementById('setting-sudo-password');
    const statusSpan = document.getElementById('sudo-setting-status');
    const pass = sudoInput?.value?.trim() || '';
    if (!pass) {
      if (statusSpan) statusSpan.innerHTML = '<span style="color:var(--danger, #ef4444);">Please enter a password</span>';
      return;
    }
    if (statusSpan) statusSpan.innerHTML = '<span style="color:var(--text-muted);">Verifying…</span>';
    try {
      const res = await fetch('/api/sudo/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass })
      });
      const data = await res.json();
      if (data.valid) {
        if (statusSpan) statusSpan.innerHTML = '<span style="color:var(--accent, #22c55e);">✅ Verified &amp; Saved!</span>';
        if (sudoInput) { sudoInput.value = ''; sudoInput.placeholder = '•••••••• (Configured & Saved)'; }
        window.Toast?.show('Sudo password verified and saved!', 'success');
      } else {
        if (statusSpan) statusSpan.innerHTML = `<span style="color:var(--danger, #ef4444);">❌ ${this.esc(data.message || 'Incorrect password')}</span>`;
        window.Toast?.show(data.message || 'Incorrect password', 'error');
      }
    } catch (err) {
      if (statusSpan) statusSpan.innerHTML = `<span style="color:var(--danger, #ef4444);">❌ ${this.esc(err.message)}</span>`;
      window.Toast?.show(err.message, 'error');
    }
  },

  async elevateWindows() {
    const badge = document.getElementById('windows-admin-badge');
    const btn = document.getElementById('btn-elevate-windows');
    if (badge) badge.textContent = 'Requesting elevation…';
    if (btn) { btn.disabled = true; btn.textContent = 'Elevating…'; }
    try {
      const res = await fetch('/api/system/elevate-windows', { method: 'POST' });
      const data = await res.json();
      if (data.isElevated) {
        if (badge) badge.innerHTML = '<span style="color:var(--accent, #22c55e);">🛡️ Running as Administrator</span>';
        if (btn) { btn.disabled = true; btn.textContent = 'Elevated ✅'; }
        window.Toast?.show(data.message || 'Administrator privilege granted', 'success');
      } else {
        if (badge) badge.innerHTML = '<span style="color:var(--warning, #eab308);">⚠️ Normal User Mode</span>';
        if (btn) { btn.disabled = false; btn.textContent = 'Grant Admin Once 🛡️'; }
        window.Toast?.show(data.message || 'Elevation not granted', 'warning');
      }
    } catch (err) {
      window.Toast?.show(err.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Grant Admin Once 🛡️'; }
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
