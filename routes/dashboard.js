const router = require("express").Router();
const c = require("../controllers/dashboardController");
const { requirePermission } = require("../middleware/auth");
router.get("/", requirePermission("dashboard.view"), c.get);
module.exports = router;
