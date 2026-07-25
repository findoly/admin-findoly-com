const Enquiry = require("../../models/Enquiry");
const catalogService = require("../catalog/catalog-service");
const LeadDistribution = require("../../models/LeadDistribution");
const notificationService = require("../communication/notification-service");
const uuid = require("../../utils/uuid");
const { validateMobile } = require("../../utils/mobile");
const {
  canonicalLeadStatus,
  resolveLeadStatusTransition,
  PROVIDER_CONTROLLED_STATUS,
} = require("../../utils/lead-journey");
const { PROVIDER_LEAD_STATUSES } = require("../../utils/provider-lead-status");
const providerStatusService = require("../distribution/provider-status-service");
const { geocodePincode } = require("../location/geocoding-service");
const { haversineDistanceKm, marketplaceVisibleAt } = require("../../utils/marketplace-radius");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const { applyDateRange, dateSort } = require("../../utils/date-query");
const {
  textValue,
  humanTextValue,
  assertHumanText,
  emailValue,
  enumValue,
  booleanValue,
  numberValue,
  dateOnlyValue,
  pincodeValue,
  tokenValue,
  identifierValue,
  plainObjectValue,
  queryTextValue,
  validationError,
} = require("../../utils/validation");

const LEAD_PRIORITIES = Object.freeze(["low", "normal", "high", "urgent"]);
const LEAD_INTENTS = Object.freeze(["not_assessed", "low", "medium", "high"]);
const OFFER_STATUSES = Object.freeze(["offered", "unlocked", "withdrawn", "expired"]);
const INTERNAL_METADATA_FIELDS = Object.freeze([
  "rejectedFromStatus",
  "rejectionReason",
  "lastRejectedFromStatus",
  "lastStatusNote",
]);

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function hasNumericValue(value) {
  return value !== null
    && value !== undefined
    && String(value).trim() !== ""
    && Number.isFinite(Number(value));
}

function normalizeMetadata(input, current = {}) {
  if (input === undefined) return current || {};
  const metadata = plainObjectValue(input, {
    label: "Lead metadata",
    maxKeys: 100,
    maxBytes: 50_000,
  });
  for (const field of INTERNAL_METADATA_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(current || {}, field)) {
      metadata[field] = current[field];
    } else {
      delete metadata[field];
    }
  }
  return metadata;
}

function assertHumanJson(value, label = "Additional details", depth = 0) {
  if (depth > 6 || value === null || value === undefined) return;
  if (typeof value === "string") {
    assertHumanText(value, { label });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertHumanJson(item, `${label} item ${index + 1}`, depth + 1));
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertHumanText(key, { label: `${label} field name` });
      assertHumanJson(item, `${label} ${key}`, depth + 1);
    }
  }
}

