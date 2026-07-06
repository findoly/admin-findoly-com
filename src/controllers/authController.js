const { createAdminCookie, clearAdminCookie } = require('../middleware/auth');

function showLogin(req, res) {
  res.render('auth/login', { title: 'Login' });
}

function login(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const expectedEmail = String(process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  const expectedPassword = process.env.ADMIN_PASSWORD || 'change-me';

  if (email === expectedEmail && password === expectedPassword) {
    createAdminCookie(res, { email, name: 'Admin' });
    return res.redirect('/dashboard?flash=Welcome back');
  }

  return res.status(401).render('auth/login', {
    title: 'Login',
    flash: 'Invalid email or password'
  });
}

function logout(req, res) {
  clearAdminCookie(res);
  res.redirect('/login?flash=Logged out');
}

module.exports = { showLogin, login, logout };
