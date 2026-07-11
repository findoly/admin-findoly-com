const router = require("express").Router();
const c = require("../controllers/catalogController");
router.get("/categories", c.categories);
module.exports = router;
