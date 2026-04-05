# Nexentia — Reverse Proxy Engine with WAF, Rate Limiting & Auth

> **A production-grade, educational reverse proxy server built from scratch in Node.js.** Nexentia sits between clients and backend servers, enforcing security (WAF, rate limiting, JWT authentication) and providing real-time observability through three live dashboards — all powered by Server-Sent Events (SSE).

<img width="791" height="599" alt="User Flow Diagram" src="https://github.com/user-attachments/assets/58359470-fff5-4b5e-9bfb-43be8f3f9ef6" />

---

## Table of Contents

- [What Is This Project?](#what-is-this-project)
- [General Concepts & Terminology](#general-concepts--terminology)
- [Architecture Overview](#architecture-overview)
- [Request Flow (Step by Step)](#request-flow-step-by-step)
- [Project Structure](#project-structure)
- [File-by-File Breakdown](#file-by-file-breakdown)
  - [Root / Config Files](#1-root--config-files)
  - [Main Entry Point — `index.js`](#2-main-entry-point--indexjs)
  - [Database Layer — `src/db.js`](#3-database-layer--srcdbjs)
  - [Authentication — `src/auth.js`](#4-authentication--srcauthjs)
  - [Auth Routes — `src/authRoutes.js`](#5-auth-routes--srcauthroutesjs)
  - [Proxy Engine — `src/proxy.js`](#6-proxy-engine--srcproxyjs)
  - [Router — `src/router.js`](#7-router--srcrouterjs)
  - [WAF Engine — `src/waf.js`](#8-waf-engine--srcwafjs)
  - [WAF Events — `src/wafEvents.js`](#9-waf-events--srcwafeventsjs)
  - [WAF Middleware — `src/middleware/wafMiddleware.js`](#10-waf-middleware--srcmiddlewarewafmiddlewarejs)
  - [Rate Limiter Engine — `src/rateLimiter.js`](#11-rate-limiter-engine--srcratelimiterjs)
  - [Rate Limit Rules — `src/rateLimitRules.js`](#12-rate-limit-rules--srcratelimitrulesjs)
  - [Rate Limit Middleware — `src/middleware/rateLimitMiddleware.js`](#13-rate-limit-middleware--srcmiddlewareratelimitmiddlewarejs)
  - [Auth Middleware — `src/middleware/authMiddleware.js`](#14-auth-middleware--srcmiddlewareauthmiddlewarejs)
  - [Proxy Logger — `src/proxyLogger.js`](#15-proxy-logger--srcproxyloggerjs)
  - [Mock Backend — `mock-backend.js`](#16-mock-backend--mock-backendjs)
  - [Dashboards (HTML)](#17-dashboards-html)
- [Demo Application](#demo-application)
- [Middleware Execution Order](#middleware-execution-order)
- [Configuration Reference](#configuration-reference)
- [Getting Started](#getting-started)
- [Tech Stack](#tech-stack)
- [License](#license)

---

## What Is This Project?

Nexentia is a **Reverse Proxy Engine** — a server that sits in front of your backend application(s) and intercepts all incoming HTTP traffic. Before any request reaches your actual backend, Nexentia:

1. **Inspects it for attacks** (SQL Injection, XSS, blacklisted IPs) via its WAF
2. **Enforces rate limits** (brute-force protection, scraping prevention) via a Sliding Window Log algorithm
3. **Verifies authentication** (JWT tokens validated against a PostgreSQL session store)
4. **Forwards clean requests** to the correct backend server based on URL-path routing rules
5. **Streams every step live** to browser dashboards via SSE (Server-Sent Events)

It is designed as both a **working security tool** and an **educational platform** to understand how enterprise-grade proxies (like Nginx, Cloudflare, AWS WAF) work under the hood.

---

## General Concepts & Terminology

| Term | What It Means |
|------|---------------|
| **Reverse Proxy** | A server that receives client requests and forwards them to one or more backend servers. The client never talks directly to the backend — the proxy acts as a secure intermediary. Unlike a forward proxy (which hides the client), a reverse proxy hides the backend. |
| **WAF (Web Application Firewall)** | A security layer that inspects HTTP request payloads (body, query params, headers) for malicious patterns. It blocks attacks like SQL Injection and Cross-Site Scripting (XSS) before they reach the application. |
| **SQL Injection** | An attack where malicious SQL code is inserted into input fields (e.g., `' OR 1=1 --`) to manipulate database queries. Can lead to unauthorized data access, data deletion, or full database takeover. |
| **XSS (Cross-Site Scripting)** | An attack where malicious JavaScript is injected into web pages (e.g., `<script>alert(1)</script>`) via user input. Can steal cookies, hijack sessions, or deface websites. |
| **Rate Limiting** | Restricting the number of requests a client (identified by IP) can make to a specific endpoint within a time window. Prevents brute-force attacks, DDoS, and API scraping. |
| **Sliding Window Log (SWL)** | A rate-limiting algorithm that stores the timestamp of every request in a window. Unlike fixed-window counters, it has no boundary-burst vulnerability — the window slides continuously with time. |
| **JWT (JSON Web Token)** | A compact, self-contained token format used for authentication. After login, the server issues a JWT; the client sends it with every subsequent request in the `Authorization: Bearer <token>` header. |
| **SSE (Server-Sent Events)** | A browser API that allows the server to push real-time updates to the client over a long-lived HTTP connection. Used here to stream proxy flow events, WAF incidents, and rate-limit data to the dashboards. |
| **Hop-by-Hop Headers** | HTTP headers (e.g., `Connection`, `Keep-Alive`, `Transfer-Encoding`) that apply only to a single transport-level connection and must NOT be forwarded by proxies. |
| **Path Stripping** | When the proxy removes its own route prefix before forwarding. For example, a request to `/api/v1/users` arrives at the proxy, which strips `/api/v1` and forwards just `/users` to the backend. |

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser / curl)                    │
│                          sends request to :3000                   │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                      NEXENTIA PROXY ENGINE (:3000)                │
│                                                                    │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────┐  ┌───────────┐ │
│  │  ① WAF      │→ │ ② Rate       │→ │ ③ Auth   │→ │ ④ Proxy   │ │
│  │  Middleware  │  │   Limiter    │  │ Middleware│  │   Router  │ │
│  │             │  │              │  │           │  │           │ │
│  │ • IP Block  │  │ • SWL Engine │  │ • JWT     │  │ • Route   │ │
│  │ • SQLi Scan │  │ • Per-IP     │  │   Verify  │  │   Match   │ │
│  │ • XSS Scan  │  │ • Per-Route  │  │ • Session │  │ • Forward │ │
│  └─────────────┘  └──────────────┘  └──────────┘  └───────────┘ │
│                                                         │         │
│  ┌──────────────────────────────────────────────────────┤         │
│  │ SSE Event Streams → Live Dashboards                  │         │
│  │  /events (proxy flow)                                │         │
│  │  /waf-events (attack feed)                           │         │
│  │  /rl-events (rate limit feed)                        │         │
│  └──────────────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
   ┌───────────┐   ┌───────────┐   ┌───────────┐
   │ Backend   │   │ Backend   │   │ Backend   │
   │ :4001     │   │ :4002     │   │ :4001     │
   │ /api/v1/* │   │ /api/v2/* │   │ /public/* │
   └───────────┘   └───────────┘   └───────────┘
```

---

## Request Flow (Step by Step)

Here is exactly what happens when a client sends `POST /api/v1/login` with a JSON body:

1. **Client → Proxy (index.js)**: The request arrives at `localhost:3000`. Express parses the JSON body.

2. **WAF Middleware (wafMiddleware.js)**: Runs first.
   - **Stage 1 — IP Blacklist**: Checks if the client IP is in `config.security.blacklisted_ips[]`. If yes → instant `403 Forbidden`.
   - **Stage 2 — Query String Scan**: Parses URL query parameters. Runs every value through SQL Injection and XSS regex patterns. If any match → `400 Bad Request`.
   - **Stage 3 — Body Scan**: Recursively flattens the JSON body into `{field, value}` pairs. Scans every leaf value against the same regex patterns. If match → `400 Bad Request`.
   - If clean → emits `waf:allowed` event → calls `next()`.

3. **Rate Limit Middleware (rateLimitMiddleware.js)**: Runs second.
   - Iterates through `rateLimitRules` (loaded from `config.json`).
   - For each rule, checks if `req.method` and `req.url` match.
   - Calls `rateLimiter.check(key, limit, windowMs)` using the Sliding Window Log.
   - If over limit → `429 Too Many Requests` with `Retry-After` header.
   - Sets `X-RateLimit-*` response headers on every matched request.

4. **Router (router.js)**: Matches URL path against `config.proxy.routes[]`.
   - If route has `auth: true` → runs `authMiddleware`.

5. **Auth Middleware (authMiddleware.js)**:
   - Extracts the JWT from `Authorization: Bearer <token>` header.
   - Verifies the JWT signature using the secret from `config.auth.jwtSecret`.
   - Checks the PostgreSQL `sessions` table to ensure the token hasn't been revoked/expired.
   - If invalid → `401 Unauthorized`.

6. **Proxy Forward (proxy.js)**:
   - Strips the route prefix (e.g., `/api/v1`) from the URL if `stripPrefix: true`.
   - Copies end-to-end headers (drops hop-by-hop headers like `Connection`, `Expect`).
   - Injects proxy headers: `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Proxy-Req-Id`.
   - Opens an HTTP connection to the target backend, sends the request with body.
   - Emits 4 SSE events in sequence: `CLIENT_TO_PROXY` → `PROXY_TO_BACKEND` → `BACKEND_TO_PROXY` → `PROXY_TO_CLIENT`.

7. **Backend → Proxy → Client**: The backend response is piped back through the proxy to the original client. Hop-by-hop headers are stripped from the response as well.

---

## Project Structure

```
Nexentia/
├── README.md                          ← This file
├── proto-1/                           ← Main proxy engine
│   ├── config.json                    ← Central configuration
│   ├── index.js                       ← Express app entry point + SSE + REST APIs
│   ├── mock-backend.js                ← Simulated backend server
│   ├── package.json                   ← Dependencies & scripts
│   │
│   ├── src/
│   │   ├── db.js                      ← PostgreSQL pool + schema init
│   │   ├── auth.js                    ← Register, login, logout, JWT helpers
│   │   ├── authRoutes.js              ← Express routes for /auth/*
│   │   ├── proxy.js                   ← HTTP forwarding engine
│   │   ├── router.js                  ← Dynamic route builder
│   │   ├── proxyLogger.js             ← SSE broadcast for proxy events
│   │   ├── waf.js                     ← WAF pattern library & detection engine
│   │   ├── wafEvents.js               ← WAF event bus (EventEmitter)
│   │   ├── rateLimiter.js             ← Sliding Window Log algorithm
│   │   ├── rateLimitRules.js          ← Config → rule transformer
│   │   │
│   │   └── middleware/
│   │       ├── wafMiddleware.js        ← WAF Express middleware (3-stage gate)
│   │       ├── rateLimitMiddleware.js  ← Rate limit Express middleware + events
│   │       └── authMiddleware.js       ← JWT verification middleware
│   │
│   └── public/
│       ├── index.html                 ← Proxy Flow Visualizer dashboard
│       ├── waf.html                   ← WAF Attack Dashboard
│       └── rate-limits.html           ← Rate Limiter Dashboard
│
└── demo/                              ← Separate CyberAttack demo app
    ├── backend/                       ← Express server with vulnerable endpoints
    │   ├── server.js
    │   ├── middleware/protection.js
    │   └── routes/
    │       ├── login.js               ← SQLi vulnerable login
    │       ├── comment.js             ← XSS vulnerable comments
    │       ├── data.js                ← DDoS vulnerable data endpoint
    │       └── brute.js               ← Brute-force vulnerable login
    │
    └── frontend/                      ← React + Vite + TailwindCSS dashboard
        └── src/
            ├── App.tsx                ← Main dashboard with protection toggle
            ├── context/ProtectionContext.tsx
            ├── lib/api.ts
            ├── panels/               ← Attack simulation panels
            │   ├── DDoSPanel.tsx
            │   ├── SQLPanel.tsx
            │   ├── XSSPanel.tsx
            │   └── BruteForcePanel.tsx
            └── components/
                ├── ServerLog.tsx
                └── Toast.tsx
```

---

## File-by-File Breakdown

### 1. Root / Config Files

#### `config.json` — Central Configuration

Every setting for the proxy, security, auth, and database is defined here. The proxy reads this at startup; no environment variables needed for core settings.

| Section | Purpose | Key Fields |
|---------|---------|------------|
| `server` | Legacy server settings | `listen_port`, `backend_url` |
| `proxy` | Proxy routing configuration | `port` (3000), `routes[]` — each with `path`, `target`, `stripPrefix`, `auth` |
| `rate_limits` | Rate limiting rules | Array of `{ id, path, method, limit, window_seconds, description }` |
| `security` | WAF configuration | `block_sql_injection`, `block_xss`, `scan_body`, `scan_query`, `scan_headers`, `blacklisted_ips[]` |
| `auth` | JWT authentication settings | `jwtSecret`, `tokenExpiry` (44h), `saltRounds` (5 for bcrypt) |
| `database` | PostgreSQL connection | `connectionString` (Neon serverless), `ssl` |

**Proxy Routes Defined:**
- `/api/v1` → `localhost:4001` (auth required, prefix stripped)
- `/api/v2` → `localhost:4002` (auth required, prefix stripped)
- `/public` → `localhost:4001` (no auth, prefix NOT stripped)

#### `package.json` — Dependencies & Scripts

| Dependency | Purpose |
|-----------|---------|
| `express` (v5) | Web framework for the proxy server |
| `bcrypt` | Password hashing for user registration |
| `jsonwebtoken` | JWT creation and verification |
| `pg` | PostgreSQL client (for Neon DB) |
| `dotenv` | Environment variable loading |

| Script | Command | Purpose |
|--------|---------|---------|
| `npm start` | `node index.js` | Start the proxy in production mode |
| `npm run dev` | `node --watch index.js` | Start with auto-restart on file changes |
| `npm run mock` | `node mock-backend.js` | Start mock backend on port 4001 |
| `npm run mock:4002` | `node mock-backend.js 4002` | Start mock backend on port 4002 |

---

### 2. Main Entry Point — `index.js`

**What it does**: Wires together every component of the proxy engine — middleware pipeline, SSE endpoints, REST APIs, and routes.

#### Key Setup Steps:

```
1. app.use(express.json())       → Parse JSON bodies
2. app.use(express.static())     → Serve dashboard HTML files
3. app.use(wafMiddleware)        → WAF runs FIRST
4. app.use(rateLimitMiddleware)  → Rate limiter runs SECOND
5. app.use('/auth', authRoutes)  → Auth endpoints
6. app.use(buildRouter(routes))  → Proxy routing (runs LAST)
```

#### SSE Endpoints (3 streams):

| Endpoint | Event Source | Events | Dashboard |
|----------|-------------|--------|-----------|
| `GET /events` | `proxyLogger` | `proxy:step` → `CLIENT_TO_PROXY`, `PROXY_TO_BACKEND`, `BACKEND_TO_PROXY`, `PROXY_TO_CLIENT`, `PROXY_ERROR` | `index.html` |
| `GET /rl-events` | `rlEvents` | `rl:blocked`, `rl:tick` | `rate-limits.html` |
| `GET /waf-events` | `wafEvents` | `waf:blocked`, `waf:allowed` | `waf.html` |

#### REST APIs:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/config-info` | GET | Returns proxy port + routes array (for dashboard display) |
| `/waf-config` | GET | Returns WAF toggle states, blacklisted IPs, and rule label lists |
| `/rl-stats` | GET | Snapshots all rate limiter state — per-rule, per-IP counts and remaining quota |
| `/rl-flush` | POST | Manually resets rate limit counters (single key or all) |
| `/health` | GET | Health check endpoint |

#### `start()` function
- Initializes the database (creates tables if not exist).
- Starts the Express server on `config.proxy.port` (3000).
- Prints a formatted boot banner showing routes, rate limits, and WAF status.

---

### 3. Database Layer — `src/db.js`

**What it does**: Creates a PostgreSQL connection pool and initializes the schema on first startup.

#### Key Elements:

- **`pool`** — A `pg.Pool` instance connected to Neon serverless PostgreSQL via the connection string in `config.json`. SSL is enabled (`rejectUnauthorized: false` for Neon).

#### `init()` function
Creates two tables if they don't exist:

| Table | Columns | Purpose |
|-------|---------|---------|
| `users` | `id (SERIAL PK)`, `username (UNIQUE)`, `email (UNIQUE)`, `password_hash (TEXT)`, `created_at` | Stores registered user accounts |
| `sessions` | `id (SERIAL PK)`, `user_id (FK → users)`, `token (TEXT)`, `expires_at`, `created_at` | Stores active JWT sessions (for revocation checks) |

The `sessions` table has `ON DELETE CASCADE` from `users`, so deleting a user automatically removes all their sessions.

---

### 4. Authentication — `src/auth.js`

**What it does**: Core authentication logic — user registration, login, logout, token operations.

#### Functions:

| Function | Signature | What It Does |
|----------|----------|--------------|
| `register(username, email, password)` | → `{ id, username, email }` | Hashes the password with bcrypt (5 salt rounds), inserts into `users` table, returns the created user object. |
| `login(email, password)` | → `{ token, user }` | Looks up user by email, compares password with bcrypt. If valid: (1) creates a JWT with `{ userId, username }` payload and configured expiry, (2) stores the token in the `sessions` table, (3) returns both. |
| `logout(token)` | → void | Deletes the session row matching the token, effectively revoking it. |
| `verifyToken(token)` | → JWT payload | Verifies the JWT signature against `config.auth.jwtSecret`. Throws if invalid. |
| `isTokenRevoked(token)` | → boolean | Queries the `sessions` table for a matching token with `expires_at > NOW()`. If no row found, the token is considered revoked. Returns `true` if revoked. |

**Important**: Login stores tokens in the DB so they can be explicitly revoked via logout. This is a server-side session store pattern — the JWT is used for fast verification, but the DB is the source of truth for revocation.

---

### 5. Auth Routes — `src/authRoutes.js`

**What it does**: Express router exposing three auth endpoints under `/auth/*`.

| Endpoint | Method | Request Body | Success Response | Error Handling |
|----------|--------|-------------|-----------------|----------------|
| `/auth/register` | POST | `{ username, email, password }` | 201: `{ message, user }` | 400 (missing fields), 409 (duplicate user — PG error code 23505), 500 |
| `/auth/login` | POST | `{ email, password }` | 200: `{ token, user }` | 400 (missing fields), 401 (wrong credentials) |
| `/auth/logout` | POST | None (token in `Authorization` header) | 200: `{ message }` | 400 (no token), 500 |

---

### 6. Proxy Engine — `src/proxy.js`

**What it does**: The core HTTP forwarding logic. This is the heart of the reverse proxy.

#### Constants:

- **`HOP_BY_HOP`** — A `Set` of hop-by-hop header names that must NEVER be forwarded: `connection`, `keep-alive`, `transfer-encoding`, `te`, `upgrade`, `trailer`, `proxy-authorization`, `proxy-connection`, `expect`. The `expect` header is specifically stripped to prevent `100-continue` handshake delays that make POST requests hang.

#### `emit(step, data)` function
Broadcasts a proxy flow event via the `proxyEvents` EventEmitter. Each event includes a timestamp and a step name.

#### `forwardRequest(req, res, target, stripPrefix, routePath)` function

This is the main proxy logic. It returns a Promise that resolves when the full request-response cycle completes.

**Step-by-step:**

1. **Generate Request ID**: A unique `reqId` combining timestamp + random string (e.g., `1712345678-a3x7k`).

2. **Strip Prefix**: If `stripPrefix` is true, removes the route path from the URL (e.g., `/api/v1/users` → `/users`).

3. **Build Outgoing Headers**:
   - Copies all client headers EXCEPT hop-by-hop ones.
   - Sets `host` to the target backend's host.
   - Injects `x-forwarded-for` (client IP), `x-forwarded-host` (original host), `x-forwarded-proto` (http), and `x-proxy-req-id` (unique trace ID).

4. **Prepare Body Buffer**: For non-GET/HEAD methods, serializes `req.body` (already parsed by Express) back to JSON and creates a Buffer. Sets `content-type` and `content-length` headers.

5. **Open HTTP Request**: Creates an `http.request` to the backend with:
   - `agent: false` — Forces a fresh socket per request (prevents stale connection reuse).
   - `timeout: 30000` — 30-second timeout.

6. **Emit 4 SSE Events**:
   - `CLIENT_TO_PROXY` — When the request arrives.
   - `PROXY_TO_BACKEND` — When forwarding begins.
   - `BACKEND_TO_PROXY` — When the backend response is fully received.
   - `PROXY_TO_CLIENT` — When the response is sent back to the client.

7. **Error Handling**:
   - **Timeout** → Destroys the request, returns `504 Gateway Timeout`.
   - **Connection Error** → Returns `502 Bad Gateway`.
   - **Stream Error** → Returns `502` with error details.
   - All errors emit a `PROXY_ERROR` event.

8. **Response Forwarding**: Collects all response chunks from the backend, strips hop-by-hop headers, sets the final `content-length`, and sends everything back to the client with `res.writeHead()` + `res.end()`.

---

### 7. Router — `src/router.js`

**What it does**: Dynamically builds an Express router from the `config.proxy.routes[]` array.

#### `buildRouter(routes)` function

For each route in the config:
1. Creates a handler chain: `[authMiddleware (if auth:true), proxyHandler]`.
2. The proxy handler calls `forwardRequest()` with the route's target, stripPrefix, and path.
3. Registers the route with `router.use(routePath, ...handlers)`.
4. Logs each registered route at startup.

**Why `router.use()` over `router.all()`?**: `use()` matches any path that STARTS with the route path, acting as a catch-all prefix matcher — exactly what a reverse proxy needs.

---

### 8. WAF Engine — `src/waf.js`

**What it does**: The pattern library and detection engine for the Web Application Firewall. Contains all regex signatures and scanning logic.

#### SQL Injection Signatures (`SQL_RULES` — 14 rules):

| # | Label | Pattern | What It Catches |
|---|-------|---------|-----------------|
| 1 | Classic OR bypass | `' OR 'x'='x` | Authentication bypass via OR tautology |
| 2 | Numeric OR bypass | `' OR 1=1` | Numeric version of the classic bypass |
| 3 | UNION SELECT exfil | `UNION ... SELECT` | Data exfiltration by appending queries |
| 4 | Stacked statement | `; DROP ...` | Multiple SQL statements via semicolons |
| 5 | DROP / TRUNCATE | `DROP TABLE xxx` | Direct destructive commands |
| 6 | SQL comment terminator | `-- ` or `#` | Comment-based query truncation |
| 7 | Block comment obfuscation | `/* ... */` | Obfuscation using C-style comments |
| 8 | MSSQL dangerous procs | `xp_cmdshell`, `sp_executesql` | MSSQL-specific RCE procedures |
| 9 | Hex-encoded payload | `0xDEADBEEF` | Hex-encoded string bypass attempts |
| 10 | Type-cast / char functions | `CAST(...)`, `CHAR(...)` | String manipulation for filter evasion |
| 11 | Time-based blind injection | `SLEEP(5)`, `pg_sleep()` | Blind SQLi via timing side-channels |
| 12 | File read/write | `LOAD_FILE()`, `INTO OUTFILE` | File system access via SQL |
| 13 | Information schema probe | `information_schema` | Database reconnaissance |
| 14 | Conditional error injection | `IF(... SELECT ...)` | Error-based SQLi via conditionals |

#### XSS Signatures (`XSS_RULES` — 14 rules):

| # | Label | Pattern | What It Catches |
|---|-------|---------|-----------------|
| 1 | `<script>` tag | `<script>` | Classic script injection |
| 2 | `javascript:` URI | `javascript:` | URI-based script execution |
| 3 | Inline event handler | `onXxx=` | Event handler attributes (onclick, onerror, etc.) |
| 4 | `<iframe>` / `<frame>` | `<iframe>`, `<embed>`, `<object>` | Embedded content injection |
| 5 | `<img>` with JS src | `<img src="javascript:..."` | Image tag script execution |
| 6 | `eval()` call | `eval(...)` | Direct JS evaluation |
| 7 | `document.cookie` / `.write` | `document.cookie`, `document.write` | DOM manipulation / cookie theft |
| 8 | SVG onload vector | `<svg onload=...>` | SVG-based XSS |
| 9 | CSS `expression()` | `expression(...)` | IE-specific CSS-based XSS |
| 10 | `vbscript:` URI | `vbscript:` | VBScript-based XSS (IE) |
| 11 | `data:text/html` exfil | `data:text/html` | Data URI XSS vector |
| 12 | URL-encoded `<script` | `%3cscript`, `&#x3c;script` | Encoded script tags |
| 13 | HTML entity evasion | `&#60;...&#62;` | Chained HTML entity encoding |
| 14 | `<link>` / `<meta>` injection | `<link>`, `<meta>`, `<base>` | Header/metadata injection |

#### Functions:

| Function | Signature | What It Does |
|----------|----------|--------------|
| `detectSqlInjection(value)` | → `{ rule: string }` or `null` | Tests a single string against all 14 SQL_RULES. Returns the label of the first matching rule, or null if clean. |
| `detectXss(value)` | → `{ rule: string }` or `null` | Tests a single string against all 14 XSS_RULES. Same return pattern. |
| `flattenValues(obj, prefix)` | → `[{ field, value }]` | Recursively walks any JavaScript value (string, number, array, nested object) and produces a flat array of `{field, value}` pairs. Arrays use bracket notation (`[0]`), objects use dot notation (`body.user.name`). This is critical for deep payload inspection. |
| `scanPairs(pairs, cfg)` | → `{ type, field, rule, payload }` or `null` | Scans an array of `{field, value}` pairs. For each pair, runs SQL injection detection (if `block_sql_injection` is on) and XSS detection (if `block_xss` is on). Returns the FIRST hit found with full context, or null if all clean. Truncates the payload to 200 chars to prevent log flooding. |

---

### 9. WAF Events — `src/wafEvents.js`

**What it does**: A singleton `EventEmitter` that decouples the WAF middleware from the SSE delivery layer.

- Emits `waf:blocked` for every blocked request (with full attack details).
- Emits `waf:allowed` for every clean request.
- `setMaxListeners(100)` — Prevents Node.js warnings when many SSE clients connect.
- Subscribed to by the `/waf-events` SSE endpoint in `index.js`.

---

### 10. WAF Middleware — `src/middleware/wafMiddleware.js`

**What it does**: The Express middleware function that orchestrates the WAF's three-stage inspection pipeline.

#### `clientIp(req)` function
Extracts the real client IP. Checks `X-Forwarded-For` header first (trusts first hop only), falls back to `req.socket.remoteAddress`.

#### `queryPairs(rawUrl)` function
Parses the URL's query string into `{field, value}` pairs using the built-in `URL` constructor. Prefixes each field with `query.` for clear logging.

#### `buildWafMiddleware(secCfg)` function

Returns an Express middleware closure bound to the security config. The blacklist IPs are normalized to a `Set` of lowercased strings for O(1) lookup.

**Three stages (executed in order, short-circuits on first hit):**

| Stage | Check | Failure Code | Source |
|-------|-------|-------------|--------|
| 1 — IP Blacklist | Is client IP in the `blacklisted_ips` Set? | 403 Forbidden | `config.security.blacklisted_ips` |
| 2 — Query String | Do any URL query params match SQL/XSS patterns? | 400 Bad Request | URL `?key=value` pairs |
| 3 — Body Scan | Do any JSON body values (deeply flattened) match? | 400 Bad Request | `req.body` (parsed by express.json) |

On any hit: emits `waf:blocked` with `{ ts, type, ip, method, url, field, rule, payload }`.
On clean pass: emits `waf:allowed` with `{ ts, ip, method, url }` and calls `next()`.

---

### 11. Rate Limiter Engine — `src/rateLimiter.js`

**What it does**: Implements the **Sliding Window Log** rate-limiting algorithm as an in-memory data structure.

#### `class SlidingWindowLog`

- **Internal state**: `this.logs = new Map<string, number[]>()` — Maps each key (e.g., `post-login:127.0.0.1`) to a sorted array of request timestamps.
- **Singleton**: The module exports a single instance shared across the entire process.

#### Methods:

| Method | Signature | What It Does |
|--------|----------|--------------|
| `check(key, limit, windowMs)` | → `{ allowed, remaining, resetAt, count }` | The core algorithm: (1) Gets the current time. (2) Evicts all timestamps older than `now - windowMs` from the front of the array (in-place splice for performance). (3) If `count >= limit` → returns `{ allowed: false }` with `resetAt` = oldest timestamp + windowMs. (4) Otherwise, pushes current timestamp, returns `{ allowed: true }` with remaining quota. |
| `stats(key, limit, windowMs)` | → `{ count, remaining, resetAt }` | Read-only version of `check()` — doesn't record a new request. Used by the stats dashboard. |
| `snapshot()` | → `[{ key, timestamps }]` | Returns a copy of every active key and its timestamps. Used by the `/rl-stats` REST endpoint. |
| `flush(key)` | → void | If a key is provided, deletes just that entry. If null, clears everything. Used by the `/rl-flush` endpoint. |

**Why SWL over alternatives?**
- **vs Fixed Window**: No boundary-burst vulnerability. A burst at second 59 doesn't reset at second 60.
- **vs Token Bucket**: Exact counting — no approximation. Better for security endpoints like login.
- **Trade-off**: O(limit) memory per active key. Acceptable for single-node deployments.

---

### 12. Rate Limit Rules — `src/rateLimitRules.js`

**What it does**: Transforms the human-readable `rate_limits` array from `config.json` into internal rule objects.

#### Transformation:

```
Config Input:                        →   Internal Rule:
{                                         {
  "id": "post-login",                       id: "post-login",
  "path": "/login",                          name: "POST /login",
  "method": "POST",                          method: "POST",
  "limit": 5,                               pathPattern: /\/login(\?.*)?$/i,
  "window_seconds": 60                      limit: 5,
}                                            windowMs: 60000,
                                           }
```

**Key design**: The `path` field is treated as a URL SUFFIX. So `/login` matches `/auth/login`, `/api/v1/login`, etc. This lets you write short path fragments without knowing the full proxy prefix.

#### `escapeRegex(str)` function
Escapes regex special characters in the path string to prevent injection.

---

### 13. Rate Limit Middleware — `src/middleware/rateLimitMiddleware.js`

**What it does**: Express middleware that enforces rate limits on every request.

#### `clientIp(req)` function
Same IP extraction logic as the WAF middleware.

#### `rateLimitMiddleware(req, res, next)` function

For each configured rule:
1. Checks if the HTTP method matches (or rule method is `*` for any).
2. Tests `req.url` against the rule's `pathPattern` regex.
3. Calls `rateLimiter.check()` with key `<ruleId>:<clientIp>`.
4. **Always** sets response headers:
   - `X-RateLimit-Rule` — Rule name
   - `X-RateLimit-Limit` — Max requests allowed
   - `X-RateLimit-Remaining` — Remaining quota
   - `X-RateLimit-Reset` — Unix timestamp when window resets
   - `X-RateLimit-Window` — Window duration
5. If **blocked**: Sets `Retry-After` header, emits `rl:blocked` event, returns `429`.
6. If **allowed**: Emits `rl:tick` event with remaining quota.
7. **First matching rule wins** — breaks after the first match to avoid double-counting.

#### `rlEvents` EventEmitter
- `rl:blocked` — Emitted with full details (IP, rule, method, URL, retryAfter).
- `rl:tick` — Emitted for allowed requests with remaining count.
- Subscribed to by `/rl-events` SSE in `index.js`.

---

### 14. Auth Middleware — `src/middleware/authMiddleware.js`

**What it does**: Express middleware that verifies JWT authentication on protected routes.

#### `authMiddleware(req, res, next)` function

1. Extracts the `Authorization` header. If missing or doesn't start with `Bearer ` → `401`.
2. Slices out the token string.
3. Calls `verifyToken(token)` — Verifies the JWT signature. If invalid or expired → `401`.
4. Calls `isTokenRevoked(token)` — Queries the database for an active session. If no session found → `401 Token expired or revoked`.
5. Sets `req.user = payload` (JWT claims) for downstream handlers.
6. Calls `next()`.

---

### 15. Proxy Logger — `src/proxyLogger.js`

**What it does**: Manages SSE connections for the proxy flow visualization dashboard.

#### Key Components:

- **`proxyEvents`** — An `EventEmitter` that the proxy engine emits `proxy:step` events to.
- **`clients`** — A `Set<Response>` of active SSE connections.
- **`addClient(res)`** — Adds an SSE response to the client set. Automatically removes it when the connection closes.
- **`broadcast(event)`** — Serializes the event to JSON and writes it to ALL connected SSE clients. Silently ignores write errors (e.g., closed connections).
- The `proxyEvents.on('proxy:step', broadcast)` listener connects the event bus to the broadcast function.

---

### 16. Mock Backend — `mock-backend.js`

**What it does**: A minimal HTTP server that simulates a real backend. Used for testing the proxy without needing an actual application server.

**Features:**
- Runs on port 4001 (or custom port via CLI argument).
- Echoes back everything the proxy sent to it:
  - `backendPort` — Which port handled the request.
  - `urlSeenByBackend` — The path AFTER prefix stripping (proves the proxy stripped correctly).
  - `receivedBody` — The JSON body that traveled through the proxy.
  - `proxyEvidence` — All `X-Forwarded-*` and `X-Proxy-Req-Id` headers (proves the request came through the proxy; if accessed directly, these are all null).

---

### 17. Dashboards (HTML)

All three dashboards are self-contained HTML files with embedded CSS and JavaScript. They use the dark color scheme with CSS custom properties and connect to their respective SSE streams.

#### `public/index.html` — Proxy Flow Visualizer

The main dashboard with three panels:
- **Left Panel**: Auth (Login/Register/Session) + Routes list with how-it-works explanation.
- **Center Panel**: Live flow diagram showing Client → Proxy → Backend with animated arrows and a step tracker. Below: real-time event log showing every proxy hop.
- **Right Panel**: Request Builder — select method, path, body; send requests through the proxy and see the response with syntax-highlighted JSON, proxy evidence headers, and echoed body.

**Key JS functions:**
- `connectSSE()` — Opens EventSource to `/events`.
- `animateStep(ev)` — Lights up the flow diagram nodes and arrows based on the current proxy step.
- `sendRequest()` — Builds and sends an HTTP request through the proxy, shows the response.
- `doLogin()/doRegister()/doLogout()` — Auth operations that store the JWT token and auto-inject it into requests.
- `highlight(json)` — Syntax-highlights JSON with colored spans for keys, strings, numbers, booleans.

#### `public/waf.html` — WAF Attack Dashboard

Three-panel layout:
- **Left Panel**: Config tab (shows WAF toggle states, blacklisted IPs, signature counts) + Patterns tab (lists all 14 SQL and 14 XSS signature labels).
- **Center Panel**: Live attack feed with real-time counters (SQL Injections, XSS Attacks, IP Blacklist blocks, Clean passes). Displays each incident with timestamp, attack type badge, matched rule, IP, URL, and truncated payload.
- **Right Panel**: Attack Tester with 10 preset payloads (4 SQLi, 4 XSS, 1 IP blacklist, 1 clean) and a manual payload editor. Shows BLOCKED/ALLOWED result with full response details.

**Key JS functions:**
- `connectSSE()` — Opens EventSource to `/waf-events`.
- `handleEvent(ev)` — Categorizes events by attack type and updates counters.
- `fireAttack()` — Sends a test payload and shows whether it was blocked.
- `loadConfig()` → `renderConfig()` + `renderPatterns()` — Fetches and displays WAF config from `/waf-config`.

#### `public/rate-limits.html` — Rate Limiter Dashboard

Three-panel layout:
- **Left Panel**: Rules tab (cards showing each rule with method, limit, window, usage bar, top IPs) + Algorithm tab (explains Sliding Window Log with pros/cons).
- **Center Panel**: Live incident feed with counters (Blocked 429s, Allowed, Unique IPs, Block rate/min).
- **Right Panel**: Burst Simulator (fire N requests with configurable delay to trigger rate limits) + Manual Flush (reset counters).

**Key JS functions:**
- `connectSSE()` — Opens EventSource to `/rl-events`.
- `runSimulator()` — Fires a burst of requests with configurable count and delay. Shows progress bar and per-request results.
- `doFlush()` — Calls `/rl-flush` to reset rate limit counters.
- `renderRuleCards()` — Renders rule cards with usage bars and per-IP breakdowns from `/rl-stats`.

---

## Demo Application

The `demo/` directory contains a **separate, standalone application** (not part of the proxy engine) that demonstrates common web attacks in an interactive UI.

### Demo Backend (`demo/backend/`)

An Express server with intentionally **vulnerable** endpoints. Each route has two modes:
- **Unprotected** (default): Attacks succeed — SQL injection grants admin access, XSS renders unsanitized, DDoS causes growing latency, brute force eventually cracks the password.
- **Protected** (`X-Protection-Mode: enabled` header): Attacks are blocked with appropriate error responses.

| Route | Attack Type | Unprotected Behavior | Protected Behavior |
|-------|------------|---------------------|-------------------|
| `POST /api/vulnerable/login` | SQL Injection | `' OR 1=1 --` grants admin access, leaks all users + API keys | Detects SQLi patterns, returns 400 |
| `POST /api/vulnerable/comment` | XSS | `<script>alert(1)</script>` is stored and rendered raw | Detects XSS patterns, returns 400 |
| `GET /api/vulnerable/data` | DDoS | Latency grows with concurrent requests (up to 3s) | Fixed 50ms response time |
| `POST /api/vulnerable/brute` | Brute Force | 15th attempt always succeeds | Rate limited to 5 attempts/min |

### Demo Frontend (`demo/frontend/`)

A React + Vite + TailwindCSS + Framer Motion dashboard with:
- **Global protection toggle** — switches all backends between protected/unprotected mode.
- **4 attack panels** (DDoSPanel, SQLPanel, XSSPanel, BruteForcePanel) — each fires the corresponding attack and displays results.
- **ServerLog** — Real-time log of all requests and responses.
- **ProtectionContext** — React context managing protection state, request counts, and blocked counts across all panels.

---

## Middleware Execution Order

The middleware pipeline is carefully ordered — security checks run before any business logic:

```
Incoming Request
     │
     ├─① WAF Middleware
     │   ├── IP Blacklist   → 403 Forbidden
     │   ├── Query Scan     → 400 Bad Request
     │   └── Body Scan      → 400 Bad Request
     │
     ├─② Rate Limit Middleware
     │   └── SWL Check      → 429 Too Many Requests
     │
     ├─③ Auth Middleware (only for routes with auth:true)
     │   └── JWT Verify     → 401 Unauthorized
     │
     └─④ Proxy Router
         └── Forward to backend → 200/502/504
```

**Why this order?**
- WAF first: No point rate-limiting or authenticating an attack payload.
- Rate limiter second: Block excessive requests before wasting CPU on JWT verification.
- Auth third: Only check tokens on routes that require it.
- Proxy last: Only clean, authorized, non-rate-limited requests reach the backend.

---

## Configuration Reference

### `config.json` — Full Schema

```jsonc
{
  // Server settings (listen port for the reverse proxy)
  "server": {
    "listen_port": 3000,
    "backend_url": "http://localhost:4001"
  },

  // Proxy routing rules
  "proxy": {
    "port": 3000,
    "routes": [
      {
        "path": "/api/v1",           // URL prefix to match
        "target": "http://localhost:4001",  // Backend to forward to
        "stripPrefix": true,          // Remove /api/v1 before forwarding
        "auth": true                  // Require JWT authentication
      }
    ]
  },

  // Rate limiting rules
  "rate_limits": [
    {
      "id": "post-login",            // Unique identifier
      "path": "/login",              // Path suffix to match
      "method": "POST",              // HTTP method (or "*" for any)
      "limit": 5,                    // Max requests per window
      "window_seconds": 60,          // Sliding window size
      "description": "Brute-force protection"
    }
  ],

  // WAF (Web Application Firewall)
  "security": {
    "block_sql_injection": true,     // Enable SQLi pattern matching
    "block_xss": true,               // Enable XSS pattern matching
    "scan_body": true,               // Inspect JSON request bodies
    "scan_query": true,              // Inspect URL query parameters
    "scan_headers": false,           // Inspect HTTP headers (off by default)
    "blacklisted_ips": [             // IP addresses to block immediately
      "203.0.113.42"
    ]
  },

  // Authentication settings
  "auth": {
    "jwtSecret": "your-secret",      // Secret key for JWT signing/verification
    "tokenExpiry": "44h",            // JWT expiration duration
    "saltRounds": 5                  // bcrypt hashing rounds
  },

  // Database connection
  "database": {
    "connectionString": "postgresql://...",  // PostgreSQL connection URL
    "ssl": true
  }
}
```

---

## Getting Started

### Prerequisites
- **Node.js** v18+
- **PostgreSQL** database (or a [Neon](https://neon.tech) serverless instance)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/Nexentia.git
cd Nexentia/proto-1

# Install dependencies
npm install
```

### Configuration

Edit `config.json`:
- Update `database.connectionString` with your PostgreSQL URL.
- Set `auth.jwtSecret` to a secure random string.
- Add/remove IP addresses in `security.blacklisted_ips`.
- Add/modify proxy routes in `proxy.routes`.

### Running the Proxy

```bash
# Terminal 1 — Start the mock backend
npm run mock

# Terminal 2 — (Optional) Start a second mock backend
npm run mock:4002

# Terminal 3 — Start the proxy server
npm run dev
```

### Access the Dashboards

| Dashboard | URL | Description |
|-----------|-----|-------------|
| Proxy Flow Visualizer | http://localhost:3000 | Main UI — auth, routes, live flow, request builder |
| WAF Dashboard | http://localhost:3000/waf.html | Attack feed, tester, security config |
| Rate Limiter Dashboard | http://localhost:3000/rate-limits.html | Rule cards, burst simulator, flush |

### Running the Demo App

```bash
# Terminal 1 — Start demo backend
cd demo/backend
npm install
npm start

# Terminal 2 — Start demo frontend
cd demo/frontend
npm install
npm run dev
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | Node.js 18+ | Server-side JavaScript |
| **Framework** | Express v5 | HTTP server + middleware pipeline |
| **Database** | PostgreSQL (Neon) | User accounts + session storage |
| **Auth Hashing** | bcrypt | Password hashing (5 salt rounds) |
| **Token Format** | JSON Web Tokens | Stateless authentication |
| **DB Client** | pg (node-postgres) | PostgreSQL connection pooling |
| **Real-time** | SSE (Server-Sent Events) | Live dashboard updates |
| **Frontend (Proxy)** | Vanilla HTML/CSS/JS | Zero-dependency dashboards |
| **Frontend (Demo)** | React + Vite + TailwindCSS | CyberAttack demo UI |
| **Animations (Demo)** | Framer Motion | Smooth toggle and panel animations |

---

## License

ISC
