# Proxy Engine — Dynamic Routing with Auth & Live Visualizer

A config-driven reverse proxy built from scratch with JWT authentication, NeonDB (PostgreSQL) session storage, and a real-time browser UI that shows every internal hop as it happens.

Deployment quick links:

- See DEPLOYMENT.md for production deployment setup of index.js and mock-backend.js.
- Copy .env.example to .env and fill real secrets for local/prod parity.
- Localhost targets in config.json are development defaults; production targets must come from env vars.

---

## What Is This?

In production systems, you never expose your actual backend servers directly to the internet. You put a **proxy** in front of them. The proxy is the only thing the outside world talks to. It decides:

- Who is allowed through (authentication)
- Where to send the request (routing)
- What to send back (response forwarding)

This is exactly what **Nginx**, **AWS API Gateway**, and **Cloudflare** do at scale. This project is a working implementation of that concept — built from scratch, config-driven, and with a live visualization layer so you can watch every request travel through the system in real time.

---

## Architecture Overview

```
                        ┌─────────────────────────────────────────┐
                        │           config.json                   │
                        │  (all routing rules live here)          │
                        └───────────────┬─────────────────────────┘
                                        │ read on startup
                                        ▼
┌──────────┐   HTTP    ┌───────────────────────────────┐   HTTP   ┌─────────────────┐
│          │ ────────► │                               │ ───────► │                 │
│  Client  │           │      Proxy Server :3000       │          │ Backend :4001   │
│ (Browser)│ ◄──────── │   (the only public port)      │ ◄─────── │ (hidden server) │
│          │  response │                               │  response│                 │
└──────────┘           └───────────────────────────────┘          └─────────────────┘
                                        │
                                        │ events (SSE)
                                        ▼
                        ┌───────────────────────────────┐
                        │      Live Visualizer UI        │
                        │   (watches every hop live)     │
                        └───────────────────────────────┘
                                        │
                                        │ sessions / users
                                        ▼
                        ┌───────────────────────────────┐
                        │     NeonDB (PostgreSQL)        │
                        │   users table + sessions table │
                        └───────────────────────────────┘
```

---

## Project Structure

```
Prototype 1/
│
├── config.json                  ← All routing rules. No hardcoded logic anywhere.
├── index.js                     ← Entry point. Boots DB, wires layers, starts server.
├── mock-backend.js              ← Fake backend server for testing (port 4001/4002)
│
├── public/
│   └── index.html               ← Full browser UI (auth + flow visualizer + request builder)
│
└── src/
    ├── db.js                    ← NeonDB connection pool + auto table creation
    ├── auth.js                  ← bcrypt hashing + JWT signing + session management
    ├── authRoutes.js            ← POST /auth/register, /auth/login, /auth/logout
    ├── proxy.js                 ← Core HTTP forwarding engine (streams req/res, emits events)
    ├── router.js                ← Reads config.json, dynamically builds all proxy routes
    ├── proxyLogger.js           ← Internal event bus + SSE broadcast to connected browsers
    └── middleware/
        └── authMiddleware.js    ← Intercepts requests, validates JWT, checks DB session
```

---

## How a Request Flows — Step by Step

This is the most important thing to understand. Every single request goes through these 4 hops:

```
STEP 1          STEP 2               STEP 3               STEP 4
  │               │                    │                    │
  ▼               ▼                    ▼                    ▼

Client ──────► Proxy ────────────► Backend ────────────► Proxy ──────────► Client
         sends    checks config      processes              gets response     delivers
         request  + auth if needed   request                                  response
```

### Step 1 — Client sends request to Proxy

The browser or any HTTP client sends a request to port `3000`.  
The backend server (port `4001`) is completely hidden — the client never knows it exists.

```
GET /api/v1/users
Host: localhost:3000
Authorization: Bearer eyJhbGci...
```

### Step 2 — Proxy checks the config and auth

`router.js` reads the route table built from `config.json` and matches the path.

```json
{
  "path": "/api/v1",
  "target": "http://localhost:4001",
  "stripPrefix": true,
  "auth": true
}
```

- **auth: true** → runs `authMiddleware.js` before forwarding
  - Extracts the `Bearer` token from the `Authorization` header
  - Verifies the JWT signature cryptographically
  - Checks NeonDB `sessions` table to confirm the session is still active (not logged out)
  - If any check fails → returns `401 Unauthorized`. Request never reaches the backend.
- **auth: false** → skips auth entirely, forwards immediately
- **stripPrefix: true** → removes `/api/v1` before forwarding, so backend sees `/users`

### Step 3 — Proxy forwards to the hidden backend

`proxy.js` opens a new raw HTTP connection to the backend and **pipes** the request directly:

