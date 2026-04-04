// Hidden backend server — should never be accessed directly by clients.
// All traffic must come through the proxy on port 3000.
// Run: node mock-backend.js [port]   (default: 4001)

const http = require('http');

const PORT = process.argv[2] ? parseInt(process.argv[2]) : 4001;

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {

    // Parse body if present
    let parsedBody = null;
    if (body) {
      try { parsedBody = JSON.parse(body); }
      catch (_) { parsedBody = body; }
    }

    // Pull out the proxy-injected headers — these PROVE the request came through the proxy
    const proxyHeaders = {
      'x-forwarded-for':   req.headers['x-forwarded-for']   || null,
      'x-forwarded-host':  req.headers['x-forwarded-host']  || null,
      'x-forwarded-proto': req.headers['x-forwarded-proto'] || null,
      'x-proxy-req-id':    req.headers['x-proxy-req-id']    || null,
    };

    const arrivedViaProxy = !!req.headers['x-proxy-req-id'];

    console.log(`[MockBackend:${PORT}] ${req.method} ${req.url}`);
    console.log(`  via proxy : ${arrivedViaProxy}`);
    console.log(`  req-id    : ${proxyHeaders['x-proxy-req-id']}`);
    console.log(`  body      : ${body || '(empty)'}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
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
        ...proxyHeaders
      }
    }, null, 2));
  });
});

server.listen(PORT, () => {
  console.log(`\n[MockBackend] Running on port ${PORT}`);
  console.log(`  Direct URL (bypassed):  http://localhost:${PORT}`);
  console.log(`  Correct URL (via proxy): http://localhost:3000/api/v1\n`);
});
