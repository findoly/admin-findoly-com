"use strict";

const router = require("express").Router();
const controller = require("../controllers/scheduledJobController");
const { scheduledJobAuth } = require("../middleware/scheduled-job-auth");

router.use(scheduledJobAuth);
router.post("/follow-ups/due", controller.processDueFollowUps);
router.post("/reports/leads", controller.dailyLeads);
router.post("/reports/lead-unlocks", controller.dailyLeadUnlocks);
router.post("/reports/providers", controller.dailyProviders);
router.post("/reports/follow-ups", controller.dailyFollowUps);
router.post("/reports/crm-health", controller.dailyCrmHealth);
router.post("/reports/testing-providers", controller.testingProviders);

module.exports = router;
