import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processMessage, resetClient, getClient, parseToolArguments } from '../server/ai/llm-client.js';
import { getDB, initDB, createConversation } from '../server/memory/store.js';

describe('LLM Client', () => {
  let conversationId;

  beforeEach(() => {
    initDB(':memory:');
    const conv = createConversation('Test Conv');
    conversationId = conv.id;
    resetClient();
  });

  it('processMessage should correctly build messages array and process streaming chunks', async () => {
    const mockChunks = [
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: { content: ' World' } }] },
      { choices: [{ finish_reason: 'stop' }] }
    ];

    // Async generator for mock response
    async function* mockStream() {
      for (const chunk of mockChunks) {
        yield chunk;
      }
    }

    const mockCreate = vi.fn().mockResolvedValue(mockStream());

    const client = getClient();
    vi.spyOn(Object.getPrototypeOf(client.chat.completions), 'create').mockImplementation(mockCreate);

    const onChunk = vi.fn();
    const onToolCall = vi.fn();
    const onToolResult = vi.fn();
    const onError = vi.fn();

    const result = await processMessage(
      conversationId,
      'Say Hello',
      "",
      onChunk,
      onToolCall,
      onToolResult,
      onError
    );

    expect(result).toBe('Hello World');
    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(onChunk).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onChunk).toHaveBeenNthCalledWith(2, ' World');
  });

  it('processMessage should parse tool_use response blocks correctly', async () => {
     // Setup mock tools and mock tools response
     const mockChunks = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_123', type: 'function', function: { name: 'read_file', arguments: '{"path":"test.txt"}' } }] } }] },
      { choices: [{ finish_reason: 'tool_calls' }] }
    ];

    async function* mockStream() {
      for (const chunk of mockChunks) {
        yield chunk;
      }
    }

    const mockCreate = vi.fn().mockResolvedValue(mockStream());
    const client = getClient();
    vi.spyOn(Object.getPrototypeOf(client.chat.completions), 'create').mockImplementation(mockCreate);

    const onChunk = vi.fn();
    const onToolCall = vi.fn();
    const onToolResult = vi.fn();
    const onError = vi.fn();

    await processMessage(
      conversationId,
      'Read test.txt',
      "",
      onChunk,
      onToolCall,
      onToolResult,
      onError
    );

    expect(onToolCall).toHaveBeenCalledTimes(1);
     expect(onToolCall).toHaveBeenCalledWith(expect.objectContaining({
      name: 'read_file',
      args: { path: 'test.txt' }
     }));
  });

  it('retries a transient streaming timeout before showing an LLM error', async () => {
    const mockCreate = vi.fn()
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]() { return this; },
        async next() { throw Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' }); },
      })
      .mockResolvedValueOnce((async function* () {
        yield { choices: [{ delta: { content: 'Recovered' } }] };
        yield { choices: [{ finish_reason: 'stop' }] };
      })());
    const client = getClient();
    vi.spyOn(Object.getPrototypeOf(client.chat.completions), 'create').mockImplementation(mockCreate);

    const result = await processMessage(
      conversationId,
      'Retry this request',
      '',
      vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(),
    );

    expect(result).toBe('Recovered');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  }, 10000);

  it('reports empty tool arguments as a tool failure and records a failed audit result', async () => {
    const mockCreate = vi.fn()
      .mockResolvedValueOnce((async function* () {
        yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-empty', type: 'function', function: { name: 'read_file', arguments: '' } }] } }] };
        yield { choices: [{ finish_reason: 'tool_calls' }] };
      })())
      .mockResolvedValueOnce((async function* () {
        yield { choices: [{ delta: { content: 'The invalid call was handled.' } }] };
        yield { choices: [{ finish_reason: 'stop' }] };
      })());
    const client = getClient();
    vi.spyOn(Object.getPrototypeOf(client.chat.completions), 'create').mockImplementation(mockCreate);

    const onToolResult = vi.fn();
    await processMessage(conversationId, 'Use the file tool', '', vi.fn(), vi.fn(), onToolResult, vi.fn());

    expect(onToolResult).toHaveBeenCalledWith(expect.objectContaining({ id: 'call-empty' }));
    const result = onToolResult.mock.calls[0][0].result;
    expect(JSON.parse(result)).toMatchObject({ ok: false, error: { code: 'invalid_tool_arguments' } });
    expect(getDB().prepare('SELECT status FROM tool_results WHERE conversation_id = ?').get(conversationId).status).toBe('error');
  });

  it('creates a result for a tool call with no function name', async () => {
    const mockCreate = vi.fn()
      .mockResolvedValueOnce((async function* () {
        yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-no-name', type: 'function', function: {} }] } }] };
        yield { choices: [{ finish_reason: 'tool_calls' }] };
      })())
      .mockResolvedValueOnce((async function* () {
        yield { choices: [{ delta: { content: 'Recovered from the malformed call.' } }] };
        yield { choices: [{ finish_reason: 'stop' }] };
      })());
    const client = getClient();
    vi.spyOn(Object.getPrototypeOf(client.chat.completions), 'create').mockImplementation(mockCreate);

    const onToolCall = vi.fn();
    const onToolResult = vi.fn();
    await processMessage(conversationId, 'Make a malformed call', '', vi.fn(), onToolCall, onToolResult, vi.fn());

    expect(onToolCall).toHaveBeenCalledWith(expect.objectContaining({ id: 'call-no-name', name: '__invalid_tool_call__' }));
    expect(onToolResult).toHaveBeenCalledWith(expect.objectContaining({ id: 'call-no-name' }));
    expect(JSON.parse(onToolResult.mock.calls[0][0].result)).toMatchObject({ ok: false, error: { code: 'invalid_tool_call' } });
  });

  it('turns a thrown tool error into an explicit failed result and audit record', async () => {
    const previousReaSetting = process.env.REA_ENABLE_TOOL_CALLS;
    delete process.env.REA_ENABLE_TOOL_CALLS;
    try {
      const mockCreate = vi.fn()
        .mockResolvedValueOnce((async function* () {
          yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-throws', type: 'function', function: { name: 'rea_call_tool', arguments: '{"tool_name":"not-enabled"}' } }] } }] };
          yield { choices: [{ finish_reason: 'tool_calls' }] };
        })())
        .mockResolvedValueOnce((async function* () {
          yield { choices: [{ delta: { content: 'The failed tool call is visible.' } }] };
          yield { choices: [{ finish_reason: 'stop' }] };
        })());
      const client = getClient();
      vi.spyOn(Object.getPrototypeOf(client.chat.completions), 'create').mockImplementation(mockCreate);

      const onToolResult = vi.fn();
      await processMessage(conversationId, 'Call the bridge', '', vi.fn(), vi.fn(), onToolResult, vi.fn());

      expect(JSON.parse(onToolResult.mock.calls[0][0].result)).toMatchObject({ ok: false, error: { code: 'tool_exception' } });
      expect(getDB().prepare('SELECT status FROM tool_results WHERE conversation_id = ?').get(conversationId).status).toBe('error');
    } finally {
      if (previousReaSetting === undefined) delete process.env.REA_ENABLE_TOOL_CALLS;
      else process.env.REA_ENABLE_TOOL_CALLS = previousReaSetting;
    }
  });

  it('joins unindexed argument fragments instead of dropping the tool call', async () => {
    const mockCreate = vi.fn()
      .mockResolvedValueOnce((async function* () {
        yield { choices: [{ delta: { tool_calls: [{ id: 'call-fragments', type: 'function', function: { name: 'read_file', arguments: '{"path":' } }] } }] };
        yield { choices: [{ delta: { tool_calls: [{ function: { arguments: '"notes.txt"}' } }] } }] };
        yield { choices: [{ finish_reason: 'tool_calls' }] };
      })())
      .mockResolvedValueOnce((async function* () {
        yield { choices: [{ delta: { content: 'The fragments were handled.' } }] };
        yield { choices: [{ finish_reason: 'stop' }] };
      })());
    const client = getClient();
    vi.spyOn(Object.getPrototypeOf(client.chat.completions), 'create').mockImplementation(mockCreate);

    const onToolCall = vi.fn();
    await processMessage(conversationId, 'Read notes', '', vi.fn(), onToolCall, vi.fn(), vi.fn());

    expect(onToolCall).toHaveBeenCalledWith(expect.objectContaining({ id: 'call-fragments', args: { path: 'notes.txt' } }));
  });

  it('returns a clear safe final answer when the model ends without content', async () => {
    const mockCreate = vi.fn().mockResolvedValue((async function* () {
      yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
    })());
    const client = getClient();
    vi.spyOn(Object.getPrototypeOf(client.chat.completions), 'create').mockImplementation(mockCreate);

    const chunks = [];
    const result = await processMessage(conversationId, 'Answer safely', '', chunk => chunks.push(chunk), vi.fn(), vi.fn(), vi.fn());

    expect(result).toMatch(/no usable final answer/i);
    expect(result).toMatch(/no further action/i);
    expect(chunks.join('')).toContain(result);
  });

  it('returns a safe final answer when a tool loop ends with an empty model response', async () => {
    const mockCreate = vi.fn()
      .mockResolvedValueOnce((async function* () {
        yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-before-empty', type: 'function', function: { name: 'read_file', arguments: '{"path":"missing.txt"}' } }] } }] };
        yield { choices: [{ finish_reason: 'tool_calls' }] };
      })())
      .mockResolvedValueOnce((async function* () {
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      })());
    const client = getClient();
    vi.spyOn(Object.getPrototypeOf(client.chat.completions), 'create').mockImplementation(mockCreate);

    const result = await processMessage(conversationId, 'Read the missing file', '', vi.fn(), vi.fn(), vi.fn(), vi.fn());

    expect(result).toMatch(/no usable final answer/i);
    expect(result).toMatch(/no further action/i);
  });

  it('parses only non-empty JSON object tool arguments', () => {
    expect(parseToolArguments('{"path":"report.txt"}')).toMatchObject({ ok: true, args: { path: 'report.txt' } });
    expect(parseToolArguments('')).toMatchObject({ ok: false, error: expect.stringMatching(/empty/i) });
    expect(parseToolArguments('{not-json}')).toMatchObject({ ok: false, error: expect.stringMatching(/valid JSON/i) });
    expect(parseToolArguments('[]')).toMatchObject({ ok: false, error: expect.stringMatching(/object/i) });
  });
});
