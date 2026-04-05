const http = require('http');
const https = require('https');
const { URL } = require('url');
const { EventEmitter } = require('events');
const { verifyToken, isTokenRevoked } = require('./auth');
const { getClientIp, isBlacklisted, markBlockedRequest } = require('./ipTracker');

const wsEvents = new EventEmitter();

function emit(type, payload) {
  wsEvents.emit(type, { ts: Date.now(), ...payload });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  const parsedUrl = new URL(req.url, 'http://proxy.local');
  return parsedUrl.searchParams.get('token') || parsedUrl.searchParams.get('access_token');
}

function findMatchingRoute(routes, url) {
  const sorted = [...(routes || [])].sort((a, b) => b.path.length - a.path.length);
  return sorted.find(route => url.startsWith(route.path)) || null;
}

function normalizeWebSocketTarget(target) {
  const targetUrl = new URL(target);

  if (targetUrl.protocol === 'http:') targetUrl.protocol = 'ws:';
  if (targetUrl.protocol === 'https:') targetUrl.protocol = 'wss:';

  if (targetUrl.protocol !== 'ws:' && targetUrl.protocol !== 'wss:') {
    throw new Error(`Unsupported websocket target protocol: ${targetUrl.protocol}`);
  }

  return targetUrl;
}

async function handleUpgrade(req, clientSocket, head, config) {
  const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const clientIp = getClientIp(req, clientSocket);
  const reqUrl = req.url;

  if (isBlacklisted(clientIp)) {
    markBlockedRequest(clientIp, 'IP_BLACKLIST');
    emit('ws:rejected', {
      reqId,
      reason: 'IP is blacklisted',
      url: reqUrl,
      status: 403,
      clientIp,
    });
    clientSocket.write('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nIP blacklisted');
    clientSocket.destroy();
    return;
  }

  const route = findMatchingRoute(config.proxy.routes, reqUrl);
  if (!route) {
    emit('ws:rejected', {
      reqId,
      reason: 'No route matched',
      url: reqUrl,
      status: 404,
      clientIp,
    });
    clientSocket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    clientSocket.destroy();
    return;
  }

  if (route.auth) {
    const token = extractToken(req);

    if (!token) {
      emit('ws:rejected', {
        reqId,
        reason: 'Missing token for auth-protected websocket route',
        url: reqUrl,
        route: route.path,
        status: 401,
        clientIp,
      });
      clientSocket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\n\r\nMissing token');
      clientSocket.destroy();
      return;
    }

    try {
      verifyToken(token);
      const revoked = await isTokenRevoked(token);
      if (revoked) {
        emit('ws:rejected', {
          reqId,
          reason: 'Token expired or revoked',
          url: reqUrl,
          route: route.path,
          status: 401,
          clientIp,
        });
        clientSocket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\n\r\nToken expired or revoked');
        clientSocket.destroy();
        return;
      }
    } catch (err) {
      emit('ws:rejected', {
        reqId,
        reason: 'Invalid token',
        url: reqUrl,
        route: route.path,
        status: 401,
        clientIp,
      });
      clientSocket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\n\r\nInvalid token');
      clientSocket.destroy();
      return;
    }
  }

  let targetUrl;
  try {
    targetUrl = normalizeWebSocketTarget(route.target);
  } catch (err) {
    emit('ws:error', {
      reqId,
      url: reqUrl,
      route: route.path,
      error: err.message,
      clientIp,
    });
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    clientSocket.destroy();
    return;
  }

  const parsedReqUrl = new URL(reqUrl, 'http://proxy.local');
  parsedReqUrl.searchParams.delete('token');
  parsedReqUrl.searchParams.delete('access_token');

  let forwardPath = parsedReqUrl.pathname;
  if (route.stripPrefix) {
    const pattern = new RegExp(`^${escapeRegExp(route.path)}`);
    forwardPath = parsedReqUrl.pathname.replace(pattern, '') || '/';
  }

  const search = parsedReqUrl.searchParams.toString();
  const forwardedPath = search ? `${forwardPath}?${search}` : forwardPath;

  const outHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    outHeaders[k] = v;
  }

  outHeaders.host = targetUrl.host;
  outHeaders['x-forwarded-for'] = clientIp;
  outHeaders['x-forwarded-host'] = req.headers.host || targetUrl.host;
  outHeaders['x-forwarded-proto'] = req.socket.encrypted ? 'https' : 'http';
  outHeaders['x-proxy-req-id'] = reqId;

  const isSecure = targetUrl.protocol === 'wss:';
  const requestModule = isSecure ? https : http;
  const targetPort = parseInt(targetUrl.port, 10) || (isSecure ? 443 : 80);

  const options = {
    hostname: targetUrl.hostname,
    port: targetPort,
    path: forwardedPath,
    method: 'GET',
    headers: outHeaders,
    agent: false,
  };

  emit('ws:opening', {
    reqId,
    clientIp,
    url: reqUrl,
    route: route.path,
    target: `${targetUrl.hostname}:${targetPort}`,
    targetProtocol: targetUrl.protocol.replace(':', ''),
    forwardedPath,
    authRequired: !!route.auth,
  });

  const proxyReq = requestModule.request(options);

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    const statusLine = `HTTP/1.1 ${proxyRes.statusCode || 101} ${proxyRes.statusMessage || 'Switching Protocols'}`;
    const headers = [statusLine];

    for (const [k, v] of Object.entries(proxyRes.headers)) {
      if (Array.isArray(v)) {
        v.forEach(val => headers.push(`${k}: ${val}`));
      } else if (v != null) {
        headers.push(`${k}: ${v}`);
      }
    }
    headers.push('', '');
    clientSocket.write(headers.join('\r\n'));

    if (proxyHead && proxyHead.length > 0) {
      clientSocket.write(proxyHead);
    }
    if (head && head.length > 0) {
      proxySocket.write(head);
    }

    const openedAt = Date.now();
    let upChunks = 0;
    let downChunks = 0;
    let upBytes = 0;
    let downBytes = 0;
    let closed = false;

    emit('ws:opened', {
      reqId,
      clientIp,
      url: reqUrl,
      route: route.path,
      target: `${targetUrl.hostname}:${targetPort}`,
      targetProtocol: targetUrl.protocol.replace(':', ''),
      forwardedPath,
    });

    clientSocket.on('data', (chunk) => {
      upChunks += 1;
      upBytes += chunk.length;
      emit('ws:message', {
        reqId,
        direction: 'up',
        bytes: chunk.length,
        totalBytesUp: upBytes,
        totalChunksUp: upChunks,
      });
    });

    proxySocket.on('data', (chunk) => {
      downChunks += 1;
      downBytes += chunk.length;
      emit('ws:message', {
        reqId,
        direction: 'down',
        bytes: chunk.length,
        totalBytesDown: downBytes,
        totalChunksDown: downChunks,
      });
    });

    clientSocket.pipe(proxySocket);
    proxySocket.pipe(clientSocket);

    const closeBoth = (why) => {
      if (closed) return;
      closed = true;

      if (!clientSocket.destroyed) clientSocket.destroy();
      if (!proxySocket.destroyed) proxySocket.destroy();

      emit('ws:closed', {
        reqId,
        reason: why,
        upChunks,
        downChunks,
        upBytes,
        downBytes,
        durationMs: Date.now() - openedAt,
      });
    };

    clientSocket.on('close', () => closeBoth('client-closed'));
    proxySocket.on('close', () => closeBoth('backend-closed'));
    clientSocket.on('error', (err) => {
      emit('ws:error', { reqId, error: err.message, where: 'client-socket' });
      closeBoth('client-error');
    });
    proxySocket.on('error', (err) => {
      emit('ws:error', { reqId, error: err.message, where: 'backend-socket' });
      closeBoth('backend-error');
    });
  });

  proxyReq.on('response', (proxyRes) => {
    const statusCode = proxyRes.statusCode || 502;
    const statusMessage = proxyRes.statusMessage || 'Upgrade Failed';

    emit('ws:rejected', {
      reqId,
      route: route.path,
      status: statusCode,
      reason: statusMessage,
      url: reqUrl,
      target: `${targetUrl.hostname}:${targetPort}`,
      forwardedPath,
      clientIp,
    });

    const headers = [`HTTP/1.1 ${statusCode} ${statusMessage}`];
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      if (Array.isArray(v)) {
        v.forEach(val => headers.push(`${k}: ${val}`));
      } else if (v != null) {
        headers.push(`${k}: ${v}`);
      }
    }
    headers.push('', '');
    clientSocket.write(headers.join('\r\n'));

    proxyRes.pipe(clientSocket);
    proxyRes.on('end', () => {
      if (!clientSocket.destroyed) clientSocket.end();
    });
  });

  proxyReq.on('error', (err) => {
    emit('ws:error', {
      reqId,
      route: route.path,
      url: reqUrl,
      target: `${targetUrl.hostname}:${targetPort}`,
      error: err.message,
      clientIp,
    });
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    clientSocket.destroy();
  });

  proxyReq.end();
}

module.exports = {
  handleUpgrade,
  wsEvents,
};
