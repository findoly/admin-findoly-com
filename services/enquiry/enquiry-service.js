const Enquiry = require("../../models/Enquiry");
const Provider = require("../../models/Provider");
const LeadDistribution = require("../../models/LeadDistribution");
const uuid = require("../../utils/uuid");
const { getPagination, pageResult } = require("../../utils/pagination");

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizeInput(input = {}, current = {}) {
  const categorySlug = text(input.categorySlug, current.categorySlug);

  return {
    name: text(input.name, current.name),
    mobile: text(input.mobile, current.mobile),
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
    status: text(input.status, current.status || "new"),
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
  const categoryObject = row.category && typeof row.category === "object" ? row.category : {};
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
    category: typeof row.category === "string" ? row.category : (categoryObject.name || ""),
    categorySlug: row.categorySlug || categoryObject.slug || "",
    sourceWebsite: row.sourceWebsite || source.website || "",
    sourceChannel: row.sourceChannel || source.channel || "",
    sourceName: row.sourceName || source.sourceName || "",
    externalEnquiryId: row.externalEnquiryId || source.externalEnquiryId || "",
  };
}

function enquiryQuery(enquiryId) {
  return { $or: [{ enquiryId }, { id: enquiryId }] };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function create(input, actor = "admin") {
  const data = normalizeInput(input);
  if (!data.categorySlug) {
    throw Object.assign(new Error("Category is required"), { status: 400 });
  }

  data.timeline = [
    {
      timelineId: uuid(),
      type: "created",
      message: "Lead created",
      actor,
      createdAt: new Date(),
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

  if (filters.status) query.status = filters.status;
  if (filters.categorySlug) query.categorySlug = filters.categorySlug;
  if (filters.city) query.city = new RegExp(escapeRegex(filters.city), "i");
  if (filters.sourceWebsite) query.sourceWebsite = filters.sourceWebsite;

  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate)
      query.createdAt.$gte = new Date(
        `${filters.startDate}T00:00:00.000+05:30`,
      );
    if (filters.endDate)
      query.createdAt.$lte = new Date(`${filters.endDate}T23:59:59.999+05:30`);
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

  const distributions = await LeadDistribution.find({ enquiryId })
    .sort({ distributedAt: -1 })
    .lean();

  return { ...presentEnquiry(enquiry), distributions };
}

async function update(enquiryId, input, actor = "admin") {
  const existing = await Enquiry.findOne(enquiryQuery(enquiryId)).lean();
  if (!existing) {
    throw Object.assign(new Error("Lead not found"), { status: 404 });
  }

  const data = normalizeInput(input, existing);
  const timeline = Array.isArray(existing.timeline)
    ? [...existing.timeline]
    : [];

  if (data.status !== existing.status) {
    timeline.push({
      timelineId: uuid(),
      type: "status_changed",
      message: `Status changed from ${existing.status} to ${data.status}`,
      actor,
      createdAt: new Date(),
    });
  }

  await Enquiry.updateOne(enquiryQuery(enquiryId), { $set: { ...data, timeline } });
  const updated = await Enquiry.findOne(enquiryQuery(enquiryId));

  if (["approved", "distributed"].includes(updated.status)) {
    await distribute(updated, actor);
  } else {
    await LeadDistribution.updateMany(
      { enquiryId, contactUnlocked: { $ne: true } },
      { $set: { status: "withdrawn", updatedAt: new Date() } },
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

  const providerIds = providers.map((provider) => provider.providerId || provider.id).filter(Boolean);

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

  await Enquiry.updateOne(
    enquiryQuery(enquiry.enquiryId),
    {
      $set: {
        distributionCount,
        unlockedCount,
        distributedAt: new Date(),
        updatedAt: new Date(),
      },
    },
  );

  return { distributionCount, unlockedCount };
}

module.exports = { create, list, get, update, addNote, distribute, presentEnquiry };
