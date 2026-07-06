const dashboardService = require('../services/dashboardService');
const { humanize } = require('../utils/status');
const { formatDate } = require('../utils/dates');

async function index(req, res, next) {
  try {
    const dashboard = await dashboardService.getDashboard();
    res.render('dashboard/index', {
      title: 'Dashboard',
      dashboard,
      showNewBookings: req.query.showNew === '1' || req.query.section === 'new-bookings',
      humanize,
      formatDate
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { index };
