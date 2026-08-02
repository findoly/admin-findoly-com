const router = require("express").Router();
const controller = require("../controllers/providerRequestController");
const { requirePermission } = require("../middleware/auth");

router.get("/metadata", requirePermission("provider_requests.view"), controller.metadata);
router.get("/", requirePermission("provider_requests.view"), controller.list);
router.get("/:providerJoinRequestId", requirePermission("provider_requests.view"), controller.get);
router.patch("/:providerJoinRequestId/status", requirePermission("provider_requests.manage"), controller.updateStatus);
router.delete("/:providerJoinRequestId", requirePermission("provider_requests.manage"), controller.remove);
router.post(
  "/:providerJoinRequestId/convert",
  requirePermission("provider_requests.manage"),
  requirePermission("providers.create"),
  controller.convert,
);

module.exports = router;
