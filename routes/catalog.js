const router = require("express").Router();
const c = require("../controllers/catalogController");
router.get("/categories", c.categories);
router.post("/categories", c.createCategory);
router.put("/categories/:categoryId", c.updateCategory);
router.patch("/categories/:categoryId", c.updateCategory);
module.exports = router;
