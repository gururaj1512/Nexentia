const express = require('express');
const path = require('path');
const config = require('./config.json');
const { init: initDb } = require('./src/db');
const { buildRouter } = require('./src/router');
const authRoutes = require('./src/authRoutes');
const { addClient } = require('./src/proxyLogger');

const app = express();
app.use(express.json());

// Serve the UI
app.use(express.static(path.join(__dirname, 'public')));

// SSE stream — browser connects here to receive live proxy events
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ step: 'CONNECTED', ts: Date.now() })}\n\n`);
  addClient(res);
});

// Expose current config to the UI
app.get('/config-info', (req, res) => {
  res.json({
    proxyPort: config.proxy.port,
    routes: config.proxy.routes.map(r => ({
      path: r.path,
      target: r.target,
      auth: r.auth,
      stripPrefix: r.stripPrefix
    }))
  });
});

// Auth endpoints (public)
app.use('/auth', authRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Dynamically built proxy router from config.json
app.use(buildRouter(config.proxy.routes));

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: `No route matched for ${req.method} ${req.url}` });
});

async function start() {
  try {
    await initDb();
    const port = config.proxy.port;
    app.listen(port, () => {
      console.log(`\n[Proxy] Listening on port ${port}`);
      console.log(`[UI]    http://localhost:${port}\n`);
      config.proxy.routes.forEach(r => {
        console.log(`  ${r.path.padEnd(12)} → ${r.target}  (auth: ${r.auth}, strip: ${r.stripPrefix})`);
      });
    });
  } catch (err) {
    console.error('[Startup] Failed:', err.message);
    process.exit(1);
  }
}

start();
