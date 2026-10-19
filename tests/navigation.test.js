import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { closeMobile } = vi.hoisted(() => ({ closeMobile: vi.fn() }));
vi.mock('../frontend/js/sidebar.js', () => ({ initSidebar: () => ({ closeMobile }) }));

function createDocument() {
  const nodes = new Map();
  const handlers = new Map();
  const document = { activeElement: null };
  function element() {
    let html = '';
    const handlers = new Map();
    const selectors = new Map();
    const node = {
      value: '', style: {}, dataset: {}, children: [], textContent: '',
      classList: { add() {}, remove() {}, contains: () => false },
      addEventListener(name, fn) { handlers.set(name, fn); },
      emit(name, event = {}) { return handlers.get(name)?.(event); },
      appendChild(child) { this.children.push(child); },
      insertBefore(child) { this.children.unshift(child); },
      focus() { document.activeElement = this; },
      contains(child) { return this === child || this.children.some(item => item.contains(child)); },
      setAttribute() {},
      querySelector(selector) {
        if (selector === '[aria-current="true"]') {
          return this.children.find(item => item.innerHTML.includes('aria-current="true"'))?.querySelector('.conv-select');
        }
        if (!selectors.has(selector)) {
          const child = element();
          selectors.set(selector, child);
          this.children.push(child);
        }
        return selectors.get(selector);
      },
      get innerHTML() { return html || this.textContent; },
      set innerHTML(value) { html = value; this.children = []; selectors.clear(); },
    };
    return node;
  }
  Object.assign(document, {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    querySelector: selector => document.getElementById(selector),
    querySelectorAll: () => [],
    createElement: element,
    addEventListener(name, handler) { handlers.set(name, handler); },
    emit(name, event) { handlers.get(name)?.(event); },
    body: element(), documentElement: element(),
  });
  return document;
}

