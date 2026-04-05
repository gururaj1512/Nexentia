# Deployment Guide

This project has two Node services to deploy separately:

- Proxy service: index.js
- Mock backend service: mock-backend.js

Why config has localhost targets:

- config.json ships with localhost targets as development defaults.
- In production, runtime env overrides should point to deployed service URLs.
- Startup now blocks localhost targets when NODE_ENV=production unless ALLOW_LOCAL_TARGETS=true.

## 1) Proxy Service

Start command:

- npm start

Required environment variables:

- JWT_SECRET
- DATABASE_URL (required unless SKIP_DB_INIT=true)

Common environment variables:

- PORT: service port (used by most PaaS)
- BACKEND_URL: default backend target for routes and SSE bridge
- PROXY_TARGET_V1, PROXY_TARGET_V2, PROXY_TARGET_PUBLIC: per-route overrides
- MAIN_BACKEND_URL: explicit target for proxy-to-backend SSE bridge
- ALLOW_LOCAL_TARGETS=false: keep localhost targets blocked in production
- TRUST_PROXY: set true/number/value when running behind a load balancer
- JSON_BODY_LIMIT: request body size limit for express.json middleware
- JWT_EXPIRES_IN
- BCRYPT_SALT_ROUNDS
- DB_SSL
- DB_SSL_REJECT_UNAUTHORIZED
- GEMINI_API_KEY (optional)
- SKIP_DB_INIT=true (only if you intentionally want to boot without DB schema init)

Production validation enforced at startup:

- JWT_SECRET must be set and at least 24 chars
- DATABASE_URL must be set
- SKIP_DB_INIT must be false
- localhost proxy targets are rejected unless ALLOW_LOCAL_TARGETS=true

## 2) Mock Backend Service

Start command:

- npm run start:mock

Environment variables:

- PORT: service port
- HOST: bind address (default 0.0.0.0)
- PROXY_BASE_URL: for logs/UI hints only
- PUBLIC_BASE_URL: canonical URL emitted in backend events/logs

## 3) Recommended Production Setup

- Deploy mock-backend.js as one service.
- Deploy index.js as a second service.
- Set BACKEND_URL in proxy to the deployed URL of mock-backend.
- If you expose separate backends for /api/v1, /api/v2, /public, use the PROXY_TARGET_* variables.
- Set a strong JWT_SECRET and a real DATABASE_URL.
- Keep .env files out of git. Use your platform secret manager.

## 4) Local Verification

In one terminal:

- npm run start:mock

In another terminal:

- npm start

Health checks:

- Proxy: GET /health
- Mock backend direct: GET /internal/events (SSE)
