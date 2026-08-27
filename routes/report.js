const router = require("express").Router();
const controller = require("../controllers/reportController");
const { requirePermission } = require("../middleware/auth");

router.get("/requirements", requirePermission("reports.view"), controller.requirements);

module.exports = router;
