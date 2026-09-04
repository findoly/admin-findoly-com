"use strict";

const service = require("../services/communication/provider-plan-email-service");

async function integrationEvent(req, res, next) {
  try {
    const result = await service.dispatch(req.body || {});
    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { integrationEvent };
