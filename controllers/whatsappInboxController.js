"use strict";

const service = require("../services/communication/whatsapp-inbox-service");

function actor(req) {
  return req.admin?.email || req.admin?.mobile || "api";
}

async function listConversations(req, res, next) {
  try {
    const result = await service.listConversations(req.query || {});
    res.json({ success: true, data: result.data, pagination: result.pagination });
  } catch (error) {
    next(error);
  }
}

async function getConversation(req, res, next) {
  try {
    res.json({ success: true, data: await service.getConversation(req.params.conversationId) });
  } catch (error) {
    next(error);
  }
}

async function listMessages(req, res, next) {
  try {
    const result = await service.listMessages(req.params.conversationId, req.query || {});
    res.json({ success: true, data: result.data, pagination: result.pagination });
  } catch (error) {
    console.error({
      event: "whatsapp_inbox_message_list_failed",
      requestId: req.requestId || req.id || "",
      conversationId: String(req.params.conversationId || "").slice(0, 120),
      code: String(error.code || "WHATSAPP_INBOX_MESSAGE_LIST_FAILED"),
      message: service.safeLogMessage(error.message, "WhatsApp inbox message list failed"),
    });
    next(error);
  }
}

async function reply(req, res, next) {
  try {
    const data = await service.reply(req.params.conversationId, req.body || {}, req.admin || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}


async function getMedia(req, res, next) {
  try {
    const media = await service.getMessageMedia(req.params.messageId, req.query?.disposition);
    res.set("Cache-Control", "private, no-store, max-age=0");
    res.redirect(302, media.url);
  } catch (error) {
    next(error);
  }
}

async function markRead(req, res, next) {
  try {
    res.json({ success: true, data: await service.markRead(req.params.conversationId, actor(req)) });
  } catch (error) {
    next(error);
  }
}

async function markUnread(req, res, next) {
  try {
    res.json({ success: true, data: await service.markUnread(req.params.conversationId) });
  } catch (error) {
    next(error);
  }
}

async function updateStatus(req, res, next) {
  try {
    res.json({
      success: true,
      data: await service.updateConversationStatus(
        req.params.conversationId,
        req.body?.status,
        actor(req),
      ),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listConversations,
  getConversation,
  listMessages,
  reply,
  getMedia,
  markRead,
  markUnread,
  updateStatus,
};
