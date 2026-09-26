"use strict";

const Enquiry = require("../../models/Enquiry");
const Provider = require("../../models/Provider");
const ProviderLeadUnlock = require("../../models/ProviderLeadUnlock");
const PaymentOrder = require("../../models/PaymentOrder");
const WalletTransaction = require("../../models/WalletTransaction");
const uuid = require("../../utils/uuid");
const { withTransaction } = require("../../utils/transaction");
const { identifierValue } = require("../../utils/validation");
const { normalizeSearchText } = require("../../utils/normalization");
const { leadCostCredits, paiseFromCredits, creditsFromPaise } = require("../../utils/credits");
const { resolveRequirementLocation } = require("../../utils/requirement-location");
const nearbyLeadAlertService = require("../communication/nearby-lead-alert-service");
const systemEventService = require("../communication/system-event-service");
const providerCreditService = require("../provider/provider-credit-service");
const assignmentService = require("./provider-assignment-service");

const MANUAL_ASSIGNMENT_RADIUS_KM = 100;

function actorLabel(actor = {}) {
  return String(
    actor.email
      || actor.employeeId
      || actor.name
      || actor
      || "crm-admin",
  ).trim() || "crm-admin";
}

function providerQuery(providerId) {
  const value = identifierValue(providerId, { label: "Provider ID" });
  return { $or: [{ providerId: value }, { id: value }] };
}

function enquiryQuery(enquiryId) {
  const value = identifierValue(enquiryId, { label: "Lead Reference ID" });
  return { $or: [{ enquiryId: value }, { id: value }] };
}

function validCoordinate(value, min, max) {
  if (value === null || value === undefined || String(value).trim() === "") return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
}

function providerCoordinatesEligible(provider = {}) {
  return String(provider.serviceLocationSource || "").trim().toLowerCase() !== "manual_pincode"
    && validCoordinate(provider.serviceLatitude, -90, 90)
    && validCoordinate(provider.serviceLongitude, -180, 180);
}

function providerPortalLeadUrl(enquiryId, env = process.env) {
  const rawBase = env.PROVIDER_PORTAL_BASE_URL
    || env.PROVIDER_PORTAL_LOGIN_URL
    || "https://provider.findoly.com";
  try {
    const url = new URL(rawBase);
    url.pathname = `/leads/${encodeURIComponent(String(enquiryId || ""))}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return `https://provider.findoly.com/leads/${encodeURIComponent(String(enquiryId || ""))}`;
  }
}

function assertLeadLifecycle(lead = {}, now = new Date()) {
  if (!lead || lead.status !== "approved" || lead.isActive === false) {
    throw Object.assign(new Error("Only an active approved requirement can be assigned"), {
      status: 409,
      code: "LEAD_NOT_ASSIGNABLE",
    });
  }
  if (lead.marketplaceExpiresAt && new Date(lead.marketplaceExpiresAt) <= now) {
    throw Object.assign(new Error("This requirement has expired and cannot be assigned"), {
      status: 409,
      code: "LEAD_EXPIRED",
    });
  }
}

function assertProviderEligibility(provider = {}, lead = {}) {
  if (!provider || provider.status !== "active" || provider.portalAccessEnabled === false) {
    throw Object.assign(new Error("Provider account is not eligible for manual assignment"), {
      status: 409,
      code: "PROVIDER_INELIGIBLE",
    });
  }
  if (!(Array.isArray(provider.categorySlugs) && provider.categorySlugs.includes(lead.categorySlug))) {
    throw Object.assign(new Error("Provider does not match this requirement category"), {
      status: 409,
      code: "PROVIDER_CATEGORY_MISMATCH",
    });
  }
}

function assignmentDistanceKm(lead = {}, provider = {}) {
  const location = resolveRequirementLocation(lead);
  if (!location) {
    throw Object.assign(new Error("Customer location is unavailable. Manual assignment requires booking coordinates."), {
      status: 409,
      code: "LEAD_LOCATION_UNAVAILABLE",
    });
  }
  if (!providerCoordinatesEligible(provider)) {
    throw Object.assign(new Error("Provider service coordinates are unavailable"), {
      status: 409,
      code: "PROVIDER_LOCATION_UNAVAILABLE",
    });
  }
  const distance = nearbyLeadAlertService.distanceKmExact(
    location.latitude,
    location.longitude,
    provider.serviceLatitude,
    provider.serviceLongitude,
  );
  if (distance === null || distance > MANUAL_ASSIGNMENT_RADIUS_KM) {
    throw Object.assign(
      new Error(`Provider must be within ${MANUAL_ASSIGNMENT_RADIUS_KM} km of the customer for manual assignment`),
      {
        status: 409,
        code: "PROVIDER_OUTSIDE_ASSIGNMENT_RADIUS",
        distanceKm: distance,
        maximumDistanceKm: MANUAL_ASSIGNMENT_RADIUS_KM,
      },
    );
  }
  return Number(distance.toFixed(1));
}

