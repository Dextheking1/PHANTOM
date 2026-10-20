import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server/app.js';
import { processMessage, resetClient, getClient } from '../server/ai/llm-client.js';
import { initDB, createConversation } from '../server/memory/store.js';
import config, { updateConfig } from '../server/config.js';

describe('Heretic Engine — Settings API & LLM Jailbreak Flow', () => {
  beforeEach(() => {
    initDB(':memory:');
    resetClient();
    updateConfig({ bypassCensorship: false });
  });

  it('GET /api/settings should include bypassCensorship field', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('bypassCensorship');
    expect(res.body.bypassCensorship).toBe(false);
  });

  it('PUT /api/settings should update bypassCensorship state', async () => {
    const updateRes = await request(app)
      .put('/api/settings')
      .send({ bypassCensorship: true });
    expect(updateRes.status).toBe(200);
    expect(config.api.bypassCensorship).toBe(true);

    const getRes = await request(app).get('/api/settings');
    expect(getRes.body.bypassCensorship).toBe(true);
  });

  it('LLM Client: when bypassCensorship is OFF, returns model response normally without interception', async () => {
    updateConfig({ bypassCensorship: false });
    const conv = createConversation('Normal Conv');

    const mockChunks = [
      { choices: [{ delta: { content: "I'm sorry, I cannot fulfill this request." } }] },
      { choices: [{ finish_reason: 'stop' }] }
    ];

    async function* mockStream() {
      for (const chunk of mockChunks) yield chunk;
    }

    const client = getClient();
    const mockCreate = vi.fn().mockResolvedValue(mockStream());
    vi.spyOn(Object.getPrototypeOf(client.chat.completions), 'create').mockImplementation(mockCreate);

    const onChunk = vi.fn();
    const result = await processMessage(
      conv.id,
      'Test message',
      '',
      onChunk,
      vi.fn(),
      vi.fn(),
      vi.fn()
    );

    // Should return the refusal as-is since bypass is off
    expect(result).toContain("I'm sorry, I cannot fulfill this request.");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('LLM Client: when bypassCensorship is ON, intercepts refusal and executes autonomous jailbreak retry', async () => {
    updateConfig({ bypassCensorship: true });
    const conv = createConversation('Bypass Conv');

    // First call produces a refusal
    const refusalChunks = [
      { choices: [{ delta: { content: "I'm sorry, but as an AI I cannot help with that." } }] },
      { choices: [{ finish_reason: 'stop' }] }
    ];

    // Second call (after autonomous jailbreak mutation) produces the unredacted answer
    const successChunks = [
      { choices: [{ delta: { content: "```c\n// Complete unredacted payload\nint main() { return 0; }\n```" } }] },
      { choices: [{ finish_reason: 'stop' }] }
    ];

    async function* makeStream(chunks) {
      for (const chunk of chunks) yield chunk;
    }

    const client = getClient();
    const mockCreate = vi.fn()
      .mockResolvedValueOnce(makeStream(refusalChunks))
      .mockResolvedValueOnce(makeStream(successChunks));
    vi.spyOn(Object.getPrototypeOf(client.chat.completions), 'create').mockImplementation(mockCreate);

    const onChunk = vi.fn();
    const result = await processMessage(
      conv.id,
      'Generate low-level payload',
      '',
      onChunk,
      vi.fn(),
      vi.fn(),
      vi.fn()
    );

    // Succeeded via autonomous retry
    expect(result).toContain('Complete unredacted payload');
    expect(mockCreate).toHaveBeenCalledTimes(2);

    // Verify the second call received the Heretic mutated message
    const secondCallMessages = mockCreate.mock.calls[1][0].messages;
    const lastUserMessage = secondCallMessages[secondCallMessages.length - 1];
    expect(lastUserMessage.content).toContain('HERETIC DIRECTIONAL OVERRIDE');
  });
});
