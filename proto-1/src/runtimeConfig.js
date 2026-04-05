const { URL } = require('url');
const baseConfig = require('../config.json');

function parsePort(rawValue, fallback) {
  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }
  return fallback;
}

function parsePositiveInt(rawValue, fallback) {
  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function parseBoolean(rawValue, fallback) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseTrustProxy(rawValue, fallback = false) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;

  const asNumber = Number.parseInt(normalized, 10);
  if (Number.isInteger(asNumber) && asNumber >= 0) return asNumber;

  return String(rawValue).trim();
}

function isLocalHostname(hostname = '') {
  const normalized = String(hostname).trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function isLocalTargetUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return isLocalHostname(parsed.hostname);
  } catch (_) {
    return false;
  }
}

function readBaseRouteTarget(routePath) {
  const route = (baseConfig.proxy?.routes || []).find(r => r.path === routePath);
  return route?.target;
}

const fallbackProxyPort = baseConfig.proxy?.port || baseConfig.server?.listen_port || 3000;
const proxyPort = parsePort(process.env.PORT || process.env.PROXY_PORT, fallbackProxyPort);

const sharedBackendTarget =
  process.env.BACKEND_URL ||
  process.env.MAIN_BACKEND_URL ||
  baseConfig.server?.backend_url ||
  readBaseRouteTarget('/api/v1') ||
  'http://localhost:4001';

const targetOverrides = {
  '/api/v1': process.env.PROXY_TARGET_V1 || process.env.BACKEND_URL || readBaseRouteTarget('/api/v1') || sharedBackendTarget,
  '/api/v2': process.env.PROXY_TARGET_V2 || readBaseRouteTarget('/api/v2') || process.env.BACKEND_URL || sharedBackendTarget,
  '/public': process.env.PROXY_TARGET_PUBLIC || process.env.BACKEND_URL || readBaseRouteTarget('/public') || sharedBackendTarget,
};

const resolvedRoutes = (baseConfig.proxy?.routes || []).map(route => ({
  ...route,
  target: targetOverrides[route.path] || route.target,
}));

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const skipDbInit = parseBoolean(process.env.SKIP_DB_INIT, false);

const runtimeConfig = {
  ...baseConfig,
  env: {
    nodeEnv,
    isProduction,
    skipDbInit,
    allowLocalTargets: parseBoolean(process.env.ALLOW_LOCAL_TARGETS, false),
  },
  http: {
    jsonBodyLimit: process.env.JSON_BODY_LIMIT || '1mb',
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY, false),
  },
  server: {
    ...baseConfig.server,
    listen_port: proxyPort,
    backend_url:
      process.env.MAIN_BACKEND_URL ||
      process.env.BACKEND_URL ||
      baseConfig.server?.backend_url ||
      resolvedRoutes[0]?.target ||
      sharedBackendTarget,
  },
  proxy: {
    ...baseConfig.proxy,
    port: proxyPort,
    routes: resolvedRoutes,
  },
  auth: {
    ...baseConfig.auth,
    jwtSecret: process.env.JWT_SECRET || baseConfig.auth?.jwtSecret || '',
    tokenExpiry: process.env.JWT_EXPIRES_IN || baseConfig.auth?.tokenExpiry || '44h',
    saltRounds: parsePositiveInt(process.env.BCRYPT_SALT_ROUNDS, baseConfig.auth?.saltRounds || 10),
  },
  database: {
    ...baseConfig.database,
    connectionString: process.env.DATABASE_URL || baseConfig.database?.connectionString || '',
    ssl: parseBoolean(process.env.DB_SSL, baseConfig.database?.ssl !== false),
    sslRejectUnauthorized: parseBoolean(process.env.DB_SSL_REJECT_UNAUTHORIZED, false),
  },
};

function collectRuntimeWarnings(cfg = runtimeConfig) {
  const warnings = [];

  if (!cfg.auth?.jwtSecret || cfg.auth.jwtSecret === 'change-me-in-env') {
    warnings.push('JWT secret is not configured securely. Set JWT_SECRET.');
  }

  if (!cfg.database?.connectionString) {
    warnings.push('Database connection string is missing. Set DATABASE_URL to enable auth/session storage.');
  }

  for (const route of cfg.proxy?.routes || []) {
    try {
      new URL(route.target);
    } catch (_) {
      warnings.push(`Invalid proxy target for route ${route.path}: ${route.target}`);
    }
  }

  return warnings;
}

function collectRuntimeErrors(cfg = runtimeConfig) {
  const errors = [];

  if (!Array.isArray(cfg.proxy?.routes) || cfg.proxy.routes.length === 0) {
    errors.push('At least one proxy route is required in proxy.routes.');
  }

  if (!cfg.env?.isProduction) {
    return errors;
  }

  const jwtSecret = cfg.auth?.jwtSecret || '';
  if (!jwtSecret || jwtSecret === 'change-me-in-env' || jwtSecret.length < 24) {
    errors.push('In production, set JWT_SECRET to a strong secret with at least 24 characters.');
  }

  if (!cfg.database?.connectionString) {
    errors.push('In production, DATABASE_URL is required.');
  }

  if (cfg.env.skipDbInit) {
    errors.push('In production, SKIP_DB_INIT must be false so schema checks run at startup.');
  }

  if (!cfg.env.allowLocalTargets) {
    const localRoutes = (cfg.proxy?.routes || []).filter(route => isLocalTargetUrl(route.target));
    if (localRoutes.length > 0) {
      errors.push(
        `In production, localhost targets are blocked. Update routes: ${localRoutes.map(r => r.path).join(', ')} or set ALLOW_LOCAL_TARGETS=true.`
      );
    }

    if (isLocalTargetUrl(cfg.server?.backend_url || '')) {
      errors.push('In production, server.backend_url cannot point to localhost unless ALLOW_LOCAL_TARGETS=true.');
    }
  }

  return errors;
}

module.exports = {
  runtimeConfig,
  collectRuntimeWarnings,
  collectRuntimeErrors,
};