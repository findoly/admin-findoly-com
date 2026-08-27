const service = require("../services/enquiry/enquiry-service");
const nearbyProviderService = require("../services/enquiry/nearby-provider-service");
const customerVerificationService = require("../services/enquiry/customer-verification-service");
const leadQualificationService = require("../services/lead-qualification/lead-qualification-service");
const leadValidationService = require("../services/lead-validation/lead-validation-service");
const requirementAiService = require("../services/requirement-ai/requirement-ai-service");
const enquiryLocationService = require("../services/location/enquiry-location-service");
const { resolveLeadStatusTransition } = require("../utils/lead-journey");
const { resolveRequirementLocation } = require("../utils/requirement-location");

function normalizeApprovedMobileVerification(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const status = String(data.journeyStatus || data.status || "").trim().toLowerCase();
  if (status !== "approved") return data;
  return {
    ...data,
    customerMobileVerified: true,
    customerMobileVerifiedAt: data.customerMobileVerifiedAt || data.statusUpdatedAt || null,
  };
}

function withEffectiveLocation(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const normalized = normalizeApprovedMobileVerification(data);
  const resolved = resolveRequirementLocation(normalized);
  if (!resolved) return normalized;
  return {
    ...normalized,
    locationLatitude: resolved.latitude,
    locationLongitude: resolved.longitude,
    locationPincode: normalized.locationPincode || resolved.pincode || normalized.pincode || "",
    locationSource: normalized.locationSource || resolved.source,
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
    const lead = await service.get(req.params.enquiryId);
    const verifiedLead = await customerVerificationService.ensureApprovedCustomerMobileVerified(lead);
    res.json({ success: true, data: withEffectiveLocation(verifiedLead) });
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  try {
    const createdLead = await service.create(req.body, req.admin?.email || "api");
    await enquiryLocationService.syncLeadLocation(createdLead);
    const refreshedLead = await service.get(createdLead.enquiryId);
    res.status(201).json({
      success: true,
      data: withEffectiveLocation(refreshedLead),
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
    const previousLead = await service.get(req.params.enquiryId);
    const updatedLead = await service.update(
      req.params.enquiryId,
      req.body,
      req.admin?.email || "admin",
    );
    const publishAlreadyFailedGeocoding = updatedLead.journeyStatus === "approved"
      && String(updatedLead.locationSource || "").toLowerCase() === "manual_pincode";
    if (!publishAlreadyFailedGeocoding) {
      await enquiryLocationService.syncLeadLocation(updatedLead, { previousLead });
    }
    const refreshedLead = await service.get(updatedLead.enquiryId);
    const verifiedLead = await customerVerificationService.ensureApprovedCustomerMobileVerified(refreshedLead);
    res.json({
      success: true,
      data: withEffectiveLocation(verifiedLead),
    });
  } catch (error) {
    next(error);
  }
}

async function status(req, res, next) {
  let verificationPreparation = null;
  try {
    await leadQualificationService.assertJourneyTransitionAllowed(req.params.enquiryId, req.body);
    const currentLead = await service.get(req.params.enquiryId);
    const transition = resolveLeadStatusTransition(
      currentLead.status || currentLead.journeyStatus,
      req.body,
      currentLead.metadata || {},
    );
    if (transition.toStatus === "approved") {
      verificationPreparation = await customerVerificationService.prepareApprovalCustomerMobileVerification(currentLead);
    }

    const changedLead = await service.updateStatus(
      req.params.enquiryId,
      req.body,
      req.admin?.email || "admin",
    );
    const verifiedLead = await customerVerificationService.ensureApprovedCustomerMobileVerified(changedLead);
    res.json({
      success: true,
      data: withEffectiveLocation(verifiedLead),
    });
  } catch (error) {
    if (verificationPreparation) {
      await customerVerificationService.rollbackPreparedApprovalCustomerMobileVerification(
        verificationPreparation,
      );
    }
    next(error);
  }
}

async function validation(req, res, next) {
  try {
    res.json({
      success: true,
      data: await leadValidationService.getValidation(req.params.enquiryId),
    });
  } catch (error) {
    next(error);
  }
}

async function validationPreview(req, res, next) {
  try {
    res.json({
      success: true,
      data: await leadValidationService.previewValidation(req.params.enquiryId, req.body),
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
    const result = await leadValidationService.saveValidation(
      req.params.enquiryId,
      req.body,
      req.admin?.email || "admin",
    );
    res.json({
      success: true,
      data: withEffectiveLocation(result.lead),
      validation: result.validation,
    });
  } catch (error) { next(error); }
}

async function generateRequirement(req, res, next) {
  try {
    const result = await requirementAiService.generateRequirement(
      req.params.enquiryId,
      req.body,
      req.admin?.email || "admin",
    );
    res.json({
      success: true,
      data: {
        lead: withEffectiveLocation(result.lead),
        requirement: result.requirement,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function approveRequirement(req, res, next) {
  try {
    const result = await requirementAiService.approveRequirement(
      req.params.enquiryId,
      req.body,
      req.admin?.email || "admin",
    );
    res.json({
      success: true,
      data: {
        lead: withEffectiveLocation(result.lead),
        requirement: result.requirement,
      },
    });
  } catch (error) {
    next(error);
  }
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
  validation,
  validationPreview,
  qualification,
  qualificationPreview,
  saveQualification,
  referralValidation,
  generateRequirement,
  approveRequirement,
  saleConversion,
  note,
  deactivate,
  reactivate,
  providerStatuses,
  nearbyProviders,
  providerStatus,
};
