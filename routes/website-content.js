const router = require("express").Router();
const controller = require("../controllers/websiteContentController");
const { requirePermission } = require("../middleware/auth");

router.get("/media", requirePermission("websiteContent.view"), controller.listMedia);
router.post("/media/upload-url", requirePermission("websiteContent.manage"), controller.mediaUploadUrl);
router.post("/media", requirePermission("websiteContent.manage"), controller.registerMedia);
router.patch("/media/:mediaId", requirePermission("websiteContent.manage"), controller.updateMedia);
router.get("/media/:mediaId/usage", requirePermission("websiteContent.view"), controller.mediaUsage);
router.delete("/media/:mediaId", requirePermission("websiteContent.manage"), controller.deleteMedia);
router.get("/items", requirePermission("websiteContent.view"), controller.listItems);
router.post("/items", requirePermission("websiteContent.manage"), controller.createItem);
router.put("/items/:itemId", requirePermission("websiteContent.manage"), controller.updateItem);
router.patch("/items/:itemId", requirePermission("websiteContent.manage"), controller.updateItem);
router.get("/homepage", requirePermission("websiteContent.view"), controller.homepage);
router.put("/homepage", requirePermission("websiteContent.manage"), controller.saveHomepage);
router.post("/homepage/publish", requirePermission("websiteContent.publish"), controller.publishHomepage);

module.exports = router;
