const service = require("../services/agent/agent-service");
async function list(req, res, next) { try { const result = await service.list(req.query); res.json({ success: true, ...result }); } catch (error) { next(error); } }
async function get(req, res, next) { try { res.json({ success: true, data: await service.get(req.params.agentId) }); } catch (error) { next(error); } }
async function create(req, res, next) { try { res.status(201).json({ success: true, data: await service.create(req.body, req.admin) }); } catch (error) { next(error); } }
async function update(req, res, next) { try { res.json({ success: true, data: await service.update(req.params.agentId, req.body, req.admin) }); } catch (error) { next(error); } }
async function requirements(req, res, next) { try { const result = await service.requirements(req.params.agentId, req.query); res.json({ success: true, ...result }); } catch (error) { next(error); } }
module.exports = { list, get, create, update, requirements };
