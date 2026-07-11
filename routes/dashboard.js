const router = require("express").Router();
const c = require("../controllers/dashboardController");
router.get("/", c.get);
module.exports = router;
