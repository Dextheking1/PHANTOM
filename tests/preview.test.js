import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createServer as createViteServer } from 'vite';
import WebSocket, { WebSocketServer } from 'ws';

const { fetch } = globalThis;

describe('Frontend preview API routing', () => {
  let backend;
  let preview;
  let cache;
  let origin;
  let sockets;

  beforeEach(async () => {
    // A loopback-only fake backend: no credentials or external network needed.
    backend = createHttpServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/settings') res.end(JSON.stringify({ apiKeySet: true, model: 'test-model' }));
      else if (req.url === '/api/conversations') res.end(JSON.stringify([{ id: 'test-chat', title: 'Test chat' }]));
      else { res.statusCode = 404; res.end(JSON.stringify({ error: 'Not found' })); }
    });
    sockets = new WebSocketServer({ server: backend, path: '/ws' });
    sockets.on('connection', socket => {
      socket.on('message', () => socket.send(JSON.stringify({ type: 'pong' })));
    });
    backend.listen(0, '127.0.0.1');
    await once(backend, 'listening');
    vi.stubEnv('PHANTOM_API_ORIGIN', `http://127.0.0.1:${backend.address().port}`);
    cache = await mkdtemp(join(tmpdir(), 'phantom-preview-test-'));
    preview = await createViteServer({
      configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)),
      configLoader: 'runner',
      root: fileURLToPath(new URL('../frontend', import.meta.url)),
      cacheDir: cache,
      server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
      logLevel: 'silent',
    });
    await preview.listen();
    origin = `http://127.0.0.1:${preview.httpServer.address().port}`;
  });

  afterEach(async () => {
    await preview?.close();
    for (const socket of sockets?.clients || []) socket.terminate();
    if (sockets) await new Promise(resolve => sockets.close(resolve));
    backend?.closeAllConnections();
    if (backend?.listening) await new Promise(resolve => backend.close(resolve));
    vi.unstubAllEnvs();
    if (cache) await rm(cache, { recursive: true, force: true });
  });

  it('serves the UI and proxies settings and conversations as JSON', async () => {
    const page = await fetch(origin);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('id="sidebar"');
    for (const path of ['/api/settings', '/api/conversations']) {
      const response = await fetch(`${origin}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      const data = await response.json();
      if (path === '/api/settings') expect(data).toEqual({ apiKeySet: true, model: 'test-model' });
      else expect(data).toEqual([{ id: 'test-chat', title: 'Test chat' }]);
    }
  });

  it('keeps API errors as JSON instead of falling back to index.html', async () => {
    const response = await fetch(`${origin}/api/not-a-route`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'Not found' });
    expect(preview.config.server.proxy['/ws'].target).toBe(preview.config.server.proxy['/api'].target);
    expect(preview.config.server.proxy['/ws'].ws).toBe(true);
    expect(preview.config.preview.proxy['/api'].target).toBe(preview.config.server.proxy['/api'].target);
  });

  it('forwards WebSocket upgrades to the same backend', async () => {
    const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/ws`);
    const message = once(socket, 'message');
    await once(socket, 'open');
    socket.send(JSON.stringify({ type: 'ping' }));
    const [data] = await message;
    expect(JSON.parse(data.toString())).toEqual({ type: 'pong' });
    socket.close();
    await once(socket, 'close');
  });
});
