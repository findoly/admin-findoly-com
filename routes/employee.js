const router = require("express").Router();
const c = require("../controllers/employeeController");
const { requirePermission } = require("../middleware/auth");

router.get("/metadata", requirePermission("employees.view"), c.metadata);
router.get("/", requirePermission("employees.view"), c.list);
router.post("/", requirePermission("employees.create"), c.create);
router.get("/:employeeId", requirePermission("employees.view"), c.get);
router.put("/:employeeId", requirePermission("employees.edit"), c.update);
router.patch("/:employeeId", requirePermission("employees.edit"), c.update);

module.exports = router;
