const followUpService = require('../services/followUpService');
const enquiryService = require('../services/enquiryService');
const { followUpStatuses, humanize } = require('../utils/status');
const { formatDate } = require('../utils/dates');
const { buildPagination } = require('../utils/pagination');

async function index(req, res, next) {
  try {
    const result = await followUpService.paginateFollowUps(req.query);
    res.render('followUps/index', {
      title: 'Follow-ups',
      subtitle: 'List and queue',
      followUps: result.items,
      pagination: buildPagination('/follow-ups', req.query, result),
      filters: req.query,
      statuses: followUpStatuses,
      humanize,
      formatDate
    });
  } catch (error) {
    next(error);
  }
}

async function newPage(req, res, next) {
  try {
    const enquiries = await enquiryService.listEnquiries({});
    res.render('followUps/new', {
      title: 'Create Follow-up',
      subtitle: 'Add task',
      enquiries,
      statuses: followUpStatuses,
      followUp: {},
      prefill: req.query || {},
      humanize,
      formatDate
    });
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  try {
    const followUp = await followUpService.createFollowUp(req.body, req.admin.email);
    const returnTo = req.body.returnTo;
    if (returnTo && returnTo.startsWith('/')) return res.redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}flash=Follow-up created`);
    res.redirect(`/follow-ups/${followUp.id}?flash=Follow-up created`);
  } catch (error) {
    next(error);
  }
}

async function show(req, res, next) {
  try {
    const followUp = await followUpService.getFollowUp(req.params.id);
    if (!followUp) return res.status(404).render('errors/404', { title: 'Follow-up not found' });
    const enquiry = followUp.enquiryId ? await enquiryService.getEnquiry(followUp.enquiryId) : null;
    res.render('followUps/show', {
      title: followUp.title || 'Follow-up',
      subtitle: 'Task detail',
      followUp,
      enquiry,
      statuses: followUpStatuses,
      humanize,
      formatDate
    });
  } catch (error) {
    next(error);
  }
}

async function edit(req, res, next) {
  try {
    const [followUp, enquiries] = await Promise.all([
      followUpService.getFollowUp(req.params.id),
      enquiryService.listEnquiries({})
    ]);
    if (!followUp) return res.status(404).render('errors/404', { title: 'Follow-up not found' });
    res.render('followUps/edit', {
      title: 'Edit Follow-up',
      subtitle: followUp.title,
      followUp,
      enquiries,
      statuses: followUpStatuses,
      humanize,
      formatDate
    });
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const meaningfulKeys = Object.keys(req.body).filter((key) => key !== 'returnTo');
    if (req.body.status && meaningfulKeys.length === 1) {
      await followUpService.updateFollowUpStatus(req.params.id, req.body.status, req.admin.email);
    } else {
      await followUpService.updateFollowUp(req.params.id, req.body, req.admin.email);
    }
    const returnTo = req.body.returnTo || `/follow-ups/${req.params.id}`;
    res.redirect(`${returnTo}?flash=Follow-up updated`);
  } catch (error) {
    next(error);
  }
}

module.exports = { index, newPage, create, show, edit, update };
