import { describe, expect, it } from 'vitest';
import { ChatSessions } from '../frontend/js/chat-sessions.js';

describe('Browser chat state isolation', () => {
  function fixture() {
    const chats = new ChatSessions();
    chats.multiplexed = true;
    const a = chats.create('a'); const b = chats.create('b');
    chats.activate(a);
    const requestA = chats.begin(a); const requestB = chats.begin(b);
    return { chats, a, b, requestA, requestB };
  }

  it('routes interleaved output and completion to their own chats', () => {
    const { chats, a, b, requestA, requestB } = fixture();
    chats.route({ type: 'chunk', conversationId: 'a', requestId: requestA, content: 'A' });
    chats.route({ type: 'chunk', conversationId: 'b', requestId: requestB, content: 'B' });
    chats.route({ type: 'response_end', conversationId: 'b', requestId: requestB });
    expect(a.events.map(frame => frame.content)).toEqual(['A']);
    expect(b.events[0].content).toBe('B');
    expect(a.processing).toBe(true);
    expect(b.processing).toBe(false);
    expect(b.unread).toBe(true);
    chats.activate(b);
    expect(b.unread).toBe(false);
  });

  it('does not adopt a newly created background chat as the active draft', () => {
    const chats = new ChatSessions();
    chats.multiplexed = true;
    const oldDraft = chats.create(); chats.activate(oldDraft);
    const requestId = chats.begin(oldDraft);
    const newDraft = chats.create(); chats.activate(newDraft);
    chats.route({ type: 'conversation_created', conversationId: 'created-a', requestId });
    expect(oldDraft.conversationId).toBe('created-a');
    expect(chats.active).toBe(newDraft);
    expect(newDraft.conversationId).toBeNull();
  });

  it('drops unknown, mismatched, unscoped and stale request frames', () => {
    const { chats, a, requestA } = fixture();
    for (const frame of [
      { type: 'chunk', conversationId: 'a', content: 'unscoped' },
      { type: 'chunk', conversationId: 'a', requestId: 'unknown', content: 'unknown' },
      { type: 'chunk', conversationId: 'b', requestId: requestA, content: 'mismatch' },
    ]) expect(chats.route(frame)).toBeNull();
    chats.route({ type: 'response_end', conversationId: 'a', requestId: requestA });
    chats.begin(a);
    expect(chats.route({ type: 'chunk', conversationId: 'a', requestId: requestA, content: 'stale' })).toBeNull();
    expect(a.events).toHaveLength(1);
  });

  it('coalesces streaming chunks instead of retaining thousands of tiny events', () => {
    const { chats, a, requestA } = fixture();
    for (let i = 0; i < 1000; i++) chats.route({ type: 'chunk', conversationId: 'a', requestId: requestA, content: 'x' });
    expect(a.events).toHaveLength(1);
    expect(a.events[0].content).toHaveLength(1000);
  });

  it('keeps the request busy until response_end after a nonterminal error', () => {
    const { chats, a, requestA } = fixture();
    chats.route({ type: 'error', message: 'Provider failed', terminal: false, conversationId: 'a', requestId: requestA });
    expect(a.processing).toBe(true);
    expect(() => chats.begin(a)).toThrow('already generating');
    chats.route({ type: 'response_end', conversationId: 'a', requestId: requestA });
    expect(a.processing).toBe(false);
  });

  it('releases all interrupted sessions on disconnect without mixing their transcripts', () => {
    const { chats, a, b } = fixture();
    chats.disconnect();
    expect(chats.requests.size).toBe(0);
    expect(a.processing).toBe(false);
    expect(b.processing).toBe(false);
    expect(a.events[0].message).toContain('Connection lost');
    expect(a.events).not.toBe(b.events);
  });

  it('bounds inactive transcript caches while keeping running sessions', () => {
    const { chats, a, b } = fixture();
    for (let i = 0; i < 20; i++) chats.activate(chats.create(`idle-${i}`));
    expect(chats.sessions.size).toBe(8);
    expect(chats.find('a')).toBe(a);
    expect(chats.find('b')).toBe(b);
  });

  it('allows safe single-chat fallback against an old backend', () => {
    const chats = new ChatSessions();
    const a = chats.create('a'); const b = chats.create('b');
    chats.activate(a); chats.begin(a); chats.activate(b);
    expect(() => chats.begin(b)).toThrow('Update and restart');
    expect(chats.route({ type: 'chunk', conversationId: 'a', content: 'Only A' })).toBe(a);
    expect(b.events).toHaveLength(0);
  });
});
