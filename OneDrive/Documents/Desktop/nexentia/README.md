# CyberAttack Demo Dashboard

An interactive visual tool that demonstrates the four most common web attacks — and shows exactly how a **reverse proxy / API gateway** stops them. Built for non-technical audiences and judges.

---

## What is This?

Imagine your web server is a house. Without a lock on the front gate (a reverse proxy), anyone can walk straight up to your door and try anything. This dashboard lets you *watch* four different attacks happen in real time, then flip a switch to activate the proxy layer and watch every attack get stopped.

---

## The Two Modes

| Mode | What happens |
|------|-------------|
| **UNPROTECTED** (red) | All attacks reach the server and succeed — data leaks, passwords crack, server crashes |
| **PROTECTED** (green) | The reverse proxy intercepts every attack before it reaches the server |

Use the big toggle at the top of the dashboard to switch between modes.

---

## The Four Attacks

### 1. DDoS — Request Flood
**What it is:** A botnet (thousands of infected computers) all hammer your server with requests simultaneously. Like 10,000 people trying to walk through a single door at once — nobody gets through and the server crashes.

**What you see:** 50 concurrent requests fire every 100ms for 5 seconds. In unprotected mode, the server load climbs to 100% and crashes. In protected mode, the rate limiter kicks in after 5 requests and blocks the rest with HTTP 429.

**How the proxy helps:** The gateway tracks requests per IP and blocks anything over the threshold — the real server never even sees the flood.

---

### 2. SQL Injection
**What it is:** When a login form blindly passes your input to the database, an attacker can type SQL code instead of a username. For example `' OR '1'='1` tricks the query into saying "give me everyone" — and suddenly you're logged in as admin without knowing the password.

**What you see:** Type (or click) a malicious payload into the username field. In unprotected mode, the server returns the admin account, the live API key, the session token, and the entire user table with password hashes. In protected mode, the pattern is detected and blocked with HTTP 400.

**How the proxy helps:** The gateway scans every request body for known SQL injection patterns and rejects them before they reach the database.

---

### 3. XSS — Cross-Site Scripting
**What it is:** If a website displays user-submitted content without cleaning it, an attacker can submit JavaScript code as a "comment." When other users view the page, their browsers execute that code — which can steal their session cookies, redirect them to fake login pages, or silently send their data to the attacker.

**What you see:** Submit a script tag as a comment. In unprotected mode, the script is rendered in the page (a simulated modal shows your "stolen" cookies). In protected mode, the proxy strips the script tag and blocks the request.

**How the proxy helps:** The gateway scans response content and request bodies for script tags and event handler attributes, sanitizing them before they reach users.

---

### 4. Brute Force
**What it is:** An attacker's bot automatically tries thousands of common passwords against a login form — "password", "123456", "admin123" — until one works. Without rate limiting, a bot can try millions of combinations in minutes.

**What you see:** 20 password attempts fire 300ms apart. In unprotected mode, attempt #15 "succeeds" and the password is revealed. In protected mode, the rate limiter blocks all attempts after the 5th, stopping the attack cold.

**How the proxy helps:** The gateway enforces a maximum of 5 login attempts per minute per IP address. After that, the IP is temporarily blocked regardless of what the actual application does.

---

## Why a Reverse Proxy / API Gateway?

Your application code shouldn't have to defend itself from every possible attack — that's like expecting every employee to be a security guard. A reverse proxy sits **in front** of your application and acts as the single entry point:

- Validates all traffic before it reaches your server
- Applies rate limiting globally without touching application code
- Scans for injection patterns in real time
- Can be updated centrally to respond to new threats
- Your actual server stays hidden from the internet entirely

---

## Running Locally

### Backend
```bash
cd backend
npm install
npm start
# Runs on http://localhost:3001
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# Runs on http://localhost:5173
```

Open `http://localhost:5173` in your browser.

---

## Project Structure

```
nexentia/
├── backend/
│   ├── middleware/
│   │   └── protection.js     # Reads X-Protection-Mode header
│   ├── routes/
│   │   ├── data.js           # GET /api/vulnerable/data (DDoS target)
│   │   ├── login.js          # POST /api/vulnerable/login (SQL injection)
│   │   ├── comment.js        # POST /api/vulnerable/comment (XSS)
│   │   └── brute.js          # POST /api/vulnerable/brute (brute force)
│   ├── server.js             # Express app entry point
│   └── .env                  # PORT, FRONTEND_URL
└── frontend/
    ├── src/
    │   ├── context/
    │   │   └── ProtectionContext.tsx  # Global state: mode, logs, counters
    │   ├── panels/
    │   │   ├── DDoSPanel.tsx
    │   │   ├── SQLPanel.tsx
    │   │   ├── XSSPanel.tsx
    │   │   └── BruteForcePanel.tsx
    │   ├── components/
    │   │   ├── ServerLog.tsx  # Live request log at bottom
    │   │   └── Toast.tsx      # Mode-switch notification
    │   ├── lib/
    │   │   └── api.ts         # fetch wrapper with X-Protection-Mode header
    │   └── App.tsx            # Layout, header toggle, grid
    └── .env                   # VITE_API_BASE_URL
```

---

*This project is for educational and demonstration purposes only. All attacks are performed against a local mock server.*
