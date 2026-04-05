require('dotenv').config();

const express   = require('express');
const path      = require('path');
const { runtimeConfig, collectRuntimeWarnings, collectRuntimeErrors } = require('./src/runtimeConfig');

const { init: initDb }                    = require('./src/db');
const { buildRouter }                     = require('./src/router');
const authRoutes                          = require('./src/authRoutes');
const { addClient }                       = require('./src/proxyLogger');
const { rateLimitMiddleware, rlEvents }   = require('./src/middleware/rateLimitMiddleware');
const rateLimitRules                      = require('./src/rateLimitRules');
const rateLimiter                         = require('./src/rateLimiter');
const { buildWafMiddleware }              = require('./src/middleware/wafMiddleware');
const { wafEvents }                       = require('./src/wafEvents');
const { SQL_RULES, XSS_RULES }            = require('./src/waf');
const aiAnalyzer                          = require('./src/aiAnalyzer');
const { handleUpgrade, wsEvents }         = require('./src/wsProxy');
const { backendBridgeEvents, startBackendBridge, stopBackendBridge } = require('./src/backendBridge');
const {
  ipEvents,
  trackRequest,
  getClientIp,
  addToBlacklist,
  removeFromBlacklist,
  getBlacklistSnapshot,
  getTrackedIpsSnapshot,
} = require('./src/ipTracker');

const app = express();
app.disable('x-powered-by');

if (runtimeConfig.http?.trustProxy !== false) {
  app.set('trust proxy', runtimeConfig.http.trustProxy);
}

app.use(express.json({ limit: runtimeConfig.http?.jsonBodyLimit || '1mb' }));

// ── Sender-IP tracking (applies to all requests) ───────────────────────────
app.use((req, res, next) => {
  const senderIp = trackRequest(req);
  req.clientIp = senderIp;
  res.setHeader('X-Sender-IP', senderIp);
  next();
});

// ── Static UI ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers['origin'] || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.sendStatus(204);
});

// ── WAF (runs FIRST — before rate limiting and routing) ────────────────────
const wafMiddleware = buildWafMiddleware(runtimeConfig.security || {});
app.use(wafMiddleware);

// ── Rate Limiter (runs AFTER WAF, BEFORE auth/proxy) ──────────────────────
app.use(rateLimitMiddleware);

aiAnalyzer.init(process.env.GEMINI_API_KEY);
aiAnalyzer.start(rlEvents);

// ══════════════════════════════════════════════════════════════════════════════
//  SSE streams
// ══════════════════════════════════════════════════════════════════════════════

// Proxy flow events
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ step: 'CONNECTED', ts: Date.now() })}\n\n`);
  addClient(res);
});

// Rate-limit events
app.get('/rl-events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', ts: Date.now() })}\n\n`);

  const onBlocked = d => res.write(`data: ${JSON.stringify({ type: 'BLOCKED', ...d })}\n\n`);
  const onTick    = d => res.write(`data: ${JSON.stringify({ type: 'TICK',    ...d })}\n\n`);
  rlEvents.on('rl:blocked', onBlocked);
  rlEvents.on('rl:tick',    onTick);
  req.on('close', () => { rlEvents.off('rl:blocked', onBlocked); rlEvents.off('rl:tick', onTick); });
});

// WAF events
app.get('/waf-events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', ts: Date.now() })}\n\n`);

  const onBlocked = d => res.write(`data: ${JSON.stringify({ type: 'BLOCKED', ...d })}\n\n`);
  const onAllowed = d => res.write(`data: ${JSON.stringify({ type: 'ALLOWED', ...d })}\n\n`);
  wafEvents.on('waf:blocked', onBlocked);
  wafEvents.on('waf:allowed', onAllowed);
  req.on('close', () => { wafEvents.off('waf:blocked', onBlocked); wafEvents.off('waf:allowed', onAllowed); });
});

// IP tracking / blacklist events
app.get('/ip-events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', ts: Date.now() })}\n\n`);

  const onIpEvent = d => res.write(`data: ${JSON.stringify(d)}\n\n`);
  ipEvents.on('ip:event', onIpEvent);

  req.on('close', () => {
    ipEvents.off('ip:event', onIpEvent);
  });
});

