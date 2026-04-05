const express   = require('express');
const path      = require('path');
const config    = require('./config.json');

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

const app = express();
app.use(express.json());

// ── Static UI ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── WAF (runs FIRST — before rate limiting and routing) ────────────────────
const wafMiddleware = buildWafMiddleware(config.security || {});
app.use(wafMiddleware);

// ── Rate Limiter (runs AFTER WAF, BEFORE auth/proxy) ──────────────────────
app.use(rateLimitMiddleware);

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

// ══════════════════════════════════════════════════════════════════════════════
//  REST — info / stats / management
// ══════════════════════════════════════════════════════════════════════════════

// Proxy config
app.get('/config-info', (req, res) => {
  res.json({
    proxyPort: config.proxy.port,
    routes: config.proxy.routes.map(r => ({
      path: r.path, target: r.target, auth: r.auth, stripPrefix: r.stripPrefix,
    })),
  });
});

// WAF config snapshot (public — no secrets)
app.get('/waf-config', (req, res) => {
  const sec = config.security || {};
  res.json({
    block_sql_injection: !!sec.block_sql_injection,
    block_xss:           !!sec.block_xss,
    scan_body:           sec.scan_body !== false,
    scan_query:          sec.scan_query !== false,
    scan_headers:        !!sec.scan_headers,
    blacklisted_ips:     sec.blacklisted_ips || [],
    sql_rules:  SQL_RULES.map(r => r.label),
    xss_rules:  XSS_RULES.map(r => r.label),
  });
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
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── Proxy router ───────────────────────────────────────────────────────────
app.use(buildRouter(config.proxy.routes));

// ── 404 fallback ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `No route matched for ${req.method} ${req.url}` });
});

// ── Boot ───────────────────────────────────────────────────────────────────
async function start() {
  try {
    await initDb();
    const port = config.proxy.port;
    app.listen(port, () => {
      console.log(`\n${'─'.repeat(56)}`);
      console.log(` Nexentia Proxy Engine`);
      console.log(`${'─'.repeat(56)}`);
      console.log(` UI          →  http://localhost:${port}`);
      console.log(` Rate Limits →  http://localhost:${port}/rate-limits.html`);
      console.log(` WAF         →  http://localhost:${port}/waf.html`);
      console.log(`${'─'.repeat(56)}`);

      console.log('\n[Proxy Routes]');
      config.proxy.routes.forEach(r =>
        console.log(`  ${r.path.padEnd(12)} → ${r.target}  auth:${r.auth}  strip:${r.stripPrefix}`),
      );

      console.log('\n[Rate Limits]');
      rateLimitRules.forEach(r =>
        console.log(`  ${r.method.padEnd(6)} ${r.name.padEnd(30)} ${r.limit}/${r.windowMs/1000}s`),
      );

      const sec = config.security || {};
      console.log('\n[WAF]');
      console.log(`  SQL Injection   : ${sec.block_sql_injection ? '✓ BLOCK' : '✗ off'}`);
      console.log(`  XSS             : ${sec.block_xss ? '✓ BLOCK' : '✗ off'}`);
      console.log(`  Blacklisted IPs : ${(sec.blacklisted_ips || []).length} entries`);
      console.log(`  Scan body       : ${sec.scan_body !== false ? 'yes' : 'no'}`);
      console.log(`  Scan query      : ${sec.scan_query !== false ? 'yes' : 'no'}`);
      console.log(`${'─'.repeat(56)}\n`);
    });
  } catch (err) {
    console.error('[Startup] Failed:', err.message);
    process.exit(1);
  }
}

start();
