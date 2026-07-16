const router = require("express").Router();
const c = require("../controllers/followUpController");
const { requirePermission } = require("../middleware/auth");
router.get("/", requirePermission("followUps.view"), c.list);
router.post("/", requirePermission("followUps.create"), c.create);
router.get("/:followUpId", requirePermission("followUps.view"), c.get);
router.put("/:followUpId", requirePermission("followUps.edit"), c.update);
router.patch("/:followUpId", requirePermission("followUps.edit"), c.update);
module.exports = router;