// AI Analyzer — SSE stream
app.get('/ai-events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ event: 'CONNECTED', ts: Date.now(), geminiEnabled: !!process.env.GEMINI_API_KEY })}\n\n`);

  const onIncoming = d => res.write(`data: ${JSON.stringify({ event: 'INCOMING', ...d })}\n\n`);
  const onAnalysis = d => res.write(`data: ${JSON.stringify({ event: 'ANALYSIS', ...d })}\n\n`);
  aiAnalyzer.aiEvents.on('ai:incoming', onIncoming);
  aiAnalyzer.aiEvents.on('ai:analysis', onAnalysis);
  req.on('close', () => {
    aiAnalyzer.aiEvents.off('ai:incoming', onIncoming);
    aiAnalyzer.aiEvents.off('ai:analysis', onAnalysis);
  });
});

// AI debug — visit /ai-test in browser to diagnose issues
app.get('/ai-test', async (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.json({ step: 'KEY', status: 'MISSING', fix: 'Add GEMINI_API_KEY=... to proto-1/.env and restart' });
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const m = new GoogleGenerativeAI(key).getGenerativeModel({ model: 'gemini-2.0-flash' });
    const r = await m.generateContent('Reply with just: {"ok":true}');
    const text = r.response.text().trim();
    res.json({ step: 'GEMINI_CALL', status: 'OK', response: text, keyPrefix: key.slice(0,8) + '...' });
  } catch (err) {
    res.json({ step: 'GEMINI_CALL', status: 'FAILED', error: err.message, keyPrefix: key.slice(0,8) + '...' });
  }
});

