function requireAuth(req, res, next) {
  if (req.session?.userId) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

function requireAdmin(req, res, next) {
  if (req.session?.userId && req.session?.role === 'admin') return next();
  res.status(403).json({ error: 'Admin required' });
}

module.exports = { requireAuth, requireAdmin };
