/**
 * Sliding Window Log Rate Limiter
 * ─────────────────────────────────────────────────────────────────────────────
 * For each (ruleId:ip) key we store an ordered array of request timestamps.
 * On every check we evict timestamps older than `windowMs`, then decide:
 *   count >= limit  →  deny  (429)
 *   otherwise       →  allow, push current timestamp
 *
 * Space: O(limit) per active key (oldest entries are evicted continuously).
 * All state is in-process memory — intentionally simple for a single-node proxy.
 */

class SlidingWindowLog {
  constructor() {
    /** @type {Map<string, number[]>} key → sorted array of timestamps */
    this.logs = new Map();
  }

  /**
   * Attempt to allow a request for the given key.
   * @param {string}  key       Unique string, e.g. "post-login:127.0.0.1"
   * @param {number}  limit     Max requests allowed in the window
   * @param {number}  windowMs  Window length in milliseconds
   * @returns {{ allowed: boolean, remaining: number, resetAt: number, count: number }}
   */
  check(key, limit, windowMs) {
    const now = Date.now();
    const windowStart = now - windowMs;

    let log = this.logs.get(key);
    if (!log) {
      log = [];
      this.logs.set(key, log);
    }

    // Evict timestamps that have aged out of the window (in-place for perf)
    let i = 0;
    while (i < log.length && log[i] <= windowStart) i++;
    if (i > 0) log.splice(0, i);

    const count = log.length;

    if (count >= limit) {
      // Oldest entry determines when the window clears for this IP
      const resetAt = log[0] + windowMs;
      return { allowed: false, remaining: 0, resetAt, count };
    }

    log.push(now);
    return {
      allowed:   true,
      remaining: limit - log.length,
      resetAt:   now + windowMs,
      count:     log.length,
    };
  }

  /**
   * Read-only stats for a key without recording a new request.
   */
  stats(key, limit, windowMs) {
    const now = Date.now();
    const windowStart = now - windowMs;
    const log = (this.logs.get(key) || []).filter(ts => ts > windowStart);
    return {
      count:     log.length,
      remaining: Math.max(0, limit - log.length),
      resetAt:   log.length > 0 ? log[0] + windowMs : now + windowMs,
    };
  }

  /**
   * Return a snapshot of every active key for the stats dashboard.
   * Keys are returned with their raw log arrays so the UI can derive
   * per-window counts dynamically.
   */
  snapshot() {
    const out = [];
    for (const [key, timestamps] of this.logs.entries()) {
      out.push({ key, timestamps: [...timestamps] });
    }
    return out;
  }

  /** Flush every log — useful for manual resets from the UI. */
  flush(key) {
    if (key) this.logs.delete(key);
    else this.logs.clear();
  }
}

// Singleton — shared across the entire process
module.exports = new SlidingWindowLog();
