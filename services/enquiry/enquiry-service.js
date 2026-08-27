const Enquiry = require("../../models/Enquiry");
const ProviderLeadUnlock = require("../../models/ProviderLeadUnlock");
const catalogService = require("../catalog/catalog-service");
const notificationService = require("../communication/notification-service");
const nearbyLeadAlertService = require("../communication/nearby-lead-alert-service");
const uuid = require("../../utils/uuid");
const { validateMobile } = require("../../utils/mobile");
const {
  canonicalLeadStatus,
  resolveLeadStatusTransition,
} = require("../../utils/lead-journey");
const { PROVIDER_LEAD_STATUSES } = require("../../utils/provider-lead-status");
const { geocodePincode } = require("../location/geocoding-service");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const { applyDateRange, dateSort } = require("../../utils/date-query");
const { normalizeSearchText, prefixRegex } = require("../../utils/normalization");
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
const MARKETPLACE_STATUSES = Object.freeze(["draft", "published", "paused", "closed", "expired"]);
const INTERNAL_METADATA_FIELDS = Object.freeze([
  "rejectedFromStatus",
  "rejectionReason",
  "lastRejectedFromStatus",
  "lastStatusNote",
]);
const STATUS_FILTERS = Object.freeze({
  new: ["new"],
  verification: ["verification", "verification_pending", "verified"],
  approved: ["approved"],
  rejected: ["rejected"],
});
const TIMELINE_LIMIT = 50;
const DEFAULT_PROVIDER_UNLOCKS = 3;

function hasNumericValue(value) {
  return value !== null
    && value !== undefined
    && String(value).trim() !== ""
    && Number.isFinite(Number(value));
}

function marketplaceLifetimeDays() {
  const configured = Number(process.env.MARKETPLACE_LEAD_TTL_DAYS || 180);
  return Number.isInteger(configured) && configured >= 1 && configured <= 365
    ? configured
    : 180;
}

