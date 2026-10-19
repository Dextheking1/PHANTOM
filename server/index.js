import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import app from './app.js';
import config from './config.js';
import { processMessage } from './ai/llm-client.js';
import { createConversation, getConversation } from './memory/store.js';
import { timingSafeEqual } from 'crypto';
import { createChatSessionHandler } from './chat-sessions.js';

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const attachChatSession = createChatSessionHandler({
  processMessage, createConversation, getConversation,
  maxConcurrentChats: config.limits.maxConcurrentChats,
  maxMessageBytes: config.limits.maxWebSocketMessageBytes,
});

function isAuthorized(request) {
  const expected = config.server.apiToken || process.env.API_TOKEN || '';
  if (!expected) {
    return process.env.PHANTOM_LOCAL_MODE === 'true' ||
      config.server.host === '127.0.0.1' ||
      config.server.host === 'localhost' ||
      config.server.host === '::1';
  }
  const provided = request.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  const actual = Buffer.from(provided);
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}

// Handle server errors (e.g. EADDRINUSE)
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const port = config.port || config.server?.port || 1337;
    console.error(`\n❌ [PHANTOM] Port ${port} is already in use by another process.`);
    console.error(`👉 Stop the process using port ${port} or run with a custom port: PORT=1338 npm run dev\n`);
    process.exit(1);
  } else {
    console.error('[Server Error]', err);
  }
});

// WebSocket Heartbeat / Stale Connection Purge
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      // Ignore ping send errors on closing sockets
    }
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

wss.on('connection', (ws, request) => {
  if (!isAuthorized(request)) {
    ws.close(1008, 'Unauthorized');
    return;
  }
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Prevent socket errors from crashing the Node.js process
  ws.on('error', (err) => {
    console.warn('[WebSocket] Connection error:', err.message);
  });

  attachChatSession(ws);
});

import { printBanner } from './banner.js';

const PORT = config.port || config.server?.port || 1337;
server.listen(PORT, config.server.host, () => {
  if (!process.env.PHANTOM_SILENT_BANNER) {
    printBanner({
      port: PORT,
      mode: process.env.NODE_ENV === 'production' ? 'Production' : 'Development',
      provider: config.api.provider || 'OpenAI',
      model: config.api.model || 'gpt-4o',
      isDev: process.env.PHANTOM_DEV === 'true',
    });
  }
});