// AI session summary
app.post('/ai-summary', async (req, res) => {
  try {
    const summary = await aiAnalyzer.generateSessionSummary();
    res.json({ ok: true, ts: Date.now(), summary });
  } catch (err) {
    console.error('[/ai-summary] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// AI threat buffer snapshot
app.get('/ai-threats', (req, res) => {
  res.json({
    ts:      Date.now(),
    count:   aiAnalyzer.threatBuffer.length,
    threats: aiAnalyzer.threatBuffer.slice(-50).reverse(),
  });
});

// WebSocket proxy flows
app.get('/ws-events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', ts: Date.now() })}\n\n`);

  const onOpening  = d => res.write(`data: ${JSON.stringify({ type: 'OPENING', ...d })}\n\n`);
  const onOpened   = d => res.write(`data: ${JSON.stringify({ type: 'OPENED', ...d })}\n\n`);
  const onMessage  = d => res.write(`data: ${JSON.stringify({ type: 'MESSAGE', ...d })}\n\n`);
  const onClosed   = d => res.write(`data: ${JSON.stringify({ type: 'CLOSED', ...d })}\n\n`);
  const onRejected = d => res.write(`data: ${JSON.stringify({ type: 'REJECTED', ...d })}\n\n`);
  const onError    = d => res.write(`data: ${JSON.stringify({ type: 'ERROR', ...d })}\n\n`);

  wsEvents.on('ws:opening', onOpening);
  wsEvents.on('ws:opened', onOpened);
  wsEvents.on('ws:message', onMessage);
  wsEvents.on('ws:closed', onClosed);
  wsEvents.on('ws:rejected', onRejected);
  wsEvents.on('ws:error', onError);

  req.on('close', () => {
    wsEvents.off('ws:opening', onOpening);
    wsEvents.off('ws:opened', onOpened);
    wsEvents.off('ws:message', onMessage);
    wsEvents.off('ws:closed', onClosed);
    wsEvents.off('ws:rejected', onRejected);
    wsEvents.off('ws:error', onError);
  });
});

// Main server bridge events (proxy subscribes to backend SSE and republishes)
app.get('/backend-events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', ts: Date.now() })}\n\n`);

  const onBridgeEvent = d => res.write(`data: ${JSON.stringify(d)}\n\n`);
  backendBridgeEvents.on('bridge:event', onBridgeEvent);

  req.on('close', () => {
    backendBridgeEvents.off('bridge:event', onBridgeEvent);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  REST — info / stats / management
// ══════════════════════════════════════════════════════════════════════════════

// Proxy config
app.get('/config-info', (req, res) => {
  res.json({
    proxyPort: runtimeConfig.proxy.port,
    routes: runtimeConfig.proxy.routes.map(r => ({
      path: r.path, target: r.target, auth: r.auth, stripPrefix: r.stripPrefix,
    })),
  });
});

// WAF config snapshot (public — no secrets)
app.get('/waf-config', (req, res) => {
  const sec = runtimeConfig.security || {};
  const runtimeBlacklist = getBlacklistSnapshot();

  res.json({
    block_sql_injection: !!sec.block_sql_injection,
    block_xss:           !!sec.block_xss,
    scan_body:           sec.scan_body !== false,
    scan_query:          sec.scan_query !== false,
    scan_headers:        !!sec.scan_headers,
    blacklisted_ips:     runtimeBlacklist.map(entry => entry.ip),
    blacklisted_details: runtimeBlacklist,
    sql_rules:  SQL_RULES.map(r => r.label),
    xss_rules:  XSS_RULES.map(r => r.label),
  });
});

// IP tracking snapshot
app.get('/ip-tracking', (req, res) => {
  const requestedLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 100;

  res.json({
    ts: Date.now(),
    requesterIp: req.clientIp || getClientIp(req),
    trackedIps: getTrackedIpsSnapshot(limit),
    blacklist: getBlacklistSnapshot(),
  });
});

// Runtime blacklist controls
app.get('/ip-blacklist', (req, res) => {
  res.json({
    ts: Date.now(),
    blacklist: getBlacklistSnapshot(),
  });
});

app.post('/ip-blacklist', (req, res) => {
  const { ip, reason } = req.body || {};
  if (!ip) {
    return res.status(400).json({ error: 'ip is required' });
  }

  try {
    const added = addToBlacklist(ip, reason || 'Blocked from dashboard', 'api');
    return res.status(201).json({ ok: true, added });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.delete('/ip-blacklist', (req, res) => {
  const { ip } = req.body || {};
  if (!ip) {
    return res.status(400).json({ error: 'ip is required' });
  }

  const removed = removeFromBlacklist(ip, 'api');
  if (!removed) {
    return res.status(404).json({ error: `ip ${ip} not found in blacklist` });
  }

  return res.json({ ok: true, removed: ip });
});

// Rate-limit stats
app.get('/rl-stats', (req, res) => {
  const snapshot = rateLimiter.snapshot();
  const now      = Date.now();
  const perRule  = rateLimitRules.map(rule => {
    const ruleSnap = snapshot
      .filter(s => s.key.startsWith(rule.id + ':'))
      .map(s => {
        const active = s.timestamps.filter(ts => ts > now - rule.windowMs);
        return {
          ip:        s.key.slice(rule.id.length + 1),
          count:     active.length,
          remaining: Math.max(0, rule.limit - active.length),
          resetAt:   active.length > 0 ? active[0] + rule.windowMs : null,
          blocked:   active.length >= rule.limit,
        };
      })
      .filter(x => x.count > 0)
      .sort((a, b) => b.count - a.count);

    return { ...rule, pathPattern: rule.pathPattern.toString(), activeIps: ruleSnap };
  });
  res.json({ ts: now, rules: perRule });
});

// Rate-limit flush
app.post('/rl-flush', (req, res) => {
  const { key } = req.body || {};
  rateLimiter.flush(key || null);
  res.json({ ok: true, flushed: key || 'ALL' });
});

// ── Auth endpoints ─────────────────────────────────────────────────────────
app.use('/auth', authRoutes);

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok',
  time: new Date().toISOString(),
  requesterIp: req.clientIp || getClientIp(req),
}));

// ── Proxy router ───────────────────────────────────────────────────────────
app.use(buildRouter(runtimeConfig.proxy.routes));

// ── 404 fallback ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `No route matched for ${req.method} ${req.url}` });
});

// ── Boot ───────────────────────────────────────────────────────────────────
async function start() {
  try {
    const runtimeErrors = collectRuntimeErrors(runtimeConfig);
    if (runtimeErrors.length > 0) {
      runtimeErrors.forEach(error => console.error(`[Config Error] ${error}`));
      throw new Error('Runtime configuration validation failed.');
    }

    const runtimeWarnings = collectRuntimeWarnings(runtimeConfig);
    runtimeWarnings.forEach(warning => console.warn(`[Config] ${warning}`));

    const skipDbInit = runtimeConfig.env?.skipDbInit === true;
    if (skipDbInit) {
      console.warn('[DB] SKIP_DB_INIT=true. Proxy started without DB schema initialization.');
    } else {
      await initDb();
    }

    const port = runtimeConfig.proxy.port;
    const server = app.listen(port, () => {
      console.log(`\n${'─'.repeat(56)}`);
      console.log(` Nexentia Proxy Engine`);
      console.log(`${'─'.repeat(56)}`);
      console.log(` UI          →  http://localhost:${port}`);
      console.log(` Rate Limits →  http://localhost:${port}/rate-limits.html`);
      console.log(` WAF         →  http://localhost:${port}/waf.html`);
      console.log(` AI Analyzer →  http://localhost:${port}/ai-analyzer.html`);
      console.log(` WebSockets  →  http://localhost:${port}/websocket.html`);
      console.log(`${'─'.repeat(56)}`);

      console.log('\n[Proxy Routes]');
      runtimeConfig.proxy.routes.forEach(r =>
        console.log(`  ${r.path.padEnd(12)} → ${r.target}  auth:${r.auth}  strip:${r.stripPrefix}`),
      );

      console.log('\n[Rate Limits]');
      rateLimitRules.forEach(r =>
        console.log(`  ${r.method.padEnd(6)} ${r.name.padEnd(30)} ${r.limit}/${r.windowMs/1000}s`),
      );

      const sec = runtimeConfig.security || {};
      console.log('\n[WAF]');
      console.log(`  SQL Injection   : ${sec.block_sql_injection ? '✓ BLOCK' : '✗ off'}`);
      console.log(`  XSS             : ${sec.block_xss ? '✓ BLOCK' : '✗ off'}`);
      console.log(`  Blacklisted IPs : ${(sec.blacklisted_ips || []).length} entries`);
      console.log(`  Scan body       : ${sec.scan_body !== false ? 'yes' : 'no'}`);
      console.log(`  Scan query      : ${sec.scan_query !== false ? 'yes' : 'no'}`);

      const mainBackendTarget = runtimeConfig.server?.backend_url || runtimeConfig.proxy.routes[0]?.target;
      if (mainBackendTarget) {
        const base = mainBackendTarget.replace(/\/+$/, '');
        console.log('\n[SSE Bridge]');
        console.log(`  Proxy listens   : http://localhost:${port}/backend-events`);
        console.log(`  Main server SSE : ${base}/internal/events`);
      }
      console.log(`${'─'.repeat(56)}\n`);

      startBackendBridge(mainBackendTarget);
    });

    // ── Bind WebSocket Upgrades ──────────────────────────────────────────────
    server.on('upgrade', (req, socket, head) => {
      // Proxy websocket connections using the main config targets
      handleUpgrade(req, socket, head, runtimeConfig);
    });

    server.on('close', () => {
      stopBackendBridge();
    });

    process.once('SIGINT', () => stopBackendBridge());
    process.once('SIGTERM', () => stopBackendBridge());

  } catch (err) {
    console.error('[Startup] Failed:', err.message);
    process.exit(1);
  }
}

start();
