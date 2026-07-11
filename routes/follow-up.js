const router = require("express").Router();
const c = require("../controllers/followUpController");
router.get("/", c.list);
router.post("/", c.create);
router.get("/:followUpId", c.get);
router.put("/:followUpId", c.update);
router.patch("/:followUpId", c.update);
module.exports = router;
