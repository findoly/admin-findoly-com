const service = require("../services/enquiry/enquiry-service");
const nearbyProviderService = require("../services/enquiry/nearby-provider-service");
const leadQualificationService = require("../services/lead-qualification/lead-qualification-service");
const { resolveRequirementLocation } = require("../utils/requirement-location");

function withEffectiveLocation(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const resolved = resolveRequirementLocation(data);
  if (!resolved) return data;
  return {
    ...data,
    locationLatitude: resolved.latitude,
    locationLongitude: resolved.longitude,
    locationPincode: data.locationPincode || resolved.pincode || data.pincode || "",
    locationSource: data.locationSource || resolved.source,
  };
}

function withEffectiveLocationList(result = {}) {
  return {
    ...result,
    data: Array.isArray(result.data) ? result.data.map(withEffectiveLocation) : result.data,
  };
}

async function list(req, res, next) {
  try {
    const result = await service.list(req.query);
    res.json({ success: true, ...withEffectiveLocationList(result) });
  } catch (error) {
    next(error);
  }
}

async function get(req, res, next) {
  try {
    res.json({ success: true, data: withEffectiveLocation(await service.get(req.params.enquiryId)) });
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  try {
    res.status(201).json({
      success: true,
      data: withEffectiveLocation(await service.create(req.body, req.admin?.email || "api")),
    });
  } catch (error) {
    next(error);
  }
}

async function createPublic(req, res, next) {
  try {
    res.status(201).json({
      success: true,
      data: withEffectiveLocation(await service.create(req.body, "public-api")),
    });
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    await leadQualificationService.assertDirectLeadValueEditAllowed(
      req.params.enquiryId,
      req.body,
    );
    res.json({
      success: true,
      data: withEffectiveLocation(await service.update(
        req.params.enquiryId,
        req.body,
        req.admin?.email || "admin",
      )),
    });
  } catch (error) {
    next(error);
  }
}

async function status(req, res, next) {
  try {
    await leadQualificationService.assertJourneyTransitionAllowed(req.params.enquiryId, req.body);
    res.json({
      success: true,
      data: withEffectiveLocation(await service.updateStatus(
        req.params.enquiryId,
        req.body,
        req.admin?.email || "admin",
      )),
    });
  } catch (error) {
    next(error);
  }
}

async function qualification(req, res, next) {
  try {
    res.json({
      success: true,
      data: await leadQualificationService.getQualification(req.params.enquiryId),
    });
  } catch (error) {
    next(error);
  }
}

async function qualificationPreview(req, res, next) {
  try {
    res.json({
      success: true,
      data: await leadQualificationService.previewQualification(req.params.enquiryId, req.body),
    });
  } catch (error) {
    next(error);
  }
}

async function saveQualification(req, res, next) {
  try {
    const result = await leadQualificationService.saveQualification(
      req.params.enquiryId,
      req.body,
      req.admin?.email || "admin",
    );
    res.json({
      success: true,
      data: {
        qualification: result.qualification,
        lead: withEffectiveLocation(result.lead),
      },
    });
  } catch (error) {
    next(error);
  }
}

async function referralValidation(req, res, next) {
  try {
    res.json({ success: true, data: withEffectiveLocation(await service.updateAgentReferralValidation(req.params.enquiryId, req.body, req.admin?.email || "admin")) });
  } catch (error) { next(error); }
}

async function saleConversion(req, res, next) {
  try {
    res.json({ success: true, data: withEffectiveLocation(await service.updateAgentSaleConversion(req.params.enquiryId, req.body, req.admin?.email || "admin")) });
  } catch (error) { next(error); }
}

async function note(req, res, next) {
  try {
    res.json({
      success: true,
      data: withEffectiveLocation(await service.addNote(
        req.params.enquiryId,
        req.body?.note,
        req.admin?.email || "admin",
      )),
    });
  } catch (error) {
    next(error);
  }
}

async function deactivate(req, res, next) {
  try {
    res.json({
      success: true,
      data: withEffectiveLocation(await service.setActiveState(
        req.params.enquiryId,
        false,
        { reason: req.body?.reason },
        req.admin?.email || "admin",
      )),
    });
  } catch (error) {
    next(error);
  }
}

async function reactivate(req, res, next) {
  try {
    res.json({
      success: true,
      data: withEffectiveLocation(await service.setActiveState(
        req.params.enquiryId,
        true,
        {},
        req.admin?.email || "admin",
      )),
    });
  } catch (error) {
    next(error);
  }
}

async function providerStatuses(req, res, next) {
  try {
    const result = await service.listProviderUnlocks(
      req.params.enquiryId,
      req.query,
    );
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function nearbyProviders(req, res, next) {
  try {
    const result = await nearbyProviderService.listNearbyProviders(
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
      data: await service.getProviderUnlock(
        req.params.enquiryId,
        req.params.providerLeadUnlockId,
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
  qualification,
  qualificationPreview,
  saveQualification,
  referralValidation,
  saleConversion,
  note,
  deactivate,
  reactivate,
  providerStatuses,
  nearbyProviders,
  providerStatus,
};
