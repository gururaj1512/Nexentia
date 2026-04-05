const express = require('express');
const router = express.Router();
const { Client } = require('pg');

const neonDbUrl = 'postgresql://neondb_owner:npg_gbueOAwqz70d@ep-hidden-lab-anb7qt1b-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require';

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

  // UNPROTECTED — query Neon DB directly to demonstrate actual SQL vulnerability
  const client = new Client({ connectionString: neonDbUrl });

  // Build the vulnerable query using the 'password' column (plaintext demo column)
  const fullQuery = `SELECT * FROM users WHERE username='${username}' AND password='${password}'`;

  // Split by semicolons to execute each injected statement separately
  // pg driver does NOT support multiple statements in one query() call
  const statements = fullQuery
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && s !== '--');

  const isBreach = SQL_INJECTION_PATTERNS.some((p) => p.test(username) || p.test(password));

  client.connect()
    .then(async () => {
      const allResults = [];
      const executedStatements = [];
      const errors = [];

      for (const stmt of statements) {
        try {
          console.log(`[SQL Injection Demo] Executing: ${stmt}`);
          const result = await client.query(stmt);
          allResults.push(result);
          executedStatements.push({ sql: stmt, status: 'executed', rowCount: result.rowCount });
        } catch (err) {
          console.error(`[SQL Injection Demo] Statement failed: ${stmt}`, err.message);
          errors.push({ sql: stmt, error: err.message });
          executedStatements.push({ sql: stmt, status: 'error', error: err.message });
        }
      }

      const rows = allResults.flatMap(r => r.rows || []);

      if (isBreach) {
        // For a dramatic breach effect, try to select all users
        let allUsers = rows;
        try {
          const dump = await client.query('SELECT id, username, email, role, password AS "passwordHash" FROM users');
          allUsers = dump.rows.length > 0 ? dump.rows : MOCK_USERS;
        } catch {
          allUsers = MOCK_USERS;
        }

        return res.json({
          success: true,
          message: errors.length > 0
            ? `Database Breached! Destructive query attempted: ${errors.map(e => e.error).join('; ')}`
            : 'Database Breached via NeonDB!',
          data: {
            userId: rows[0]?.id || 1,
            role: rows[0]?.role || 'hacker',
            secret: 'sk_prod_abc123xyz_LIVE_KEY',
            sessionToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkbWluIiwicm9sZSI6ImFkbWluIn0',
            allUsers: allUsers.length > 0 ? allUsers : MOCK_USERS,
            dbQuery: fullQuery,
            executedStatements,
          },
        });
      }

      if (rows.length > 0) {
        return res.json({
          success: true,
          message: 'Welcome!',
          data: {
            userId: rows[0]?.id || 1,
            role: rows[0]?.role || 'user',
            secret: 'sk_prod_abc123xyz_LIVE_KEY',
            sessionToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkbWluIiwicm9sZSI6ImFkbWluIn0',
            allUsers: rows,
            dbQuery: fullQuery,
          },
        });
      }

      return res.status(401).json({ success: false, message: 'Invalid credentials', data: { dbQuery: fullQuery } });
    })
    .catch(err => {
      console.error("[SQL Injection Demo] Connection/fatal error:", err.message);
      if (isBreach) {
        return res.json({
          success: true,
          message: `Database Breached! Injection caused: ${err.message}`,
          data: {
            userId: 1,
            role: 'hacker',
            secret: 'sk_prod_abc123xyz_LIVE_KEY',
            sessionToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
            allUsers: MOCK_USERS,
            dbQuery: fullQuery,
          },
        });
      }
      return res.status(500).json({
        success: false,
        message: 'Database error',
        error: err.message,
        data: { dbQuery: fullQuery },
      });
    })
    .finally(() => client.end());
});

module.exports = router;
