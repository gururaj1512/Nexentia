const { EventEmitter } = require('events');
const config = require('../config.json');

const MAX_TRACKED_IPS = 2000;
const MAX_RECENT_PER_IP = 20;

const trackedIps = new Map();
const blacklist = new Map();

const ipEvents = new EventEmitter();
ipEvents.setMaxListeners(100);

function normalizeIp(rawIp) {
  if (!rawIp) return 'unknown';

  let ip = String(rawIp).trim();
  if (!ip) return 'unknown';

  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';

  return ip;
}

function getClientIp(req, socketFallback) {
  const forwarded = req?.headers?.['x-forwarded-for'];
  if (forwarded) {
    const firstHop = String(forwarded).split(',')[0].trim();
    return normalizeIp(firstHop);
  }

  return normalizeIp(
    req?.clientIp ||
    req?.socket?.remoteAddress ||
    socketFallback?.remoteAddress ||
    req?.connection?.remoteAddress ||
    '127.0.0.1',
  );
}

function ensureIpRecord(ip) {
  let record = trackedIps.get(ip);
  if (!record) {
    record = {
      ip,
      totalRequests: 0,
      blockedRequests: 0,
      lastSeen: 0,
      lastMethod: '',
      lastUrl: '',
      methods: {},
      recent: [],
    };
    trackedIps.set(ip, record);
  }
  return record;
}

function pruneTrackedIps() {
  if (trackedIps.size <= MAX_TRACKED_IPS) return;

  const toDelete = [...trackedIps.values()]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(MAX_TRACKED_IPS);

  for (const record of toDelete) {
    trackedIps.delete(record.ip);
  }
}

function trackRequest(req) {
  const ip = getClientIp(req);
  const now = Date.now();

  const record = ensureIpRecord(ip);
  record.totalRequests += 1;
  record.lastSeen = now;
  record.lastMethod = req.method;
  record.lastUrl = req.originalUrl || req.url;
  record.methods[req.method] = (record.methods[req.method] || 0) + 1;
  record.recent.unshift({
    ts: now,
    method: req.method,
    url: req.originalUrl || req.url,
  });
  if (record.recent.length > MAX_RECENT_PER_IP) {
    record.recent.length = MAX_RECENT_PER_IP;
  }

  pruneTrackedIps();
  return ip;
}

function markBlockedRequest(ip, reason) {
  const normalized = normalizeIp(ip);
  const record = ensureIpRecord(normalized);
  record.blockedRequests += 1;

  ipEvents.emit('ip:event', {
    type: 'BLOCKED_HIT',
    ts: Date.now(),
    ip: normalized,
    reason,
    blockedRequests: record.blockedRequests,
  });
}

function addToBlacklist(ip, reason = 'Manual block', source = 'api') {
  const normalized = normalizeIp(ip);
  if (normalized === 'unknown') {
    throw new Error('A valid IP address is required');
  }

  const existing = blacklist.get(normalized);
  const record = {
    ip: normalized,
    reason,
    source,
    addedAt: existing?.addedAt || Date.now(),
  };

  blacklist.set(normalized, record);
  ipEvents.emit('ip:event', {
    type: 'BLACKLIST_ADD',
    ts: Date.now(),
    ...record,
  });

  return record;
}

function removeFromBlacklist(ip, source = 'api') {
  const normalized = normalizeIp(ip);
  if (!blacklist.has(normalized)) return false;

  blacklist.delete(normalized);
  ipEvents.emit('ip:event', {
    type: 'BLACKLIST_REMOVE',
    ts: Date.now(),
    ip: normalized,
    source,
  });

  return true;
}

function isBlacklisted(ip) {
  return blacklist.has(normalizeIp(ip));
}

function getBlacklistSnapshot() {
  return [...blacklist.values()].sort((a, b) => b.addedAt - a.addedAt);
}

function getTrackedIpsSnapshot(limit = 100) {
  const max = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 100;

  return [...trackedIps.values()]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, max)
    .map(record => ({
      ...record,
      isBlacklisted: isBlacklisted(record.ip),
    }));
}

function hydrateBlacklistFromConfig() {
  const initial = config.security?.blacklisted_ips || [];
  for (const ip of initial) {
    try {
      addToBlacklist(ip, 'Configured in config.json', 'startup');
    } catch (_) {
      // Ignore malformed startup entries to keep boot path robust.
    }
  }
}

hydrateBlacklistFromConfig();

module.exports = {
  ipEvents,
  normalizeIp,
  getClientIp,
  trackRequest,
  markBlockedRequest,
  addToBlacklist,
  removeFromBlacklist,
  isBlacklisted,
  getBlacklistSnapshot,
  getTrackedIpsSnapshot,
};