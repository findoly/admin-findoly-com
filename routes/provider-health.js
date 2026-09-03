const router = require("express").Router();
const controller = require("../controllers/providerHealthController");
const { requirePermission } = require("../middleware/auth");

router.get("/", requirePermission("providers.view"), controller.list);

module.exports = router;
