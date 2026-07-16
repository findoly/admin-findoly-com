const router = require("express").Router();
const c = require("../controllers/roleController");
const { requirePermission, requireAnyPermission } = require("../middleware/auth");

router.get("/metadata", requireAnyPermission("roles.view", "roles.create", "roles.edit"), c.metadata);
router.get("/", requireAnyPermission("roles.view", "roles.create", "roles.edit"), c.list);
router.post("/", requirePermission("roles.create"), c.create);
router.get("/:roleId", requirePermission("roles.view"), c.get);
router.put("/:roleId", requirePermission("roles.edit"), c.update);
router.patch("/:roleId", requirePermission("roles.edit"), c.update);

module.exports = router;
