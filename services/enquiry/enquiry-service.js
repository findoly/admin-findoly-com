const Enquiry = require("../../models/Enquiry");
const Provider = require("../../models/Provider");
const LeadDistribution = require("../../models/LeadDistribution");
const uuid = require("../../utils/uuid");
const { validateMobile } = require("../../utils/mobile");
const {
  canonicalLeadStatus,
  resolveLeadStatusTransition,
} = require("../../utils/lead-journey");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const {
  textValue,
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
const OFFER_STATUSES = Object.freeze(["offered", "unlocked", "withdrawn", "expired"]);
const PROVIDER_LEAD_STATUSES = Object.freeze([
  "contacted",
  "confirmed",
  "on_hold",
  "rejected",
  "invalid",
  "not_interested",
]);
const INTERNAL_METADATA_FIELDS = Object.freeze([
  "rejectedFromStatus",
  "rejectionReason",
  "lastRejectedFromStatus",
  "lastStatusNote",
]);

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
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

function normalizeInput(input = {}, current = {}) {
  const categorySlug = tokenValue(input.categorySlug ?? current.categorySlug, {
    label: "Category",
    required: true,
    maxLength: 80,
  });
  const mobile = validateMobile(input.mobile ?? current.mobile ?? "", {
    label: "Customer mobile number",
  });

  return {
    name: textValue(input.name ?? current.name, {
      label: "Customer name",
      required: true,
      maxLength: 120,
    }),
    mobile,
    email: emailValue(input.email ?? current.email, {
      label: "Customer email",
      required: false,
    }),
    addressLine: textValue(input.addressLine ?? current.addressLine, {
      label: "Customer address",
      maxLength: 500,
    }),
    city: textValue(input.city ?? current.city, {
      label: "City",
      maxLength: 100,
    }),
    state: textValue(input.state ?? current.state, {
      label: "State",
      maxLength: 100,
    }),
    pincode: pincodeValue(input.pincode ?? current.pincode, {
      label: "Pincode",
      required: false,
    }),
    category: textValue(input.category ?? current.category ?? categorySlug, {
      label: "Category name",
      fallback: categorySlug,
      required: true,
      maxLength: 120,
    }),
    categorySlug,
    serviceType: textValue(input.serviceType ?? current.serviceType, {
      label: "Service type",
      maxLength: 120,
    }),
    requirementTitle: textValue(
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
    preferredDate: dateOnlyValue(
      input.preferredDate ?? current.preferredDate,
      { label: "Preferred date", required: false },
    ),
    preferredSlot: textValue(input.preferredSlot ?? current.preferredSlot, {
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
    sourceName: textValue(input.sourceName ?? current.sourceName, {
      label: "Source name",
      maxLength: 120,
    }),
    campaign: textValue(input.campaign ?? current.campaign, {
      label: "Campaign",
      maxLength: 120,
    }),
    externalEnquiryId: textValue(
      input.externalEnquiryId ?? current.externalEnquiryId,
      { label: "External enquiry ID", maxLength: 128 },
    ),
    notes: textValue(input.notes ?? current.notes, {
      label: "Lead notes",
      maxLength: 5000,
      preserveWhitespace: true,
    }),
    additionalDetails:
      input.additionalDetails === undefined
        ? current.additionalDetails || {}
        : plainObjectValue(input.additionalDetails, {
            label: "Additional details",
            maxKeys: 100,
            maxBytes: 50_000,
          }),
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
    category:
      typeof row.category === "string"
        ? row.category
        : categoryObject.name || "",
    categorySlug: row.categorySlug || categoryObject.slug || "",
    sourceWebsite: row.sourceWebsite || source.website || "",
    sourceChannel: row.sourceChannel || source.channel || "",
    sourceName: row.sourceName || source.sourceName || "",
    externalEnquiryId:
      row.externalEnquiryId || source.externalEnquiryId || "",
    journeyStatus: canonicalLeadStatus(row.status),
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
  rejected: ["rejected"],
});

function historyArrays(distribution = {}) {
  return [
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
      const status = text(
        item.status || item.providerLeadStatus || item.toStatus,
      );
      const createdAt =
        item.createdAt || item.updatedAt || item.statusUpdatedAt || null;
      if (!status && !item.message) continue;
      events.push({
        type: "provider_status",
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

  const data = normalizeInput(input);
  const initialStatus = "new";
  const now = new Date();
  data.status = initialStatus;
  data.statusUpdatedAt = now;
  data.statusUpdatedBy = actor;
  data.isActive = true;
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
  if (["approved", "distributed"].includes(enquiry.status)) {
    await distribute(enquiry, actor);
  }

  return get(enquiry.enquiryId);
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

  const startDate = dateOnlyValue(filters.startDate, {
    label: "Start date",
    required: false,
  });
  const endDate = dateOnlyValue(filters.endDate, {
    label: "End date",
    required: false,
  });
  if (startDate && endDate && endDate < startDate) {
    throw validationError("End date cannot be before start date");
  }
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) {
      query.createdAt.$gte = new Date(`${startDate}T00:00:00.000+05:30`);
    }
    if (endDate) {
      query.createdAt.$lte = new Date(`${endDate}T23:59:59.999+05:30`);
    }
  }

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
    sort: { createdAt: -1, _id: -1 },
    limit,
    cursor,
  });

  return {
    ...result,
    data: result.data.map(presentEnquiry),
  };
}

async function get(enquiryId) {
  const enquiry = await Enquiry.findOne(enquiryQuery(enquiryId)).lean();
  if (!enquiry) {
    throw Object.assign(new Error("Lead not found"), { status: 404 });
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
    "distributedAt",
  ]) {
    if (input[field] !== undefined) {
      throw validationError(`${field} is maintained by the CRM and cannot be edited directly`);
    }
  }

  // Normalize against the presented shape so legacy nested lead records remain editable.
  const data = normalizeInput(input, presentEnquiry(existing));
  data.status = existing.status;
  data.statusUpdatedAt = existing.statusUpdatedAt || null;
  data.statusUpdatedBy = existing.statusUpdatedBy || "";
  data.isActive = existing.isActive !== false;

  await Enquiry.updateOne(enquiryQuery(enquiryId), { $set: data });
  const updated = await Enquiry.findOne(enquiryQuery(enquiryId));
  const distributionEnquiryId = existing.enquiryId || existing.id || enquiryId;

  if (
    updated.isActive !== false &&
    ["approved", "distributed"].includes(canonicalLeadStatus(updated.status))
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

  const updated = await Enquiry.findOne(enquiryQuery(enquiryId));
  const distributionEnquiryId = existing.enquiryId || existing.id || enquiryId;
  if (["approved", "distributed"].includes(transition.toStatus)) {
    await distribute(updated, actor);
  } else {
    await LeadDistribution.updateMany(
      { enquiryId: distributionEnquiryId, contactUnlocked: { $ne: true } },
      { $set: { status: "withdrawn", updatedAt: now } },
    );
    await refreshDistributionSummary(distributionEnquiryId);
  }

  return get(enquiryId);
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
    ["approved", "distributed"].includes(canonicalLeadStatus(existing.status))
  ) {
    const updated = await Enquiry.findOne(enquiryQuery(enquiryId));
    await distribute(updated, actor);
  }

  return get(enquiryId);
}

function distributionData(enquiry, provider) {
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
    category: enquiry.category,
    city: enquiry.city,
    state: enquiry.state,
    pincode: enquiry.pincode,
    preferredDate: enquiry.preferredDate,
    preferredSlot: enquiry.preferredSlot,
    priority: enquiry.priority,
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
  const enquiry = presentEnquiry(rawEnquiry);
  if (!enquiry.enquiryId) {
    throw validationError("Lead Reference ID is required for distribution");
  }
  if (!["approved", "distributed"].includes(enquiry.journeyStatus)) {
    throw validationError("Approve the lead before distributing it");
  }
  if (enquiry.isActive === false) {
    throw Object.assign(
      new Error("Reactivate the lead before distributing it"),
      { status: 409 },
    );
  }

  const reference = identifierValue(enquiry.enquiryId || enquiry.id, {
    label: "Lead Reference ID",
  });
  const now = new Date();

  await LeadDistribution.updateMany(
    { enquiryId: reference, contactUnlocked: { $ne: true } },
    { $set: { status: "withdrawn", updatedAt: now } },
  );

  const providers = Provider.find({
    status: "active",
    portalAccessEnabled: { $ne: false },
    categorySlugs: enquiry.categorySlug,
  })
    .select({
      providerId: 1,
      id: 1,
      name: 1,
      businessName: 1,
      mobile: 1,
    })
    .lean()
    .cursor();

  for await (const provider of providers) {
    const providerId = provider.providerId || provider.id;
    if (!providerId) continue;
    const data = distributionData(enquiry, provider);
    const result = await LeadDistribution.updateOne(
      {
        enquiryId: reference,
        providerId,
        contactUnlocked: { $ne: true },
      },
      { $set: { ...data, status: "offered" } },
    );

    if (!result.matchedCount) {
      try {
        await LeadDistribution.create({
          ...data,
          leadDistributionId: uuid(),
          status: "offered",
          contactUnlocked: false,
          distributedBy: actor,
          distributedAt: now,
        });
      } catch (error) {
        // A unique conflict means an already-unlocked record exists. It must remain untouched.
        if (error?.code !== 11000) throw error;
      }
    }
  }

  const summary = await refreshDistributionSummary(reference);
  await Enquiry.updateOne(enquiryQuery(reference), {
    $set: { distributedAt: now, updatedAt: new Date() },
  });
  return summary;
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

module.exports = {
  create,
  list,
  get,
  update,
  updateStatus,
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
