/** No browser persistence: provider keys and transcript caches stay out of storage. */
export class ChatSessions {
  constructor() {
    this.sessions = new Map();
    this.requests = new Map();
    this.active = null;
    this.multiplexed = false;
    this.maxConcurrent = 4;
  }

  create(conversationId = null) {
    const session = {
      key: globalThis.crypto.randomUUID(), conversationId, requestId: null,
      processing: false, loading: false, unread: false, revision: 0,
      history: [], events: [], draft: '', image: null, imageName: '',
    };
    this.sessions.set(session.key, session);
    return session;
  }

  find(conversationId) {
    return [...this.sessions.values()].find(session => session.conversationId === conversationId);
  }

  activate(session) {
    this.active = session;
    session.unread = false;
    // Bound inactive transcript/draft caches. Running chats are never evicted.
    this.sessions.delete(session.key);
    this.sessions.set(session.key, session);
    for (const [key, item] of this.sessions) {
      if (this.sessions.size <= 8) break;
      if (item !== session && !item.processing) this.sessions.delete(key);
    }
  }

  begin(session) {
    if (session.processing) throw new Error('This chat is already generating a reply.');
    if ((!this.multiplexed && this.requests.size) || this.requests.size >= this.maxConcurrent) {
      throw new Error(this.multiplexed
        ? `Up to ${this.maxConcurrent} chats can run at once. Wait for a reply or stop a running chat.`
        : 'Update and restart the backend to run multiple chats at once. You can still switch chats safely.');
    }
    session.requestId = globalThis.crypto.randomUUID();
    session.processing = true;
    session.revision += 1;
    this.requests.set(session.requestId, session);
    return session.requestId;
  }

  record(session, frame) {
    const last = session.events.at(-1);
    if (last && last.type === frame.type && ['chunk', 'thinking', 'tool_progress'].includes(frame.type)
      && last.id === frame.id && last.requestId === frame.requestId) {
      const field = frame.type === 'tool_progress' ? 'text' : 'content';
      last[field] = (last[field] || '') + (frame[field] || frame.data || '');
    } else session.events.push({ ...frame });
    session.revision += 1;
  }

  route(frame) {
    let session = frame.requestId ? this.requests.get(frame.requestId) : null;
    // Compatibility with older backends is safe only with one pending request.
    if (!frame.requestId && !this.multiplexed && this.requests.size === 1) session = this.requests.values().next().value;
    if (!session) return null;
    if (frame.conversationId && session.conversationId && frame.conversationId !== session.conversationId) return null;
    if (frame.type === 'conversation_created') {
      session.conversationId = frame.conversationId;
      return session;
    }
    const terminal = frame.type === 'response_end' || (frame.type === 'error' && (frame.terminal === true || (!this.multiplexed && frame.terminal !== false)));
    this.record(session, frame);
    if (session !== this.active && ['chunk', 'error', 'response_end'].includes(frame.type)) session.unread = true;
    if (terminal) {
      session.processing = false;
      this.requests.delete(session.requestId);
    }
    return session;
  }

  disconnect() {
    for (const session of this.requests.values()) {
      this.record(session, { type: 'error', message: 'Connection lost. This chat was interrupted; reconnect and retry the last request.' });
      this.record(session, { type: 'response_end' });
      session.processing = false;
    }
    this.requests.clear();
    this.multiplexed = false;
  }
}