function addDays(date, days) {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + Number(days || 0));
  return value;
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

  let requestedServiceTypes = input.serviceTypeIds ?? input.serviceTypes ?? current.serviceTypes;
  if ((!Array.isArray(requestedServiceTypes) || !requestedServiceTypes.length) && (input.serviceType ?? current.serviceType)) {
    const legacyValue = String(input.serviceType ?? current.serviceType).trim();
    const matches = await catalogService.listServiceTypes({ categorySlug, includeInactive: true });
    const match = matches.find((item) =>
      String(item.serviceTypeId || item.id) === legacyValue
      || String(item.slug || "").toLowerCase() === legacyValue.toLowerCase()
      || String(item.name || "").toLowerCase() === legacyValue.toLowerCase(),
    );
    if (match) requestedServiceTypes = [match.serviceTypeId || match.id];
  }
  const serviceTypes = await catalogService.resolveLeadServiceTypes(
    categorySlug,
    requestedServiceTypes,
    { allowInactiveCurrent: current.serviceTypes || [] },
  );
  const currentAlertDistanceKm = Number(current.alertDistanceKm);
  const alertDistanceFallback = Number.isInteger(currentAlertDistanceKm)
    && currentAlertDistanceKm >= 1
    && currentAlertDistanceKm <= 100
    ? currentAlertDistanceKm
    : await catalogService.getCategoryAlertDistanceKm(categorySlug);
  const currentMaxProviderUnlocks = Number(current.maxProviderUnlocks);
  const maxProviderUnlockFallback = Number.isInteger(currentMaxProviderUnlocks)
    && currentMaxProviderUnlocks >= 1
    && currentMaxProviderUnlocks <= 1000
    ? currentMaxProviderUnlocks
    : await catalogService.getCategoryDefaultProviderUnlocks(categorySlug);

  const name = humanTextValue(input.name ?? current.name, {
    label: "Customer name",
    required: true,
    maxLength: 120,
  });
  const city = humanTextValue(input.city ?? current.city, {
    label: "City",
    required: true,
    maxLength: 100,
  });
  const requirementTitle = humanTextValue(
    input.requirementTitle ?? current.requirementTitle,
    { label: "Requirement title", required: true, maxLength: 200 },
  );
  const usedUnlockSlots = Math.max(
    0,
    Number(current.unlockedCount || 0) + Number(current.reservedUnlockCount || 0),
  );

  return {
    name,
    nameKey: normalizeSearchText(name),
    mobile,
    email: emailValue(input.email ?? current.email, {
      label: "Customer email",
      required: false,
    }),
    addressLine: humanTextValue(input.addressLine ?? current.addressLine, {
      label: "Customer address",
      maxLength: 500,
    }),
    city,
    cityKey: normalizeSearchText(city),
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
    alertDistanceKm: numberValue(input.alertDistanceKm, {
      label: "Provider alert distance",
      fallback: alertDistanceFallback,
      min: 1,
      max: 100,
      integer: true,
    }),
    serviceTypes,
    serviceType: serviceTypes[0]?.name || "",
    requirementTitle,
    requirementTitleKey: normalizeSearchText(requirementTitle),
    priority: enumValue(input.priority, LEAD_PRIORITIES, {
      label: "Lead priority",
      fallback: current.priority || "normal",
    }),
    preferredDate: dateOnlyValue(input.preferredDate ?? current.preferredDate, {
      label: "Preferred date",
      required: false,
    }),
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
      fallback: maxProviderUnlockFallback,
      min: Math.max(1, usedUnlockSlots),
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
    externalEnquiryId: textValue(input.externalEnquiryId ?? current.externalEnquiryId, {
      label: "External enquiry ID",
      maxLength: 128,
    }),
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
  const categoryObject = row.category && typeof row.category === "object" ? row.category : {};
  const maxProviderUnlocks = Number.isInteger(Number(row.maxProviderUnlocks))
    && Number(row.maxProviderUnlocks) > 0
    ? Number(row.maxProviderUnlocks)
    : DEFAULT_PROVIDER_UNLOCKS;
  const alertDistanceKm = Number(row.alertDistanceKm);
  const unlockedCount = Math.max(0, Number(row.unlockedCount || 0));
  const reservedUnlockCount = Math.max(0, Number(row.reservedUnlockCount || 0));
  const remainingUnlocks = Number.isFinite(Number(row.remainingUnlocks))
    ? Math.max(0, Number(row.remainingUnlocks))
    : Math.max(0, maxProviderUnlocks - unlockedCount - reservedUnlockCount);

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
    marketplaceStatus: MARKETPLACE_STATUSES.includes(row.marketplaceStatus) ? row.marketplaceStatus : "draft",
    marketplaceAvailable: row.marketplaceAvailable === true,
    marketplaceClosureReason: row.marketplaceClosureReason || "",
    marketplacePublishedAt: row.marketplacePublishedAt || null,
    marketplaceExpiresAt: row.marketplaceExpiresAt || null,
    category: typeof row.category === "string" ? row.category : categoryObject.name || "",
    categorySlug: row.categorySlug || categoryObject.slug || "",
    alertDistanceKm: Number.isInteger(alertDistanceKm) && alertDistanceKm >= 1 && alertDistanceKm <= 100
      ? alertDistanceKm
      : 20,
    serviceTypes: Array.isArray(row.serviceTypes)
      ? row.serviceTypes.map((item) => ({
          serviceTypeId: item.serviceTypeId || item.id || "",
          name: item.name || "",
          slug: item.slug || "",
        })).filter((item) => item.name)
      : [],
    serviceType: row.serviceType || (Array.isArray(row.serviceTypes) ? row.serviceTypes[0]?.name : "") || "",
    sourceWebsite: row.sourceWebsite || source.website || "",
    sourceChannel: row.sourceChannel || source.channel || "",
    sourceName: row.sourceName || source.sourceName || "",
    externalEnquiryId: row.externalEnquiryId || source.externalEnquiryId || "",
    journeyStatus: canonicalLeadStatus(row.status),
    agentReferralValidation: row.agentReferralValidation || "pending",
    leadValidationMethod: row.leadValidationMethod || "",
    agentSaleConversion: row.agentSaleConversion || "pending",
    unlockedCount,
    reservedUnlockCount,
    remainingUnlocks,
    maxProviderUnlocks,
    providerConfirmedCount: Math.max(0, Number(row.providerConfirmedCount || 0)),
    providerSaleConversionStatus: row.providerSaleConversionStatus || "pending",
    partnerEligibilityDate: row.partnerEligibilityDate
      || (row.agentId && row.createdAt
        ? new Date(new Date(row.createdAt).getTime() + 14 * 24 * 60 * 60 * 1000)
        : null),
    partnerPayoutStatus: row.partnerPayoutStatus || (row.agentId ? "waiting_period" : ""),
    isActive: row.isActive !== false,
  };
}

function enquiryQuery(enquiryId) {
  const value = identifierValue(enquiryId, { label: "Lead Reference ID" });
  return { $or: [{ enquiryId: value }, { id: value }] };
}

