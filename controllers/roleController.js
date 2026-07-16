const service = require("../services/access/role-service");

async function list(req, res, next) {
  try { return res.json({ success: true, data: await service.list() }); }
  catch (error) { return next(error); }
}
async function metadata(req, res, next) {
  try { return res.json({ success: true, data: service.metadata() }); }
  catch (error) { return next(error); }
}
async function get(req, res, next) {
  try { return res.json({ success: true, data: await service.get(req.params.roleId) }); }
  catch (error) { return next(error); }
}
async function create(req, res, next) {
  try { return res.status(201).json({ success: true, data: await service.create(req.body, req.admin) }); }
  catch (error) { return next(error); }
}
async function update(req, res, next) {
  try { return res.json({ success: true, data: await service.update(req.params.roleId, req.body, req.admin) }); }
  catch (error) { return next(error); }
}
module.exports = { list, metadata, get, create, update };
