const cookieName = process.env.AUTH_COOKIE_NAME || 'service_crm_admin';

function attachAdmin(req, res, next) {
  req.admin = null;
  const raw = req.cookies?.[cookieName];
  if (!raw) return next();
  try {
    const session = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (session.email && session.exp > Date.now()) req.admin = session;
    else res.clearCookie(cookieName);
  } catch (error) {
    res.clearCookie(cookieName);
  }
  return next();
}

function pageAuth(req, res, next) {
  if (req.admin) return next();
  return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl || '/dashboard')}`);
}

function apiAuth(req, res, next) {
  if (req.admin) return next();
  return res.status(401).json({ success: false, message: 'Authentication required' });
}

function setAdminCookie(res, admin) {
  const session = { email: admin.email, name: admin.name || 'Admin', exp: Date.now() + 12 * 60 * 60 * 1000 };
  res.cookie(cookieName, Buffer.from(JSON.stringify(session)).toString('base64url'), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 12 * 60 * 60 * 1000
  });
}

function clearAdminCookie(res) { res.clearCookie(cookieName); }

module.exports = { attachAdmin, pageAuth, apiAuth, setAdminCookie, clearAdminCookie };
