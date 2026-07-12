const router = require("express").Router();
const controller = require("../controllers/agentController");
router.get("/", controller.list);
router.post("/", controller.create);
router.get("/:agentId/requirements", controller.requirements);
router.get("/:agentId", controller.get);
router.put("/:agentId", controller.update);
router.patch("/:agentId", controller.update);
module.exports = router;
