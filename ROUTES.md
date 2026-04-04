# Route Reference — What Every Route Does & Where to Navigate

This document explains every route in the system, exactly where your request body travels,
and what you should expect to see at each step.


---

## The Body Problem (and the Fix)

When you send `POST /api/v1/hello` with body `{"key": "hello"}`, the body passes through
**three distinct hands** before it reaches the backend:

```
Your request body: {"key": "hello"}

  1. Express middleware (index.js)
       express.json() reads and parses the raw stream
       req.body = { key: "hello" }          ← stream is now consumed

  2. Proxy engine (src/proxy.js)
       Cannot pipe the stream again (already read)
       Reads req.body, re-serializes → JSON.stringify({ key: "hello" })
       Writes it into the new outgoing request to the backend
       Sets Content-Type: application/json + Content-Length automatically

  3. Mock Backend (mock-backend.js)
       Receives the raw bytes again
       Collects them: body = '{"key":"hello"}'
       Parses: parsedBody = { key: "hello" }
       Returns it inside receivedBody in the response
```

**This was a real bug before the fix.** `req.pipe()` was being called after Express had
already consumed the stream, so the backend received an empty body. The fix re-serializes
`req.body` manually before writing to the outgoing proxy request.

---

## Route Map

```
localhost:3000
│
├── /auth/register        POST    → authRoutes.js     (no proxy, handled here)
├── /auth/login           POST    → authRoutes.js     (no proxy, handled here)
├── /auth/logout          POST    → authRoutes.js     (no proxy, handled here)
│
├── /api/v1/*             ANY     → authMiddleware → proxy → localhost:4001
├── /api/v2/*             ANY     → authMiddleware → proxy → localhost:4002
├── /public/*             ANY     → proxy → localhost:4001  (no auth)
│
├── /health               GET     → returns immediately, no proxy
├── /events               GET     → SSE stream, no proxy
└── /config-info          GET     → returns route config, no proxy
```

---

## Route-by-Route Breakdown

---

### POST `/auth/register`

**Handled by:** `src/authRoutes.js` → `src/auth.js` → NeonDB  
**Proxy involved:** No  
**Auth required:** No

**What it does:**
Reads `username`, `email`, `password` from the request body.
Hashes the password with bcrypt, inserts a row into the `users` table.

**Request:**
```json
POST /auth/register
Content-Type: application/json

{
  "username": "alice",
  "email": "alice@example.com",
  "password": "secret123"
}
```

**Where your body goes:**
```
req.body.username → SQL INSERT into users.username
req.body.email    → SQL INSERT into users.email
req.body.password → bcrypt.hash() → SQL INSERT into users.password_hash
```

**Success response (201):**
```json
{
  "message": "User registered",
  "user": { "id": 1, "username": "alice", "email": "alice@example.com" }
}
```

**Where to navigate after hitting this route:**  
→ Go to `POST /auth/login` with the same email + password to get your token.

---

### POST `/auth/login`

**Handled by:** `src/authRoutes.js` → `src/auth.js` → NeonDB  
**Proxy involved:** No  
**Auth required:** No

**What it does:**
Looks up the user by email, verifies the password against the stored bcrypt hash.
Creates a JWT signed with `jwtSecret` from `config.json`.
Saves the token + expiry into the `sessions` table in NeonDB.

**Request:**
```json
POST /auth/login
Content-Type: application/json

{
  "email": "alice@example.com",
  "password": "secret123"
}
```

**Where your body goes:**
```
req.body.email    → SELECT * FROM users WHERE email = $1
req.body.password → bcrypt.compare(password, user.password_hash)
                    if match → jwt.sign({ userId, username }, jwtSecret)
                             → INSERT INTO sessions (user_id, token, expires_at)
```

**Success response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { "id": 1, "username": "alice", "email": "alice@example.com" }
}
```

**Where to navigate after hitting this route:**  
→ Copy the `token`. Add it as `Authorization: Bearer <token>` header.  
→ Now hit any `auth: true` route like `POST /api/v1/hello`.

---

### POST `/auth/logout`

**Handled by:** `src/authRoutes.js` → `src/auth.js` → NeonDB  
**Proxy involved:** No  
**Auth required:** Yes (Bearer token in header)

**What it does:**
Deletes the session row from NeonDB. The token is immediately dead even if the JWT
hasn't expired yet.

**Request:**
```
POST /auth/logout
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Where the token goes:**
```
Authorization header → token extracted
→ DELETE FROM sessions WHERE token = $1
→ Token is now revoked. Any future request using it gets 401.
```

**Success response (200):**
```json
{ "message": "Logged out successfully" }
```

**Where to navigate after hitting this route:**  
→ The token is now dead. Go back to `POST /auth/login` to get a new one.

---

### ANY `/api/v1/*`

**Handled by:** `src/router.js` → `src/middleware/authMiddleware.js` → `src/proxy.js` → `localhost:4001`  
**Proxy involved:** Yes  
**Auth required:** Yes  
**Prefix stripped:** Yes (`/api/v1/hello` becomes `/hello` at the backend)

**What it does:**
This is the main proxied route. The request goes through auth, then gets forwarded to
the hidden backend on port `4001`.

**Example — POST `/api/v1/hello` with body `{"key": "hello"}`:**

