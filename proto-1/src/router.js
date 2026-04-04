const express = require('express');
const authMiddleware = require('./middleware/authMiddleware');
const { forwardRequest } = require('./proxy');

function buildRouter(routes) {
  const router = express.Router();

  for (const route of routes) {
    const { path: routePath, target, stripPrefix, auth } = route;

    const handlers = [];
    if (auth) handlers.push(authMiddleware);

    handlers.push(async (req, res) => {
      console.log(`[Router] ${req.method} ${req.url} → ${target}`);
      try {
        await forwardRequest(req, res, target, stripPrefix, routePath);
      } catch (err) {
        if (!res.headersSent) {
          res.status(502).json({ error: 'Proxy error', detail: err.message });
        }
      }
    });

    router.use(routePath, ...handlers);
    console.log(`[Router] Registered route: ${routePath} → ${target} (auth: ${auth})`);
  }

  return router;
}

module.exports = { buildRouter };
