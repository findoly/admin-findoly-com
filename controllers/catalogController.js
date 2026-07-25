const service = require("../services/catalog/catalog-service");

async function categories(req, res, next) {
  try {
    if (String(req.query.paginate) === "true") {
      const result = await service.listCategoryPage(req.query);
      return res.json({ success: true, ...result });
    }
    return res.json({
      success: true,
      data: await service.listCategories({ includeInactive: req.query.includeInactive }),
    });
  } catch (error) {
    return next(error);
  }
}

async function createCategory(req, res, next) {
  try {
    return res.status(201).json({ success: true, data: await service.createCategory(req.body) });
  } catch (error) {
    return next(error);
  }
}

async function updateCategory(req, res, next) {
  try {
    return res.json({ success: true, data: await service.updateCategory(req.params.categoryId, req.body) });
  } catch (error) {
    return next(error);
  }
}

async function serviceTypes(req, res, next) {
  try {
    const result = await service.listServiceTypes({ ...req.query, categoryId: req.params.categoryId || req.query.categoryId });
    if (String(req.query.paginate) === "true") return res.json({ success: true, ...result });
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

async function createServiceType(req, res, next) {
  try {
    return res.status(201).json({
      success: true,
      data: await service.createServiceType(req.params.categoryId, req.body),
    });
  } catch (error) {
    return next(error);
  }
}

async function updateServiceType(req, res, next) {
  try {
    return res.json({
      success: true,
      data: await service.updateServiceType(req.params.serviceTypeId, req.body),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  categories,
  createCategory,
  updateCategory,
  serviceTypes,
  createServiceType,
  updateServiceType,
};
