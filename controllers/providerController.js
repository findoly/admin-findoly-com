const service = require("../services/provider/provider-service");
const creditService = require("../services/provider/provider-credit-service");

async function list(req, res, next) {
  try {
    const result = await service.list(req.query);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function get(req, res, next) {
  try {
    res.json({
      success: true,
      data: await service.get(req.params.providerId),
    });
  } catch (error) {
    next(error);
  }
}

async function distributions(req, res, next) {
  try {
    const result = await service.listDistributions(
      req.params.providerId,
      req.query,
    );
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function transactions(req, res, next) {
  try {
    const result = await service.listTransactions(
      req.params.providerId,
      req.query,
    );
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  try {
    res.status(201).json({ success: true, data: await service.create(req.body, req.admin?.email || req.admin?.employeeId || "crm-admin") });
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    res.json({
      success: true,
      data: await service.update(req.params.providerId, req.body, req.admin?.email || req.admin?.employeeId || "crm-admin"),
    });
  } catch (error) {
    next(error);
  }
}

async function sync(req, res, next) {
  try {
    const provider = await service.get(req.params.providerId);
    await service.syncApprovedLeads(provider);
    res.json({ success: true, message: "Provider leads synchronized" });
  } catch (error) {
    next(error);
  }
}


async function reviewOutcome(req, res, next) {
  try {
    res.json({
      success: true,
      data: await service.reviewProviderOutcome(
        req.params.providerId,
        req.params.leadDistributionId,
        req.body,
        req.admin?.email || "admin",
      ),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  list,
  get,
  distributions,
  transactions,
  create,
  update,
  sync,
  reviewOutcome,
};

module.exports.addCredits = async function addCredits(req, res, next) {
  try {
    const data = await creditService.addCredits(
      req.params.providerId,
      req.body,
      req.admin,
    );
    return res.status(data.duplicate ? 200 : 201).json({
      success: true,
      message: data.duplicate
        ? "This credit request was already processed"
        : "Credits added successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
};
