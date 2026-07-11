const Enquiry = require("../../models/Enquiry");
const Provider = require("../../models/Provider");
const LeadDistribution = require("../../models/LeadDistribution");
const uuid = require("../../utils/uuid");
const { validateMobile } = require("../../utils/mobile");
const {
  canonicalLeadStatus,
  resolveLeadStatusTransition,
} = require("../../utils/lead-journey");
const { getPagination, pageResult } = require("../../utils/pagination");

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizeInput(input = {}, current = {}) {
  const categorySlug = text(input.categorySlug, current.categorySlug);
  const mobile = validateMobile(input.mobile ?? current.mobile ?? "", {
    label: "Customer mobile number",
  });

  return {
    name: text(input.name, current.name),
    mobile,
    email: text(input.email, current.email).toLowerCase(),
    addressLine: text(input.addressLine, current.addressLine),
    city: text(input.city, current.city),
    state: text(input.state, current.state),
    pincode: text(input.pincode, current.pincode),
    category: text(input.category, current.category || categorySlug),
    categorySlug,
    serviceType: text(input.serviceType, current.serviceType),
    requirementTitle: text(input.requirementTitle, current.requirementTitle),
    priority: text(input.priority, current.priority || "normal"),
    preferredDate: text(input.preferredDate, current.preferredDate),
    preferredSlot: text(input.preferredSlot, current.preferredSlot),
    leadPricePaise: Math.max(
      0,
      Math.round(
        Number(input.leadPricePaise ?? current.leadPricePaise ?? 10000),
      ),
    ),
    currency: "INR",
    sourceWebsite: text(
      input.sourceWebsite,
      current.sourceWebsite || "manual-admin",
    ),
    sourceChannel: text(input.sourceChannel, current.sourceChannel || "admin"),
    sourceType: text(input.sourceType, current.sourceType || "manual"),
    sourceName: text(input.sourceName, current.sourceName),
    campaign: text(input.campaign, current.campaign),
    externalEnquiryId: text(input.externalEnquiryId, current.externalEnquiryId),
    notes: text(input.notes, current.notes),
    additionalDetails:
      input.additionalDetails ?? current.additionalDetails ?? {},
    metadata: input.metadata ?? current.metadata ?? {},
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
  };
}

function enquiryQuery(enquiryId) {
  return { $or: [{ enquiryId }, { id: enquiryId }] };
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

async function create(input, actor = "admin") {
  const data = normalizeInput(input);
  if (!data.categorySlug) {
    throw Object.assign(new Error("Category is required"), { status: 400 });
  }

  const initialStatus = canonicalLeadStatus(input.status || "new");
  const now = new Date();
  data.status = initialStatus;
  data.statusUpdatedAt = now;
  data.statusUpdatedBy = actor;
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
  const { page, limit, skip } = getPagination(filters);
  const query = {};

  if (filters.status) {
    query.status = {
      $in: STATUS_FILTERS[filters.status] || [String(filters.status)],
    };
  }
  if (filters.categorySlug) query.categorySlug = filters.categorySlug;
  if (filters.city) query.city = new RegExp(escapeRegex(filters.city), "i");
  if (filters.sourceWebsite) query.sourceWebsite = filters.sourceWebsite;

  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) {
      query.createdAt.$gte = new Date(
        `${filters.startDate}T00:00:00.000+05:30`,
      );
    }
    if (filters.endDate) {
      query.createdAt.$lte = new Date(
        `${filters.endDate}T23:59:59.999+05:30`,
      );
    }
  }

  if (filters.q) {
    const search = new RegExp(escapeRegex(String(filters.q).trim()), "i");
    query.$or = [
      { enquiryId: search },
      { requirementTitle: search },
      { name: search },
      { mobile: search },
      { category: search },
      { categorySlug: search },
      { city: search },
      { externalEnquiryId: search },
    ];
  }

  const [rows, total] = await Promise.all([
    Enquiry.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Enquiry.countDocuments(query),
  ]);

  return pageResult(rows.map(presentEnquiry), total, page, limit);
}

async function get(enquiryId) {
  const enquiry = await Enquiry.findOne(enquiryQuery(enquiryId)).lean();
  if (!enquiry) {
    throw Object.assign(new Error("Lead not found"), { status: 404 });
  }

  const distributions = await LeadDistribution.find({
    enquiryId: enquiry.enquiryId || enquiry.id || enquiryId,
  })
    .sort({ distributedAt: -1 })
    .lean();

  return {
    ...presentEnquiry(enquiry),
    distributions: distributions.map(presentDistribution),
  };
}

