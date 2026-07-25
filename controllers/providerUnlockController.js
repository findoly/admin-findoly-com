const service = require("../services/provider-unlock/provider-unlock-service");

async function list(req, res, next) {
  try {
    const result = await service.list(req.query);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

module.exports = { list };
