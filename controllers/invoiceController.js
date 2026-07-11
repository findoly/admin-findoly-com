const service = require("../services/invoice/invoice-service");
async function list(req, res, next) {
  try {
    const result = await service.list(req.query);
    res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
}
async function get(req, res, next) {
  try {
    res.json({ success: true, data: await service.get(req.params.invoiceId) });
  } catch (e) {
    next(e);
  }
}
async function create(req, res, next) {
  try {
    res
      .status(201)
      .json({ success: true, data: await service.create(req.body) });
  } catch (e) {
    next(e);
  }
}
async function update(req, res, next) {
  try {
    res.json({
      success: true,
      data: await service.update(req.params.invoiceId, req.body),
    });
  } catch (e) {
    next(e);
  }
}
module.exports = { list, get, create, update };
