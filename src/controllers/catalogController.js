const catalogService = require('../services/catalogService');
const { humanize } = require('../utils/status');

async function categories(req, res, next) {
  try {
    const [categories, templates, sourceWebsites] = await Promise.all([
      catalogService.listCategories(),
      catalogService.listTemplates(),
      catalogService.listSourceWebsites()
    ]);
    res.render('catalog/categories', {
      title: 'Categories & Forms',
      categories,
      templates,
      sourceWebsites,
      fieldTypes: catalogService.FIELD_TYPES,
      humanize
    });
  } catch (error) {
    next(error);
  }
}

async function createCategory(req, res, next) {
  try {
    await catalogService.createCategory(req.body, req.admin.email);
    res.redirect('/catalog/categories?flash=Service module created');
  } catch (error) {
    next(error);
  }
}

async function templates(req, res, next) {
  try {
    const [templates, categories, sourceWebsites] = await Promise.all([
      catalogService.listTemplates(),
      catalogService.listCategories(),
      catalogService.listSourceWebsites()
    ]);
    res.render('catalog/templates', {
      title: 'Form Templates',
      templates,
      categories,
      sourceWebsites,
      fieldTypes: catalogService.FIELD_TYPES,
      humanize
    });
  } catch (error) {
    next(error);
  }
}

async function createTemplate(req, res, next) {
  try {
    await catalogService.createTemplate(req.body, req.admin.email);
    res.redirect('/catalog/templates?flash=Form template created');
  } catch (error) {
    next(error);
  }
}

module.exports = { categories, createCategory, templates, createTemplate };
