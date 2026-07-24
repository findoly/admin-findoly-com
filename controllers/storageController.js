const storageService = require("../services/storage/s3-service");

async function config(req, res, next) {
  try {
    return res.json({ success: true, data: storageService.publicConfig() });
  } catch (error) {
    return next(error);
  }
}

async function list(req, res, next) {
  try {
    return res.json({ success: true, data: await storageService.list(req.query) });
  } catch (error) {
    return next(error);
  }
}

async function createFolder(req, res, next) {
  try {
    return res.status(201).json({ success: true, data: await storageService.createFolder(req.body) });
  } catch (error) {
    return next(error);
  }
}

async function createUploadUrl(req, res, next) {
  try {
    return res.status(201).json({ success: true, data: await storageService.createUploadUrl(req.body) });
  } catch (error) {
    return next(error);
  }
}

async function createDownloadUrl(req, res, next) {
  try {
    return res.json({ success: true, data: await storageService.createDownloadUrl(req.body) });
  } catch (error) {
    return next(error);
  }
}

module.exports = { config, list, createFolder, createUploadUrl, createDownloadUrl };