async function update(enquiryId, input, actor = "admin") {
  const existing = await Enquiry.findOne(enquiryQuery(enquiryId)).lean();
  if (!existing) {
    throw Object.assign(new Error("Lead not found"), { status: 404 });
  }

  if (
    input.status !== undefined &&
    canonicalLeadStatus(input.status) !== canonicalLeadStatus(existing.status)
  ) {
    throw Object.assign(
      new Error("Use the lead journey controls to change status"),
      { status: 400 },
    );
  }

  const data = normalizeInput(input, existing);
  data.status = existing.status;
  data.statusUpdatedAt = existing.statusUpdatedAt || null;
  data.statusUpdatedBy = existing.statusUpdatedBy || "";

  await Enquiry.updateOne(enquiryQuery(enquiryId), { $set: data });
  const updated = await Enquiry.findOne(enquiryQuery(enquiryId));
  const distributionEnquiryId = existing.enquiryId || existing.id || enquiryId;

  if (["approved", "distributed"].includes(canonicalLeadStatus(updated.status))) {
    await distribute(updated, actor);
  } else {
    await LeadDistribution.updateMany(
      { enquiryId: distributionEnquiryId, contactUnlocked: { $ne: true } },
      { $set: { status: "withdrawn", updatedAt: new Date() } },
    );
  }

  return get(enquiryId);
}

async function updateStatus(enquiryId, input = {}, actor = "admin") {
  const existing = await Enquiry.findOne(enquiryQuery(enquiryId)).lean();
  if (!existing) {
    throw Object.assign(new Error("Lead not found"), { status: 404 });
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
  }

  return get(enquiryId);
}

async function addNote(enquiryId, note, actor = "admin") {
  const message = text(note);
  if (!message) {
    throw Object.assign(new Error("Note is required"), { status: 400 });
  }

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

function distributionData(enquiry, provider) {
  return {
    enquiryId: enquiry.enquiryId || enquiry.id,
    providerId: provider.providerId || provider.id,
    categorySlug: enquiry.categorySlug,
    leadPricePaise: Number(enquiry.leadPricePaise || 0),
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

async function distribute(enquiryDocument, actor = "system") {
  const rawEnquiry = enquiryDocument.toObject
    ? enquiryDocument.toObject()
    : enquiryDocument;
  const enquiry = presentEnquiry(rawEnquiry);
  const providers = await Provider.find({
    status: "active",
    portalAccessEnabled: { $ne: false },
    categorySlugs: enquiry.categorySlug,
  }).lean();

  const providerIds = providers
    .map((provider) => provider.providerId || provider.id)
    .filter(Boolean);

  for (const provider of providers) {
    const data = distributionData(enquiry, provider);
    const existing = await LeadDistribution.findOne({
      enquiryId: enquiry.enquiryId || enquiry.id,
      providerId: provider.providerId || provider.id,
    }).lean();

    if (!existing) {
      await LeadDistribution.create({
        ...data,
        status: "offered",
        contactUnlocked: false,
        distributedBy: actor,
        distributedAt: new Date(),
      });
    } else if (!existing.contactUnlocked) {
      await LeadDistribution.updateOne(
        { leadDistributionId: existing.leadDistributionId },
        { $set: { ...data, status: "offered" } },
      );
    }
  }

  const withdrawQuery = {
    enquiryId: enquiry.enquiryId || enquiry.id,
    contactUnlocked: { $ne: true },
  };
  if (providerIds.length) withdrawQuery.providerId = { $nin: providerIds };

  await LeadDistribution.updateMany(withdrawQuery, {
    $set: { status: "withdrawn", updatedAt: new Date() },
  });

  const [distributionCount, unlockedCount] = await Promise.all([
    LeadDistribution.countDocuments({
      enquiryId: enquiry.enquiryId || enquiry.id,
      status: { $ne: "withdrawn" },
    }),
    LeadDistribution.countDocuments({
      enquiryId: enquiry.enquiryId || enquiry.id,
      contactUnlocked: true,
    }),
  ]);

  await Enquiry.updateOne(enquiryQuery(enquiry.enquiryId), {
    $set: {
      distributionCount,
      unlockedCount,
      distributedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return { distributionCount, unlockedCount };
}

module.exports = {
  create,
  list,
  get,
  update,
  updateStatus,
  addNote,
  distribute,
  presentEnquiry,
  providerJourney,
};
