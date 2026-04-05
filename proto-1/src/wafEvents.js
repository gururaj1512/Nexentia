/**
 * WAF Event Bus
 * ─────────────────────────────────────────────────────────────────────────────
 * Singleton EventEmitter that the WAF middleware emits to, and the SSE
 * endpoint in index.js subscribes to.
 *
 * Events:
 *   'waf:blocked'  — emitted for every blocked request
 *   'waf:allowed'  — emitted for every clean request (throttled: rate-of-change only)
 */

const { EventEmitter } = require('events');

const wafEvents = new EventEmitter();
wafEvents.setMaxListeners(100);

module.exports = { wafEvents };
