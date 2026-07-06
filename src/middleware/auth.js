const cookieName = process.env.AUTH_COOKIE_NAME || 'service_crm_admin';

function attachAdmin(req, res, next) {
  const raw = req.cookies[cookieName];
  if (!raw) return next();
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (parsed.email && parsed.exp > Date.now()) {
      req.admin = { email: parsed.email, name: parsed.name || 'Admin' };
    }
  } catch (error) {
    res.clearCookie(cookieName);
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.admin) return next();
  return res.redirect('/login?flash=Please login to continue');
}

function createAdminCookie(res, admin) {
  const payload = {
    email: admin.email,
    name: admin.name || 'Admin',
    exp: Date.now() + 12 * 60 * 60 * 1000
  };
  res.cookie(cookieName, Buffer.from(JSON.stringify(payload)).toString('base64url'), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000
  });
}

function clearAdminCookie(res) {
  res.clearCookie(cookieName);
}

module.exports = {
  attachAdmin,
  requireAdmin,
  createAdminCookie,
  clearAdminCookie
};
