const service = require("../services/billing/provider-subscription-service");

async function list(req, res, next) {
  try {
    const result = await service.list(req.query);
    return res.json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
}

async function get(req, res, next) {
  try {
    return res.json({ success: true, data: await service.get(req.params.providerSubscriptionId) });
  } catch (error) {
    return next(error);
  }
}

module.exports = { list, get };
