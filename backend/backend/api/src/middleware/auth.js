/**
 * Auth middleware — verifies that the request has a valid session
 * with a wallet address (set during nonce verification).
 */

function requireAuth(req, res, next) {
  if (!req.session || !req.session.address) {
    return res.status(401).json({ error: 'Not authenticated. Connect wallet first.' });
  }
  next();
}

/**
 * Admin middleware — checks that the session address is in the admin whitelist.
 * For MVP, admin addresses are loaded from ADMIN_ADDRESSES env var (comma-separated).
 */
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.address) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const adminAddresses = (process.env.ADMIN_ADDRESSES || '').split(',').map(a => a.trim());
  if (!adminAddresses.includes(req.session.address)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