async function normalizeInput(input = {}, current = {}) {
  const categorySlug = tokenValue(input.categorySlug ?? current.categorySlug, {
    label: "Category",
    required: true,
    maxLength: 80,
  });
  const mobile = validateMobile(input.mobile ?? current.mobile ?? "", {
    label: "Customer mobile number",
  });
  if (!/^[6-9]\d{9}$/.test(mobile)) {
    throw validationError("Customer mobile number must be a valid Indian mobile number");
  }
  const committedUnlocks = Math.max(
    1,
    Number(current.unlockedCount || 0) + Number(current.pendingUnlockCount || 0),
  );
  let requestedServiceTypes = input.serviceTypeIds ?? input.serviceTypes ?? current.serviceTypes;
  if ((!Array.isArray(requestedServiceTypes) || !requestedServiceTypes.length) && (input.serviceType ?? current.serviceType)) {
    const legacyValue = String(input.serviceType ?? current.serviceType).trim();
    const matches = await catalogService.listServiceTypes({ categorySlug, includeInactive: true });
    const match = matches.find((item) =>
      String(item.serviceTypeId || item.id) === legacyValue ||
      String(item.slug || "").toLowerCase() === legacyValue.toLowerCase() ||
      String(item.name || "").toLowerCase() === legacyValue.toLowerCase(),
    );
    if (match) requestedServiceTypes = [match.serviceTypeId || match.id];
  }
  const serviceTypes = await catalogService.resolveLeadServiceTypes(
    categorySlug,
    requestedServiceTypes,
    { allowInactiveCurrent: current.serviceTypes || [] },
  );

  return {
    name: humanTextValue(input.name ?? current.name, {
      label: "Customer name",
      required: true,
      maxLength: 120,
    }),
    mobile,
    email: emailValue(input.email ?? current.email, {
      label: "Customer email",
      required: false,
    }),
    addressLine: humanTextValue(input.addressLine ?? current.addressLine, {
      label: "Customer address",
      maxLength: 500,
    }),
    city: humanTextValue(input.city ?? current.city, {
      label: "City",
      required: true,
      maxLength: 100,
    }),
    state: humanTextValue(input.state ?? current.state, {
      label: "State",
      required: true,
      maxLength: 100,
    }),
    pincode: pincodeValue(input.pincode ?? current.pincode, {
      label: "Pincode",
      required: true,
    }),
    category: humanTextValue(input.category ?? current.category ?? categorySlug, {
      label: "Category name",
      fallback: categorySlug,
      required: true,
      maxLength: 120,
    }),
    categorySlug,
    serviceTypes,
    serviceType: serviceTypes[0]?.name || "",
    requirementTitle: humanTextValue(
      input.requirementTitle ?? current.requirementTitle,
      {
        label: "Requirement title",
        required: true,
        maxLength: 200,
      },
    ),
    priority: enumValue(input.priority, LEAD_PRIORITIES, {
      label: "Lead priority",
      fallback: current.priority || "normal",
    }),
    leadIntent: enumValue(input.leadIntent, LEAD_INTENTS, {
      label: "Lead intent",
      fallback: current.leadIntent || "not_assessed",
    }),
    preferredDate: dateOnlyValue(
      input.preferredDate ?? current.preferredDate,
      { label: "Preferred date", required: false },
    ),
    preferredSlot: humanTextValue(input.preferredSlot ?? current.preferredSlot, {
      label: "Preferred slot",
      maxLength: 100,
    }),
    leadPricePaise: numberValue(input.leadPricePaise, {
      label: "Lead price",
      fallback: current.leadPricePaise ?? 10000,
      min: 0,
      max: 1_000_000_000,
      integer: true,
    }),
    maxProviderUnlocks: numberValue(input.maxProviderUnlocks, {
      label: "Maximum provider unlocks",
      fallback: current.maxProviderUnlocks ?? 5,
      min: committedUnlocks,
      max: 1000,
      integer: true,
    }),
    currency: "INR",
    sourceWebsite: textValue(input.sourceWebsite ?? current.sourceWebsite, {
      label: "Source website",
      fallback: "manual-admin",
      maxLength: 120,
    }),
    sourceChannel: textValue(input.sourceChannel ?? current.sourceChannel, {
      label: "Source channel",
      fallback: "admin",
      maxLength: 80,
    }),
    sourceType: textValue(input.sourceType ?? current.sourceType, {
      label: "Source type",
      fallback: "manual",
      maxLength: 80,
    }),
    sourceName: humanTextValue(input.sourceName ?? current.sourceName, {
      label: "Source name",
      maxLength: 120,
    }),
    campaign: humanTextValue(input.campaign ?? current.campaign, {
      label: "Campaign",
      maxLength: 120,
    }),
    externalEnquiryId: textValue(
      input.externalEnquiryId ?? current.externalEnquiryId,
      { label: "External enquiry ID", maxLength: 128 },
    ),
    notes: humanTextValue(input.notes ?? current.notes, {
      label: "Lead notes",
      maxLength: 5000,
      preserveWhitespace: true,
    }),
    additionalDetails: (() => {
      const details = input.additionalDetails === undefined
        ? current.additionalDetails || {}
        : plainObjectValue(input.additionalDetails, {
            label: "Additional details",
            maxKeys: 100,
            maxBytes: 50_000,
          });
      assertHumanJson(details);
      return details;
    })(),
    metadata: normalizeMetadata(input.metadata, current.metadata || {}),
    updatedAt: new Date(),
  };
}

function presentEnquiry(row = {}) {
  const customer = row.customer || {};
  const address = row.address || {};
  const source = row.source || {};
  const categoryObject =
    row.category && typeof row.category === "object" ? row.category : {};
  return {
    ...row,
    enquiryId: row.enquiryId || row.id || "",
    name: row.name || customer.name || "",
    mobile: row.mobile || customer.mobile || "",
    email: row.email || customer.email || "",
    addressLine: row.addressLine || address.line1 || "",
    city: row.city || address.city || "",
    state: row.state || address.state || "",
    pincode: row.pincode || address.pincode || "",
    locationLatitude: hasNumericValue(row.locationLatitude) ? Number(row.locationLatitude) : null,
    locationLongitude: hasNumericValue(row.locationLongitude) ? Number(row.locationLongitude) : null,
    locationPincode: row.locationPincode || "",
    locationLocality: row.locationLocality || "",
    locationDistrict: row.locationDistrict || "",
    locationState: row.locationState || "",
    locationCountry: row.locationCountry || "India",
    locationVerifiedAt: row.locationVerifiedAt || null,
    marketplacePublishedAt: row.marketplacePublishedAt || null,
    category:
      typeof row.category === "string"
        ? row.category
        : categoryObject.name || "",
    categorySlug: row.categorySlug || categoryObject.slug || "",
    serviceTypes: Array.isArray(row.serviceTypes) ? row.serviceTypes.map((item) => ({
      serviceTypeId: item.serviceTypeId || item.id || "",
      name: item.name || "",
      slug: item.slug || "",
    })).filter((item) => item.name) : [],
    serviceType: row.serviceType || (Array.isArray(row.serviceTypes) ? row.serviceTypes[0]?.name : "") || "",
    sourceWebsite: row.sourceWebsite || source.website || "",
    sourceChannel: row.sourceChannel || source.channel || "",
    sourceName: row.sourceName || source.sourceName || "",
    externalEnquiryId:
      row.externalEnquiryId || source.externalEnquiryId || "",
    journeyStatus: canonicalLeadStatus(row.status),
    leadIntent: LEAD_INTENTS.includes(String(row.leadIntent || "").toLowerCase()) ? String(row.leadIntent).toLowerCase() : "not_assessed",
    agentReferralValidation: row.agentReferralValidation || "pending",
    leadValidationMethod: row.leadValidationMethod || "",
    agentSaleConversion: row.agentSaleConversion || "pending",
    unlockedCount: Number(row.unlockedCount || 0),
    pendingUnlockCount: Number(row.pendingUnlockCount || 0),
    maxProviderUnlocks: Number.isInteger(Number(row.maxProviderUnlocks)) && Number(row.maxProviderUnlocks) > 0 ? Number(row.maxProviderUnlocks) : 5,
    providerConfirmedCount: Number(row.providerConfirmedCount || 0),
    providerSaleConversionStatus: row.providerSaleConversionStatus || (canonicalLeadStatus(row.status) === PROVIDER_CONTROLLED_STATUS ? "converted" : "pending"),
    partnerEligibilityDate: row.partnerEligibilityDate || (row.agentId && row.createdAt ? new Date(new Date(row.createdAt).getTime() + 14 * 24 * 60 * 60 * 1000) : null),
    partnerPayoutStatus: row.partnerPayoutStatus || (row.agentId ? "waiting_period" : ""),
    isActive: row.isActive !== false,
  };
}

