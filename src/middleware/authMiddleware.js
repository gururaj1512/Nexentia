const { verifyToken, isTokenRevoked } = require('../auth');

async function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);
    const revoked = await isTokenRevoked(token);
    if (revoked) {
      return res.status(401).json({ error: 'Token expired or revoked' });
    }
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = authMiddleware;
