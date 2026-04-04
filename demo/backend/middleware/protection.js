/**
 * Protection middleware — reads X-Protection-Mode header from request.
 * Attaches req.protectionEnabled (boolean) for all route handlers.
 */
function protectionMiddleware(req, res, next) {
  const mode = req.headers['x-protection-mode'];
  req.protectionEnabled = mode === 'enabled';
  next();
}

module.exports = protectionMiddleware;
