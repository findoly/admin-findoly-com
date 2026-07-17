const service = require("../services/provider/provider-service");

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
    res.status(201).json({ success: true, data: await service.create(req.body) });
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    res.json({
      success: true,
      data: await service.update(req.params.providerId, req.body),
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
