/**
 * Chat rendering and interaction logic
 * Enhanced with:
 *  - Real-time typing animation (character by character)
 *  - Safe progress status for model reasoning (raw reasoning is never displayed)
 *  - Compact tool activity timeline with live output and final states
 *  - FIXED: Auto-scroll now works correctly during streaming
 *  - Image message support
 */

const FILE_TOOL_NAMES = new Set([
  'read_file',
  'write_file',
  'edit_source_code',
  'generate_pdf',
  'list_directory',
  'save_trace',
]);

const FILE_PATH_KEYS = ['path', 'file_path', 'target_file', 'output_path', 'filename'];
const SENSITIVE_ARGUMENT_KEY = /(?:pass(?:word|phrase)?|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key)/i;
const LARGE_ARGUMENT_KEY = /^(?:content|code|body|input|payload|task_description|description)$/i;
const PREVIEW_TOOL_NAMES = new Set(['show_preview_window', 'show_code_demo', 'analyze_target_graph']);
window.Chat = {
  messagesEl: null,
  currentAssistantEl: null,
  currentContent: '',
  renderedContent: '',
  isStreaming: false,
  // Typing animation state
  typingQueue: [],
  typingIndex: 0,
  typingTimer: null,
  typingSpeed: 22, // ms per character — slightly slower for visible effect
  // Thinking state
  currentThinkingEl: null,
  thinkingContent: '',
  // Activity timeline state
  activityTimelineEl: null,
  activityItems: new Map(),
  activitySequence: 0,
  activityTimer: null,
  _currentTurnTools: [],
  // Auto-scroll control: user can scroll up to pause, near-bottom = resume
  _userScrolled: false,
  _lastScrollTop: 0,

  init() {
    this.messagesEl = document.getElementById('messages');
    this._chatArea = document.getElementById('chat-area');

    // Detect when user manually scrolls up (pause auto-scroll)
    this._chatArea.addEventListener('scroll', () => {
      const threshold = 80;
      const currentScrollTop = this._chatArea.scrollTop;
      const distFromBottom = Math.ceil(this._chatArea.scrollHeight - currentScrollTop - this._chatArea.clientHeight);

      if (distFromBottom <= threshold) {
        // If we are at or near the bottom, resume auto-scroll
        this._userScrolled = false;
      } else if (currentScrollTop < this._lastScrollTop) {
        // If we are NOT near the bottom AND we scrolled UP,
        // it means the user intentionally scrolled back.
        this._userScrolled = true;
      }

      this._lastScrollTop = currentScrollTop;
    });
  },

  clear() {
    this.isStreaming = false;
    this.messagesEl.innerHTML = '';
    this.currentAssistantEl = null;
    this.currentContent = '';
    this.renderedContent = '';
    this.currentThinkingEl = null;
    this.thinkingContent = '';
    this.activityTimelineEl = null;
    this.activityItems.clear();
    this.activitySequence = 0;
    this._stopActivityTimer();
    this.typingQueue = [];
    this.typingIndex = 0;
    this._userScrolled = false;
    this._currentTurnTools = [];
    if (this.typingTimer) {
      cancelAnimationFrame(this.typingTimer);
      this.typingTimer = null;
    }
  },

  showWelcome() {
    document.getElementById('welcome-screen').style.display = 'flex';
    this.messagesEl.style.display = 'none';
  },

  hideWelcome() {
    document.getElementById('welcome-screen').style.display = 'none';
    this.messagesEl.style.display = 'flex';
  },

  addUserMessage(content, imageDataUrl) {
    this.hideWelcome();
    this._userScrolled = false; // reset on new user message
    this._currentTurnTools = []; // reset tools tracked for the new turn
    const el = document.createElement('div');
    el.className = 'message user';

    // Add user message content container
    const contentEl = document.createElement('div');
    if (imageDataUrl) {
      const img = document.createElement('img');
      img.src = imageDataUrl;
      img.className = 'msg-image';
      img.alt = 'Uploaded image';
      contentEl.appendChild(img);
      if (content) {
        const textEl = document.createElement('div');
        textEl.textContent = content;
        textEl.style.marginTop = '8px';
        contentEl.appendChild(textEl);
      }
    } else {
      contentEl.textContent = content;
    }
    el.appendChild(contentEl);

    // Add timestamp
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const footerEl = document.createElement('div');
    footerEl.className = 'message-footer user';
    footerEl.innerHTML = `<span class="message-timestamp">${timeStr}</span>`;
    el.appendChild(footerEl);

    this.messagesEl.appendChild(el);
    this.scrollToBottom(true);
  },

  /** Show safe progress status without exposing model chain-of-thought. */
  addThinkingChunk() {
    this.hideWelcome();

    if (!this.currentThinkingEl) {
      this.currentThinkingEl = document.createElement('details');
      this.currentThinkingEl.className = 'message thinking thinking-running';
      this.currentThinkingEl.open = true;

      const label = document.createElement('summary');
      label.className = 'thinking-label';
      label.textContent = '🧠 Thinking · in progress';
      this.currentThinkingEl.appendChild(label);

      const contentEl = document.createElement('div');
      contentEl.className = 'thinking-content';
      this.currentThinkingEl.appendChild(contentEl);

      this.messagesEl.appendChild(this.currentThinkingEl);
      this.thinkingContent = '';
    }

    // Keep the raw reasoning out of the DOM and transcript view. The provider
    // may send sensitive prompts, credentials, or internal chain-of-thought.
    this.thinkingContent = 'PHANTOM is working through the request and tool results. Reasoning details are hidden.';
    const contentEl = this.currentThinkingEl.querySelector('.thinking-content');
    if (contentEl) {
      contentEl.textContent = this.thinkingContent;
      // Auto-scroll the thinking content box itself
      contentEl.scrollTop = contentEl.scrollHeight;
    }
    this.scrollToBottom();
  },

  /**
   * End thinking — fade it slightly, update label
   */
  endThinking(status = 'completed') {
    if (this.currentThinkingEl) {
      const failed = ['failed', 'cancelled', 'interrupted'].includes(status);
      this.currentThinkingEl.classList.add(failed ? 'thinking-failed' : 'thinking-done');
      if (this.currentThinkingEl.classList.remove) this.currentThinkingEl.classList.remove('thinking-running');
      this.currentThinkingEl.open = false;
      const label = this.currentThinkingEl.querySelector('.thinking-label');
      if (label) label.textContent = failed ? '⚠ Thinking interrupted' : '✓ Thinking complete';
      const contentEl = this.currentThinkingEl.querySelector('.thinking-content');
      if (contentEl && failed) contentEl.textContent = 'Reasoning was interrupted. Model reasoning remains hidden.';
    }
    this.currentThinkingEl = null;
    this.thinkingContent = '';
  },

  startAssistantMessage() {
    this.hideWelcome();

    // End any thinking block (thinking already shown above)
    this.endThinking();
    // A new assistant segment gets its own timeline so tool cards stay in
    // chronological order when a model alternates between text and tools.
    this.activityTimelineEl = null;

    this.currentContent = '';
    this.renderedContent = '';
    this.typingQueue = [];
    this.typingIndex = 0;
    this.currentAssistantEl = document.createElement('div');
    this.currentAssistantEl.className = 'message assistant';

    // Add typing indicator dots
    const typing = document.createElement('div');
    typing.className = 'typing-indicator';
    typing.innerHTML = '<span></span><span></span><span></span>';
    this.currentAssistantEl.appendChild(typing);

    this.messagesEl.appendChild(this.currentAssistantEl);
    this.isStreaming = true;
    this.scrollToBottom(true);

    // The CSS indicator can wait without running an idle animation-frame loop.
  },

  appendChunk(text, immediate = false) {
    if (!this.currentAssistantEl) {
      this.startAssistantMessage();
    }

    // Remove typing indicator dots on first chunk
    const typing = this.currentAssistantEl.querySelector('.typing-indicator');
    if (typing) typing.remove();

    // Add text to full content buffer
    this.currentContent += text;
    if (immediate) {
      if (this.typingTimer) cancelAnimationFrame(this.typingTimer);
      this.typingTimer = null;
      this.renderedContent = this.currentContent;
      this.typingQueue = [];
      this.typingIndex = 0;
      this.currentAssistantEl.innerHTML = window.renderMarkdown(this.currentContent);
      return;
    }

    // Queue only the NEW characters for typing animation
    for (const char of text) {
      this.typingQueue.push(char);
    }
    this._startTypingLoop();
  },

  /**
   * Typing animation loop — renders characters gradually, not all at once
   * FIXED: scrollToBottom now called after every render to keep up
   */
  _startTypingLoop() {
    if (this.typingTimer) return;
    let lastTime = 0;

    const animate = (timestamp) => {
      if (!this.isStreaming || this.typingIndex >= this.typingQueue.length) {
        this.typingTimer = null;
        return; // Stop the loop
      }

      if (this.typingIndex < this.typingQueue.length) {
        const elapsed = timestamp - lastTime;

        // Adaptive speed: speed up when queue grows to prevent lag
        const queueSize = this.typingQueue.length - this.typingIndex;
        let speed = this.typingSpeed;
        if (queueSize > 200) speed = 1;
        else if (queueSize > 100) speed = 3;
        else if (queueSize > 50) speed = 6;
        else if (queueSize > 20) speed = 8;

        if (elapsed >= speed) {
          // Batch size also adapts to prevent falling behind
          const batchSize = Math.min(
            queueSize,
            queueSize > 200 ? 30 :
            queueSize > 100 ? 15 :
            queueSize > 50 ? 8 :
            queueSize > 20 ? 4 : 2
          );

          for (let i = 0; i < batchSize; i++) {
            if (this.typingIndex < this.typingQueue.length) {
              this.renderedContent += this.typingQueue[this.typingIndex++];
            }
          }

          // Re-render markdown with what we've typed so far
          if (this.currentAssistantEl) {
            this.currentAssistantEl.innerHTML = window.renderMarkdown(this.renderedContent);
          }

          // FIXED: Force scroll to bottom after each render frame
          this.scrollToBottom(false, true);
          lastTime = timestamp;
        }
      }

      if (this.typingIndex >= this.typingQueue.length) {
        this.typingQueue = [];
        this.typingIndex = 0;
        this.typingTimer = null;
      } else this.typingTimer = requestAnimationFrame(animate);
    };

    this.typingTimer = requestAnimationFrame(animate);
  },

  endAssistantMessage() {
    if (this.currentAssistantEl) {
      // Remove any remaining typing indicator
      const typing = this.currentAssistantEl.querySelector('.typing-indicator');
      if (typing) typing.remove();

      // Flush any remaining queued characters
      if (this.typingIndex < this.typingQueue.length) {
        this.renderedContent += this.typingQueue.slice(this.typingIndex).join('');
        this.typingQueue = [];
        this.typingIndex = 0;
      }

      // Final full render
      if (this.renderedContent || this.currentContent) {
        this.currentAssistantEl.innerHTML = window.renderMarkdown(this.renderedContent || this.currentContent);

        // Render prominent tools executed summary if tools were run during this response
        if (this._currentTurnTools && this._currentTurnTools.length > 0) {
          const summaryBar = document.createElement('div');
          summaryBar.className = 'turn-tools-summary';
          const toolCount = this._currentTurnTools.length;
          const capturedTools = [...this._currentTurnTools];

          const tagsHtml = capturedTools.map(t => {
            const isErr = t.status === 'failed';
            const statusIcon = isErr ? '❌' : '✓';
            const label = this.escapeHtml(t.name) + (t.duration ? ` (${t.duration}ms)` : '');
            return `<span class="summary-tag" style="${isErr ? 'border-color: var(--danger); color: var(--danger);' : ''}">${statusIcon} ${label}</span>`;
          }).join('');

          summaryBar.innerHTML = `
            <span class="summary-title">⚡ Tools Executed (${toolCount}):</span>
            <div class="summary-tags">${tagsHtml}</div>
            <button type="button" class="summary-toggle-btn" title="Inspect full tool commands and outputs">👁️ Tool Details</button>
          `;

          const toggleBtn = summaryBar.querySelector('.summary-toggle-btn');
          if (toggleBtn) {
            toggleBtn.onclick = (e) => {
              e.stopPropagation();
              capturedTools.forEach(t => {
                if (t.card) {
                  const body = t.card.querySelector('.tool-card-body');
                  if (body) body.classList.toggle('expanded');
                }
              });
              const firstCard = capturedTools[0]?.card;
              if (firstCard && firstCard.scrollIntoView) {
                firstCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }
            };
          }

          this.currentAssistantEl.insertBefore(summaryBar, this.currentAssistantEl.firstChild);
        }

        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const footerEl = document.createElement('div');
        footerEl.className = 'message-footer assistant';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'message-copy-btn';
        copyBtn.setAttribute('aria-label', 'Copy message');
        copyBtn.innerHTML = '📋 Copy';
        const textToCopy = this.renderedContent || this.currentContent;
        copyBtn.onclick = () => window.copyText(textToCopy, copyBtn);

        const timeSpan = document.createElement('span');
        timeSpan.className = 'message-timestamp';
        timeSpan.textContent = timeStr;

        footerEl.appendChild(timeSpan);
        footerEl.appendChild(copyBtn);

        this.currentAssistantEl.appendChild(footerEl);
      }
    }

    if (this.typingTimer) {
      cancelAnimationFrame(this.typingTimer);
      this.typingTimer = null;
    }

    this.currentAssistantEl = null;
    this.currentContent = '';
    this.renderedContent = '';
    this.isStreaming = false;
    this._userScrolled = false;

    // End thinking too
    this.endThinking();
    // Final scroll to bottom
    this.scrollToBottom(true);
  },

  _ensureActivityTimeline() {
    if (this.activityTimelineEl) return this.activityTimelineEl;
    const timeline = document.createElement('section');
    timeline.className = 'activity-timeline';
    timeline.setAttribute('aria-label', 'Activity timeline');
    this.messagesEl.appendChild(timeline);
    this.activityTimelineEl = timeline;
    return timeline;
  },

  _createActivityItem(data = {}, options = {}) {
    const name = this._normaliseToolName(data.name);
    const args = this._normaliseArgs(data.args);
    const key = data.id !== undefined && data.id !== null && String(data.id).trim()
      ? String(data.id)
      : `generated-${++this.activitySequence}`;
    const presentation = this._getToolPresentation(name, args);
    const timeline = this._ensureActivityTimeline();

    const card = document.createElement('article');
    card.className = presentation.isFileTool ? 'tool-card file-mod-card' : 'tool-card';
    card.id = `tool-${key}`;
    card.setAttribute('data-tool-id', key);

    const header = document.createElement('div');
    header.className = presentation.isFileTool ? 'tool-card-header file-mod-header' : 'tool-card-header';
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');

    const title = document.createElement('span');
    title.className = 'tool-card-title';
    const icon = document.createElement('span');
    icon.className = 'tool-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = presentation.icon;
    title.appendChild(icon);

    if (presentation.isFileTool) {
      const action = document.createElement('strong');
      action.className = 'tool-action';
      action.textContent = presentation.actionName;
      title.appendChild(action);
    }

    const toolName = document.createElement('span');
    toolName.className = 'tool-name';
    toolName.textContent = name;
    title.appendChild(toolName);

    if (presentation.isFileTool) {
      const path = document.createElement('span');
      path.className = 'tool-path';
      path.textContent = `Path: ${presentation.filePath || 'unavailable'}`;
      title.appendChild(path);
    }
    header.appendChild(title);

    const argsEl = document.createElement('span');
    argsEl.className = 'tool-args';
    argsEl.textContent = this.getArgsPreview(presentation.args, {
      omitKeys: presentation.filePath ? FILE_PATH_KEYS : [],
    }) || 'No arguments';
    header.appendChild(argsEl);

    const meta = document.createElement('span');
    meta.className = 'tool-card-meta';
    const statusEl = document.createElement('span');
    statusEl.className = 'tool-status';
    const durationEl = document.createElement('time');
    durationEl.className = 'tool-duration';
    durationEl.setAttribute('aria-label', 'Duration');
    meta.appendChild(statusEl);
    meta.appendChild(durationEl);
    header.appendChild(meta);

    const body = document.createElement('div');
    body.className = 'tool-card-body';
    const progressEl = document.createElement('div');
    progressEl.className = 'tool-progress hidden';
    const outputEl = document.createElement('div');
    outputEl.className = 'tool-output';
    body.appendChild(progressEl);
    body.appendChild(outputEl);
    if (options.expanded !== false) body.classList.add('expanded');

    const toggleBody = () => {
      const expanded = body.classList.toggle('expanded');
      header.setAttribute('aria-expanded', String(expanded));
    };
    header.setAttribute('aria-expanded', options.expanded === false ? 'false' : 'true');
    if (header.addEventListener) {
      header.addEventListener('click', toggleBody);
      header.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleBody();
        }
      });
    }

    card.appendChild(header);
    card.appendChild(body);
    timeline.appendChild(card);

    const item = {
      id: key,
      card,
      header,
      body,
      statusEl,
      durationEl,
      progressEl,
      outputEl,
      name,
      args: presentation.args,
      filePath: presentation.filePath,
      progressText: '',
      outputText: '',
      startedAt: Number.isFinite(Number(options.startedAt)) ? Number(options.startedAt) : Date.now(),
      durationMs: null,
      status: 'running',
    };
    this.activityItems.set(key, item);
    this._setActivityStatus(item, options.status || 'running', options.durationMs);
    return item;
  },

  _findActivityItem(data = {}) {
    const id = data.id !== undefined && data.id !== null ? String(data.id) : '';
    if (id && this.activityItems.has(id)) return this.activityItems.get(id);

    const name = data.name ? this._normaliseToolName(data.name) : '';
    let fallback = null;
    for (const item of this.activityItems.values()) {
      if (item.status !== 'running') continue;
      if (!name || item.name === name) fallback = item;
    }
    return fallback;
  },

  _getToolPresentation(name, args) {
    const filePath = this.getFilePath(name, args);
    const isFileTool = FILE_TOOL_NAMES.has(name) || Boolean(filePath);
    let actionName = 'Tool';
    let icon = '⚡';
    if (name === 'write_file') { actionName = 'Creating file'; icon = '📄'; }
    else if (name === 'edit_source_code') { actionName = 'Editing file'; icon = '📝'; }
    else if (name === 'read_file') { actionName = 'Reading file'; icon = '📖'; }
    else if (name === 'generate_pdf') { actionName = 'Creating PDF'; icon = '📑'; }
    else if (name === 'list_directory') { actionName = 'Listing directory'; icon = '📁'; }
    else if (isFileTool) { actionName = 'File activity'; icon = '📄'; }
    return { name, args, filePath, isFileTool, actionName, icon };
  },

  _setActivityStatus(item, status, durationMs) {
    if (!item) return;
    const normalized = ['running', 'completed', 'failed', 'cancelled', 'interrupted'].includes(status)
      ? status
      : 'completed';
    item.status = normalized;
    const explicitDuration = Number(durationMs);
    if (Number.isFinite(explicitDuration) && explicitDuration >= 0) item.durationMs = explicitDuration;
    else if (normalized !== 'running') item.durationMs = Math.max(0, Date.now() - item.startedAt);

    const aliases = normalized === 'completed' ? ' completed done'
      : normalized === 'failed' ? ' failed error'
        : normalized === 'cancelled' ? ' cancelled'
          : normalized === 'interrupted' ? ' interrupted failed error' : '';
    item.statusEl.className = `tool-status ${normalized}${aliases}`;
    item.statusEl.textContent = '';
    if (normalized === 'running') {
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      spinner.setAttribute('aria-hidden', 'true');
      item.statusEl.appendChild(spinner);
    } else {
      const icon = document.createElement('span');
      icon.className = 'tool-status-icon';
      icon.textContent = normalized === 'completed' ? '✓' : normalized === 'cancelled' ? '⏹' : '⚠';
      icon.setAttribute('aria-hidden', 'true');
      item.statusEl.appendChild(icon);
    }
    const label = document.createElement('span');
    label.className = 'tool-status-label';
    label.textContent = normalized === 'running' ? 'Running'
      : normalized === 'completed' ? 'Completed'
        : normalized === 'cancelled' ? 'Stopped'
          : normalized === 'interrupted' ? 'Interrupted' : 'Failed';
    item.statusEl.appendChild(label);
    item.statusEl.setAttribute('aria-label', label.textContent);

    this._refreshActivityDuration(item);
    item.card.setAttribute('data-status', normalized);
    if (item.header) item.header.setAttribute('aria-label', `${item.name}: ${label.textContent}`);
    if (normalized === 'running') this._startActivityTimer();
    else if (![...this.activityItems.values()].some(activity => activity.status === 'running')) this._stopActivityTimer();
  },

  _refreshActivityDuration(item) {
    if (!item || !item.durationEl) return;
    const duration = item.status === 'running' && item.durationMs === null
      ? Math.max(0, Date.now() - item.startedAt) : item.durationMs;
    item.durationEl.textContent = this.formatDuration(duration);
    item.durationEl.setAttribute('datetime', duration === null ? '' : String(duration));
  },

  _refreshActivityDurations() {
    for (const item of this.activityItems.values()) {
      if (item.status === 'running') this._refreshActivityDuration(item);
    }
  },

  _startActivityTimer() {
    if (this.activityTimer || typeof setInterval !== 'function') return;
    this.activityTimer = setInterval(() => {
      this._refreshActivityDurations();
      if (![...this.activityItems.values()].some(item => item.status === 'running')) this._stopActivityTimer();
    }, 500);
  },

  _stopActivityTimer() {
    if (this.activityTimer) clearInterval(this.activityTimer);
    this.activityTimer = null;
  },

  _setTimelineState(status) {
    if (!this.activityTimelineEl) return;
    let stateEl = this.activityTimelineEl.querySelector('.activity-timeline-state');
    if (!stateEl) {
      stateEl = document.createElement('div');
      this.activityTimelineEl.appendChild(stateEl);
    }
    const normalized = status === 'failed' || status === 'cancelled' || status === 'interrupted'
      ? status : status === 'running' ? 'running' : 'completed';
    stateEl.className = `activity-timeline-state ${normalized}`;
    stateEl.textContent = normalized === 'running' ? 'Activity in progress'
      : normalized === 'completed' ? 'Activity completed'
        : normalized === 'cancelled' ? 'Activity stopped' : 'Activity interrupted';
  },

  /** Finalize running cards and redacted thinking when a turn ends. */
  finalizeActivity(status = 'completed') {
    const normalized = ['failed', 'cancelled', 'interrupted'].includes(status) ? status : 'completed';
    for (const item of this.activityItems.values()) {
      if (item.status !== 'running') continue;
      this._setActivityStatus(item, normalized);
      if (!item.outputText) {
        item.outputText = normalized === 'completed'
          ? 'No output recorded.' : 'No result received before activity ended.';
        item.outputEl.textContent = item.outputText;
      }
      item.body.classList.add('expanded');
    }
    if (this.currentThinkingEl) this.endThinking(normalized);
    if (this.activityTimelineEl) {
      const statuses = [...this.activityItems.values()].map(item => item.status);
      const timelineStatus = statuses.includes('running') ? 'running'
        : statuses.includes('cancelled') ? 'cancelled'
          : statuses.includes('failed') ? 'failed'
            : statuses.includes('interrupted') ? 'interrupted' : 'completed';
      this._setTimelineState(timelineStatus);
    }
    this._refreshActivityDurations();
    if (![...this.activityItems.values()].some(item => item.status === 'running')) this._stopActivityTimer();
  },

  _normaliseToolName(name) {
    const value = name === undefined || name === null ? '' : String(name).trim();
    return value || 'Unknown tool';
  },

  _normaliseArgs(args) {
    if (args && typeof args === 'object' && !Array.isArray(args)) return args;
    if (typeof args === 'string' && args.trim()) {
      try {
        const parsed = JSON.parse(args);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch {
        return { arguments: '[invalid JSON]' };
      }
    }
    return {};
  },

  _stringifyValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    try {
      const serialized = JSON.stringify(value, null, 2);
      return serialized === undefined ? String(value) : serialized;
    } catch {
      return String(value);
    }
  },

  _displayToolResult(name, result) {
    if (PREVIEW_TOOL_NAMES.has(this._normaliseToolName(name))) {
      try {
        const parsed = typeof result === 'string' ? JSON.parse(result) : result;
        if (parsed && typeof parsed === 'object' && parsed.html_content) return String(parsed.message || 'Success');
      } catch {
        // Keep the raw result as text when a preview payload is malformed.
      }
    }
    return this._stringifyValue(result);
  },

  _isFailedToolResult(status, result) {
    const statusText = String(status || '').toLowerCase();
    if (['error', 'failed', 'failure'].includes(statusText)) return true;
    let parsed = result;
    if (typeof result === 'string') {
      try { parsed = JSON.parse(result); } catch { parsed = result; }
    }
    if (parsed && typeof parsed === 'object' && (parsed.ok === false || parsed.success === false)) return true;
    const text = this._stringifyValue(result).trim();
    return /^(?:\[SUDO_REQUIRED\]|Error\b|Unknown tool\b|Install not started\b|Request error\b|Scrape error\b|Delegation (?:not started|error)\b|.*\[(?:TIMEOUT|EXIT CODE)\])/i.test(text);
  },

  /**
   * Create a compact activity timeline item without interpolating any tool
   * supplied value into HTML. Tool names, paths, arguments, progress, and
   * results all enter the DOM through textContent.
   */
  addToolCall(data = {}, options = {}) {
    this.hideWelcome();
    const item = this._createActivityItem(data, options);
    this._startActivityTimer();
    if (!options.replay) {
      if (!this._currentTurnTools) this._currentTurnTools = [];
      this._currentTurnTools.push({
        id: item.id,
        name: item.name,
        args: item.args,
        card: item.card,
        status: 'running',
      });
    }
    this.scrollToBottom(true);
    return item;
  },

  /** Live tool output — stream progress into the matching timeline item. */
  updateToolProgress(data = {}) {
    const item = this._findActivityItem(data);
    if (item) {
      const text = this._stringifyValue(data.text);
      item.progressText += text;
      item.progressEl.textContent = item.progressText;
      if (item.progressText && item.progressEl.classList.remove) item.progressEl.classList.remove('hidden');
      item.body.classList.add('expanded');
      item.body.scrollTop = item.body.scrollHeight;
      this._refreshActivityDurations();
    }
    this.scrollToBottom();
  },

  /**
   * Finish a tool item. `replay` prevents workspace refreshes while rendering
   * history or a disconnected session back into the transcript.
   */
  addToolResult(data = {}, options = {}) {
    let item = this._findActivityItem(data);
    if (!item) item = this._createActivityItem(data, { ...options, expanded: true });

    const result = this._displayToolResult(data.name || item.name, data.result);
    item.outputText = result || 'No output';
    item.outputEl.textContent = item.outputText;
    item.body.classList.add('expanded');

    const failed = this._isFailedToolResult(data.status, data.result);
    const duration = data.duration_ms ?? data.durationMs ?? data.duration;
    this._setActivityStatus(item, failed ? 'failed' : 'completed', duration);

    if (this._currentTurnTools) {
      const match = this._currentTurnTools.find(t => t.id === item.id || t.name === item.name);
      if (match) {
        match.status = failed ? 'failed' : 'completed';
        match.duration = duration;
        match.result = result;
      }
    }

    if (!options.replay && ['write_file', 'edit_source_code', 'execute_command'].includes(item.name)) {
      window.WorkspaceExplorer?.loadTree();
    }

    this.scrollToBottom();
    return item;
  },

  addSystemMessage(content) {
    const el = document.createElement('div');
    el.className = 'message system';
    el.textContent = content;
    this.messagesEl.appendChild(el);
    this.scrollToBottom(true);
  },

  addErrorMessage(content) {
    const el = document.createElement('div');
    el.className = 'message error';
    el.textContent = content;
    this.messagesEl.appendChild(el);
    this.scrollToBottom(true);
  },

  /**
   * Render full conversation history from API
   */
  renderHistory(messages) {
    this.clear();
    if (!messages || messages.length === 0) {
      this.showWelcome();
      return;
    }

    this.hideWelcome();

    for (const msg of messages) {
      if (msg.role === 'user') {
        const el = document.createElement('div');
        el.className = 'message user';

        const contentEl = document.createElement('div');
        contentEl.textContent = this._stringifyValue(msg.content);
        el.appendChild(contentEl);

        const msgTimestamp = msg.timestamp || msg.created_at;
        const timeStr = msgTimestamp ? new Date(msgTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const footerEl = document.createElement('div');
        footerEl.className = 'message-footer user';
        if (timeStr) {
          const timeSpan = document.createElement('span');
          timeSpan.className = 'message-timestamp';
          timeSpan.textContent = timeStr;
          footerEl.appendChild(timeSpan);
        }
        el.appendChild(footerEl);

        this.messagesEl.appendChild(el);
      } else if (msg.role === 'assistant') {
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            const functionPart = tc?.function && typeof tc.function === 'object' ? tc.function : {};
            const name = functionPart.name || tc?.name;
            const rawArgs = functionPart.arguments !== undefined ? functionPart.arguments : tc?.args;
            const args = this._normaliseArgs(rawArgs);
            this.addToolCall({ id: tc?.id, name, args }, { replay: true, expanded: true });
          }
        }
        if (msg.content) {
          // Strip <think> blocks and show only a redacted status in history.
          let displayContent = this._stringifyValue(msg.content);
          const thinkMatch = displayContent.match(/<think>([\s\S]*?)<\/think>/);
          if (thinkMatch) {
            const thinkEl = document.createElement('details');
            thinkEl.className = 'message thinking thinking-done';
            thinkEl.open = false;
            const label = document.createElement('summary');
            label.className = 'thinking-label';
            label.textContent = '✓ Thinking complete';
            const content = document.createElement('div');
            content.className = 'thinking-content';
            content.textContent = 'Model reasoning is hidden. Review the verified answer and tool results below.';
            thinkEl.appendChild(label);
            thinkEl.appendChild(content);
            this.messagesEl.appendChild(thinkEl);
            displayContent = displayContent.replace(/<think>[\s\S]*?<\/think>/, '').trim();
          }

          if (displayContent) {
            const el = document.createElement('div');
            el.className = 'message assistant';
            el.innerHTML = window.renderMarkdown(displayContent);

            const msgTimestamp = msg.timestamp || msg.created_at;
            const timeStr = msgTimestamp ? new Date(msgTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            const footerEl = document.createElement('div');
            footerEl.className = 'message-footer assistant';

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'message-copy-btn';
            copyBtn.setAttribute('aria-label', 'Copy message');
            copyBtn.textContent = '📋 Copy';
            const textToCopy = displayContent;
            copyBtn.onclick = () => window.copyText(textToCopy, copyBtn);

            if (timeStr) {
              const timeSpan = document.createElement('span');
              timeSpan.className = 'message-timestamp';
              timeSpan.textContent = timeStr;
              footerEl.appendChild(timeSpan);
            }

            footerEl.appendChild(copyBtn);
            el.appendChild(footerEl);

            this.messagesEl.appendChild(el);
          }
        }
      } else if (msg.role === 'tool') {
        this.addToolResult({
          id: msg.tool_call_id,
          name: msg.name,
          result: msg.content,
        }, { replay: true, expanded: true });
      }
    }

    // A persisted tool call without a matching result must not look live when
    // history is opened. Keep it visibly finalized as interrupted.
    this.finalizeActivity('interrupted');
    this.scrollToBottom(true);
  },

  /**
   * FIXED: Reliable scroll to bottom
   * force=true bypasses the user-scrolled check (use on new messages)
   */
  scrollToBottom(force = false, sync = false) {
    if (!this._chatArea) return;
    if (force || !this._userScrolled) {
      if (sync) {
        this._chatArea.scrollTop = this._chatArea.scrollHeight;
        return;
      }
      // Use double rAF to ensure DOM has updated before scrolling
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (this._chatArea && (force || !this._userScrolled)) {
            this._chatArea.scrollTop = this._chatArea.scrollHeight;
          }
        });
      });
    }
  },

  getFilePath(name, args) {
    const source = this._normaliseArgs(args);
    for (const key of FILE_PATH_KEYS) {
      const value = source[key];
      if (value !== undefined && value !== null && String(value).trim()) return this._singleLine(value);
    }
    if (name === 'execute_command' && source.working_directory) return this._singleLine(source.working_directory);
    return '';
  },

  getArgsPreview(args, options = {}) {
    const source = this._normaliseArgs(args);
    const omitted = new Set(options.omitKeys || []);
    const keys = Object.keys(source).filter(key => !omitted.has(key));
    if (!keys.length) return '';
    const summary = keys.slice(0, 4).map(key => `${key}: ${this._safeArgumentValue(key, source[key])}`);
    if (keys.length > summary.length) summary.push(`+${keys.length - summary.length} more`);
    return this._truncate(summary.join(' · '), 180);
  },

  _safeArgumentValue(key, value) {
    if (SENSITIVE_ARGUMENT_KEY.test(key)) return '[redacted]';
    if (LARGE_ARGUMENT_KEY.test(key)) {
      const length = typeof value === 'string' ? value.length : this._stringifyValue(value).length;
      return `[${length} chars]`;
    }
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).length} fields}`;
    return this._truncate(this._singleLine(value), 100);
  },

  _singleLine(value) {
    return String(value === undefined || value === null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim();
  },

  _truncate(value, limit) {
    const text = String(value || '');
    return text.length > limit ? `${text.substring(0, limit - 1)}…` : text;
  },

  formatDuration(durationMs) {
    if (durationMs === null || durationMs === undefined || !Number.isFinite(Number(durationMs))) return '—';
    const duration = Math.max(0, Number(durationMs));
    if (duration < 1000) return `${Math.round(duration)}ms`;
    if (duration < 60000) return `${(duration / 1000).toFixed(1).replace(/\.0$/, '')}s`;
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000).toString().padStart(2, '0');
    return `${minutes}m ${seconds}s`;
  },

  escapeHtml(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
    return str.replace(/[&<>"]/g, m => map[m]);
  },
};