```
Forwarded to: http://localhost:4001/users
Headers added by proxy:
  x-forwarded-for:   ::1              (real client IP)
  x-forwarded-host:  localhost:3000   (original hostname)
  x-proxy-req-id:    1712345678-abc12 (unique trace ID for this request)
```

The backend processes the request and sends a response.

### Step 4 — Proxy pipes the response back to the client

The backend's response is streamed directly back using Node.js `.pipe()`.  
The client receives the response exactly as the backend sent it.

---

## The Config File — Where All Logic Lives

```json
{
  "proxy": {
    "port": 3000,
    "routes": [
      {
        "path": "/api/v1",
        "target": "http://localhost:4001",
        "stripPrefix": true,
        "auth": true
      },
      {
        "path": "/api/v2",
        "target": "http://localhost:4002",
        "stripPrefix": true,
        "auth": true
      },
      {
        "path": "/public",
        "target": "http://localhost:4001",
        "stripPrefix": false,
        "auth": false
      }
    ]
  },
  "auth": {
    "jwtSecret": "nexentia",
    "tokenExpiry": "44h",
    "saltRounds": 5
  },
  "database": {
    "connectionString": "postgresql://...",
    "ssl": true
  }
}
```

| Field | What it controls |
|---|---|
| `port` | The single public port the proxy listens on |
| `path` | URL prefix that triggers this route |
| `target` | The hidden backend server to forward to |
| `stripPrefix` | If `true`, removes the path prefix before forwarding |
| `auth` | If `true`, requires a valid JWT token to proceed |
| `jwtSecret` | Secret key used to sign and verify all JWT tokens |
| `tokenExpiry` | How long a login token stays valid |
| `saltRounds` | How many bcrypt rounds to use when hashing passwords |

**To add a new backend service:** add one object to the `routes` array and restart. No code changes needed.

---

## Authentication System

### Why not just JWT alone?

JWT (JSON Web Tokens) are self-contained — once issued, they're cryptographically valid until they expire. This means if a user logs out, their token is still technically valid until expiry. An attacker who gets the token can keep using it.

**Solution:** Store every active session in NeonDB. On logout, delete the row. Every request checks the database — if the session doesn't exist, access is denied immediately, regardless of the token's expiry.

### The Auth Flow

```
REGISTER:
  User submits username + email + password
          │
          ▼
  bcrypt hashes the password (saltRounds: 5)
          │
          ▼
  Stored in NeonDB users table (plain password never saved)


LOGIN:
  User submits email + password
          │
          ▼
  Fetch user from NeonDB by email
          │
          ▼
  bcrypt.compare(submitted password, stored hash)
          │
          ▼
  If match → generate JWT (signed with jwtSecret, expires in 44h)
          │
          ▼
  Save token to NeonDB sessions table with expiry timestamp
          │
          ▼
  Return token to client


EVERY PROTECTED REQUEST:
  Extract Bearer token from Authorization header
          │
          ▼
  jwt.verify(token, jwtSecret)  ← cryptographic check
          │
          ▼
  Query sessions table: token exists AND expires_at > NOW()
          │
          ▼
  If both pass → attach user to request, continue to proxy
  If either fails → 401 Unauthorized


LOGOUT:
  DELETE FROM sessions WHERE token = $1
  Token is now dead immediately, even if not expired
```

### Database Tables

```sql
-- Who can log in
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(100) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Active login sessions
CREATE TABLE sessions (
  id         SERIAL PRIMARY KEY,
  user_id    INT REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Live Flow Visualizer — How It Works

This is what makes the system observable. Most proxies work invisibly. Here, every hop is visible in the browser in real time.

### The Event Bus

`proxyLogger.js` is a Node.js `EventEmitter` — a shared in-memory event bus inside the server process. Every time `proxy.js` hits a new hop, it fires an event:

```
Request arrives      →  emit('CLIENT_TO_PROXY',  { method, url, clientIp })
About to forward     →  emit('PROXY_TO_BACKEND', { target, forwardedPath })
Backend responded    →  emit('BACKEND_TO_PROXY', { status })
Delivering to client →  emit('PROXY_TO_CLIENT',  { status })
```

### Server-Sent Events (SSE)

The browser connects to `GET /events` which is a persistent HTTP connection that stays open. The server can push data down to the browser any time without the browser asking.

```
Browser opens: GET /events
Server: keeps connection open, sends events as they happen

Server pushes:  data: {"step":"CLIENT_TO_PROXY","method":"GET","url":"/api/v1/test"}\n\n
Server pushes:  data: {"step":"PROXY_TO_BACKEND","target":"localhost:4001"}\n\n
Server pushes:  data: {"step":"BACKEND_TO_PROXY","status":200}\n\n
Server pushes:  data: {"step":"PROXY_TO_CLIENT","status":200}\n\n
```

The browser's JavaScript listens on this stream and animates the UI — arrows light up, step badges go green, the event log fills in — all synchronized with what's actually happening inside the server.

### Why SSE and not WebSockets?

SSE is a one-way push from server to browser over plain HTTP. It's simpler, reconnects automatically, and is perfectly suited here since the browser only needs to receive, not send.

---

## The UI

Open `http://localhost:3000` after starting the server.

