/**
 * Rate Limit Rules — loaded dynamically from config.json
 * ─────────────────────────────────────────────────────────────────────────────
 * Transforms the human-friendly `rate_limits` array in config.json into the
 * internal rule format consumed by rateLimitMiddleware.js.
 *
 * Config entry shape:
 *   { id, path, method, limit, window_seconds, description }
 *
 * Built rule shape:
 *   { id, name, method, pathPattern (RegExp), limit, windowMs, description }
 *
 * Path matching strategy:
 *   The `path` field (e.g. "/login") is treated as a SUFFIX — so it matches
 *   "/auth/login", "/api/v1/login", etc.  This lets you write short path
 *   fragments in config without knowing the full proxy prefix.
 */

const config = require('../config.json');

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const rules = (config.rate_limits || []).map(r => ({
  id:          r.id || r.path.replace(/\W+/g, '-').replace(/^-|-$/g, ''),
  name:        `${r.method} ${r.path}`,
  method:      r.method.toUpperCase(),
  // Matches the path as a suffix anywhere in the URL (with optional query string)
  pathPattern: new RegExp(`${escapeRegex(r.path)}(\\?.*)?$`, 'i'),
  limit:       r.limit,
  windowMs:    (r.window_seconds || 60) * 1000,
  description: r.description || '',
}));

module.exports = rules;
