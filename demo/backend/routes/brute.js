const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { Client } = require('pg');
const router = express.Router();

const neonDbUrl = 'postgresql://neondb_owner:npg_gbueOAwqz70d@ep-hidden-lab-anb7qt1b-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require';

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
router.post('/', bruteForceProtection, async (req, res) => {
  const { username = 'admin', password = '' } = req.body;
  const { attemptNumber = 1 } = req.body;

  // Query NeonDB to check credentials (intentionally vulnerable — plaintext password comparison)
  const client = new Client({ connectionString: neonDbUrl });

  try {
    await client.connect();

    // Deliberately vulnerable: compare plaintext passwords in the DB
    const result = await client.query(
      `SELECT id, username, email, role, password FROM users WHERE username='${username}' AND password='${password}'`
    );

    if (result.rows.length > 0) {
      // Password found!
      const user = result.rows[0];
      console.log(`[Brute Force Demo] Password cracked for '${username}' on attempt #${attemptNumber}: ${password}`);
      return res.json({
        success: true,
        message: 'Login successful! Password cracked via NeonDB!',
        crackedPassword: password,
        username: user.username,
        role: user.role,
        email: user.email,
        dbQuery: `SELECT * FROM users WHERE username='${username}' AND password='${password}'`,
      });
    }

    console.log(`[Brute Force Demo] Attempt #${attemptNumber} failed: ${username}/${password}`);
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials',
      attempt: attemptNumber,
      dbQuery: `SELECT * FROM users WHERE username='${username}' AND password='${password}'`,
    });
  } catch (err) {
    console.error('[Brute Force Demo] DB error:', err.message);
    // Fallback: if DB connection fails, use hardcoded behavior
    if (!req.protectionEnabled && parseInt(attemptNumber) === 15) {
      return res.json({
        success: true,
        message: 'Login successful! (fallback)',
        crackedPassword: password || 'admin123',
        username,
      });
    }
    return res.status(401).json({ success: false, message: 'Invalid credentials', attempt: attemptNumber });
  } finally {
    await client.end().catch(() => {});
  }
});

module.exports = router;
