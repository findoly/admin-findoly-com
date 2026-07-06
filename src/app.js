require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const morgan = require('morgan');
const methodOverride = require('method-override');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const enquiryRoutes = require('./routes/enquiryRoutes');
const providerRoutes = require('./routes/providerRoutes');
const followUpRoutes = require('./routes/followUpRoutes');
const billingRoutes = require('./routes/billingRoutes');
const catalogRoutes = require('./routes/catalogRoutes');
const communicationRoutes = require('./routes/communicationRoutes');
const reportRoutes = require('./routes/reportRoutes');
const searchRoutes = require('./routes/searchRoutes');
const apiRoutes = require('./routes/apiRoutes');
const { requireAdmin, attachAdmin } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errors');
const { branding } = require('./config/branding');
const dashboardService = require('./services/dashboardService');
const { enquiryQueues } = require('./utils/status');

const app = express();

app.set('views', path.join(__dirname, '..', 'views'));
app.set('view engine', 'ejs');

// app.use(rateLimit({
//   windowMs: 60 * 1000,
//   limit: 500,
//   standardHeaders: true,
//   legacyHeaders: false
// }));

app.use(cors());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(methodOverride('_method'));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(attachAdmin);

app.use(async (req, res, next) => {
  res.locals.branding = branding;
  res.locals.currentPath = req.path;
  res.locals.admin = req.admin;
  res.locals.flash = req.query.flash || '';
  res.locals.enquiryQueues = enquiryQueues;
  res.locals.navCounts = {
    queues: enquiryQueues.reduce((acc, queue) => ({ ...acc, [queue.key]: 0 }), {}),
    enquiries: 0,
    providers: 0,
    openFollowUps: 0,
    invoices: 0
  };

  if (!req.admin || req.path.startsWith('/api')) return next();

  res.locals.navCounts = await dashboardService.getNavigationCounts();
  return next();
});

app.get('/', (req, res) => {
  if (req.admin) return res.redirect('/dashboard');
  return res.redirect('/login');
});

app.use('/', authRoutes);
app.use('/api', apiRoutes);
app.use('/dashboard', requireAdmin, dashboardRoutes);
app.get('/bookings', requireAdmin, (req, res) => res.redirect('/enquiries/queue/new'));
app.get('/bookings/:queueKey', requireAdmin, (req, res) => res.redirect(`/enquiries/queue/${req.params.queueKey}`));
app.use('/enquiries', requireAdmin, enquiryRoutes);
app.use('/providers', requireAdmin, providerRoutes);
app.use('/search', requireAdmin, searchRoutes);
app.use('/follow-ups', requireAdmin, followUpRoutes);
app.use('/billing', requireAdmin, billingRoutes);
app.use('/catalog', requireAdmin, catalogRoutes);
app.use('/communications', requireAdmin, communicationRoutes);
app.use('/reports', requireAdmin, reportRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
