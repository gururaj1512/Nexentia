const express = require('express');
const router = express.Router();

// Track concurrent request count to simulate growing latency under load
let activeRequests = 0;

// GET /api/vulnerable/data
router.get('/', async (req, res) => {
  activeRequests++;
  const delay = req.protectionEnabled ? 50 : Math.min(activeRequests * 80, 3000);

  await new Promise((r) => setTimeout(r, delay));
  activeRequests = Math.max(0, activeRequests - 1);

  res.json({
    message: 'Data fetched successfully',
    serverLoad: Math.min(activeRequests * 5, 100),
    timestamp: Date.now(),
    data: {
      users: 1523,
      transactions: 89342,
      revenue: '$2,341,098',
      apiKey: 'sk_live_8f4h2k9xp1m3n7',
    },
  });
});

module.exports = router;
