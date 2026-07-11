const { setAdminCookie, clearAdminCookie } = require("../middleware/auth");
function login(req, res) {
  const email = String(req.body.email || "")
    .trim()
    .toLowerCase();
  const password = String(req.body.password || "");
  const expectedEmail = String(
    process.env.ADMIN_EMAIL || "admin@example.com",
  ).toLowerCase();
  const expectedPassword = String(process.env.ADMIN_PASSWORD || "change-me");
  if (email !== expectedEmail || password !== expectedPassword)
    return res
      .status(401)
      .json({ success: false, message: "Invalid email or password" });
  setAdminCookie(res, { email, name: "Admin" });
  return res.json({ success: true, data: { email, name: "Admin" } });
}
function me(req, res) {
  return res.json({ success: true, data: req.admin });
}
function logout(req, res) {
  clearAdminCookie(res);
  return res.json({ success: true, message: "Logged out" });
}
module.exports = { login, me, logout };
