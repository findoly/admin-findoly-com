const router = require("express").Router();
const c = require("../controllers/invoiceController");
const { requirePermission } = require("../middleware/auth");
router.get("/", requirePermission("billing.view"), c.list);
router.post("/", requirePermission("billing.create"), c.create);
router.get("/:invoiceId", requirePermission("billing.view"), c.get);
router.put("/:invoiceId", requirePermission("billing.edit"), c.update);
router.patch("/:invoiceId", requirePermission("billing.edit"), c.update);
module.exports = router;
