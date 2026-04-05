// Hidden backend server — should never be accessed directly by clients.
// All traffic must come through the proxy on port 3000.
// Run: node mock-backend.js [port]   (default: 4001)

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.argv[2] ? parseInt(process.argv[2], 10) : 4001;

const sseClients = new Set();

function publishBackendEvent(type, payload = {}) {
  const event = {
    type,
    ts: Date.now(),
    backendPort: PORT,
    ...payload,
  };

  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try { client.write(frame); } catch (_) {}
  }
}

function attachInternalEventClient(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  sseClients.add(res);
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', ts: Date.now(), backendPort: PORT })}\n\n`);
  req.on('close', () => sseClients.delete(res));
}

const server = http.createServer((req, res) => {
  if (req.url === '/internal/events') {
    attachInternalEventClient(req, res);
    return;
  }

  const startedAt = Date.now();
  let body = '';

  req.on('data', chunk => {
    body += chunk;
  });

  req.on('end', () => {
    // Parse body if present
    let parsedBody = null;
    if (body) {
      try { parsedBody = JSON.parse(body); }
      catch (_) { parsedBody = body; }
    }

    // Pull out the proxy-injected headers — these PROVE the request came through the proxy
    const proxyHeaders = {
      'x-forwarded-for': req.headers['x-forwarded-for'] || null,
      'x-forwarded-host': req.headers['x-forwarded-host'] || null,
      'x-forwarded-proto': req.headers['x-forwarded-proto'] || null,
      'x-proxy-req-id': req.headers['x-proxy-req-id'] || null,
    };

    const arrivedViaProxy = !!req.headers['x-proxy-req-id'];

    publishBackendEvent('HTTP_INBOUND', {
      method: req.method,
      url: req.url,
      reqId: proxyHeaders['x-proxy-req-id'],
      arrivedViaProxy,
      bodyBytes: Buffer.byteLength(body || '', 'utf8'),
      clientIp: req.socket.remoteAddress || 'unknown',
    });

    console.log(`[MockBackend:${PORT}] ${req.method} ${req.url}`);
    console.log(`  via proxy : ${arrivedViaProxy}`);
    console.log(`  req-id    : ${proxyHeaders['x-proxy-req-id']}`);
    console.log(`  body      : ${body || '(empty)'}`);

    const responsePayload = {
      // ── What the backend received ──────────────────────────────
      backendPort: PORT,
      method: req.method,

      // url shows the STRIPPED path — proxy removed /api/v1 before forwarding
      urlSeenByBackend: req.url,

      // The body your client sent — traveled: client → proxy → here
      receivedBody: parsedBody,

      // ── Proxy evidence ─────────────────────────────────────────
      // These headers were injected BY the proxy. If you hit port 4001
      // directly (bypassing proxy), these will all be null.
      proxyEvidence: {
        arrivedViaProxy,
        ...proxyHeaders,
      },
    };

    const responseBody = JSON.stringify(responsePayload, null, 2);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(responseBody);

    publishBackendEvent('HTTP_RESPONDED', {
      method: req.method,
      url: req.url,
      reqId: proxyHeaders['x-proxy-req-id'],
      status: 200,
      durationMs: Date.now() - startedAt,
      responseBytes: Buffer.byteLength(responseBody, 'utf8'),
    });
  });
});

server.listen(PORT, () => {
  console.log(`\n[MockBackend] Running on port ${PORT}`);
  console.log(`  Direct URL (bypassed):  http://localhost:${PORT}`);
  console.log(`  Correct URL (via proxy): http://localhost:3000/api/v1`);
  console.log(`  Internal SSE stream    : http://localhost:${PORT}/internal/events\n`);
  publishBackendEvent('BACKEND_ONLINE', { url: `http://localhost:${PORT}` });
});

// ── Attach WebSocket Echo Server ──────────────────────────────────────────
const wss = new WebSocketServer({ server });
wss.on('connection', (ws, req) => {
  const connectionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const clientIp = req.socket.remoteAddress || 'unknown';
  let inMessages = 0;
  let outMessages = 0;

  console.log(`[MockBackend:WS] Client connected via ${req.url}`);
  publishBackendEvent('WS_CONNECTED', {
    connectionId,
    url: req.url,
    clientIp,
  });

  ws.on('message', (message, isBinary) => {
    const payload = isBinary ? message : message.toString();
    const bytes = Buffer.byteLength(message);
    inMessages += 1;

    console.log(`[MockBackend:WS] Received: ${isBinary ? '<binary>' : payload}`);
    publishBackendEvent('WS_MESSAGE_IN', {
      connectionId,
      bytes,
      isBinary: !!isBinary,
      preview: isBinary ? '<binary>' : payload.slice(0, 120),
    });

    const echo = isBinary ? message : `ECHO: ${payload}`;
    ws.send(echo);

    outMessages += 1;
    publishBackendEvent('WS_MESSAGE_OUT', {
      connectionId,
      bytes: Buffer.byteLength(isBinary ? message : Buffer.from(String(echo))),
      isBinary: !!isBinary,
      preview: isBinary ? '<binary>' : String(echo).slice(0, 120),
    });
  });

  ws.on('close', (code, reasonBuffer) => {
    const reason = reasonBuffer && reasonBuffer.length ? reasonBuffer.toString() : '';
    console.log('[MockBackend:WS] Client disconnected');
    publishBackendEvent('WS_CLOSED', {
      connectionId,
      inMessages,
      outMessages,
      closeCode: code,
      closeReason: reason,
    });
  });

  ws.on('error', (err) => {
    publishBackendEvent('WS_ERROR', {
      connectionId,
      error: err.message,
    });
  });
});
