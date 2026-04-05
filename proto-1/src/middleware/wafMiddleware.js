/**
 * WAF Middleware
 * ─────────────────────────────────────────────────────────────────────────────
 * Three-stage gate — runs BEFORE rate limiting and proxy routing:
 *
 *   Stage 1 — IP Blacklist
 *     Instant 403 for any IP in config.security.blacklisted_ips.
 *     Zero payload inspection cost.
 *
 *   Stage 2 — Query String Scan  (if config.security.scan_query)
 *     Flattens all URL query parameters and scans for SQLi / XSS.
 *
 *   Stage 3 — Request Body Scan  (if config.security.scan_body)
 *     Flattens the already-parsed JSON body (req.body from express.json)
 *     and scans every leaf value for SQLi / XSS.
 *
 * On any hit: emit a 'waf:blocked' event and return 403/400 immediately.
 * Clean requests: emit 'waf:allowed' and call next().
 */

const { URL }               = require('url');
const { wafEvents }         = require('../wafEvents');
const { flattenValues, scanPairs } = require('../waf');

/**
 * Extract the real client IP.
 * Trusts X-Forwarded-For only for the first hop (proxy set it).
 */
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || '127.0.0.1';
}

/**
 * Parse query-string values from req.url into { field, value } pairs.
 * Uses the built-in URL parser — no dependency on qs.
 */
function queryPairs(rawUrl) {
  try {
    const u = new URL(rawUrl, 'http://x');
    const pairs = [];
    for (const [k, v] of u.searchParams.entries()) {
      pairs.push({ field: `query.${k}`, value: v });
    }
    return pairs;
  } catch (_) {
    return [];
  }
}

/**
 * Build the WAF middleware bound to a specific security config object.
 * @param {{ block_sql_injection, block_xss, scan_body, scan_query, blacklisted_ips }} secCfg
 */
function buildWafMiddleware(secCfg) {
  // Normalise blacklist to a Set of lowercased strings for O(1) lookup
  const blacklist = new Set(
    (secCfg.blacklisted_ips || []).map(ip => ip.trim().toLowerCase()),
  );

  return function wafMiddleware(req, res, next) {
    const ip      = clientIp(req);
    const ipLower = ip.toLowerCase();

    // ── Stage 1: IP Blacklist ──────────────────────────────────────────────
    if (blacklist.has(ipLower)) {
      const evt = {
        ts:      Date.now(),
        type:    'IP_BLACKLIST',
        ip,
        method:  req.method,
        url:     req.url,
        field:   'ip',
        rule:    'Blacklisted IP address',
        payload: ip,
      };
      wafEvents.emit('waf:blocked', evt);
      console.warn(`[WAF] 403 IP_BLACKLIST  ${ip}  ${req.method} ${req.url}`);
      return res.status(403).json({
        error:  'Forbidden',
        reason: 'Your IP address has been blacklisted.',
        ip,
      });
    }

    // ── Stage 2: Query String Scan ─────────────────────────────────────────
    if (secCfg.scan_query !== false) {
      const qPairs = queryPairs(req.url);
      const hit    = scanPairs(qPairs, secCfg);
      if (hit) {
        const evt = { ts: Date.now(), ip, method: req.method, url: req.url, ...hit };
        wafEvents.emit('waf:blocked', evt);
        console.warn(`[WAF] 400 ${hit.type}  ${ip}  field=${hit.field}  rule="${hit.rule}"`);
        return res.status(400).json({
          error:   'Bad Request',
          reason:  `Malicious payload detected (${hit.type}).`,
          type:    hit.type,
          field:   hit.field,
          blocked: hit.rule,
        });
      }
    }

    // ── Stage 3: Body Scan ────────────────────────────────────────────────
    if (secCfg.scan_body !== false && req.body !== undefined) {
      const bPairs = flattenValues(req.body).map(p => ({
        field: `body.${p.field}`,
        value: p.value,
      }));
      const hit = scanPairs(bPairs, secCfg);
      if (hit) {
        const evt = { ts: Date.now(), ip, method: req.method, url: req.url, ...hit };
        wafEvents.emit('waf:blocked', evt);
        console.warn(`[WAF] 400 ${hit.type}  ${ip}  field=${hit.field}  rule="${hit.rule}"`);
        return res.status(400).json({
          error:   'Bad Request',
          reason:  `Malicious payload detected (${hit.type}).`,
          type:    hit.type,
          field:   hit.field,
          blocked: hit.rule,
        });
      }
    }

    // ── Clean: pass through ───────────────────────────────────────────────
    wafEvents.emit('waf:allowed', {
      ts:     Date.now(),
      ip,
      method: req.method,
      url:    req.url,
    });

    next();
  };
}

module.exports = { buildWafMiddleware };
