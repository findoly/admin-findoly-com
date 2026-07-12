const router = require("express").Router();
const c = require("../controllers/providerController");

router.get("/", c.list);
router.post("/", c.create);
router.get("/:providerId/distributions", c.distributions);
router.get("/:providerId/transactions", c.transactions);
router.post("/:providerId/sync", c.sync);
router.get("/:providerId", c.get);
router.put("/:providerId", c.update);
router.patch("/:providerId", c.update);

module.exports = router;