function pushTimeline(entry) {
  return { $each: [entry], $slice: -TIMELINE_LIMIT };
}

function providerJourney(unlock = {}) {
  const events = [{
    type: "unlocked",
    status: "unlocked",
    message: "Customer contact unlocked",
    actor: unlock.providerId || "provider",
    createdAt: unlock.unlockedAt || unlock.createdAt,
  }];
  if (unlock.providerLeadStatus) {
    events.push({
      type: "provider_status",
      status: unlock.providerLeadStatus,
      reason: unlock.providerLeadReason || "",
      note: unlock.providerLeadNote || "",
      actor: unlock.providerLeadStatusUpdatedBy || unlock.providerId || "provider",
      createdAt: unlock.providerLeadStatusUpdatedAt,
    });
  }
  if (unlock.providerSaleOutcome) {
    events.push({
      type: "provider_outcome",
      outcome: unlock.providerSaleOutcome,
      note: unlock.providerSaleOutcomeNote || "",
      actor: unlock.providerSaleOutcomeUpdatedBy || unlock.providerId || "provider",
      createdAt: unlock.providerSaleOutcomeUpdatedAt,
    });
  }
  return events.filter((item) => item.createdAt).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function presentProviderUnlock(row = {}) {
  return {
    ...row,
    providerLeadUnlockId: row.providerLeadUnlockId || "",
    status: "unlocked",
    contactUnlocked: true,
    providerJourney: providerJourney(row),
  };
}

function assertReferenceIdUnchanged(existing, input = {}) {
  const currentReference = String(existing.enquiryId || existing.id || "");
  for (const field of ["enquiryId", "referenceId", "id"]) {
    if (input[field] === undefined || input[field] === null) continue;
    if (String(input[field]) !== currentReference) {
      throw Object.assign(new Error("Lead Reference ID cannot be changed after creation"), { status: 400 });
    }
  }
  if (input._id !== undefined && input._id !== null && String(input._id) !== String(existing._id || "")) {
    throw Object.assign(new Error("Lead database ID cannot be changed after creation"), { status: 400 });
  }
}

async function ensureEnquiryLocation(enquiry) {
  const pincode = String(enquiry.pincode || "").trim();
  if (!/^[1-9]\d{5}$/.test(pincode)) {
    throw validationError("A valid 6-digit lead PIN code is required before marketplace publishing");
  }
  const alreadyVerified = pincode === String(enquiry.locationPincode || "")
    && String(enquiry.locationSource || "").trim().toLowerCase() !== "manual_pincode"
    && hasNumericValue(enquiry.locationLatitude)
    && hasNumericValue(enquiry.locationLongitude);
  if (alreadyVerified) return enquiry;

  try {
    const location = await geocodePincode(pincode);
    const locationData = {
      locationLatitude: Number(location.latitude),
      locationLongitude: Number(location.longitude),
      locationPincode: pincode,
      locationLocality: location.locality || "",
      locationDistrict: location.district || "",
      locationState: location.state || enquiry.state || "",
      locationCountry: location.country || "India",
      locationVerifiedAt: location.verifiedAt || new Date(),
      locationSource: location.source || "google_geocoding",
    };
    await Enquiry.updateOne(enquiryQuery(enquiry.enquiryId || enquiry.id), {
      $set: { ...locationData, updatedAt: new Date() },
    });
    return { ...enquiry, ...locationData };
  } catch (_error) {
    // A geocoding outage must not block approval. Clear any old coordinates so
    // this explicit manual state retries Google later and cannot look verified.
    return {
      ...enquiry,
      locationLatitude: null,
      locationLongitude: null,
      locationPincode: pincode,
      locationLocality: "",
      locationDistrict: "",
      locationState: enquiry.state || "",
      locationCountry: "India",
      locationVerifiedAt: null,
      locationSource: "manual_pincode",
    };
  }
}

async function publishMarketplace(enquiryId, actor = "system") {
  const startedAt = process.hrtime.bigint();
  console.info({
    event: "marketplace_publish_started",
    enquiryId: String(enquiryId || ""),
    actor: String(actor || "system"),
  });
  let lead = await Enquiry.findOne(enquiryQuery(enquiryId)).lean();
  if (!lead) throw Object.assign(new Error("Lead not found"), { status: 404 });
  if (lead.isActive === false) {
    throw Object.assign(new Error("Reactivate the lead before publishing it"), { status: 409 });
  }
  if (canonicalLeadStatus(lead.status) !== "approved") {
    throw validationError("Approve the lead before publishing it to the marketplace");
  }
  if (lead.agentReferralValidation !== "valid") {
    throw validationError("Only Valid leads can be published to providers");
  }

  lead = await ensureEnquiryLocation(lead);
  const now = new Date();
  const maxProviderUnlocks = Math.max(1, Number(lead.maxProviderUnlocks || DEFAULT_PROVIDER_UNLOCKS));
  const unlockedCount = Math.max(0, Number(lead.unlockedCount || 0));
  const reservedUnlockCount = Math.max(0, Number(lead.reservedUnlockCount || 0));
  const remainingUnlocks = Math.max(0, maxProviderUnlocks - unlockedCount - reservedUnlockCount);
  const existingExpiry = lead.marketplaceExpiresAt ? new Date(lead.marketplaceExpiresAt) : null;
  const marketplacePublishedAt = lead.marketplacePublishedAt || now;
  const marketplaceExpiresAt = existingExpiry && existingExpiry > now
    ? existingExpiry
    : addDays(now, marketplaceLifetimeDays());

  await Enquiry.updateOne(enquiryQuery(enquiryId), {
    $set: {
      marketplaceStatus: remainingUnlocks > 0 ? "published" : "closed",
      marketplaceAvailable: remainingUnlocks > 0,
      marketplaceClosureReason: remainingUnlocks > 0 ? "" : "unlock_limit",
      marketplacePublishedAt,
      marketplaceExpiresAt,
      remainingUnlocks,
      locationLatitude: hasNumericValue(lead.locationLatitude) ? Number(lead.locationLatitude) : null,
      locationLongitude: hasNumericValue(lead.locationLongitude) ? Number(lead.locationLongitude) : null,
      locationPincode: lead.locationPincode || lead.pincode,
      locationLocality: lead.locationLocality || "",
      locationDistrict: lead.locationDistrict || "",
      locationState: lead.locationState || lead.state || "",
      locationCountry: lead.locationCountry || "India",
      locationVerifiedAt: lead.locationVerifiedAt || null,
      locationSource: lead.locationSource || "manual_pincode",
      updatedAt: now,
    },
    $push: {
      timeline: pushTimeline({
        timelineId: uuid(),
        type: "marketplace_published",
        message: remainingUnlocks > 0
          ? "Lead automatically published to the Provider Marketplace"
          : "Lead approved but marketplace capacity is already full",
        actor,
        createdAt: now,
      }),
    },
  });

  const publishedLead = await get(enquiryId);
  let alertSummary = null;
  if (remainingUnlocks > 0) {
    try {
      alertSummary = await nearbyLeadAlertService.dispatchNearbyLeadAlerts(publishedLead, actor);
    } catch (error) {
      console.error({
        event: "nearby_alert_dispatch_failed",
        enquiryId: publishedLead.enquiryId,
        code: String(error.code || "NEARBY_ALERT_DISPATCH_FAILED"),
        message: String(error.message || error).slice(0, 2000),
        stack: error.stack,
      });
    }
  }
  console.info({
    event: "marketplace_publish_completed",
    enquiryId: publishedLead.enquiryId,
    marketplaceStatus: publishedLead.marketplaceStatus,
    remainingUnlocks: Number(publishedLead.remainingUnlocks || 0),
    categorySlug: publishedLead.categorySlug || "",
    coordinatesAvailable: [publishedLead.locationLatitude, publishedLead.locationLongitude]
      .every((value) => value !== null && value !== undefined && Number.isFinite(Number(value))),
    alertSummary,
    durationMs: Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(2)),
  });
  return publishedLead;
}

