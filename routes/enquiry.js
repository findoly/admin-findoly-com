const router = require("express").Router();
const c = require("../controllers/enquiryController");
const { requirePermission } = require("../middleware/auth");

router.get("/", requirePermission("requirements.view"), c.list);
router.post("/", requirePermission("requirements.create"), c.create);
router.get("/:enquiryId/nearby-providers", requirePermission("requirements.view"), c.nearbyProviders);
router.get("/:enquiryId/providers", requirePermission("requirements.view"), c.providerStatuses);
router.get("/:enquiryId/providers/:providerLeadUnlockId", requirePermission("requirements.view"), c.providerStatus);
router.get("/:enquiryId/validation", requirePermission("requirements.view"), c.validation);
router.post("/:enquiryId/validation/preview", requirePermission("requirements.manage"), c.validationPreview);
router.get("/:enquiryId/qualification", requirePermission("requirements.view"), c.qualification);
router.post("/:enquiryId/qualification/preview", requirePermission("requirements.manage"), c.qualificationPreview);
router.post("/:enquiryId/qualification", requirePermission("requirements.manage"), c.saveQualification);
router.post("/:enquiryId/deactivate", requirePermission("requirements.manage"), c.deactivate);
router.post("/:enquiryId/reactivate", requirePermission("requirements.manage"), c.reactivate);
router.post("/:enquiryId/status", requirePermission("requirements.manage"), c.status);
router.post("/:enquiryId/referral-validation", requirePermission("requirements.manage"), c.referralValidation);
router.post("/:enquiryId/sale-conversion", requirePermission("requirements.manage"), c.saleConversion);
router.post("/:enquiryId/note", requirePermission("requirements.manage"), c.note);
router.get("/:enquiryId", requirePermission("requirements.view"), c.get);
router.put("/:enquiryId", requirePermission("requirements.edit"), c.update);
router.patch("/:enquiryId", requirePermission("requirements.edit"), c.update);

module.exports = router;
