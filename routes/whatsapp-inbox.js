"use strict";

const router = require("express").Router();
const controller = require("../controllers/whatsappInboxController");
const { requirePermission } = require("../middleware/auth");

router.get("/conversations", requirePermission("communications.view"), controller.listConversations);
router.get("/conversations/:conversationId", requirePermission("communications.view"), controller.getConversation);
router.get("/conversations/:conversationId/messages", requirePermission("communications.view"), controller.listMessages);
router.post("/conversations/:conversationId/reply", requirePermission("communications.send"), controller.reply);
router.get("/messages/:messageId/media", requirePermission("communications.view"), controller.getMedia);
router.post("/conversations/:conversationId/read", requirePermission("communications.view"), controller.markRead);
router.post("/conversations/:conversationId/unread", requirePermission("communications.view"), controller.markUnread);
router.patch("/conversations/:conversationId/status", requirePermission("communications.view"), controller.updateStatus);

module.exports = router;
