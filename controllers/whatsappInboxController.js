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
  markRead,
  markUnread,
  updateStatus,
};