async function closeMarketplace(enquiryId, marketplaceStatus = "paused", actor = "system", closureReason = "status_change") {
  const status = enumValue(marketplaceStatus, ["paused", "closed", "expired"], {
    label: "Marketplace status",
  });
  const now = new Date();
  const result = await Enquiry.updateOne(enquiryQuery(enquiryId), {
    $set: {
      marketplaceStatus: status,
      marketplaceAvailable: false,
      marketplaceClosureReason: status === "expired" ? "expired" : closureReason,
      updatedAt: now,
    },
    $push: {
      timeline: pushTimeline({
        timelineId: uuid(),
        type: "marketplace_closed",
        message: `Marketplace availability changed to ${status}`,
        actor,
        createdAt: now,
      }),
    },
  });
  if (!result.matchedCount) throw Object.assign(new Error("Lead not found"), { status: 404 });
}

async function create(input = {}, actor = "admin") {
  const requestedStatus = textValue(input.status, {
    label: "Initial lead status",
    fallback: "new",
    maxLength: 40,
  }).toLowerCase();
  if (requestedStatus !== "new") {
    throw validationError("New leads must start at the New journey stage");
  }

  const data = await normalizeInput(input);
  const now = new Date();
  data.status = "new";
  data.statusUpdatedAt = now;
  data.statusUpdatedBy = actor;
  data.isActive = true;
  data.agentReferralValidation = "pending";
  data.marketplaceStatus = "draft";
  data.marketplaceAvailable = false;
  data.unlockedCount = 0;
  data.reservedUnlockCount = 0;
  data.remainingUnlocks = data.maxProviderUnlocks;
  data.timeline = [{
    timelineId: uuid(),
    type: "created",
    message: "Lead created with new status",
    fromStatus: "",
    toStatus: "new",
    actor,
    createdAt: now,
  }];

  const enquiry = await Enquiry.create(data);
  const createdLead = await get(enquiry.enquiryId);
  await notificationService.triggerSafe("lead_created", {
    lead: createdLead,
    status: createdLead.journeyStatus || createdLead.status,
    trigger: "lead_created",
    createdBy: actor,
    source: actor === "public-api" ? "public-api" : "crm",
    idempotencySuffix: createdLead.createdAt || now.toISOString(),
  }, actor);
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
    const active = String(filters.active).toLowerCase();
    if (["active", "true"].includes(active)) query.isActive = { $ne: false };
    else if (["deactivated", "false"].includes(active)) query.isActive = false;
    else throw validationError("Lead active-state filter must be active or deactivated");
  }
  if (filters.marketplaceStatus) {
    query.marketplaceStatus = enumValue(filters.marketplaceStatus, MARKETPLACE_STATUSES, {
      label: "Marketplace status filter",
    });
  }
  if (filters.categorySlug) {
    query.categorySlug = tokenValue(filters.categorySlug, {
      label: "Category filter",
      maxLength: 80,
    });
  }
  const city = queryTextValue(filters.city, { label: "City filter", maxLength: 100 });
  if (city) query.cityKey = normalizeSearchText(city);
  if (filters.sourceWebsite) {
    query.sourceWebsite = textValue(filters.sourceWebsite, {
      label: "Source website filter",
      maxLength: 120,
    });
  }
  if (filters.sourceChannel) {
    query.sourceChannel = textValue(filters.sourceChannel, {
      label: "Source channel filter",
      maxLength: 80,
    });
  }
  if (filters.referralId) {
    query.referralId = textValue(filters.referralId, {
      label: "Referral ID filter",
      maxLength: 6,
    }).toUpperCase();
  }
  if (filters.agentReferralValidation) {
    const validationStatus = enumValue(
      filters.agentReferralValidation,
      ["pending", "valid", "invalid"],
      { label: "Lead validation filter" },
    );
    query.agentReferralValidation = validationStatus === "pending"
      ? { $in: ["", "pending", null] }
      : validationStatus;
  }
  if (filters.partnerPayoutStatus) {
    query.partnerPayoutStatus = enumValue(
      filters.partnerPayoutStatus,
      ["waiting_period", "unpaid", "reserved", "paid", "not_eligible"],
      { label: "Partner payout status filter" },
    );
  }

  applyDateRange(query, filters, {
    fields: {
      createdAt: "Created date",
      updatedAt: "Updated date",
      statusUpdatedAt: "Status updated date",
      marketplacePublishedAt: "Marketplace published date",
    },
  });

  const q = queryTextValue(filters.q, { label: "Lead search", maxLength: 100 });
  if (q) {
    const normalized = normalizeSearchText(q);
    if (/^[6-9]\d{9}$/.test(normalized)) {
      query.mobile = normalized;
    } else if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized)) {
      query.email = normalized;
    } else if (/^[1-9]\d{5}$/.test(normalized)) {
      query.$or = [{ pincode: normalized }, { referralId: normalized.toUpperCase() }];
    } else {
      if (normalized.length < 3) {
        throw validationError("Lead search must contain at least 3 characters");
      }
      query.$or = [
        { enquiryId: q.trim() },
        { externalEnquiryId: q.trim() },
        { referralId: q.trim().toUpperCase() },
        { requirementTitleKey: prefixRegex(normalized) },
        { nameKey: prefixRegex(normalized) },
      ];
    }
  }

  const result = await cursorPaginate(Enquiry, {
    query,
    sort: dateSort(filters, {
      fields: ["createdAt", "updatedAt", "statusUpdatedAt", "marketplacePublishedAt"],
    }),
    limit,
    cursor,
  });
  return { ...result, data: result.data.map(presentEnquiry) };
}

