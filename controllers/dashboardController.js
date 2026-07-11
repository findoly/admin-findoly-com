const service = require("../services/dashboard/dashboard-service");
async function get(req, res, next) {
  try {
    res.json({ success: true, data: await service.getDashboard() });
  } catch (e) {
    next(e);
  }
}
module.exports = { get };