function enquiryQuery(enquiryId) {
  const value = identifierValue(enquiryId, { label: "Lead Reference ID" });
  return { $or: [{ enquiryId: value }, { id: value }] };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const STATUS_FILTERS = Object.freeze({
  new: ["new"],
  verification: ["verification", "verification_pending", "verified"],
  approved: ["approved"],
  distributed: ["distributed", "in_progress", "completed", "closed"],
  sale_converted: ["sale_converted"],
  rejected: ["rejected"],
});

function historyArrays(distribution = {}) {
  return [
    distribution.providerSaleOutcomeHistory,
    distribution.providerLeadStatusHistory,
    distribution.providerStatusHistory,
    distribution.providerTimeline,
  ].filter(Array.isArray);
}

function providerJourney(distribution = {}) {
  const events = [];
  if (distribution.distributedAt || distribution.createdAt) {
    events.push({
      type: "distributed",
      status: "offered",
      message: "Lead offered to provider",
      actor: distribution.distributedBy || "system",
      createdAt: distribution.distributedAt || distribution.createdAt,
    });
  }

  if (distribution.contactUnlocked || distribution.status === "unlocked") {
    events.push({
      type: "unlocked",
      status: "unlocked",
      message: "Contact details unlocked",
      actor: distribution.providerId || "provider",
      createdAt:
        distribution.unlockedAt ||
        distribution.updatedAt ||
        distribution.distributedAt,
    });
  }

  for (const history of historyArrays(distribution)) {
    for (const item of history) {
      if (!item || typeof item !== "object") continue;
      const outcome = text(item.outcome || item.providerSaleOutcome || item.toOutcome);
      const status = text(item.status || item.providerLeadStatus || item.toStatus);
      const createdAt = item.createdAt || item.updatedAt || item.statusUpdatedAt || null;
      if (!outcome && !status && !item.message) continue;
      events.push({
        type: outcome ? "provider_outcome" : "provider_status",
        outcome,
        status,
        reason: text(item.reason || item.providerLeadReason),
        note: text(item.note || item.providerLeadNote),
        message: text(item.message),
        actor: text(
          item.actor || item.updatedBy || item.providerLeadStatusUpdatedBy,
          distribution.providerId || "provider",
        ),
        createdAt,
      });
    }
  }

  if (distribution.providerSaleOutcome) {
    const currentTime = distribution.providerSaleOutcomeUpdatedAt || null;
    const alreadyIncluded = events.some(
      (event) =>
        event.type === "provider_outcome" &&
        event.outcome === distribution.providerSaleOutcome &&
        String(event.createdAt || "") === String(currentTime || ""),
    );
    if (!alreadyIncluded) {
      events.push({
        type: "provider_outcome",
        outcome: distribution.providerSaleOutcome,
        note: distribution.providerSaleOutcomeNote || "",
        message: "",
        actor: distribution.providerSaleOutcomeUpdatedBy || distribution.providerId || "provider",
        createdAt: currentTime,
      });
    }
  }

  if (distribution.providerLeadStatus) {
    const currentTime = distribution.providerLeadStatusUpdatedAt || null;
    const alreadyIncluded = events.some(
      (event) =>
        event.type === "provider_status" &&
        event.status === distribution.providerLeadStatus &&
        String(event.createdAt || "") === String(currentTime || ""),
    );
    if (!alreadyIncluded) {
      events.push({
        type: "provider_status",
        status: distribution.providerLeadStatus,
        reason: distribution.providerLeadReason || "",
        note: distribution.providerLeadNote || "",
        message: "",
        actor:
          distribution.providerLeadStatusUpdatedBy ||
          distribution.providerId ||
          "provider",
        createdAt: currentTime,
      });
    }
  }

  return events.sort((a, b) => {
    const left = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const right = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return left - right;
  });
}

function presentDistribution(row = {}) {
  return {
    ...row,
    providerJourney: providerJourney(row),
  };
}

function assertReferenceIdUnchanged(existing, input = {}) {
  const currentReference = String(existing.enquiryId || existing.id || "");
  for (const field of ["enquiryId", "referenceId", "id"]) {
    if (input[field] === undefined || input[field] === null) continue;
    if (String(input[field]) !== currentReference) {
      throw Object.assign(
        new Error("Lead Reference ID cannot be changed after creation"),
        { status: 400 },
      );
    }
  }

  if (
    input._id !== undefined &&
    input._id !== null &&
    String(input._id) !== String(existing._id || "")
  ) {
    throw Object.assign(
      new Error("Lead database ID cannot be changed after creation"),
      { status: 400 },
    );
  }
}

async function create(input = {}, actor = "admin") {
  const requestedStatus = textValue(input.status, {
    label: "Initial lead status",
    fallback: "new",
    maxLength: 40,
  }).toLowerCase();
  if (requestedStatus !== "new") {
    throw validationError(
      "New leads must start at the New journey stage",
    );
  }

  const data = await normalizeInput(input);
  const initialStatus = "new";
  const now = new Date();
  data.status = initialStatus;
  data.statusUpdatedAt = now;
  data.statusUpdatedBy = actor;
  data.isActive = true;
  data.agentReferralValidation = "pending";
  data.timeline = [
    {
      timelineId: uuid(),
      type: "created",
      message: `Lead created with ${initialStatus} status`,
      fromStatus: "",
      toStatus: initialStatus,
      actor,
      createdAt: now,
    },
  ];

  const enquiry = await Enquiry.create(data);
  if (["distributed", PROVIDER_CONTROLLED_STATUS].includes(canonicalLeadStatus(enquiry.status))) {
    await distribute(enquiry, actor);
  }

  const createdLead = await get(enquiry.enquiryId);
  await notificationService.triggerSafe(
    "lead_created",
    {
      lead: createdLead,
      status: createdLead.journeyStatus || createdLead.status,
      trigger: "lead_created",
      idempotencySuffix: createdLead.createdAt || now.toISOString(),
    },
    actor,
  );
  return createdLead;
}

async function list(filters = {}) {
  const { limit, cursor } = getPagination(filters);
  const query = {};

  if (filters.status) {
    const status = enumValue(filters.status, Object.keys(STATUS_FILTERS), {
      label: "Lead status filter",
    });
    query.status = { $in: STATUS_FILTERS[status] };
  }

  if (filters.active !== undefined && filters.active !== "") {
    const activeFilter = textValue(filters.active, {
      label: "Lead active-state filter",
      maxLength: 20,
    }).toLowerCase();
    if (["active", "true"].includes(activeFilter)) {
      query.isActive = { $ne: false };
    } else if (["deactivated", "false"].includes(activeFilter)) {
      query.isActive = false;
    } else {
      throw validationError(
        "Lead active-state filter must be active or deactivated",
      );
    }
  }

  if (filters.categorySlug) {
    query.categorySlug = tokenValue(filters.categorySlug, {
      label: "Category filter",
      maxLength: 80,
    });
  }
  const city = queryTextValue(filters.city, {
    label: "City filter",
    maxLength: 100,
  });
  if (city) query.city = new RegExp(escapeRegex(city), "i");
  if (filters.sourceWebsite) {
    query.sourceWebsite = textValue(filters.sourceWebsite, {
      label: "Source website filter",
      maxLength: 120,
    });
  }
  if (filters.sourceChannel) {
    query.sourceChannel = textValue(filters.sourceChannel, { label: "Source channel filter", maxLength: 80 });
  }
  if (filters.referralId) {
    query.referralId = textValue(filters.referralId, { label: "Referral ID filter", maxLength: 6 }).toUpperCase();
  }
  if (filters.agentReferralValidation) {
    const validationStatus = enumValue(filters.agentReferralValidation, ["pending", "valid", "invalid"], { label: "Lead validation filter" });
    query.agentReferralValidation = validationStatus === "pending"
      ? { $in: ["", "pending", null] }
      : validationStatus;
  }
  if (filters.partnerPayoutStatus) {
    query.partnerPayoutStatus = enumValue(filters.partnerPayoutStatus, ["waiting_period", "unpaid", "reserved", "paid", "not_eligible"], { label: "Partner payout status filter" });
  }

  applyDateRange(query, filters, {
    fields: {
      createdAt: "Created date",
      updatedAt: "Updated date",
      statusUpdatedAt: "Status updated date",
      marketplacePublishedAt: "Marketplace published date",
    },
  });

  const q = queryTextValue(filters.q, {
    label: "Lead search",
    maxLength: 100,
  });
  if (q) {
    const search = new RegExp(escapeRegex(q), "i");
    query.$or = [
      { enquiryId: search },
      { requirementTitle: search },
      { name: search },
      { mobile: search },
      { category: search },
      { categorySlug: search },
      { city: search },
      { externalEnquiryId: search },
      { agentId: search },
      { referralId: search },
      { agentName: search },
      { agentBusinessName: search },
    ];
  }

  const result = await cursorPaginate(Enquiry, {
    query,
    sort: dateSort(filters, { fields: ["createdAt", "updatedAt", "statusUpdatedAt", "marketplacePublishedAt"] }),
    limit,
    cursor,
  });

  return {
    ...result,
    data: result.data.map(presentEnquiry),
  };
}

async function get(enquiryId) {
  let enquiry = await Enquiry.findOne(enquiryQuery(enquiryId)).lean();
  if (!enquiry) {
    throw Object.assign(new Error("Lead not found"), { status: 404 });
  }
  if (["distributed", PROVIDER_CONTROLLED_STATUS].includes(canonicalLeadStatus(enquiry.status))) {
    const reconciled = await providerStatusService.syncSaleConversion(
      enquiry.enquiryId || enquiry.id || enquiryId,
      { actor: "crm-read-reconciliation", notify: false },
    );
    enquiry = reconciled.lead || enquiry;
  }
  return presentEnquiry(enquiry);
}

async function update(enquiryId, input = {}, actor = "admin") {
  const existing = await Enquiry.findOne(enquiryQuery(enquiryId)).lean();
  if (!existing) {
    throw Object.assign(new Error("Lead not found"), { status: 404 });
  }

  assertReferenceIdUnchanged(existing, input);

  if (input.status !== undefined) {
    const requestedStatus = textValue(input.status, {
      label: "Lead status",
      required: true,
      maxLength: 40,
    }).toLowerCase();
    const knownStatuses = new Set(Object.values(STATUS_FILTERS).flat());
    if (
      !knownStatuses.has(requestedStatus) ||
      canonicalLeadStatus(requestedStatus) !== canonicalLeadStatus(existing.status)
    ) {
      throw validationError("Use the lead journey controls to change status");
    }
  }

  if (input.isActive !== undefined) {
    const requestedActive = booleanValue(input.isActive, {
      label: "Lead active state",
      fallback: existing.isActive !== false,
    });
    if (requestedActive !== (existing.isActive !== false)) {
      throw validationError(
        "Use the deactivate or reactivate action to change lead availability",
      );
    }
  }

  for (const field of [
    "timeline",
    "statusUpdatedAt",
    "statusUpdatedBy",
    "deactivatedAt",
    "deactivatedBy",
    "deactivationReason",
    "distributionCount",
    "unlockedCount",
    "pendingUnlockCount",
    "distributedAt",
    "marketplacePublishedAt",
    "locationLatitude",
    "locationLongitude",
    "locationPincode",
    "locationVerifiedAt",
    "providerConfirmedCount",
    "providerSaleConversionStatus",
    "providerSaleConversionUpdatedAt",
    "providerSaleConversionProviderId",
    "providerSaleConversionProviderName",
    "providerSaleConvertedAt",
    "providerSaleConvertedBy",
    "agentSaleConversion",
    "agentSaleConversionNote",
    "agentSaleConvertedAt",
    "agentSaleConvertedBy",
  ]) {
    if (input[field] !== undefined) {
      throw validationError(`${field} is maintained by the CRM and cannot be edited directly`);
    }
  }

  // Normalize against the presented shape so legacy nested lead records remain editable.
  const data = await normalizeInput(input, presentEnquiry(existing));
  data.status = existing.status;
  data.statusUpdatedAt = existing.statusUpdatedAt || null;
  data.statusUpdatedBy = existing.statusUpdatedBy || "";
  data.isActive = existing.isActive !== false;

  await Enquiry.updateOne(enquiryQuery(enquiryId), { $set: data });
  const updated = await Enquiry.findOne(enquiryQuery(enquiryId));
  const distributionEnquiryId = existing.enquiryId || existing.id || enquiryId;

  if (
    updated.isActive !== false &&
    ["distributed", PROVIDER_CONTROLLED_STATUS].includes(canonicalLeadStatus(updated.status))
  ) {
    await distribute(updated, actor);
  } else if (updated.isActive !== false) {
    await LeadDistribution.updateMany(
      { enquiryId: distributionEnquiryId, contactUnlocked: { $ne: true } },
      { $set: { status: "withdrawn", updatedAt: new Date() } },
    );
    await refreshDistributionSummary(distributionEnquiryId);
  }

  return get(enquiryId);
}

async function updateStatus(enquiryId, input = {}, actor = "admin") {
  const existing = await Enquiry.findOne(enquiryQuery(enquiryId)).lean();
  if (!existing) {
    throw Object.assign(new Error("Lead not found"), { status: 404 });
  }
  if (existing.isActive === false) {
    throw Object.assign(
      new Error("Reactivate the lead before changing its journey status"),
      { status: 409 },
    );
  }
  if (["distributed", PROVIDER_CONTROLLED_STATUS].includes(canonicalLeadStatus(existing.status))) {
    throw Object.assign(
      new Error("Employees cannot move, restore or reject a lead after it has been distributed. Provider confirmations control sale conversion."),
      { status: 409 },
    );
  }

  const isAgentRequirement = Boolean(existing.agentId && (existing.sourceChannel === "agent" || existing.sourceWebsite === "agent-portal" || existing.metadata?.agentSubmission));
  if (isAgentRequirement) {
    await require("../partner-payout/partner-payout-service").assertRequirementNotPayoutProcessing(existing);
  }
  if (existing.agentReferralValidation !== "valid") {
    throw validationError(
      "Complete lead validation first. Mark the lead Valid to use journey actions, or mark it Invalid to reject the lead automatically.",
    );
  }
  if (isAgentRequirement && !String(input.note || input.reason || "").trim()) {
    throw validationError("A status-change note is required for Agent Portal requirements");
  }

  const metadata = { ...(existing.metadata || {}) };
  const transition = resolveLeadStatusTransition(
    existing.status,
    input,
    metadata,
  );
  const now = new Date();

  if (transition.action === "reject") {
    metadata.rejectedFromStatus = transition.fromStatus;
    metadata.rejectionReason = transition.note;
  } else if (transition.action === "restore") {
    metadata.lastRejectedFromStatus = metadata.rejectedFromStatus || "";
    delete metadata.rejectionReason;
  }
  metadata.lastStatusNote = transition.note;

  const timelineEntry = {
    timelineId: uuid(),
    type: "status_changed",
    message: `Status changed from ${transition.fromStatus} to ${transition.toStatus}`,
    fromStatus: transition.fromStatus,
    toStatus: transition.toStatus,
    action: transition.action,
    note: transition.note,
    actor,
    createdAt: now,
  };

  await Enquiry.updateOne(enquiryQuery(enquiryId), {
    $set: {
      status: transition.toStatus,
      statusUpdatedAt: now,
      statusUpdatedBy: actor,
      metadata,
      updatedAt: now,
    },
    $push: { timeline: timelineEntry },
  });

  if (isAgentRequirement && transition.toStatus === "rejected") {
    if (existing.partnerWithdrawalId && existing.partnerPayoutStatus === "reserved") {
      await require("../partner-payout/partner-payout-service").markEligibilityChangedForRequirement(existing.enquiryId || enquiryId, `Requirement rejected: ${transition.note}`, actor);
    }
    await Enquiry.updateOne(enquiryQuery(enquiryId), { $set: { partnerPayoutStatus: existing.partnerPayoutStatus === "paid" ? "paid" : "not_eligible", updatedAt: now } });
  }

  if (isAgentRequirement && transition.toStatus !== "rejected" && existing.agentReferralValidation === "valid" && !["paid", "reserved"].includes(existing.partnerPayoutStatus)) {
    const eligibilityAt = existing.partnerEligibilityDate || new Date(new Date(existing.createdAt || now).getTime() + 14 * 24 * 60 * 60 * 1000);
    await Enquiry.updateOne(enquiryQuery(enquiryId), { $set: { partnerEligibilityDate: eligibilityAt, partnerPayoutStatus: eligibilityAt <= now ? "unpaid" : "waiting_period", updatedAt: now } });
  }

  const updated = await Enquiry.findOne(enquiryQuery(enquiryId));
  const distributionEnquiryId = existing.enquiryId || existing.id || enquiryId;
  if (["distributed", PROVIDER_CONTROLLED_STATUS].includes(transition.toStatus)) {
    await distribute(updated, actor);
  } else {
    await LeadDistribution.updateMany(
      { enquiryId: distributionEnquiryId, contactUnlocked: { $ne: true } },
      { $set: { status: "withdrawn", updatedAt: now } },
    );
    await refreshDistributionSummary(distributionEnquiryId);
  }

  const changedLead = await get(enquiryId);
  const eventByStatus = {
    approved: "lead_approved",
    rejected: "lead_rejected",
    on_hold: "lead_on_hold",
    distributed: "lead_distributed",
  };
  await notificationService.triggerSafe(
    eventByStatus[transition.toStatus] || "lead_status_changed",
    {
      lead: changedLead,
      status: transition.toStatus,
      note: transition.note,
      trigger: "lead_status_changed",
      idempotencySuffix: now.toISOString(),
    },
    actor,
  );
  return changedLead;
}

async function addNote(enquiryId, note, actor = "admin") {
  const message = textValue(note, {
    label: "Note",
    required: true,
    maxLength: 5000,
    preserveWhitespace: true,
  });

  const result = await Enquiry.updateOne(
    enquiryQuery(enquiryId),
    {
      $set: { notes: message, updatedAt: new Date() },
      $push: {
        timeline: {
          timelineId: uuid(),
          type: "note",
          message,
          actor,
          createdAt: new Date(),
        },
      },
    },
  );

  if (!result.matchedCount) {
    throw Object.assign(new Error("Lead not found"), { status: 404 });
  }

  return get(enquiryId);
}

async function setActiveState(
  enquiryId,
  isActive,
  { reason = "" } = {},
  actor = "admin",
) {
  const existing = await Enquiry.findOne(enquiryQuery(enquiryId)).lean();
  if (!existing) {
    throw Object.assign(new Error("Lead not found"), { status: 404 });
  }

  const targetActive = booleanValue(isActive, {
    label: "Lead active state",
    fallback: existing.isActive !== false,
  });
  const currentlyActive = existing.isActive !== false;
  if (targetActive === currentlyActive) return get(enquiryId);

  const normalizedReason = textValue(reason, {
    label: "Deactivation reason",
    maxLength: 1000,
    preserveWhitespace: true,
  });
  const now = new Date();
  const reference = existing.enquiryId || existing.id || enquiryId;
  const timelineEntry = {
    timelineId: uuid(),
    type: targetActive ? "reactivated" : "deactivated",
    message: targetActive ? "Lead reactivated" : "Lead deactivated",
    note: normalizedReason,
    actor,
    createdAt: now,
  };

  await Enquiry.updateOne(enquiryQuery(enquiryId), {
    $set: targetActive
      ? {
          isActive: true,
          deactivatedAt: null,
          deactivatedBy: "",
          deactivationReason: "",
          updatedAt: now,
        }
      : {
          isActive: false,
          deactivatedAt: now,
          deactivatedBy: actor,
          deactivationReason: normalizedReason,
          updatedAt: now,
        },
    $push: { timeline: timelineEntry },
  });

  if (!targetActive) {
    await LeadDistribution.updateMany(
      { enquiryId: reference, contactUnlocked: { $ne: true } },
      { $set: { status: "withdrawn", updatedAt: now } },
    );
    await refreshDistributionSummary(reference);
  } else if (
    ["distributed", PROVIDER_CONTROLLED_STATUS].includes(canonicalLeadStatus(existing.status))
  ) {
    const updated = await Enquiry.findOne(enquiryQuery(enquiryId));
    await distribute(updated, actor);
  }

  return get(enquiryId);
}

async function ensureEnquiryLocation(enquiry) {
  const pincode = String(enquiry.pincode || "").trim();
  if (!/^[1-9]\d{5}$/.test(pincode)) {
    throw validationError("A valid 6-digit lead PIN code is required before marketplace distribution");
  }
  const alreadyVerified = pincode === String(enquiry.locationPincode || "")
    && hasNumericValue(enquiry.locationLatitude)
    && hasNumericValue(enquiry.locationLongitude);
  if (alreadyVerified) return enquiry;

  const location = await geocodePincode(pincode);
  const locationData = {
    locationLatitude: Number(location.latitude),
    locationLongitude: Number(location.longitude),
    locationPincode: pincode,
    locationLocality: location.locality || "",
    locationDistrict: location.district || "",
    locationState: location.state || "",
    locationCountry: location.country || "India",
    locationVerifiedAt: location.verifiedAt || new Date(),
    locationSource: location.source || "google_geocoding",
  };
  await Enquiry.updateOne(enquiryQuery(enquiry.enquiryId || enquiry.id), {
    $set: { ...locationData, updatedAt: new Date() },
  });
  return { ...enquiry, ...locationData };
}

function distributionData(enquiry, provider) {
  const publishedAt = enquiry.marketplacePublishedAt || enquiry.distributedAt || new Date();
  const distanceKm = haversineDistanceKm(
    provider.serviceLatitude,
    provider.serviceLongitude,
    enquiry.locationLatitude,
    enquiry.locationLongitude,
  );
  return {
    enquiryId: enquiry.enquiryId || enquiry.id,
    providerId: provider.providerId || provider.id,
    categorySlug: enquiry.categorySlug,
    leadPricePaise: numberValue(enquiry.leadPricePaise, {
      label: "Lead price",
      fallback: 0,
      min: 0,
      max: 1_000_000_000,
      integer: true,
    }),
    currency: "INR",
    leadTitle: enquiry.requirementTitle,
    serviceType: enquiry.serviceType,
    serviceTypes: Array.isArray(enquiry.serviceTypes) ? enquiry.serviceTypes : undefined,
    category: enquiry.category,
    city: enquiry.city,
    state: enquiry.state,
    pincode: enquiry.pincode,
    leadLatitude: hasNumericValue(enquiry.locationLatitude) ? Number(enquiry.locationLatitude) : null,
    leadLongitude: hasNumericValue(enquiry.locationLongitude) ? Number(enquiry.locationLongitude) : null,
    providerDistanceKm: distanceKm,
    marketplacePublishedAt: publishedAt,
    marketplaceVisibleAt: marketplaceVisibleAt(publishedAt, distanceKm),
    preferredDate: enquiry.preferredDate,
    preferredSlot: enquiry.preferredSlot,
    priority: enquiry.priority,
    leadIntent: enquiry.leadIntent || "not_assessed",
    sourceWebsite: enquiry.sourceWebsite,
    customerName: enquiry.name,
    customerMobile: enquiry.mobile,
    customerEmail: enquiry.email,
    customerAddress: enquiry.addressLine,
    providerName: provider.name,
    providerBusinessName: provider.businessName,
    providerMobile: provider.mobile,
    additionalDetails: enquiry.additionalDetails || {},
    updatedAt: new Date(),
  };
}

async function refreshDistributionSummary(enquiryId) {
  const reference = identifierValue(enquiryId, { label: "Lead Reference ID" });
  let distributionCount = 0;
  let unlockedCount = 0;
  const rows = LeadDistribution.find({ enquiryId: reference })
    .select({ status: 1, contactUnlocked: 1 })
    .lean()
    .cursor();

  for await (const row of rows) {
    if (row.status !== "withdrawn") distributionCount += 1;
    if (row.contactUnlocked === true) unlockedCount += 1;
  }

  await Enquiry.updateOne(enquiryQuery(reference), {
    $set: {
      distributionCount,
      unlockedCount,
      updatedAt: new Date(),
    },
  });

  return { distributionCount, unlockedCount };
}

async function distribute(enquiryDocument, actor = "system") {
  if (!enquiryDocument) {
    throw Object.assign(new Error("Lead not found"), { status: 404 });
  }
  const rawEnquiry = enquiryDocument.toObject
    ? enquiryDocument.toObject()
    : enquiryDocument;
  let enquiry = presentEnquiry(rawEnquiry);
  if (!enquiry.enquiryId) {
    throw validationError("Lead Reference ID is required for marketplace publishing");
  }
  if (!["distributed", PROVIDER_CONTROLLED_STATUS].includes(enquiry.journeyStatus)) {
    throw validationError("Move the lead to Distributed before publishing it to the marketplace");
  }
  if (enquiry.isActive === false) {
    throw Object.assign(
      new Error("Reactivate the lead before publishing it to the marketplace"),
      { status: 409 },
    );
  }
  if (enquiry.agentReferralValidation !== "valid") {
    throw validationError("Only Valid leads can be published to providers");
  }
  enquiry = await ensureEnquiryLocation(enquiry);

  const reference = identifierValue(enquiry.enquiryId || enquiry.id, {
    label: "Lead Reference ID",
  });
  const now = new Date();
  const marketplacePublishedAt = enquiry.marketplacePublishedAt || enquiry.distributedAt || now;
  const maxUnlocks = numberValue(enquiry.maxProviderUnlocks, {
    label: "Maximum provider unlocks",
    fallback: 5,
    min: 1,
    max: 1000,
    integer: true,
  });

  // Provider-specific rows are no longer required for marketplace visibility.
  // Keep unlocked rows for customer access and audit history; retire old locked offers.
  await LeadDistribution.updateMany(
    {
      enquiryId: reference,
      contactUnlocked: { $ne: true },
      $or: [
        { directPaymentPendingOrderId: "" },
        { directPaymentPendingOrderId: { $exists: false } },
        { directPaymentPendingUntil: null },
        { directPaymentPendingUntil: { $lte: now } },
      ],
    },
    { $set: { status: "withdrawn", updatedAt: now } },
  );

  const pendingUnlockCount = await LeadDistribution.countDocuments({
    enquiryId: reference,
    contactUnlocked: { $ne: true },
    directPaymentPendingOrderId: { $nin: ["", null] },
    directPaymentPendingUntil: { $gt: now },
  });

  await Enquiry.updateOne(enquiryQuery(reference), {
    $set: {
      distributedAt: enquiry.distributedAt || now,
      marketplacePublishedAt,
      maxProviderUnlocks: maxUnlocks,
      pendingUnlockCount,
      updatedAt: now,
    },
  });

  const summary = await refreshDistributionSummary(reference);
  await providerStatusService.syncSaleConversion(reference, {
    actor,
    notify: false,
  });

  return {
    ...summary,
    marketplacePublished: true,
    marketplacePublishedAt,
    maxProviderUnlocks: maxUnlocks,
    remainingUnlocks: Math.max(0, maxUnlocks - Number(summary.unlockedCount || 0)),
  };
}

async function listProviderStatuses(enquiryId, filters = {}) {
  const lead = await get(enquiryId);
  const { limit, cursor } = getPagination(filters);
  const query = { enquiryId: lead.enquiryId };

  if (filters.status) {
    query.providerLeadStatus = enumValue(
      filters.status,
      PROVIDER_LEAD_STATUSES,
      { label: "Provider lead status filter" },
    );
  }
  if (filters.offerStatus) {
    query.status = enumValue(filters.offerStatus, OFFER_STATUSES, {
      label: "Offer status filter",
    });
  }
  if (filters.unlocked !== undefined && filters.unlocked !== "") {
    const unlocked = booleanValue(filters.unlocked, {
      label: "Unlocked filter",
    });
    query.contactUnlocked = unlocked ? true : { $ne: true };
  }
  const q = queryTextValue(filters.q, {
    label: "Provider status search",
    maxLength: 100,
  });
  if (q) {
    const search = new RegExp(escapeRegex(q), "i");
    query.$or = [
      { providerId: search },
      { providerName: search },
      { providerBusinessName: search },
      { providerMobile: search },
      { providerLeadStatus: search },
      { providerLeadReason: search },
    ];
  }

  const result = await cursorPaginate(LeadDistribution, {
    query,
    sort: { distributedAt: -1, _id: -1 },
    limit,
    cursor,
    select: {
      leadDistributionId: 1,
      enquiryId: 1,
      providerId: 1,
      providerName: 1,
      providerBusinessName: 1,
      providerMobile: 1,
      status: 1,
      contactUnlocked: 1,
      providerSaleOutcome: 1,
      providerSaleOutcomeNote: 1,
      providerSaleOutcomeUpdatedAt: 1,
      outcomeVerificationStatus: 1,
      outcomeVerificationNote: 1,
      outcomeVerifiedAt: 1,
      outcomeVerifiedBy: 1,
      providerLeadStatus: 1,
      providerLeadReason: 1,
      providerLeadNote: 1,
      distributedAt: 1,
      unlockedAt: 1,
      providerLeadStatusUpdatedAt: 1,
      updatedAt: 1,
    },
  });

  return { lead, ...result };
}

async function getProviderStatus(enquiryId, leadDistributionId) {
  const lead = await get(enquiryId);
  const distributionId = identifierValue(leadDistributionId, {
    label: "Lead distribution ID",
  });
  const distribution = await LeadDistribution.findOne({
    enquiryId: lead.enquiryId,
    leadDistributionId: distributionId,
  }).lean();
  if (!distribution) {
    throw Object.assign(new Error("Provider lead status not found"), {
      status: 404,
    });
  }
  return { lead, distribution: presentDistribution(distribution) };
}

async function updateAgentReferralValidation(enquiryId, input = {}, actor = "admin") {
  await require("../partner-payout/partner-payout-service").updateReferralValidation(enquiryId, input, actor);
  return get(enquiryId);
}

async function updateAgentSaleConversion() {
  throw Object.assign(
    new Error("Sale conversion is provider-controlled. Employees cannot update it manually."),
    { status: 405 },
  );
}

module.exports = {
  create,
  list,
  get,
  update,
  updateStatus,
  updateAgentReferralValidation,
  updateAgentSaleConversion,
  addNote,
  setActiveState,
  distribute,
  listProviderStatuses,
  getProviderStatus,
  refreshDistributionSummary,
  presentEnquiry,
  providerJourney,
  normalizeInput,
  normalizeMetadata,
  assertReferenceIdUnchanged,
  distributionData,
  LEAD_PRIORITIES,
  OFFER_STATUSES,
  PROVIDER_LEAD_STATUSES,
};
