const router = require("express").Router();
const controller = require("../controllers/locationController");

// Read-only helper available to any authenticated CRM employee. The parent
// /api router already applies apiAuth before mounting this route.
router.get("/pincode/:pincode", controller.lookupPincode);

module.exports = router;
