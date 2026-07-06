const providerService = require('../services/providerService');
const catalogService = require('../services/catalogService');
const { providerStatuses, humanize } = require('../utils/status');
const { formatDate } = require('../utils/dates');
const { buildPagination } = require('../utils/pagination');

async function index(req, res, next) {
  try {
    const [result, categories] = await Promise.all([
      providerService.paginateProviders(req.query),
      catalogService.listCategories()
    ]);
    res.render('providers/index', {
      title: 'Providers',
      providers: result.items,
      pagination: buildPagination('/providers', req.query, result),
      categories,
      filters: req.query,
      statuses: providerStatuses,
      humanize,
      formatDate
    });
  } catch (error) {
    next(error);
  }
}

async function showCreate(req, res, next) {
  try {
    const categories = await catalogService.listCategories();
    res.render('providers/create', {
      title: 'Create Provider',
      categories,
      statuses: providerStatuses,
      humanize
    });
  } catch (error) {
    next(error);
  }
}


async function showEdit(req, res, next) {
  try {
    const provider = await providerService.getProvider(req.params.id);
    if (!provider) return res.status(404).render('errors/404', { title: 'Provider not found' });
    const [categories, enquiries] = await Promise.all([
      catalogService.listCategories(),
      require('../services/enquiryService').listEnquiries({ assignedProviderId: provider.id })
    ]);
    res.render('providers/edit', {
      title: `Edit ${provider.name}`,
      subtitle: 'Provider profile edit',
      provider,
      categories,
      enquiries,
      statuses: providerStatuses,
      humanize,
      formatDate
    });
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  try {
    const provider = await providerService.createProvider(req.body, req.admin.email);
    res.redirect(`/providers/${provider.id}?flash=Provider created`);
  } catch (error) {
    next(error);
  }
}

async function show(req, res, next) {
  try {
    const provider = await providerService.getProvider(req.params.id);
    if (!provider) return res.status(404).render('errors/404', { title: 'Provider not found' });
    const [categories, enquiries] = await Promise.all([
      catalogService.listCategories(),
      require('../services/enquiryService').listEnquiries({ assignedProviderId: provider.id })
    ]);
    res.render('providers/show', {
      title: provider.name,
      provider,
      categories,
      enquiries,
      statuses: providerStatuses,
      humanize,
      formatDate
    });
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    await providerService.updateProvider(req.params.id, req.body, req.admin.email);
    res.redirect(`/providers/${req.params.id}?flash=Provider updated`);
  } catch (error) {
    next(error);
  }
}

module.exports = { index, showCreate, showEdit, create, show, update };
