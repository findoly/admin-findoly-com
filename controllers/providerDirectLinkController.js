"use strict";

const service = require("../services/enquiry/provider-direct-link-service");

async function create(req, res, next) {
  try {
    const result = await service.createProviderDirectLink(
      req.params.enquiryId,
      req.params.providerId,
    );
    console.info({
      event: "provider_direct_lead_link_created",
      enquiryId: result.enquiryId,
      providerId: result.providerId,
      actor: req.admin?.email || "admin",
    });
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create };
