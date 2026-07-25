const router = require("express").Router();
const controller = require("../controllers/providerSubscriptionController");
const { requirePermission } = require("../middleware/auth");
router.get("/", requirePermission("billing.view"), controller.list);
router.get("/:providerSubscriptionId", requirePermission("billing.view"), controller.get);
module.exports = router;