```
Step 1 — Hits Express on :3000
         express.json() parses body → req.body = { key: "hello" }

Step 2 — Hits authMiddleware (src/middleware/authMiddleware.js)
         Extracts Bearer token from Authorization header
         jwt.verify(token, jwtSecret) → checks cryptographic signature
         SELECT FROM sessions WHERE token = ? AND expires_at > NOW()
         If session not found → 401 Unauthorized (request stops here)
         If session found → req.user = { userId, username }, continue

Step 3 — Hits proxy.js (src/proxy.js)
         Emits: CLIENT_TO_PROXY event → UI arrow 1 lights up
         Strips prefix: /api/v1/hello → /hello
         Emits: PROXY_TO_BACKEND event → UI arrow 2 lights up
         Re-serializes req.body → '{"key":"hello"}'
         Opens new HTTP connection to localhost:4001
         Sends: POST /hello with body {"key":"hello"}

Step 4 — Hits mock-backend.js on :4001
         Receives raw bytes: '{"key":"hello"}'
         Parses: parsedBody = { key: "hello" }
         Sends response back to proxy

Step 5 — proxy.js receives backend response
         Emits: BACKEND_TO_PROXY event → UI arrow 3 lights up (return)
         Pipes response back to original client
         Emits: PROXY_TO_CLIENT event → UI arrow 4 lights up
```

**Response from backend (200):**
```json
{
  "message": "Hello from mock backend",
  "port": 4001,
  "method": "POST",
  "url": "/hello",
  "receivedBody": { "key": "hello" }
}
```

Note `url` is `/hello` not `/api/v1/hello` — the prefix was stripped before forwarding.  
Note `receivedBody` contains your actual body — it traveled the full chain.

**Where to navigate after hitting this route:**  
→ Watch the live flow diagram at `http://localhost:3000` — all 4 step badges go green.  
→ Check the SSE event log — you will see all 4 events with timestamps and details.  
→ The response panel on the right shows exactly what the backend returned.

---

### ANY `/api/v2/*`

Same as `/api/v1/*` but forwards to `localhost:4002`.  
Start a second mock backend to test: `node mock-backend.js 4002`

---

### ANY `/public/*`

**Handled by:** `src/router.js` → `src/proxy.js` → `localhost:4001`  
**Proxy involved:** Yes  
**Auth required:** No  
**Prefix stripped:** No (`/public/hello` stays `/public/hello` at the backend)

**What it does:**
No auth check. Request is forwarded immediately to the backend on port `4001`.
The full path including `/public` is preserved.

**Where to navigate after hitting this route:**  
→ Same as `/api/v1/*` — watch the flow visualizer. Only 3 relevant steps (no auth step).

---

### GET `/health`

**Handled by:** `index.js` directly  
**Proxy involved:** No  
**Auth required:** No

Returns immediately. Used to check if the server is up.

```json
{ "status": "ok", "time": "2026-04-05T10:00:00.000Z" }
```

---

### GET `/events`

**Handled by:** `index.js` → `src/proxyLogger.js`  
**Proxy involved:** No  
**Auth required:** No

Opens a persistent SSE connection. The browser UI connects here automatically on load.
Every proxy hop fires an event down this stream in real time.

**Events emitted per request:**
```
CLIENT_TO_PROXY   { method, url, clientIp }
PROXY_TO_BACKEND  { target, forwardedPath, method }
BACKEND_TO_PROXY  { status }
PROXY_TO_CLIENT   { status }
```

You can connect to this manually to watch raw events:
```bash
curl -N http://localhost:3000/events
```

---

### GET `/config-info`

**Handled by:** `index.js` directly  
**Proxy involved:** No  
**Auth required:** No

Returns the current route config so the UI can render the route cards without
the browser needing to read `config.json` directly.

```json
{
  "proxyPort": 3000,
  "routes": [
    { "path": "/api/v1", "target": "http://localhost:4001", "auth": true, "stripPrefix": true },
    { "path": "/api/v2", "target": "http://localhost:4002", "auth": true, "stripPrefix": true },
    { "path": "/public", "target": "http://localhost:4001", "auth": false, "stripPrefix": false }
  ]
}
```

---

## Full Navigation Flow (Start to Finish)

```
1. Start servers
   node mock-backend.js 4001    ← hidden backend
   npm start                    ← proxy on :3000

2. Open browser
   http://localhost:3000

3. Register (Left panel → Auth tab)
   POST /auth/register
   → User created in NeonDB

4. Login (Left panel → Auth tab)
   POST /auth/login
   → Token appears in the "Session" view
   → Token is auto-injected into all future requests from the UI

5. Send a proxied request (Right panel → Request Builder)
   Method: POST
   Path:   /api/v1/hello
   Body:   {"key": "hello"}
   → Hit "Send Request"

6. Watch the flow (Middle panel)
   Step 1 lights up  →  CLIENT_TO_PROXY    (your request arrived)
   Step 2 lights up  →  PROXY_TO_BACKEND   (forwarding to :4001)
   Step 3 lights up  →  BACKEND_TO_PROXY   (backend responded)
   Step 4 lights up  →  PROXY_TO_CLIENT    (delivered back to you)

7. See the response (Right panel)
   {
     "receivedBody": { "key": "hello" }   ← your body, end to end
   }

8. Logout (Left panel)
   POST /auth/logout
   → Session deleted from NeonDB
   → Token is immediately invalid
```
