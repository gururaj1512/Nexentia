require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const protectionMiddleware = require('./middleware/protection');

const dataRoutes = require('./routes/data');
const loginRoutes = require('./routes/login');
const commentRoutes = require('./routes/comment');
const bruteRoutes = require('./routes/brute');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS — allow frontend origin
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Protection-Mode'],
}));

app.use(express.json());

// Global DDoS rate limiter (only active in protection mode)
const ddosProtection = rateLimit({
  windowMs: 5000, // 5 seconds
  max: 5,
  keyGenerator: (req) => ipKeyGenerator(req) + '-ddos',
  handler: (req, res) => {
    res.status(429).json({
      blocked: true,
      error: 'Rate limit exceeded',
      blocked_by: 'RateLimiter',
      status: 429,
    });
  },
  skip: (req) => {
    const mode = req.headers['x-protection-mode'];
    return mode !== 'enabled';
  },
});

// Apply protection middleware globally
app.use(protectionMiddleware);

// Routes
app.use('/api/vulnerable/data', ddosProtection, dataRoutes);
app.use('/api/vulnerable/login', loginRoutes);
app.use('/api/vulnerable/comment', commentRoutes);
app.use('/api/vulnerable/brute', bruteRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

app.listen(PORT, () => {
  console.log(`[Backend] CyberAttack Demo server running on http://localhost:${PORT}`);
});
