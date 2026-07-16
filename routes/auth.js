const router = require("express").Router();
const controller = require("../controllers/authController");
const { apiAuth } = require("../middleware/auth");

router.post("/send-otp", controller.sendOtp);
router.post("/verify-otp", controller.verifyOtp);
router.get("/me", apiAuth, controller.me);
router.post("/logout", apiAuth, controller.logout);

module.exports = router;
