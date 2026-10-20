import { randomUUID } from 'node:crypto';

const EMPTY_CHAT_RESPONSE = '[PHANTOM] No usable final answer was returned. No further action was taken.';

/** Shared across sockets: a conversation must never have two writers at once. */
export function createChatSessionHandler({ processMessage, createConversation, getConversation, maxConcurrentChats = 4, maxMessageBytes = 262144 }) {
  const conversations = new Map();
  const limit = Math.max(1, Math.min(32, Number(maxConcurrentChats) || 4));

  return function attach(ws) {
    const requests = new Map();
    const send = data => {
      if (ws.readyState !== 1) return;
      try { ws.send(JSON.stringify(data)); } catch { ws.terminate?.(); }
    };
    const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 128;
    send({ type: 'session_ready', protocolVersion: 2, maxConcurrentChats: limit });

    ws.on('message', async data => {
      let payload;
      try {
        if (Buffer.byteLength(data) > maxMessageBytes) { ws.close(1009, 'Message too large'); return; }
        payload = JSON.parse(data);
      } catch {
        send({ type: 'protocol_error', message: 'Invalid chat payload.' });
        return;
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
      if (payload.type === 'ping' || payload.type === 'pong') {
        ws.isAlive = true;
        if (payload.type === 'ping') send({ type: 'pong' });
        return;
      }
      if (payload.type === 'stop') {
        const request = payload.requestId ? requests.get(payload.requestId)
          : [...requests.values()].find(item => item.conversationId === payload.conversationId);
        // Old clients can stop their only request, but never an arbitrary one.
        const target = request || (!payload.requestId && !payload.conversationId && requests.size === 1 ? requests.values().next().value : null);
        if (target && (!payload.conversationId || payload.conversationId === target.conversationId)) target.controller.abort();
        return;
      }
      if (payload.type !== 'chat' && payload.type !== undefined) return;
      const requestId = payload.requestId === undefined ? randomUUID() : payload.requestId;
      if (!validId(requestId)) { send({ type: 'protocol_error', message: 'Invalid request ID.' }); return; }
      const reject = message => send({ type: 'error', message, requestId, conversationId: payload.conversationId || null, terminal: true });
      const text = payload.content ?? payload.message;
      if (typeof text !== 'string' || !text.trim()) { reject('A non-empty message is required.'); return; }
      if (requests.has(requestId)) {
        // Do not emit a terminal event with the ID of the still-running request.
        send({ type: 'protocol_error', message: 'Duplicate request ID.' });
        return;
      }
      if (payload.conversationId !== undefined && payload.conversationId !== null && !validId(payload.conversationId)) {
        reject('Invalid conversation ID.'); return;
      }
      if (conversations.has(payload.conversationId)) { reject('This chat already has a running request.'); return; }
      if (conversations.size >= limit) { reject(`Up to ${limit} chats can run at once. Wait for a reply or stop a running chat.`); return; }

      let entry;
      let emit;
      try {
        const conversation = payload.conversationId ? getConversation(payload.conversationId) : createConversation(text.substring(0, 30));
        if (!conversation) { reject('Conversation not found.'); return; }
        entry = { conversationId: conversation.id, requestId, controller: new AbortController() };
        requests.set(requestId, entry);
        conversations.set(conversation.id, entry);
        emit = (type, detail = {}) => {
          if (requests.get(requestId) === entry) send({ ...detail, type, conversationId: entry.conversationId, requestId });
        };
        if (!payload.conversationId) emit('conversation_created');
        emit('response_start');
        const finalResponse = await processMessage(
          entry.conversationId, text, payload.context,
          content => emit('chunk', { content }),
          tool => emit('tool_call', tool),
          tool => emit('tool_result', tool),
          message => emit('error', { message, terminal: false }),
          content => emit('thinking', { content }),
          entry.controller.signal,
          progress => emit('tool_progress', progress),
        );
        if (typeof finalResponse !== 'string' || !finalResponse.trim()) {
          emit('chunk', { content: EMPTY_CHAT_RESPONSE });
        }
      } catch (error) {
        if (emit) emit('error', { message: error.message, terminal: false });
        else reject('Could not start this chat.');
      } finally {
        if (entry) {
          emit('response_end', { cancelled: entry.controller.signal.aborted });
          requests.delete(requestId);
          if (conversations.get(entry.conversationId) === entry) conversations.delete(entry.conversationId);
        }
      }
    });
    ws.on('close', () => {
      for (const entry of requests.values()) entry.controller.abort();
      // Keep the conversation lock until an in-flight tool actually returns.
    });
  };
}
