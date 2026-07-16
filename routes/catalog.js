const router = require("express").Router();
const c = require("../controllers/catalogController");
const { requirePermission } = require("../middleware/auth");
router.get("/categories", requirePermission("categories.view"), c.categories);
router.post("/categories", requirePermission("categories.manage"), c.createCategory);
router.put("/categories/:categoryId", requirePermission("categories.manage"), c.updateCategory);
router.patch("/categories/:categoryId", requirePermission("categories.manage"), c.updateCategory);
module.exports = router;
