const router = require("express").Router();
const controller = require("../controllers/catalogController");
const { requirePermission } = require("../middleware/auth");

router.get("/categories", requirePermission("categories.view"), controller.categories);
router.post("/categories", requirePermission("categories.manage"), controller.createCategory);
router.put("/categories/:categoryId", requirePermission("categories.manage"), controller.updateCategory);
router.patch("/categories/:categoryId", requirePermission("categories.manage"), controller.updateCategory);
router.get("/categories/:categoryId/service-types", requirePermission("categories.view"), controller.serviceTypes);
router.post("/categories/:categoryId/service-types", requirePermission("categories.manage"), controller.createServiceType);
router.get("/service-types", requirePermission("categories.view"), controller.serviceTypes);
router.put("/service-types/:serviceTypeId", requirePermission("categories.manage"), controller.updateServiceType);
router.patch("/service-types/:serviceTypeId", requirePermission("categories.manage"), controller.updateServiceType);

module.exports = router;
