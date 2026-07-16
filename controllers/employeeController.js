const service = require("../services/access/employee-service");

async function list(req, res, next) {
  try {
    const result = await service.list(req.query);
    return res.json({ success: true, ...result });
  } catch (error) { return next(error); }
}
async function metadata(req, res, next) {
  try { return res.json({ success: true, data: await service.metadata() }); }
  catch (error) { return next(error); }
}
async function get(req, res, next) {
  try { return res.json({ success: true, data: await service.get(req.params.employeeId) }); }
  catch (error) { return next(error); }
}
async function create(req, res, next) {
  try { return res.status(201).json({ success: true, data: await service.create(req.body, req.admin) }); }
  catch (error) { return next(error); }
}
async function update(req, res, next) {
  try { return res.json({ success: true, data: await service.update(req.params.employeeId, req.body, req.admin) }); }
  catch (error) { return next(error); }
}
module.exports = { list, metadata, get, create, update };
