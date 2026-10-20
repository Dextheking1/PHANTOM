import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createChatSessionHandler } from '../server/chat-sessions.js';

function fixture(limit = 4) {
  const runs = [];
  const processMessage = vi.fn((...args) => new Promise((resolve, reject) => runs.push({ args, resolve, reject })));
  let created = 0;
  const attach = createChatSessionHandler({ processMessage, maxConcurrentChats: limit,
    createConversation: () => ({ id: `new-${++created}` }),
    getConversation: id => id === 'missing' ? null : ({ id }),
  });
  function socket() {
    const ws = new EventEmitter();
    ws.readyState = 1;
    ws.frames = [];
    ws.send = data => ws.frames.push(JSON.parse(data));
    ws.close = vi.fn();
    attach(ws);
    ws.chat = (conversationId, requestId) => ws.emit('message', JSON.stringify({ type: 'chat', content: 'Hello', conversationId, requestId }));
    ws.control = data => ws.emit('message', JSON.stringify(data));
    return ws;
  }
  return { runs, socket, processMessage };
}

describe('Conversation-scoped WebSocket requests', () => {
  it('runs separate chats concurrently and tags every event with the correct request', async () => {
    const { socket, runs } = fixture();
    const ws = socket();
    ws.chat('a', 'request-a');
    ws.chat('b', 'request-b');
    expect(runs).toHaveLength(2);
    runs[0].args[3]('Only A');
    runs[1].args[3]('Only B');
    runs[1].args[4]({ id: 'tool', conversationId: 'wrong', requestId: 'wrong' });
    expect(ws.frames.find(frame => frame.content === 'Only A')).toMatchObject({ conversationId: 'a', requestId: 'request-a' });
    expect(ws.frames.find(frame => frame.content === 'Only B')).toMatchObject({ conversationId: 'b', requestId: 'request-b' });
    expect(ws.frames.find(frame => frame.type === 'tool_call')).toMatchObject({ conversationId: 'b', requestId: 'request-b' });
    runs.forEach(run => run.resolve());
    await Promise.resolve();
    expect(ws.frames.filter(frame => frame.type === 'response_end')).toHaveLength(2);
  });

  it('keeps the running lock and abort controller intact across heartbeats', () => {
    const { socket, runs } = fixture();
    const ws = socket();
    ws.chat('a', 'one');
    ws.control({ type: 'ping' });
    ws.control({ type: 'pong' });
    ws.chat('a', 'two');
    expect(runs).toHaveLength(1);
    expect(ws.frames.find(frame => frame.requestId === 'two')).toMatchObject({ type: 'error', terminal: true });
    ws.control({ type: 'stop', conversationId: 'a', requestId: 'one' });
    expect(runs[0].args[8].aborted).toBe(true);
  });

  it('stops only the matching request and aborts remaining work on disconnect', () => {
    const { socket, runs } = fixture();
    const ws = socket();
    ws.chat('a', 'one'); ws.chat('b', 'two');
    ws.control({ type: 'stop', conversationId: 'b', requestId: 'one' });
    expect(runs[0].args[8].aborted).toBe(false);
    ws.control({ type: 'stop', conversationId: 'a', requestId: 'one' });
    expect(runs[0].args[8].aborted).toBe(true);
    expect(runs[1].args[8].aborted).toBe(false);
    ws.emit('close');
    expect(runs[1].args[8].aborted).toBe(true);
  });

  it('prevents two sockets from writing the same conversation', async () => {
    const { socket, runs } = fixture();
    const first = socket(); const second = socket();
    first.chat('a', 'one'); second.chat('a', 'two');
    expect(runs).toHaveLength(1);
    expect(second.frames.at(-1)).toMatchObject({ type: 'error', requestId: 'two', terminal: true });
    runs[0].resolve();
    await Promise.resolve();
    second.chat('a', 'three');
    expect(runs).toHaveLength(2);
  });

  it('limits total API concurrency and creates new chats only after admission', () => {
    const { socket, runs } = fixture(1);
    const ws = socket();
    ws.chat(null, 'one'); ws.chat(null, 'two');
    expect(runs).toHaveLength(1);
    expect(ws.frames.filter(frame => frame.type === 'conversation_created')).toEqual([
      { type: 'conversation_created', conversationId: 'new-1', requestId: 'one' },
    ]);
    expect(ws.frames.at(-1)).toMatchObject({ type: 'error', requestId: 'two', terminal: true });
  });

  it('keeps rejected duplicate IDs from terminating an existing request', () => {
    const { socket, runs } = fixture();
    const ws = socket();
    ws.chat('a', 'one'); ws.chat('b', 'one');
    expect(runs).toHaveLength(1);
    expect(ws.frames.at(-1).type).toBe('protocol_error');
  });

  it('scopes errors and always sends a terminal response after failures', async () => {
    const { socket, runs } = fixture();
    const ws = socket();
    ws.chat('a', 'one');
    runs[0].reject(new Error('Test failure'));
    await Promise.resolve();
    expect(ws.frames.slice(-2)).toEqual([
      { type: 'error', message: 'Test failure', terminal: false, conversationId: 'a', requestId: 'one' },
      { type: 'response_end', cancelled: false, conversationId: 'a', requestId: 'one' },
    ]);
  });

  it('rejects missing conversations without starting a model request', () => {
    const { socket, runs } = fixture();
    const ws = socket();
    ws.chat('missing', 'one');
    expect(runs).toHaveLength(0);
    expect(ws.frames.at(-1)).toMatchObject({ type: 'error', requestId: 'one', terminal: true });
  });

  it('emits a safe final message if a model handler resolves without content', async () => {
    const { socket, runs } = fixture();
    const ws = socket();
    ws.chat('a', 'one');
    runs[0].resolve('');
    await Promise.resolve();
    await Promise.resolve();

    expect(ws.frames.find(frame => frame.type === 'chunk')).toMatchObject({
      content: expect.stringMatching(/no usable final answer/i),
    });
    expect(ws.frames.at(-1)).toMatchObject({ type: 'response_end', requestId: 'one' });
  });
});
