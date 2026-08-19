"use strict";

const followUpAlertService = require("../services/scheduled-jobs/follow-up-alert-service");
const reportService = require("../services/scheduled-jobs/report-service");
const scheduledAlertService = require("../services/scheduled-jobs/scheduled-alert-service");

function actor(req) {
  return req.admin?.email || "scheduled-job";
}

async function processDueFollowUps(req, res, next) {
  try {
    const data = await followUpAlertService.processDueFollowUps({ limit: req.body?.limit });
    res.status(data.failed > 0 ? 502 : 200).json({ success: data.failed === 0, data });
  } catch (error) {
    next(error);
  }
}

async function dailyLeads(req, res, next) {
  try {
    res.json({ success: true, data: await reportService.sendDailyLeadReport(req.body || {}) });
  } catch (error) {
    next(error);
  }
}

async function dailyLeadUnlocks(req, res, next) {
  try {
    res.json({ success: true, data: await reportService.sendDailyLeadUnlockReport(req.body || {}) });
  } catch (error) {
    next(error);
  }
}

async function dailyProviders(req, res, next) {
  try {
    res.json({ success: true, data: await reportService.sendDailyProviderReport(req.body || {}) });
  } catch (error) {
    next(error);
  }
}

async function dailyFollowUps(req, res, next) {
  try {
    res.json({ success: true, data: await reportService.sendDailyFollowUpReport(req.body || {}) });
  } catch (error) {
    next(error);
  }
}

async function dailyCrmHealth(req, res, next) {
  try {
    res.json({ success: true, data: await reportService.sendDailyCrmHealthReport(req.body || {}) });
  } catch (error) {
    next(error);
  }
}

async function testingProviders(req, res, next) {
  try {
    res.json({ success: true, data: await reportService.sendTestingProviderAlert(req.body || {}) });
  } catch (error) {
    next(error);
  }
}

async function ensureScheduledAlerts(req, res, next) {
  try {
    const rows = await scheduledAlertService.ensureScheduledAlertTemplatesAndRules();
    res.json({
      success: true,
      data: rows.map(({ definition, rule, template }) => ({
        event: definition.event,
        label: definition.ruleName,
        description: definition.description,
        ruleId: rule?.ruleId || "",
        templateId: template?.templateId || "",
      })),
    });
  } catch (error) {
    next(error);
  }
}

async function updateScheduledAlert(req, res, next) {
  try {
    res.json({
      success: true,
      data: await scheduledAlertService.updateScheduledAlert(req.params.event, req.body || {}, actor(req)),
    });
  } catch (error) {
    next(error);
  }
}

async function testScheduledAlert(req, res, next) {
  try {
    res.status(201).json({ success: true, data: await scheduledAlertService.testScheduledAlert(req.params.event, actor(req)) });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  processDueFollowUps,
  dailyLeads,
  dailyLeadUnlocks,
  dailyProviders,
  dailyFollowUps,
  dailyCrmHealth,
  testingProviders,
  ensureScheduledAlerts,
  updateScheduledAlert,
  testScheduledAlert,
};
