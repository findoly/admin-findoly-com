const router = require("express").Router();
const controller = require("../controllers/customerPortalController");
const { requireCustomerPortalToken } = require("../middleware/customerPortalAuth");

router.use(requireCustomerPortalToken);
router.get("/categories", controller.categories);
router.post("/enquiries", controller.createEnquiry);
router.get("/enquiries", controller.listEnquiries);
router.get("/enquiries/:enquiryId", controller.getEnquiry);
router.post("/enquiries/:enquiryId/cancel", controller.cancelEnquiry);

module.exports = router;
