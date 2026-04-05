const http = require('http');
const https = require('https');
const { URL } = require('url');
const { proxyEvents } = require('./proxyLogger');

// Hop-by-hop headers must never be forwarded through a proxy.
// They belong to a single TCP connection and have no meaning on the next hop.
// 'expect' is also stripped — forwarding 100-continue causes a handshake
// delay that makes POST requests appear to hang.
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'te',
  'upgrade', 'trailer', 'proxy-authorization', 'proxy-connection',
  'expect',
]);

function emit(step, data) {
  proxyEvents.emit('proxy:step', { ts: Date.now(), step, ...data });
}

function defaultPortForProtocol(protocol) {
  return protocol === 'https:' ? '443' : '80';
}

function rewriteUpstreamLocation(locationValue, targetUrl, routePath, stripPrefix) {
  if (!locationValue) return locationValue;

  try {
    const targetOrigin = `${targetUrl.protocol}//${targetUrl.host}`;
    const parsedLocation = new URL(locationValue, targetOrigin);
    const rawHasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(locationValue);

    const targetPort = targetUrl.port || defaultPortForProtocol(targetUrl.protocol);
    const locationPort = parsedLocation.port || defaultPortForProtocol(parsedLocation.protocol);

    const isSameTarget =
      parsedLocation.protocol === targetUrl.protocol &&
      parsedLocation.hostname === targetUrl.hostname &&
      locationPort === targetPort;

    if (rawHasScheme && !isSameTarget) {
      return locationValue;
    }

    let rewrittenPath = `${parsedLocation.pathname}${parsedLocation.search}${parsedLocation.hash}`;

    if (stripPrefix && routePath && !rewrittenPath.startsWith(routePath)) {
      rewrittenPath = `${routePath}${rewrittenPath.startsWith('/') ? '' : '/'}${rewrittenPath}`;
      rewrittenPath = rewrittenPath.replace(/\/{2,}/g, '/');
    }

    return rewrittenPath;
  } catch (_) {
    return locationValue;
  }
}

function forwardRequest(req, res, target, stripPrefix, routePath) {
  return new Promise((resolve, reject) => {
    const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const senderIp = req.clientIp || req.socket.remoteAddress || '127.0.0.1';

    // Strip route prefix before forwarding
    let urlPath = req.url;
    if (stripPrefix) {
      urlPath = req.url.replace(new RegExp(`^${routePath}`), '') || '/';
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch (err) {
      emit('PROXY_ERROR', { reqId, error: `Invalid target URL: ${target}` });
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad Gateway', detail: `Invalid target URL: ${target}` }));
      }
      reject(err);
      return;
    }

    const isSecureTarget = targetUrl.protocol === 'https:';
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      emit('PROXY_ERROR', { reqId, error: `Unsupported target protocol: ${targetUrl.protocol}` });
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad Gateway', detail: `Unsupported target protocol: ${targetUrl.protocol}` }));
      }
      reject(new Error(`Unsupported target protocol: ${targetUrl.protocol}`));
      return;
    }

    const requestModule = isSecureTarget ? https : http;
    const targetPort = parseInt(targetUrl.port, 10) || (isSecureTarget ? 443 : 80);

    // Copy only end-to-end headers — drop every hop-by-hop header
    const outHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) outHeaders[k] = v;
    }
    outHeaders['host']              = targetUrl.host;
    outHeaders['x-forwarded-for']   = senderIp;
    outHeaders['x-forwarded-host']  = req.headers.host || targetUrl.host;
    outHeaders['x-forwarded-proto'] = req.socket.encrypted ? 'https' : 'http';
    outHeaders['x-proxy-req-id']    = reqId;

    // Prepare body buffer (express.json already parsed the stream for us)
    let bodyBuffer;
    if (req.body !== undefined && req.method !== 'GET' && req.method !== 'HEAD') {
      bodyBuffer = Buffer.from(JSON.stringify(req.body), 'utf8');
      outHeaders['content-type']   = 'application/json';
      outHeaders['content-length'] = String(bodyBuffer.length);
    }

    const options = {
      hostname: targetUrl.hostname,
      port:     targetPort,
      path:     urlPath,
      method:   req.method,
      headers:  outHeaders,
      // agent:false creates a fresh socket per request instead of reusing
      // pooled connections. Without this, Node.js reuses a connection that
      // the backend already closed, causing POST requests to hang until the
      // stale socket times out.
      agent:   false,
      timeout: 30000,
    };

    // ── Step 1 ────────────────────────────────────────────────────────
    emit('CLIENT_TO_PROXY', {
      reqId,
      method:   req.method,
      url:      req.url,
      clientIp: senderIp,
    });

    // ── Step 2 ────────────────────────────────────────────────────────
    emit('PROXY_TO_BACKEND', {
      reqId,
      method:        req.method,
      forwardedPath: urlPath,
      target:        `${targetUrl.hostname}:${targetPort}`,
    });

    const proxyReq = requestModule.request(options, (proxyRes) => {
      const chunks = [];
      proxyRes.on('data', chunk => chunks.push(chunk));

      proxyRes.on('end', () => {
        const body = Buffer.concat(chunks);

        // ── Step 3 ──────────────────────────────────────────────────
        emit('BACKEND_TO_PROXY', {
          reqId,
          status:        proxyRes.statusCode,
          contentLength: body.length,
        });

        // Clean response headers — strip hop-by-hop, set definitive content-length
        const resHeaders = {};
        for (const [k, v] of Object.entries(proxyRes.headers)) {
          if (!HOP_BY_HOP.has(k.toLowerCase())) resHeaders[k] = v;
        }

        const originalLocation = resHeaders['location'];
        const rewrittenLocation = rewriteUpstreamLocation(originalLocation, targetUrl, routePath, stripPrefix);
        if (rewrittenLocation && rewrittenLocation !== originalLocation) {
          resHeaders['location'] = rewrittenLocation;
          const statusCode = proxyRes.statusCode || 0;
          if ([301, 302, 307, 308].includes(statusCode)) {
            resHeaders['cache-control'] = 'no-store';
          }
        }

        resHeaders['content-length'] = String(body.length);

        resHeaders['access-control-allow-origin']      = req.headers['origin'] || '*';
        resHeaders['access-control-allow-methods']     = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
        resHeaders['access-control-allow-headers']     = 'Content-Type, Authorization, X-Requested-With';
        resHeaders['access-control-allow-credentials'] = 'true';

        res.writeHead(proxyRes.statusCode, resHeaders);
        res.end(body);

        // ── Step 4 ──────────────────────────────────────────────────
        emit('PROXY_TO_CLIENT', {
          reqId,
          status: proxyRes.statusCode,
        });

        resolve();
      });

      proxyRes.on('error', err => {
        emit('PROXY_ERROR', { reqId, error: err.message });
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Backend stream error', detail: err.message }));
        }
        reject(err);
      });
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      emit('PROXY_ERROR', { reqId, error: 'Backend timed out after 30s' });
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Gateway Timeout', detail: 'Backend did not respond within 30s' }));
      }
      reject(new Error('Backend timeout'));
    });

    proxyReq.on('error', err => {
      emit('PROXY_ERROR', { reqId, error: err.message });
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad Gateway', detail: err.message }));
      }
      reject(err);
    });

    // Send the body (or just end the request for GET/HEAD)
    if (bodyBuffer) {
      // Write + end in one call — avoids a potential flush timing issue
      // that can occur with separate .write() + .end() calls
      proxyReq.end(bodyBuffer);
    } else {
      proxyReq.end();
    }
  });
}

module.exports = { forwardRequest };
