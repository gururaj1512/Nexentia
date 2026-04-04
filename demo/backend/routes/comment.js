const express = require('express');
const router = express.Router();

const XSS_PATTERNS = [
  /<script[\s\S]*?>/i,
  /javascript\s*:/i,
  /onerror\s*=/i,
  /onload\s*=/i,
  /onclick\s*=/i,
  /document\.cookie/i,
  /document\.location/i,
  /eval\s*\(/i,
];

// POST /api/vulnerable/comment
router.post('/', (req, res) => {
  const { comment = '' } = req.body;

  if (req.protectionEnabled) {
    for (const pattern of XSS_PATTERNS) {
      if (pattern.test(comment)) {
        return res.status(400).json({
          blocked: true,
          reason: 'XSS pattern detected: ' + (comment.match(pattern)?.[0] || 'malicious tag'),
          status: 400,
        });
      }
    }
    return res.json({ success: true, comment, sanitized: true });
  }

  // UNPROTECTED — return raw comment to be rendered by frontend with dangerouslySetInnerHTML
  res.json({
    success: true,
    comment,
    rendered: comment,
    warning: 'Comment stored and rendered without sanitization',
  });
});

module.exports = router;
