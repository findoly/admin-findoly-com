const router = require("express").Router();
const c = require("../controllers/providerController");
router.get("/", c.list);
router.post("/", c.create);
router.get("/:providerId", c.get);
router.put("/:providerId", c.update);
router.patch("/:providerId", c.update);
router.post("/:providerId/sync", c.sync);
module.exports = router;
