import { validateUrlForSSRF } from './executor.js';

const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function retryDelay(response) {
  const header = response.headers.get('retry-after');
  if (header === null) return 500;
  const milliseconds = /^\d+(?:\.\d+)?$/.test(header)
    ? Number(header) * 1000
    : Date.parse(header) - Date.now();
  // A long Retry-After should not hold an agent invocation open or be ignored.
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 500;
}

async function readMarkdown(response, maxLength) {
  // Decode incrementally: retain only the requested prefix, but count the whole
  // body to preserve the existing truncation message and empty-content check.
  const reader = response.body?.getReader();
  if (!reader) return { markdown: '', length: 0, hasContent: false };
  const decoder = new TextDecoder();
  const parts = [];
  let retained = 0;
  let length = 0;
  let hasContent = false;
  const consume = text => {
    length += text.length;
    if (!hasContent && /\S/.test(text)) hasContent = true;
    if (retained < maxLength) {
      const prefix = text.slice(0, maxLength - retained);
      parts.push(prefix);
      retained += prefix.length;
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      consume(decoder.decode(value, { stream: true }));
    }
    consume(decoder.decode());
    return { markdown: parts.join(''), length, hasContent };
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Fetches any URL through Jina Reader API and returns clean, readable Markdown.
 * Zero config, free, no API key required.
 */
export async function jinaReadUrl(args = {}) {
  try {
    const { url, max_length = 50000 } = args ?? {};
    if (typeof url !== 'string' || !url.trim()) {
      throw new Error('url must be a non-empty string');
    }
    validateUrlForSSRF(url);
    if (!Number.isSafeInteger(max_length) || max_length < 1) {
      throw new Error('max_length must be a positive safe integer');
    }

    const jinaUrl = `https://r.jina.ai/${url}`;
    let response;
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      response = undefined;
      try {
        response = await fetch(jinaUrl, {
          headers: {
            'Accept': 'text/markdown',
            'User-Agent': 'PHANTOM/1.0',
          },
          signal: AbortSignal.timeout(20000),
        });
      } catch (error) {
        lastError = error;
        if (attempt < 2) await sleep(500);
        continue;
      }
      if (attempt < 2 && RETRYABLE_HTTP_STATUSES.has(response.status)) {
        const delay = retryDelay(response);
        if (delay <= 2000) {
          await response.body?.cancel().catch(() => {});
          await sleep(delay);
          continue;
        }
      }
      break;
    }
    if (!response) {
      return `Jina Reader timed out while reading ${url}. Try scrape_webpage or retry in a moment. (${lastError?.code || lastError?.message || 'network error'})`;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return `Error: Jina Reader returned HTTP ${response.status} for ${url}. Try the scrape_webpage tool as a fallback.`;
    }

    const { markdown, length, hasContent } = await readMarkdown(response, max_length);

    if (!hasContent) {
      return `Jina Reader returned empty content for ${url}. The page may be behind a login wall or have anti-bot protections. Try scrape_webpage or scrapling_fetch instead.`;
    }

    const trimmed = length > max_length
      ? markdown + `\n\n[... truncated at ${max_length} chars. Full content is ${length} chars.]`
      : markdown;

    return `# Content from ${url}\n\n${trimmed}`;
  } catch (err) {
    return `Error reading URL via Jina Reader: ${err.message}`;
  }
}