async function get(enquiryId) {
  const enquiry = await Enquiry.findOne(enquiryQuery(enquiryId)).lean();
  if (!enquiry) throw Object.assign(new Error("Lead not found"), { status: 404 });
  return presentEnquiry(enquiry);
}

async function update(enquiryId, input = {}, actor = "admin") {
  const existing = await Enquiry.findOne(enquiryQuery(enquiryId)).lean();
  if (!existing) throw Object.assign(new Error("Lead not found"), { status: 404 });
  assertReferenceIdUnchanged(existing, input);

  if (input.status !== undefined
    && canonicalLeadStatus(input.status) !== canonicalLeadStatus(existing.status)) {
    throw validationError("Use the lead journey controls to change status");
  }
  if (input.isActive !== undefined
    && booleanValue(input.isActive, { label: "Lead active state" }) !== (existing.isActive !== false)) {
    throw validationError("Use the deactivate or reactivate action to change lead availability");
  }

  for (const field of [
    "timeline", "statusUpdatedAt", "statusUpdatedBy", "deactivatedAt", "deactivatedBy",
    "deactivationReason", "unlockedCount", "reservedUnlockCount", "remainingUnlocks",
    "marketplaceStatus", "marketplaceAvailable", "marketplaceClosureReason", "marketplacePublishedAt", "marketplaceExpiresAt",
    "locationLatitude", "locationLongitude", "locationPincode", "locationVerifiedAt",
    "providerConfirmedCount", "providerSaleConversionStatus", "providerSaleConversionUpdatedAt",
    "providerSaleConvertedAt", "agentSaleConversion",
    "agentSaleConversionNote", "agentSaleConvertedAt", "agentSaleConvertedBy",
  ]) {
    if (input[field] !== undefined) {
      throw validationError(`${field} is maintained by the CRM and cannot be edited directly`);
    }
  }

  const data = await normalizeInput(input, presentEnquiry(existing));
  const existingServiceTypes = (Array.isArray(existing.serviceTypes) ? existing.serviceTypes : [])
    .map((item) => String(item?.serviceTypeId || item?.id || item?.slug || item?.name || item || "").trim())
    .filter(Boolean);
  const nextServiceTypes = (Array.isArray(data.serviceTypes) ? data.serviceTypes : [])
    .map((item) => String(item?.serviceTypeId || item?.id || item?.slug || item?.name || item || "").trim())
    .filter(Boolean);
  const requirementContextChanged = String(existing.categorySlug || "") !== String(data.categorySlug || "")
    || String(existing.category || "") !== String(data.category || "")
    || JSON.stringify(existingServiceTypes) !== JSON.stringify(nextServiceTypes);
  const requirementStillEditable = canonicalLeadStatus(existing.status) !== "approved"
    && existing.marketplaceAvailable !== true
    && String(existing.marketplaceStatus || "").toLowerCase() !== "published"
    && Number(existing.unlockedCount || 0) === 0
    && Number(existing.reservedUnlockCount || 0) === 0;
  if (requirementContextChanged && requirementStillEditable) {
    Object.assign(data, {
      requirementAiStatus: "",
      requirementAiClarificationReason: "",
      requirementAiClarificationMessage: "",
      requirementAiProviderTitle: "",
      requirementAiProviderDetails: "",
      providerRequirementTitle: "",
      providerRequirementDetails: "",
      requirementAiApprovedAt: null,
      requirementAiApprovedBy: "",
      requirementAiSourceHash: "",
      requirementAiGeneratedAt: null,
    });
  }
  data.status = existing.status;
  data.statusUpdatedAt = existing.statusUpdatedAt || null;
  data.statusUpdatedBy = existing.statusUpdatedBy || "";
  data.isActive = existing.isActive !== false;
  data.remainingUnlocks = Math.max(
    0,
    data.maxProviderUnlocks
      - Number(existing.unlockedCount || 0)
      - Number(existing.reservedUnlockCount || 0),
  );

  await Enquiry.updateOne(enquiryQuery(enquiryId), { $set: data });
  if (data.isActive && canonicalLeadStatus(existing.status) === "approved") {
    await publishMarketplace(enquiryId, actor);
  }
  return get(enquiryId);
}

