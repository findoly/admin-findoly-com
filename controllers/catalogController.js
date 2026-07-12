const service = require("../services/catalog/catalog-service");

async function categories(req, res, next) {
  try {
    if (String(req.query.paginate) === "true") {
      const result = await service.listCategoryPage(req.query);
      return res.json({ success: true, ...result });
    }
    return res.json({
      success: true,
      data: await service.listCategories({
        includeInactive: req.query.includeInactive,
      }),
    });
  } catch (e) {
    return next(e);
  }
}

async function createCategory(req, res, next) {
  try {
    res.status(201).json({
      success: true,
      data: await service.createCategory(req.body),
    });
  } catch (e) {
    next(e);
  }
}

async function updateCategory(req, res, next) {
  try {
    res.json({
      success: true,
      data: await service.updateCategory(req.params.categoryId, req.body),
    });
  } catch (e) {
    next(e);
  }
}

module.exports = { categories, createCategory, updateCategory };
