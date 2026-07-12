const router = require("express").Router();
const controller = require("../controllers/partnerPayoutController");
router.get("/", controller.list);
router.get("/agent/:agentId/summary", controller.agentSummary);
router.get("/agent/:agentId/withdrawals", controller.agentWithdrawals);
router.post("/:withdrawalId/transition", controller.transition);
router.post("/:withdrawalId/payout", controller.payout);
router.get("/:withdrawalId", controller.get);
module.exports = router;