```
┌──────────────────┬──────────────────────────────────┬─────────────────────┐
│   LEFT PANEL     │        MIDDLE PANEL              │    RIGHT PANEL      │
│                  │                                  │                     │
│  Auth Tab        │  💻 Client → ⚙️ Proxy → 🖥 Backend  │  Method + Path      │
│  ├─ Login form   │  (arrows animate per request)    │  Body (JSON)        │
│  ├─ Register     │                                  │  Send button        │
│  └─ Token view   │  Step tracker:                   │  Response viewer    │
│                  │  [1] [2] [3] [4] → all go green  │  Quick test buttons │
│  Routes Tab      │                                  │                     │
│  ├─ Route cards  │  Live SSE Event Log              │                     │
│  └─ Flow guide   │  (newest event on top)           │                     │
└──────────────────┴──────────────────────────────────┴─────────────────────┘
```

---

## Running the Project

### 1. Install dependencies

```bash
npm install
```

### 2. Start a mock backend (hidden server)

```bash
node mock-backend.js 4001
```

This starts a simple HTTP server on port `4001` that echoes back whatever it receives. This simulates your real backend service.

### 3. Start the proxy

```bash
npm start
```

This will:
- Connect to NeonDB and create the `users` and `sessions` tables if they don't exist
- Read `config.json` and register all routes dynamically
- Start the proxy on port `3000`
- Serve the UI at `http://localhost:3000`

### 4. Open the UI

```
http://localhost:3000
```

---

## API Reference

All requests go to `http://localhost:3000`.

### Auth Endpoints (no token required)

#### Register
```
POST /auth/register
Content-Type: application/json

{
  "username": "alice",
  "email": "alice@example.com",
  "password": "mysecretpassword"
}

Response 201:
{
  "message": "User registered",
  "user": { "id": 1, "username": "alice", "email": "alice@example.com" }
}
```

#### Login
```
POST /auth/login
Content-Type: application/json

{
  "email": "alice@example.com",
  "password": "mysecretpassword"
}

Response 200:
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { "id": 1, "username": "alice", "email": "alice@example.com" }
}
```

#### Logout
```
POST /auth/logout
Authorization: Bearer <token>

Response 200:
{ "message": "Logged out successfully" }
```

### Proxied Endpoints (token required for auth routes)

```
GET  /api/v1/*      → forwards to http://localhost:4001/*   (auth required)
GET  /api/v2/*      → forwards to http://localhost:4002/*   (auth required)
GET  /public/*      → forwards to http://localhost:4001/*   (no auth)
```

### System Endpoints

```
GET /health         → { "status": "ok", "time": "..." }
GET /events         → SSE stream of live proxy events
GET /config-info    → current route config (used by the UI)
```

---

## curl Examples

```bash
# Register a user
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","email":"alice@example.com","password":"secret123"}'

# Login and save the token
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"secret123"}' | \
  grep -o '"token":"[^"]*"' | cut -d'"' -f4)

# Hit a protected route through the proxy
curl http://localhost:3000/api/v1/anything \
  -H "Authorization: Bearer $TOKEN"

# Try without token — should get 401
curl http://localhost:3000/api/v1/anything

# Hit a public route — no token needed
curl http://localhost:3000/public/hello

# Logout
curl -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer $TOKEN"
```

---

## Key Technical Decisions

| Decision | Why |
|---|---|
| Raw `http.request` with `.pipe()` | Streams data without loading it into memory — handles large responses and real-time data efficiently |
| Config-driven routing | Zero code changes to add/remove/modify backend services |
| Sessions stored in NeonDB | Enables immediate token revocation on logout — solves the stateless JWT invalidation problem |
| bcrypt for passwords | Industry-standard one-way hashing — even if the database is leaked, passwords are not exposed |
| Server-Sent Events for UI | One-way server push over plain HTTP — simpler than WebSockets for this use case, auto-reconnects |
| Internal EventEmitter bus | Decouples the proxy logic from the visualization layer — proxy doesn't need to know about the UI |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Web framework | Express.js |
| Database | NeonDB (Serverless PostgreSQL) |
| DB client | node-postgres (`pg`) |
| Auth | JSON Web Tokens (`jsonwebtoken`) + `bcrypt` |
| Proxy transport | Node.js built-in `http` module |
| Real-time push | Server-Sent Events (SSE) |
| Frontend | Vanilla HTML / CSS / JavaScript |