async function updateStatus(enquiryId, input = {}, actor = "admin") {
  const existing = await Enquiry.findOne(enquiryQuery(enquiryId)).lean();
  if (!existing) throw Object.assign(new Error("Lead not found"), { status: 404 });
  if (existing.isActive === false) {
    throw Object.assign(new Error("Reactivate the lead before changing its journey status"), { status: 409 });
  }

  const isAgentRequirement = Boolean(
    existing.agentId
    && (existing.sourceChannel === "agent"
      || existing.sourceWebsite === "agent-portal"
      || existing.metadata?.agentSubmission),
  );
  if (isAgentRequirement) {
    await require("../partner-payout/partner-payout-service")
      .assertRequirementNotPayoutProcessing(existing);
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
  const transition = resolveLeadStatusTransition(existing.status, input, metadata);
  if (transition.toStatus === "approved") {
    const requirementApproved = Boolean(
      existing.requirementAiApprovedAt
      && String(existing.providerRequirementTitle || "").trim()
      && String(existing.providerRequirementDetails || "").trim()
    );
    if (!requirementApproved) {
      throw validationError("Approve the customer requirement before approving this lead");
    }
  }
  const now = new Date();
  if (transition.action === "reject") {
    metadata.rejectedFromStatus = transition.fromStatus;
    metadata.rejectionReason = transition.note;
  } else if (transition.action === "restore") {
    metadata.lastRejectedFromStatus = metadata.rejectedFromStatus || "";
    delete metadata.rejectionReason;
  }
  metadata.lastStatusNote = transition.note;

  const statusUpdateQuery = isAgentRequirement
    ? {
        $and: [
          enquiryQuery(enquiryId),
          {
            $or: [
              { partnerPayoutLockWithdrawalId: "" },
              { partnerPayoutLockWithdrawalId: null },
              { partnerPayoutLockWithdrawalId: { $exists: false } },
            ],
          },
        ],
      }
    : enquiryQuery(enquiryId);
  const statusUpdate = await Enquiry.updateOne(statusUpdateQuery, {
    $set: {
      status: transition.toStatus,
      statusUpdatedAt: now,
      statusUpdatedBy: actor,
      metadata,
      updatedAt: now,
    },
    $push: {
      timeline: pushTimeline({
        timelineId: uuid(),
        type: "status_changed",
        message: `Status changed from ${transition.fromStatus} to ${transition.toStatus}`,
        fromStatus: transition.fromStatus,
        toStatus: transition.toStatus,
        action: transition.action,
        note: transition.note,
        actor,
        createdAt: now,
      }),
    },
  });
  if (statusUpdate.matchedCount !== 1) {
    throw Object.assign(
      new Error(isAgentRequirement
        ? "This referral is locked while its Razorpay payout is processing"
        : "Lead status changed while it was being updated"),
      {
        status: 409,
        code: isAgentRequirement ? "REFERRAL_PAYOUT_LOCKED" : "LEAD_CONCURRENT_UPDATE",
      },
    );
  }

  if (isAgentRequirement && transition.toStatus === "rejected") {
    if (existing.partnerWithdrawalId && existing.partnerPayoutStatus === "reserved") {
      await require("../partner-payout/partner-payout-service")
        .markEligibilityChangedForRequirement(
          existing.enquiryId || enquiryId,
          `Requirement rejected: ${transition.note}`,
          actor,
        );
    }
    await Enquiry.updateOne(enquiryQuery(enquiryId), {
      $set: {
        partnerPayoutStatus: existing.partnerPayoutStatus === "paid" ? "paid" : "not_eligible",
        updatedAt: now,
      },
    });
  }
  if (isAgentRequirement
    && transition.toStatus !== "rejected"
    && existing.agentReferralValidation === "valid"
    && !["paid", "reserved"].includes(existing.partnerPayoutStatus)) {
    const eligibilityAt = existing.partnerEligibilityDate
      || new Date(new Date(existing.createdAt || now).getTime() + 14 * 24 * 60 * 60 * 1000);
    await Enquiry.updateOne(enquiryQuery(enquiryId), {
      $set: {
        partnerEligibilityDate: eligibilityAt,
        partnerPayoutStatus: eligibilityAt <= now ? "unpaid" : "waiting_period",
        updatedAt: now,
      },
    });
  }

  if (transition.toStatus === "approved") {
    await publishMarketplace(enquiryId, actor);
  } else {
    await closeMarketplace(
      enquiryId,
      transition.toStatus === "rejected" ? "closed" : "paused",
      actor,
      "status_change",
    );
  }

  const changedLead = await get(enquiryId);
  const eventByStatus = {
    approved: "lead_approved",
    rejected: "lead_rejected",
    verification: "lead_status_changed",
    new: "lead_status_changed",
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
  const now = new Date();
  const result = await Enquiry.updateOne(enquiryQuery(enquiryId), {
    $set: { notes: message, updatedAt: now },
    $push: {
      timeline: pushTimeline({
        timelineId: uuid(),
        type: "note",
        message,
        actor,
        createdAt: now,
      }),
    },
  });
  if (!result.matchedCount) throw Object.assign(new Error("Lead not found"), { status: 404 });
  return get(enquiryId);
}

async function setActiveState(enquiryId, isActive, { reason = "" } = {}, actor = "admin") {
  const existing = await Enquiry.findOne(enquiryQuery(enquiryId)).lean();
  if (!existing) throw Object.assign(new Error("Lead not found"), { status: 404 });
  const targetActive = booleanValue(isActive, {
    label: "Lead active state",
    fallback: existing.isActive !== false,
  });
  if (targetActive === (existing.isActive !== false)) return get(enquiryId);

  const normalizedReason = textValue(reason, {
    label: "Deactivation reason",
    maxLength: 1000,
    preserveWhitespace: true,
  });
  const now = new Date();
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
          marketplaceStatus: "closed",
          marketplaceAvailable: false,
          marketplaceClosureReason: "deactivated",
          updatedAt: now,
        },
    $push: {
      timeline: pushTimeline({
        timelineId: uuid(),
        type: targetActive ? "reactivated" : "deactivated",
        message: targetActive ? "Lead reactivated" : "Lead deactivated",
        note: normalizedReason,
        actor,
        createdAt: now,
      }),
    },
  });

  if (targetActive && canonicalLeadStatus(existing.status) === "approved") {
    await publishMarketplace(enquiryId, actor);
  }
  return get(enquiryId);
}

