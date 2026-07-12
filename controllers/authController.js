const crypto = require("crypto");
const { setAdminCookie, clearAdminCookie } = require("../middleware/auth");
const { emailValue, textValue } = require("../utils/validation");

function safeEqual(left, right) {
  const leftDigest = crypto.createHash("sha256").update(String(left)).digest();
  const rightDigest = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function login(req, res, next) {
  try {
    const email = emailValue(req.body?.email, {
      label: "Email",
      required: true,
    });
    const password = textValue(req.body?.password, {
      label: "Password",
      required: true,
      maxLength: 500,
      preserveWhitespace: true,
    });
    const expectedEmail = String(
      process.env.ADMIN_EMAIL || "admin@example.com",
    )
      .trim()
      .toLowerCase();
    const expectedPassword = String(process.env.ADMIN_PASSWORD || "change-me");

    if (!safeEqual(email, expectedEmail) || !safeEqual(password, expectedPassword)) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
    }
    setAdminCookie(res, { email, name: "Admin" });
    return res.json({ success: true, data: { email, name: "Admin" } });
  } catch (error) {
    return next(error);
  }
}

function me(req, res) {
  return res.json({ success: true, data: req.admin });
}

function logout(req, res) {
  clearAdminCookie(res);
  return res.json({ success: true, message: "Logged out" });
}

module.exports = { login, me, logout, safeEqual };
