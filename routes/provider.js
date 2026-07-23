const router = require("express").Router();
const c = require("../controllers/providerController");
const { requirePermission } = require("../middleware/auth");

router.get("/", requirePermission("providers.view"), c.list);
router.post("/", requirePermission("providers.create"), c.create);
router.get("/:providerId/distributions", requirePermission("providers.view"), c.distributions);
router.patch("/:providerId/distributions/:leadDistributionId/outcome-review", requirePermission("providers.edit"), c.reviewOutcome);
router.get("/:providerId/transactions", requirePermission("providers.view"), c.transactions);
router.post("/:providerId/credits", requirePermission("provider_credits.add"), c.addCredits);
router.post("/:providerId/sync", requirePermission("providers.edit"), c.sync);
router.get("/:providerId", requirePermission("providers.view"), c.get);
router.put("/:providerId", requirePermission("providers.edit"), c.update);
router.patch("/:providerId", requirePermission("providers.edit"), c.update);

module.exports = router;
