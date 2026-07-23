const service = require("../services/customer-portal/customer-portal-service");

async function categories(req, res, next) {
  try {
    return res.json({ success: true, data: await service.categories() });
  } catch (error) {
    return next(error);
  }
}

async function createEnquiry(req, res, next) {
  try {
    return res.status(201).json({
      success: true,
      data: await service.createEnquiry(req.body),
    });
  } catch (error) {
    return next(error);
  }
}

async function listEnquiries(req, res, next) {
  try {
    return res.json({
      success: true,
      data: await service.listEnquiries(req.query.mobile, req.query),
    });
  } catch (error) {
    return next(error);
  }
}

async function getEnquiry(req, res, next) {
  try {
    return res.json({
      success: true,
      data: await service.getEnquiry(req.query.mobile, req.params.enquiryId),
    });
  } catch (error) {
    return next(error);
  }
}

async function cancelEnquiry(req, res, next) {
  try {
    return res.json({
      success: true,
      data: await service.cancelEnquiry(req.body.mobile, req.params.enquiryId),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  categories,
  createEnquiry,
  listEnquiries,
  getEnquiry,
  cancelEnquiry,
};
