const router = require("express").Router();
const c = require("../controllers/enquiryController");
const { requirePermission } = require("../middleware/auth");

router.get("/", requirePermission("requirements.view"), c.list);
router.post("/", requirePermission("requirements.create"), c.create);
router.get("/:enquiryId/providers", requirePermission("requirements.view"), c.providerStatuses);
router.get("/:enquiryId/providers/:leadDistributionId", requirePermission("requirements.view"), c.providerStatus);
router.post("/:enquiryId/deactivate", requirePermission("requirements.manage"), c.deactivate);
router.post("/:enquiryId/reactivate", requirePermission("requirements.manage"), c.reactivate);
router.post("/:enquiryId/status", requirePermission("requirements.manage"), c.status);
router.post("/:enquiryId/referral-validation", requirePermission("requirements.manage"), c.referralValidation);
router.post("/:enquiryId/sale-conversion", requirePermission("requirements.manage"), c.saleConversion);
router.post("/:enquiryId/note", requirePermission("requirements.manage"), c.note);
router.post("/:enquiryId/distribute", requirePermission("requirements.manage"), c.distribute);
router.get("/:enquiryId", requirePermission("requirements.view"), c.get);
router.put("/:enquiryId", requirePermission("requirements.edit"), c.update);
router.patch("/:enquiryId", requirePermission("requirements.edit"), c.update);

module.exports = router;
