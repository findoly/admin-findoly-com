const dashboardService = require('../services/dashboardService');
const auditService = require('../services/auditService');
const { humanize } = require('../utils/status');
const { formatDate } = require('../utils/dates');

async function index(req, res, next) {
  try {
    const [dashboard, auditLogs] = await Promise.all([
      dashboardService.getDashboard(),
      auditService.list(150)
    ]);
    res.render('reports/index', {
      title: 'Reports',
      dashboard,
      auditLogs,
      humanize,
      formatDate
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { index };
