const router = require("express").Router();
const controller = require("../controllers/providerUnlockController");
const { requirePermission } = require("../middleware/auth");

router.get("/", requirePermission("provider_unlocks.view"), controller.list);

module.exports = router;
