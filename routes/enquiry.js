const router = require("express").Router();
const c = require("../controllers/enquiryController");

router.get("/", c.list);
router.post("/", c.create);
router.get("/:enquiryId/providers", c.providerStatuses);
router.get(
  "/:enquiryId/providers/:leadDistributionId",
  c.providerStatus,
);
router.post("/:enquiryId/deactivate", c.deactivate);
router.post("/:enquiryId/reactivate", c.reactivate);
router.post("/:enquiryId/status", c.status);
router.post("/:enquiryId/referral-validation", c.referralValidation);
router.post("/:enquiryId/sale-conversion", c.saleConversion);
router.post("/:enquiryId/note", c.note);
router.post("/:enquiryId/distribute", c.distribute);
router.get("/:enquiryId", c.get);
router.put("/:enquiryId", c.update);
router.patch("/:enquiryId", c.update);

module.exports = router;
