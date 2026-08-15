const service = require("../services/website-content/website-content-service");
const catalogImport = require("../services/website-content/catalog-import-service");

function actor(req) { return req.admin || "crm-admin"; }

async function listMedia(req, res, next) { try { res.json({ success: true, data: await service.listMedia(req.query) }); } catch (e) { next(e); } }
async function mediaUploadUrl(req, res, next) { try { res.status(201).json({ success: true, data: await service.createMediaUpload(req.body) }); } catch (e) { next(e); } }
async function registerMedia(req, res, next) { try { res.status(201).json({ success: true, data: await service.registerMedia(req.body, actor(req)) }); } catch (e) { next(e); } }
async function updateMedia(req, res, next) { try { res.json({ success: true, data: await service.updateMedia(req.params.mediaId, req.body, actor(req)) }); } catch (e) { next(e); } }
async function mediaUsage(req, res, next) { try { res.json({ success: true, data: await service.mediaUsage(req.params.mediaId) }); } catch (e) { next(e); } }
async function deleteMedia(req, res, next) { try { res.json({ success: true, data: await service.deleteMedia(req.params.mediaId) }); } catch (e) { next(e); } }
async function listItems(req, res, next) { try { res.json({ success: true, data: await service.listItems(req.query) }); } catch (e) { next(e); } }
async function createItem(req, res, next) { try { res.status(201).json({ success: true, data: await service.createItem(req.body, actor(req)) }); } catch (e) { next(e); } }
async function updateItem(req, res, next) { try { res.json({ success: true, data: await service.updateItem(req.params.itemId, req.body, actor(req)) }); } catch (e) { next(e); } }
async function deleteItem(req, res, next) { try { res.json({ success: true, data: await service.deleteItem(req.params.itemId) }); } catch (e) { next(e); } }

async function catalogImportPreview(req, res, next) {
  try {
    const upload = catalogImport.decodeCsvUpload(req.body);
    return res.json({ success: true, data: await catalogImport.buildPreview(upload.buffer, upload.fileName) });
  } catch (e) {
    if (e?.preview) return res.status(e.status || 422).json({ success: false, message: e.message, data: e.preview });
    return next(e);
  }
}
async function prepareCatalogImport(req, res, next) {
  try {
    return res.status(201).json({ success: true, data: await catalogImport.prepareImport(req.body, actor(req)) });
  } catch (e) {
    if (e?.preview) return res.status(e.status || 422).json({ success: false, message: e.message, data: e.preview });
    return next(e);
  }
}
async function executeCatalogImport(req, res, next) {
  try {
    return res.json({ success: true, data: await catalogImport.executeImport(req.params.importId, actor(req)) });
  } catch (e) {
    if (e?.preview) return res.status(e.status || 409).json({ success: false, message: e.message, data: e.preview });
    return next(e);
  }
}
async function catalogImportHistory(req, res, next) {
  try { return res.json({ success: true, data: await catalogImport.listImportHistory(req.query) }); } catch (e) { return next(e); }
}
async function catalogImportTemplate(req, res, next) {
  try {
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", 'attachment; filename="findoly-catalog-import-template.csv"');
    return res.send(catalogImport.templateCsv());
  } catch (e) { return next(e); }
}

async function homepage(req, res, next) { try { res.json({ success: true, data: await service.homepageAdmin() }); } catch (e) { next(e); } }
async function saveHomepage(req, res, next) { try { res.json({ success: true, data: await service.saveHomepageDraft(req.body, actor(req)) }); } catch (e) { next(e); } }
async function publishHomepage(req, res, next) { try { res.json({ success: true, data: await service.publishHomepage(actor(req)) }); } catch (e) { next(e); } }

module.exports = { listMedia, mediaUploadUrl, registerMedia, updateMedia, mediaUsage, deleteMedia, listItems, createItem, updateItem, deleteItem, catalogImportPreview, prepareCatalogImport, executeCatalogImport, catalogImportHistory, catalogImportTemplate, homepage, saveHomepage, publishHomepage };
