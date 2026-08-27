const service = require("../services/report/requirement-report-service");

async function requirements(req, res, next) {
  try {
    const data = await service.getRequirementReport(req.query || {});
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = { requirements };
