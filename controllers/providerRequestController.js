const service = require("../services/provider-request/provider-request-service");

async function metadata(req, res, next) {
  try {
    return res.json({ success: true, data: await service.metadata() });
  } catch (error) {
    return next(error);
  }
}

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
    return res.json({ success: true, data: await service.get(req.params.providerJoinRequestId) });
  } catch (error) {
    return next(error);
  }
}

async function updateStatus(req, res, next) {
  try {
    return res.json({
      success: true,
      data: await service.updateStatus(req.params.providerJoinRequestId, req.body, req.admin),
    });
  } catch (error) {
    return next(error);
  }
}

async function convert(req, res, next) {
  try {
    const data = await service.convert(req.params.providerJoinRequestId, req.body, req.admin);
    return res.status(data.existing ? 200 : 201).json({
      success: true,
      message: data.existing
        ? "The provider already existed and the request was linked to that account"
        : "Provider account created and request converted successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { metadata, list, get, updateStatus, convert };
