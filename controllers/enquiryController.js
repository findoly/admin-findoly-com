const service = require("../services/enquiry/enquiry-service");

async function list(req, res, next) {
  try {
    const result = await service.list(req.query);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function get(req, res, next) {
  try {
    res.json({ success: true, data: await service.get(req.params.enquiryId) });
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  try {
    res.status(201).json({
      success: true,
      data: await service.create(req.body, req.admin?.email || "api"),
    });
  } catch (error) {
    next(error);
  }
}

async function createPublic(req, res, next) {
  try {
    res.status(201).json({
      success: true,
      data: await service.create(req.body, "public-api"),
    });
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    res.json({
      success: true,
      data: await service.update(
        req.params.enquiryId,
        req.body,
        req.admin?.email || "admin",
      ),
    });
  } catch (error) {
    next(error);
  }
}

async function status(req, res, next) {
  try {
    res.json({
      success: true,
      data: await service.updateStatus(
        req.params.enquiryId,
        req.body,
        req.admin?.email || "admin",
      ),
    });
  } catch (error) {
    next(error);
  }
}

async function referralValidation(req, res, next) {
  try {
    res.json({ success: true, data: await service.updateAgentReferralValidation(req.params.enquiryId, req.body, req.admin?.email || "admin") });
  } catch (error) { next(error); }
}

async function saleConversion(req, res, next) {
  try {
    res.json({ success: true, data: await service.updateAgentSaleConversion(req.params.enquiryId, req.body, req.admin?.email || "admin") });
  } catch (error) { next(error); }
}

async function note(req, res, next) {
  try {
    res.json({
      success: true,
      data: await service.addNote(
        req.params.enquiryId,
        req.body?.note,
        req.admin?.email || "admin",
      ),
    });
  } catch (error) {
    next(error);
  }
}

async function distribute(req, res, next) {
  try {
    const lead = await service.get(req.params.enquiryId);
    if (!lead.isActive) {
      throw Object.assign(
        new Error("Reactivate the lead before synchronizing providers"),
        { status: 409 },
      );
    }
    if (!["distributed", "sale_converted"].includes(lead.journeyStatus)) {
      throw Object.assign(
        new Error("Move the lead to Distributed before publishing it to the marketplace"),
        { status: 400 },
      );
    }
    res.json({
      success: true,
      data: await service.distribute(lead, req.admin?.email || "admin"),
    });
  } catch (error) {
    next(error);
  }
}

async function deactivate(req, res, next) {
  try {
    res.json({
      success: true,
      data: await service.setActiveState(
        req.params.enquiryId,
        false,
        { reason: req.body?.reason },
        req.admin?.email || "admin",
      ),
    });
  } catch (error) {
    next(error);
  }
}

async function reactivate(req, res, next) {
  try {
    res.json({
      success: true,
      data: await service.setActiveState(
        req.params.enquiryId,
        true,
        {},
        req.admin?.email || "admin",
      ),
    });
  } catch (error) {
    next(error);
  }
}

async function providerStatuses(req, res, next) {
  try {
    const result = await service.listProviderStatuses(
      req.params.enquiryId,
      req.query,
    );
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function providerStatus(req, res, next) {
  try {
    res.json({
      success: true,
      data: await service.getProviderStatus(
        req.params.enquiryId,
        req.params.leadDistributionId,
      ),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  list,
  get,
  create,
  createPublic,
  update,
  status,
  referralValidation,
  saleConversion,
  note,
  distribute,
  deactivate,
  reactivate,
  providerStatuses,
  providerStatus,
};
