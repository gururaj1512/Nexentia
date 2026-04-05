/**
 * Rate Limit Middleware + Event Bus
 * ─────────────────────────────────────────────────────────────────────────────
 * Wraps the SlidingWindowLog engine and emits SSE-friendly events so the
 * rate-limits dashboard can display live incident and traffic data.
 */

const { EventEmitter } = require('events');
const rateLimiter      = require('../rateLimiter');
const rules            = require('../rateLimitRules');
const { getClientIp }  = require('../ipTracker');

// ── Event bus (separate from the proxy logger) ────────────────────────────────
const rlEvents = new EventEmitter();
rlEvents.setMaxListeners(100);

/**
 * Build and return the Express middleware function.
 * This must be registered BEFORE the proxy router so limits are enforced
 * before the request is ever forwarded.
 */
function rateLimitMiddleware(req, res, next) {
  const ip = req.clientIp || getClientIp(req);

  for (const rule of rules) {
    // Method check
    if (rule.method !== '*' && rule.method !== req.method) continue;
    // Path check (regex against full req.url)
    if (!rule.pathPattern.test(req.url)) continue;

    const key    = `${rule.id}:${ip}`;
    const result = rateLimiter.check(key, rule.limit, rule.windowMs);

    // Always attach rate-limit metadata headers
    res.setHeader('X-RateLimit-Rule',      rule.name);
    res.setHeader('X-RateLimit-Limit',     String(rule.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Reset',     String(Math.ceil(result.resetAt / 1000)));
    res.setHeader('X-RateLimit-Window',    `${rule.windowMs / 1000}s`);

    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));

      // Emit incident for the dashboard
      rlEvents.emit('rl:blocked', {
        ts:          Date.now(),
        ip,
        ruleId:      rule.id,
        ruleName:    rule.name,
        method:      req.method,
        url:         req.url,
        limit:       rule.limit,
        windowMs:    rule.windowMs,
        retryAfter,
      });

      return res
        .status(429)
        .json({
          error:      'Too Many Requests',
          rule:       rule.name,
          limit:      rule.limit,
          window:     `${rule.windowMs / 1000}s`,
          retryAfter,
          message:    `Rate limit exceeded. You may retry in ${retryAfter}s.`,
        });
    }

    // Allowed — emit a lightweight traffic tick for live stats
    rlEvents.emit('rl:tick', {
      ts:        Date.now(),
      ip,
      ruleId:    rule.id,
      ruleName:  rule.name,
      remaining: result.remaining,
      count:     result.count,
      limit:     rule.limit,
    });

    break; // First matching rule wins — no double-counting
  }

  next();
}

module.exports = { rateLimitMiddleware, rlEvents };