async function listProviderUnlocks(enquiryId, filters = {}) {
  const lead = await get(enquiryId);
  const { limit, cursor } = getPagination(filters);
  const query = { enquiryId: lead.enquiryId };
  if (filters.status) {
    query.providerLeadStatus = enumValue(filters.status, PROVIDER_LEAD_STATUSES, {
      label: "Provider lead status filter",
    });
  }
  if (filters.outcome) {
    query.providerSaleOutcome = enumValue(filters.outcome, ["confirmed", "not_confirmed"], {
      label: "Provider outcome filter",
    });
  }
  const providerId = queryTextValue(filters.providerId || filters.q, {
    label: "Provider ID filter",
    maxLength: 100,
  });
  if (providerId) query.providerId = identifierValue(providerId, { label: "Provider ID filter" });

  const result = await cursorPaginate(ProviderLeadUnlock, {
    query,
    sort: { unlockedAt: -1, _id: -1 },
    limit,
    cursor,
  });
  return { lead, ...result, data: result.data.map(presentProviderUnlock) };
}

async function getProviderUnlock(enquiryId, providerLeadUnlockId) {
  const lead = await get(enquiryId);
  const unlockId = identifierValue(providerLeadUnlockId, {
    label: "Provider lead unlock ID",
  });
  const unlock = await ProviderLeadUnlock.findOne({
    enquiryId: lead.enquiryId,
    providerLeadUnlockId: unlockId,
  }).lean();
  if (!unlock) {
    throw Object.assign(new Error("Provider lead unlock not found"), { status: 404 });
  }
  return { lead, unlock: presentProviderUnlock(unlock) };
}

async function updateAgentReferralValidation(enquiryId, input = {}, actor = "admin") {
  await require("../partner-payout/partner-payout-service")
    .updateReferralValidation(enquiryId, input, actor);
  const lead = await get(enquiryId);
  if (lead.agentReferralValidation === "valid" && lead.journeyStatus === "approved" && lead.isActive) {
    return publishMarketplace(enquiryId, actor);
  }
  return lead;
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
  publishMarketplace,
  closeMarketplace,
  listProviderUnlocks,
  getProviderUnlock,
  presentEnquiry,
  presentProviderUnlock,
  providerJourney,
  normalizeInput,
  normalizeMetadata,
  assertReferenceIdUnchanged,
  LEAD_PRIORITIES,
  MARKETPLACE_STATUSES,
  PROVIDER_LEAD_STATUSES,
};