describe('Conversation navigation integration', () => {
  let document;
  let fetchMock;
  let chat;
  let socket;
  const conversations = [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }];

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    document = createDocument();
    chat = Object.fromEntries(['init', 'renderHistory', 'clear', 'showWelcome', 'addErrorMessage',
      'addUserMessage', 'startAssistantMessage', 'appendChunk', 'endAssistantMessage',
      'addThinkingChunk', 'addToolCall', 'addToolResult', 'updateToolProgress', 'addSystemMessage'].map(name => [name, vi.fn()]));
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => conversations });
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', { Toast: { show: vi.fn() } });
    vi.stubGlobal('localStorage', { getItem: () => null });
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' });
    vi.stubGlobal('WebSocket', class {
      static OPEN = 1;
      static CONNECTING = 0;
      constructor() { socket = this; this.readyState = 1; this.send = vi.fn(); }
    });
    vi.stubGlobal('Chat', chat);
    vi.stubGlobal('Settings', { init() {} });
    vi.stubGlobal('Management', { init() {} });
    vi.stubGlobal('fetch', fetchMock);
    await import('../frontend/js/app.js');
    await Promise.resolve();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps the conversation search filter when selecting a result', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ messages: ['alpha'] }) });
    const search = document.getElementById('search-conversations');
    search.value = 'Alpha';
    search.emit('input');
    const list = document.getElementById('conversation-list');
    expect(list.children).toHaveLength(1);
    const select = list.children[0].querySelector('.conv-select');
    select.focus();
    await select.emit('click');
    expect(list.children).toHaveLength(1);
    expect(list.children[0].innerHTML).toContain('aria-current="true"');
    expect(document.activeElement).toBe(list.children[0].querySelector('.conv-select'));
    expect(chat.renderHistory).toHaveBeenCalledWith(['alpha']);
    expect(closeMobile).toHaveBeenCalledTimes(1);
  });

  it('does not let a slower conversation overwrite the latest selection', async () => {
    let resolveFirst;
    fetchMock.mockImplementation(url => {
      if (url.endsWith('/a')) return new Promise(resolve => { resolveFirst = resolve; });
      return Promise.resolve({ ok: true, json: async () => ({ messages: ['beta'] }) });
    });
    const list = document.getElementById('conversation-list');
    const first = list.children[0].querySelector('.conv-select').emit('click');
    expect(closeMobile).toHaveBeenCalledTimes(1);
    await list.children[1].querySelector('.conv-select').emit('click');
    resolveFirst({ ok: true, json: async () => ({ messages: ['alpha'] }) });
    await first;
    expect(chat.renderHistory).toHaveBeenCalledExactlyOnceWith(['beta']);
  });

  it('does not render a pending conversation after starting a new chat', async () => {
    let resolveHistory;
    fetchMock.mockImplementation(() => new Promise(resolve => { resolveHistory = resolve; }));
    const pending = document.getElementById('conversation-list').children[0].querySelector('.conv-select').emit('click');
    document.getElementById('new-chat-btn').emit('click');
    resolveHistory({ ok: true, json: async () => ({ messages: ['old conversation'] }) });
    await pending;
    expect(chat.renderHistory).not.toHaveBeenCalled();
    expect(chat.showWelcome).toHaveBeenCalled();
    expect(document.activeElement).toBe(document.getElementById('message-input'));
  });

  it('streams two chats independently and scopes Stop to the selected chat', async () => {
    const frame = data => socket.onmessage({ data: JSON.stringify(data) });
    frame({ type: 'session_ready', protocolVersion: 2, maxConcurrentChats: 4 });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) });
    const list = document.getElementById('conversation-list');
    const select = index => list.children[index].querySelector('.conv-select').emit('click');
    const send = text => {
      document.getElementById('message-input').value = text;
      document.getElementById('send-btn').emit('click');
      return JSON.parse(socket.send.mock.lastCall[0]);
    };
    await select(0);
    const a = send('Question for A');
    frame({ type: 'response_start', conversationId: 'a', requestId: a.requestId });
    frame({ type: 'chunk', content: 'Answer A', conversationId: 'a', requestId: a.requestId });
    await select(1);
    const b = send('Question for B');
    expect(a.requestId).not.toBe(b.requestId);
    expect(a.conversationId).toBe('a');
    expect(b.conversationId).toBe('b');
    frame({ type: 'response_start', conversationId: 'b', requestId: b.requestId });
    chat.appendChunk.mockClear();
    frame({ type: 'chunk', content: 'More A', conversationId: 'a', requestId: a.requestId });
    expect(chat.appendChunk).not.toHaveBeenCalled();
    frame({ type: 'chunk', content: 'Answer B', conversationId: 'b', requestId: b.requestId });
    expect(chat.appendChunk).toHaveBeenCalledExactlyOnceWith('Answer B', false);
    document.getElementById('stop-btn').emit('click');
    expect(JSON.parse(socket.send.mock.lastCall[0])).toEqual({ type: 'stop', conversationId: 'b', requestId: b.requestId });
    chat.appendChunk.mockClear();
    await select(0);
    expect(chat.appendChunk).toHaveBeenCalledWith('Answer AMore A', true);
    frame({ type: 'response_end', conversationId: 'b', requestId: b.requestId });
    expect(document.getElementById('stop-btn').style.display).toBe('flex');
  });

  it('keeps composer drafts separate when switching chats', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) });
    const list = document.getElementById('conversation-list');
    await list.children[0].querySelector('.conv-select').emit('click');
    document.getElementById('message-input').value = 'Unsent draft A';
    await list.children[1].querySelector('.conv-select').emit('click');
    expect(document.getElementById('message-input').value).toBe('');
    document.getElementById('message-input').value = 'Unsent draft B';
    await list.children[0].querySelector('.conv-select').emit('click');
    expect(document.getElementById('message-input').value).toBe('Unsent draft A');
  });

  it('does not attach a late image upload from A to the selected chat B', async () => {
    let reader;
    vi.stubGlobal('FileReader', class { constructor() { reader = this; } readAsDataURL() {} });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) });
    const list = document.getElementById('conversation-list');
    await list.children[0].querySelector('.conv-select').emit('click');
    document.emit('paste', { clipboardData: { items: [{ type: 'image/png', getAsFile: () => ({ type: 'image/png', name: 'a.png' }) }] } });
    await list.children[1].querySelector('.conv-select').emit('click');
    reader.onload({ target: { result: 'data:image/png;base64,dGVzdA==' } });
    expect(document.getElementById('image-preview-thumb').src).toBeUndefined();
    await list.children[0].querySelector('.conv-select').emit('click');
    expect(document.getElementById('image-preview-thumb').src).toBe('data:image/png;base64,dGVzdA==');
  });
});
