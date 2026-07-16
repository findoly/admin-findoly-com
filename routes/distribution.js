const router = require("express").Router();
const c = require("../controllers/distributionController");
const { requirePermission } = require("../middleware/auth");
router.get("/", requirePermission("distributions.view"), c.list);
module.exports = router;
