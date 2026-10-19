import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jinaReadUrl } from '../server/tools/internet.js';

const { AbortSignal, Response, ReadableStream, TextEncoder } = globalThis;

// Keep the real URL validator, but avoid loading native embedding dependencies.
vi.mock('@xenova/transformers', () => ({ pipeline: vi.fn() }));

describe('Jina Reader', () => {
  const url = 'https://example.com/article?view=full';
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads Markdown with the Jina endpoint, headers and timeout', async () => {
    fetchMock.mockResolvedValue(new Response('# Article\n\nBody'));
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    expect(await jinaReadUrl({ url })).toBe(`# Content from ${url}\n\n# Article\n\nBody`);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`https://r.jina.ai/${url}`, {
      headers: { Accept: 'text/markdown', 'User-Agent': 'PHANTOM/1.0' },
      signal: expect.any(AbortSignal),
    });
    expect(timeout).toHaveBeenCalledWith(20000);
  });

  it('truncates at an explicit limit and reports the original length', async () => {
    fetchMock.mockResolvedValue(new Response('abcdefghij'));
    expect(await jinaReadUrl({ url, max_length: 4 })).toBe(
      `# Content from ${url}\n\nabcd\n\n[... truncated at 4 chars. Full content is 10 chars.]`,
    );
  });

  it('uses the default 50,000 character limit', async () => {
    fetchMock.mockResolvedValue(new Response('a'.repeat(50001)));
    expect(await jinaReadUrl({ url })).toBe(
      `# Content from ${url}\n\n${'a'.repeat(50000)}\n\n[... truncated at 50000 chars. Full content is 50001 chars.]`,
    );
  });

  it('does not truncate content exactly at the limit', async () => {
    fetchMock.mockResolvedValue(new Response('abcd'));
    expect(await jinaReadUrl({ url, max_length: 4 })).toBe(`# Content from ${url}\n\nabcd`);
  });

  it('reports permanent HTTP failures without retrying', async () => {
    const response = new Response('Forbidden', { status: 403 });
    const cancel = vi.spyOn(response.body, 'cancel');
    fetchMock.mockResolvedValue(response);
    expect(await jinaReadUrl({ url })).toBe(
      `Error: Jina Reader returned HTTP 403 for ${url}. Try the scrape_webpage tool as a fallback.`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each(['', ' \n\t '])('reports empty or whitespace-only content (%j)', async (body) => {
    fetchMock.mockResolvedValue(new Response(body));
    expect(await jinaReadUrl({ url })).toBe(
      `Jina Reader returned empty content for ${url}. The page may be behind a login wall or have anti-bot protections. Try scrape_webpage or scrapling_fetch instead.`,
    );
  });

  it('retries one network failure after 500ms', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(new Response('Recovered'));
    const result = jinaReadUrl({ url });

    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe(`# Content from ${url}\n\nRecovered`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports the last network error after exhausting two attempts', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(Object.assign(new Error('last failure'), { code: 'ETIMEDOUT' }));
    const result = jinaReadUrl({ url });
    await vi.advanceTimersByTimeAsync(500);

    expect(await result).toBe(
      `Jina Reader timed out while reading ${url}. Try scrape_webpage or retry in a moment. (ETIMEDOUT)`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports response-body failures', async () => {
    const response = new Response(new ReadableStream({
      start(controller) { controller.error(new Error('body interrupted')); },
    }));
    fetchMock.mockResolvedValue(response);
    expect(await jinaReadUrl({ url })).toBe('Error reading URL via Jina Reader: body interrupted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.body.locked).toBe(false);
  });

  it('streams large bodies without calling response.text()', async () => {
    let chunks = 0;
    const response = new Response(new ReadableStream({
      pull(controller) {
        if (chunks++ < 100) controller.enqueue(new TextEncoder().encode('x'.repeat(10000)));
        else controller.close();
      },
    }));
    const text = vi.spyOn(response, 'text');
    fetchMock.mockResolvedValue(response);
    expect(await jinaReadUrl({ url, max_length: 10 })).toBe(
      `# Content from ${url}\n\nxxxxxxxxxx\n\n[... truncated at 10 chars. Full content is 1000000 chars.]`,
    );
    expect(text).not.toHaveBeenCalled();
    expect(response.body.locked).toBe(false);
  });

  it('decodes UTF-8 correctly when characters span byte chunks', async () => {
    const bytes = new TextEncoder().encode('é🙂尾');
    fetchMock.mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    })));
    expect(await jinaReadUrl({ url, max_length: 3 })).toBe(
      `# Content from ${url}\n\né🙂\n\n[... truncated at 3 chars. Full content is 4 chars.]`,
    );
  });

  it('flushes an incomplete UTF-8 sequence consistently with Response.text()', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([0x61, 0xe2, 0x82])));
    expect(await jinaReadUrl({ url })).toBe(`# Content from ${url}\n\na\ufffd`);
  });

  it('releases the reader if the response body times out', async () => {
    const controller = new globalThis.AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    let response;
    fetchMock.mockImplementation(async (_url, { signal }) => {
      response = new Response(new ReadableStream({
        start(stream) {
          signal.addEventListener('abort', () => stream.error(signal.reason), { once: true });
        },
      }));
      return response;
    });
    const result = jinaReadUrl({ url });
    controller.abort(new Error('body timed out'));
    expect(await result).toBe('Error reading URL via Jina Reader: body timed out');
    expect(response.body.locked).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('checks for empty content beyond the retained prefix', async () => {
    fetchMock.mockResolvedValue(new Response('    nonempty'));
    expect(await jinaReadUrl({ url, max_length: 2 })).toBe(
      `# Content from ${url}\n\n  \n\n[... truncated at 2 chars. Full content is 12 chars.]`,
    );
  });

  it('handles a successful response without a body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await jinaReadUrl({ url })).toContain('Jina Reader returned empty content');
  });

  it.each([429, 502, 503, 504])('retries HTTP %s once and cancels its unused body', async (status) => {
    vi.useFakeTimers();
    const response = new Response('Temporary failure', { status });
    const cancel = vi.spyOn(response.body, 'cancel');
    fetchMock.mockResolvedValueOnce(response).mockResolvedValueOnce(new Response('Recovered'));
    const result = jinaReadUrl({ url });
    await vi.advanceTimersByTimeAsync(499);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe(`# Content from ${url}\n\nRecovered`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['1', 'invalid'])('handles Retry-After %s without an unbounded wait', async (retryAfter) => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(new Response('Busy', {
      status: 429, headers: { 'Retry-After': retryAfter },
    })).mockResolvedValueOnce(new Response('Recovered'));
    const result = jinaReadUrl({ url });
    const delay = retryAfter === '1' ? 1000 : 500;
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toContain('Recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honours an HTTP-date Retry-After', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    fetchMock.mockResolvedValueOnce(new Response('Busy', {
      status: 503, headers: { 'Retry-After': 'Mon, 19 Oct 2026 12:00:02 GMT' },
    })).mockResolvedValueOnce(new Response('Recovered'));
    const result = jinaReadUrl({ url });
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toContain('Recovered');
  });

  it('does not retry before a long server-requested delay', async () => {
    fetchMock.mockResolvedValue(new Response('Busy', {
      status: 429, headers: { 'Retry-After': '60' },
    }));
    expect(await jinaReadUrl({ url })).toContain('HTTP 429');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caps HTTP retries at two total attempts', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response('Busy', { status: 503 }));
    const result = jinaReadUrl({ url });
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toContain('HTTP 503');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not return a stale HTTP response when the retry fails at the network layer', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(new Response('Busy', { status: 503 }))
      .mockRejectedValueOnce(new Error('connection reset'));
    const result = jinaReadUrl({ url });
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toContain('(connection reset)');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, null, {}, { url: '' }, { url: '   ' }, { url: 123 }])(
    'rejects missing or invalid url arguments (%j) without fetching', async (args) => {
      expect(await jinaReadUrl(args)).toBe('Error reading URL via Jina Reader: url must be a non-empty string');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, 1.5, '100', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid max_length %s without fetching', async (max_length) => {
      expect(await jinaReadUrl({ url, max_length })).toBe(
        'Error reading URL via Jina Reader: max_length must be a positive safe integer',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['not a URL', 'Invalid URL format'],
    ['file:///etc/passwd', 'Invalid URL protocol'],
    ['http://localhost/admin', 'SSRF protection'],
    ['http://127.0.0.2/admin', 'SSRF protection'],
    ['http://169.254.169.254/latest/meta-data/', 'SSRF protection'],
    ['http://[::1]/admin', 'SSRF protection'],
    ['http://service.localhost/admin', 'SSRF protection'],
    ['http://127.0.0.1.nip.io/admin', 'SSRF protection'],
    ['http://127.0.0.1.xip.io/admin', 'SSRF protection'],
    ['http://127.0.0.1.sslip.io/admin', 'SSRF protection'],
  ])('rejects unsafe URL %s before fetching', async (unsafeUrl, message) => {
    const result = await jinaReadUrl({ url: unsafeUrl });
    expect(result).toMatch(/^Error reading URL via Jina Reader: /);
    expect(result).toContain(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