function unlockSnapshot(lead = {}, provider = {}, input = {}) {
  const title = String(lead.providerRequirementTitle || lead.requirementTitle || "").slice(0, 200);
  const now = input.now || new Date();
  return {
    providerLeadUnlockId: input.providerLeadUnlockId || uuid(),
    enquiryId: lead.enquiryId || lead.id || "",
    providerId: provider.providerId || provider.id || "",
    leadTitle: title,
    leadTitleKey: normalizeSearchText(title),
    categorySlug: lead.categorySlug || "",
    category: lead.category || "",
    serviceTypes: Array.isArray(lead.serviceTypes) ? lead.serviceTypes.slice(0, 5) : undefined,
    priority: lead.priority || "normal",
    city: lead.city || "",
    cityKey: normalizeSearchText(lead.city),
    state: lead.state || "",
    pincode: lead.pincode || "",
    leadPricePaise: Number(lead.leadPricePaise || 0),
    currency: lead.currency || "INR",
    providerName: provider.name || "",
    providerBusinessName: provider.businessName || "",
    unlockedAt: now,
    unlockMethod: "credits",
    chargedCredits: Number(input.chargedCredits || 0),
    chargedPaise: 0,
    walletTransactionId: input.walletTransactionId || "",
    paymentOrderId: "",
    assignmentSource: "crm_manual",
    assignedBy: input.assignedBy || "",
    assignedAt: now,
  };
}

