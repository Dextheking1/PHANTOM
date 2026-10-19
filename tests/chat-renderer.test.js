import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Chat renderer lifecycle', () => {
  let chat;
  let frames;
  let frameId;
  beforeEach(async () => {
    vi.resetModules();
    frames = new Map(); frameId = 0;
    const element = () => ({ innerHTML: '', style: {}, classList: { add() {} }, appendChild() {}, setAttribute() {}, querySelector: () => null });
    vi.stubGlobal('window', { renderMarkdown: text => `<p>${text}</p>` });
    vi.stubGlobal('document', { createElement: element, getElementById: element });
    vi.stubGlobal('requestAnimationFrame', callback => { frames.set(++frameId, callback); return frameId; });
    vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id));
    await import('../frontend/js/chat.js');
    chat = globalThis.window.Chat;
    chat.messagesEl = element();
    chat.scrollToBottom = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  function tick(timestamp) {
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    callback(timestamp);
  }

  it('does not run idle animation frames while awaiting provider output', () => {
    chat.startAssistantMessage();
    expect(frames.size).toBe(0);
    chat.appendChunk('ab');
    expect(frames.size).toBe(1);
    tick(100);
    expect(chat.renderedContent).toBe('ab');
    expect(chat.typingQueue).toEqual([]);
    expect(frames.size).toBe(0);
    chat.appendChunk('cd');
    expect(frames.size).toBe(1);
    tick(200);
    expect(chat.renderedContent).toBe('abcd');
  });

  it('cancels the previous chat animation and clears streaming state on a switch', () => {
    chat.startAssistantMessage();
    chat.appendChunk('Only belongs to the old chat');
    chat.clear();
    expect(frames.size).toBe(0);
    expect(chat.isStreaming).toBe(false);
    expect(chat.currentAssistantEl).toBeNull();
    expect(chat.currentContent).toBe('');
  });

  it('restores cached partial output immediately without replaying its typing animation', () => {
    chat.startAssistantMessage();
    chat.appendChunk('Restored answer', true);
    expect(chat.currentAssistantEl.innerHTML).toBe('<p>Restored answer</p>');
    expect(frames.size).toBe(0);
    expect(chat.typingQueue).toEqual([]);
    chat.appendChunk(' next');
    expect(frames.size).toBe(1);
    chat.endAssistantMessage();
    expect(frames.size).toBe(0);
  });
});
