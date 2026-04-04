const express = require('express');
const router = express.Router();

const SQL_INJECTION_PATTERNS = [
  /'\s*OR\s*'1'\s*=\s*'1/i,
  /;\s*DROP\s+TABLE/i,
  /UNION\s+SELECT/i,
  /--\s*$/,
  /'\s*OR\s+1\s*=\s*1/i,
  /xp_cmdshell/i,
  /EXEC\s*\(/i,
];

const MOCK_USERS = [
  { id: 1, username: 'admin', email: 'admin@company.com', role: 'admin', passwordHash: '5f4dcc3b5aa765d61d8327de' },
  { id: 2, username: 'alice', email: 'alice@company.com', role: 'user', passwordHash: 'e10adc3949ba59abbe56e057' },
  { id: 3, username: 'bob', email: 'bob@company.com', role: 'user', passwordHash: 'd8578edf8458ce06fbc5bb76' },
  { id: 4, username: 'charlie', email: 'charlie@company.com', role: 'moderator', passwordHash: '25d55ad283aa400af464c76d' },
];

// POST /api/vulnerable/login
router.post('/', (req, res) => {
  const { username = '', password = '' } = req.body;

  if (req.protectionEnabled) {
    const input = username + ' ' + password;
    for (const pattern of SQL_INJECTION_PATTERNS) {
      if (pattern.test(input)) {
        return res.status(400).json({
          blocked: true,
          reason: 'SQL Injection pattern detected',
          pattern_matched: username.match(pattern)?.[0] || password.match(pattern)?.[0] || 'suspicious input',
          status: 400,
        });
      }
    }
    // Normal failed login
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  // UNPROTECTED — any SQL-injection-like input grants access
  const isInjection = SQL_INJECTION_PATTERNS.some((p) => p.test(username) || p.test(password));
  if (isInjection || username === 'admin') {
    return res.json({
      success: true,
      message: 'Welcome Admin!',
      data: {
        userId: 1,
        role: 'admin',
        secret: 'sk_prod_abc123xyz_LIVE_KEY',
        sessionToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkbWluIiwicm9sZSI6ImFkbWluIn0',
        allUsers: MOCK_USERS,
        dbQuery: `SELECT * FROM users WHERE username='${username}' OR '1'='1'`,
      },
    });
  }

  res.status(401).json({ success: false, message: 'Invalid credentials' });
});

module.exports = router;
