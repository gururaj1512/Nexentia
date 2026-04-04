const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const router = express.Router();

const bruteForceProtection = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  keyGenerator: (req) => ipKeyGenerator(req) + '-brute',
  handler: (req, res) => {
    res.status(429).json({
      blocked: true,
      reason: 'Brute force protection: max 5 login attempts per minute',
      retryAfter: 60,
      status: 429,
    });
  },
  skip: (req) => !req.protectionEnabled,
});

// POST /api/vulnerable/brute
router.post('/', bruteForceProtection, (req, res) => {
  const { username = 'admin', password = '' } = req.body;
  const { attemptNumber = 1 } = req.body;

  // Hardcoded: attempt 15 always succeeds (in unprotected mode)
  if (!req.protectionEnabled && parseInt(attemptNumber) === 15) {
    return res.json({
      success: true,
      message: 'Login successful!',
      crackedPassword: password || 'admin123',
      username,
    });
  }

  res.status(401).json({ success: false, message: 'Invalid credentials', attempt: attemptNumber });
});

module.exports = router;
