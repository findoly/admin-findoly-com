const router = require("express").Router();
const controller = require("../controllers/storageController");
const { requirePermission } = require("../middleware/auth");

router.get("/config", requirePermission("storage.view"), controller.config);
router.get("/", requirePermission("storage.view"), controller.list);
router.post("/folders", requirePermission("storage.manage"), controller.createFolder);
router.post("/upload-url", requirePermission("storage.manage"), controller.createUploadUrl);
router.post("/download-url", requirePermission("storage.view"), controller.createDownloadUrl);

module.exports = router;
