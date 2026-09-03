const service = require("../services/provider/provider-health-service");

async function list(req, res, next) {
  try {
    const result = await service.list(req.query);
    return res.json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
}

module.exports = { list };
