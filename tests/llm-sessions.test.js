import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import config from '../server/config.js';
import { getClient, processMessage, resetClient } from '../server/ai/llm-client.js';
import { initDB, closeDB, createConversation, addMessage, getMessages, saveMemory } from '../server/memory/store.js';

vi.mock('@xenova/transformers', () => ({ pipeline: vi.fn() }));
vi.mock('../server/ai/system-prompt.js', () => ({ buildSystemPrompt: vi.fn(async () => 'Test system instruction') }));
vi.mock('../server/tools/registry.js', () => ({ getToolDefinitions: () => [] }));

async function* stream(text) {
  yield { choices: [{ delta: { content: text } }] };
  yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
}

describe('Concurrent model request isolation', () => {
  let original;
  let a;
  let b;

  beforeEach(() => {
    original = { ...config.api };
    Object.assign(config.api, { baseUrl: 'https://provider.example/v1', apiKey: 'test-key-not-real', model: 'test-model', temperature: 0, maxTokens: 256 });
    resetClient();
    initDB(':memory:');
    a = createConversation('Chat A').id;
    b = createConversation('Chat B').id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(config.api, original);
    resetClient();
    closeDB();
  });

  function mockCreate(implementation) {
    return vi.spyOn(Object.getPrototypeOf(getClient().chat.completions), 'create').mockImplementation(implementation);
  }

  function run(id, message, signal) {
    return processMessage(id, message, undefined, vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), signal);
  }

  it('keeps histories, model settings and saved replies separate during concurrent calls', async () => {
    addMessage(a, { role: 'user', content: 'History belonging to A' });
    addMessage(b, { role: 'user', content: 'History belonging to B' });
    const create = mockCreate(async params => stream(params.messages.at(-1).content === 'Ask A' ? 'Reply A' : 'Reply B'));
    const first = run(a, 'Ask A');
    config.api.model = 'other-model';
    config.api.temperature = 1;
    const second = run(b, 'Ask B');
    expect(await Promise.all([first, second])).toEqual(['Reply A', 'Reply B']);
    const paramsA = create.mock.calls.find(([params]) => params.messages.at(-1).content === 'Ask A')[0];
    const paramsB = create.mock.calls.find(([params]) => params.messages.at(-1).content === 'Ask B')[0];
    expect(paramsA).toMatchObject({ model: 'test-model', temperature: 0 });
    expect(paramsB).toMatchObject({ model: 'other-model', temperature: 1 });
    expect(JSON.stringify(paramsA.messages)).not.toContain('History belonging to B');
    expect(JSON.stringify(paramsB.messages)).not.toContain('History belonging to A');
    expect(getMessages(a).at(-1).content).toBe('Reply A');
    expect(getMessages(b).at(-1).content).toBe('Reply B');
  });

  it('does not automatically inject shared investigation memories into another chat', async () => {
    await saveMemory('notes', 'shared-investigation', 'A note intended for explicit recall');
    const create = mockCreate(async () => stream('Reply'));
    await run(a, 'shared-investigation');
    expect(JSON.stringify(create.mock.calls[0][0].messages)).not.toContain('A note intended for explicit recall');
  });

  it('passes separate abort signals to the SDK so stopping A does not cancel B', async () => {
    const controllerA = new globalThis.AbortController();
    const controllerB = new globalThis.AbortController();
    const pending = new Map();
    const create = mockCreate((params, options) => new Promise((resolve, reject) => {
      const text = params.messages.at(-1).content;
      pending.set(text, resolve);
      options.signal.addEventListener('abort', () => reject(new Error('Aborted test request')), { once: true });
    }));
    const first = run(a, 'Ask A', controllerA.signal);
    const second = run(b, 'Ask B', controllerB.signal);
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    controllerA.abort();
    pending.get('Ask B')(stream('Reply B'));
    const [resultA, resultB] = await Promise.all([first, second]);
    expect(resultA).toContain('Operation stopped');
    expect(resultB).toBe('Reply B');
    expect(controllerB.signal.aborted).toBe(false);
    expect(create.mock.calls[0][1].signal).not.toBe(create.mock.calls[1][1].signal);
  });

  it('reads only the latest bounded history for the selected conversation in stable order', async () => {
    for (let i = 0; i < 60; i++) addMessage(a, { role: 'user', content: `A-${i}` });
    addMessage(b, { role: 'user', content: 'B-only' });
    expect(getMessages(a, 3).map(message => message.content)).toEqual(['A-57', 'A-58', 'A-59']);
    const create = mockCreate(async () => stream('Reply'));
    await run(a, 'Latest question');
    const messages = create.mock.calls[0][0].messages;
    expect(messages).toHaveLength(42); // system + 40 history entries + new user
    expect(messages[1].content).toBe('A-20');
    expect(JSON.stringify(messages)).not.toContain('B-only');
  });

  it('shares NVIDIA pacing across simultaneous chats instead of bursting API calls', async () => {
    config.api.baseUrl = 'https://nvidia.example/v1';
    resetClient();
    const timestamps = [];
    mockCreate(async () => { timestamps.push(Date.now()); return stream('Reply'); });
    await Promise.all([run(a, 'Ask A'), run(b, 'Ask B')]);
    expect(timestamps).toHaveLength(2);
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(1400);
  });
});