async function assignRequirement(enquiryIdInput, providerIdInput, actor = {}) {
  const enquiryId = identifierValue(enquiryIdInput, { label: "Lead Reference ID" });
  const requestedProviderId = identifierValue(providerIdInput, { label: "Provider ID" });
  const assignedBy = actorLabel(actor);
  let canonicalProviderId = requestedProviderId;

  let result;
  try {
    result = await withTransaction(async (session) => {
      const now = new Date();
      const lead = await Enquiry.findOne(enquiryQuery(enquiryId)).session(session);
      if (!lead) throw Object.assign(new Error("Requirement not found"), { status: 404 });
      assertLeadLifecycle(lead, now);

      const provider = await Provider.findOne(providerQuery(requestedProviderId)).session(session);
      if (!provider) throw Object.assign(new Error("Provider not found"), { status: 404 });
      canonicalProviderId = String(provider.providerId || provider.id || requestedProviderId);
      assertProviderEligibility(provider, lead);

      const distanceKm = assignmentDistanceKm(lead, provider);

      const existingAssignment = await ProviderLeadUnlock.findOne({
        enquiryId: lead.enquiryId,
        providerId: canonicalProviderId,
      })
        .session(session)
        .lean();
      if (existingAssignment) {
        throw Object.assign(
          new Error("This provider already handled this requirement. Select a different provider."),
          { status: 409, code: "PROVIDER_ALREADY_ASSIGNED" },
        );
      }

      const blocker = await assignmentService.findBlockingUnlock(
        lead.enquiryId,
        canonicalProviderId,
        session,
      );
      if (blocker) {
        throw Object.assign(
          new Error("Every earlier provider must be Not Confirmed before assigning this requirement to another provider."),
          {
            status: 409,
            code: "PREVIOUS_PROVIDER_NOT_CLOSED",
            blockingProviderId: blocker.providerId || "",
            blockingProviderLeadUnlockId: blocker.providerLeadUnlockId || "",
          },
        );
      }

      const activeCheckout = await PaymentOrder.findOne({
        providerId: canonicalProviderId,
        enquiryId: lead.enquiryId,
        purpose: "lead_unlock",
        reservationStatus: "reserved",
        fulfilled: { $ne: true },
        reservedUntil: { $gt: now },
      })
        .select({ paymentOrderId: 1, reservedUntil: 1 })
        .session(session)
        .lean();
      if (activeCheckout) {
        throw Object.assign(
          new Error("This provider already has an active payment checkout for the requirement. Complete or cancel it first."),
          { status: 409, code: "DIRECT_PAYMENT_PENDING" },
        );
      }

      const costCredits = Math.max(0, leadCostCredits(lead));
      const costMinorCredits = paiseFromCredits(costCredits);
      const consumption = await providerCreditService.consumeLeadUnlockCredits(
        canonicalProviderId,
        costMinorCredits,
        session,
      );

      const providerLeadUnlockId = uuid();
      const walletTransactionId = costMinorCredits > 0 ? uuid() : "";
      if (costMinorCredits > 0) {
        await WalletTransaction.create(
          [
            {
              walletTransactionId,
              providerId: canonicalProviderId,
              type: "debit",
              amountPaise: costMinorCredits,
              currency: "INR",
              balanceBeforePaise: consumption.balanceBeforePaise,
              balanceAfterPaise: consumption.balanceAfterPaise,
              status: "posted",
              source: "lead_unlock",
              referenceId: lead.enquiryId,
              idempotencyKey: `lead-unlock:${canonicalProviderId}:${lead.enquiryId}`,
              description: `Assigned lead ${lead.enquiryId} by Findoly CRM`,
              metadata: {
                consumption: consumption.consumption,
                assignmentSource: "crm_manual",
                assignedBy,
                providerLeadUnlockId,
              },
            },
          ],
          { session },
        );
      }

      const remainingUnlocks = Math.max(0, Number(lead.remainingUnlocks || 0));
      if (remainingUnlocks > 0) {
        lead.remainingUnlocks = remainingUnlocks - 1;
      } else {
        lead.remainingUnlocks = 0;
      }
      lead.unlockedCount = Math.max(0, Number(lead.unlockedCount || 0)) + 1;
      lead.marketplaceAvailable = false;
      lead.marketplaceStatus = "closed";
      lead.marketplaceClosureReason = "provider_pending";
      lead.updatedAt = now;
      await lead.save({ session });

      const [unlock] = await ProviderLeadUnlock.create(
        [
          unlockSnapshot(lead.toObject(), provider.toObject(), {
            now,
            providerLeadUnlockId,
            chargedCredits: costCredits,
            walletTransactionId,
            assignedBy,
          }),
        ],
        { session },
      );

      return {
        lead: lead.toObject(),
        unlock: unlock.toObject(),
        provider: consumption.provider.toObject
          ? consumption.provider.toObject()
          : consumption.provider,
        distanceKm,
        costCredits,
        balanceBeforeCredits: creditsFromPaise(consumption.balanceBeforePaise),
        balanceAfterCredits: creditsFromPaise(consumption.balanceAfterPaise),
      };
    }, { operationLabel: "CRM manual provider assignment" });
  } catch (error) {
    if (error?.code === 11000) {
      const existingUnlock = await ProviderLeadUnlock.findOne({
        enquiryId,
        providerId: canonicalProviderId,
      }).lean();
      if (existingUnlock) {
        return {
          duplicate: true,
          unlock: existingUnlock,
          leadUrl: providerPortalLeadUrl(existingUnlock.enquiryId),
          emailDeliveries: [],
        };
      }
    }
    throw error;
  }

  const leadUrl = providerPortalLeadUrl(result.unlock.enquiryId);
  let emailDeliveries = [];
  try {
    emailDeliveries = await systemEventService.dispatch(
      "provider_lead_assigned",
      {
        providerLeadUnlockId: result.unlock.providerLeadUnlockId,
        enquiryId: result.unlock.enquiryId,
        providerId: result.unlock.providerId,
        eventAt: result.unlock.unlockedAt,
        source: "crm_manual_assignment",
        leadUrl,
        creditsUsed: result.costCredits,
        unlock: result.unlock,
        lead: result.lead,
        provider: result.provider,
      },
      assignedBy,
    );
  } catch (error) {
    emailDeliveries = [{
      channel: "email",
      success: false,
      error: String(error.message || "Provider assignment email failed").slice(0, 1000),
    }];
  }

  return {
    ...result,
    duplicate: false,
    leadUrl,
    emailDeliveries,
  };
}

module.exports = {
  MANUAL_ASSIGNMENT_RADIUS_KM,
  providerCoordinatesEligible,
  providerPortalLeadUrl,
  assignmentDistanceKm,
  unlockSnapshot,
  assignRequirement,
};
