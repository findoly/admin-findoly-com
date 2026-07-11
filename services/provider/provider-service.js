const Provider = require("../../models/Provider");
const Enquiry = require("../../models/Enquiry");
const LeadDistribution = require("../../models/LeadDistribution");
const WalletTransaction = require("../../models/WalletTransaction");
const { normalizeMobile } = require("../../utils/mobile");
const { getPagination, pageResult } = require("../../utils/pagination");
const enquiryService = require("../enquiry/enquiry-service");

function toArray(value) {
  if (Array.isArray(value)) return value;
  return String(value || "").split(",");
}

function normalize(input = {}, current = {}) {
  const mobile = String(input.mobile ?? current.mobile ?? "").trim();
  return {
    name: String(input.name ?? current.name ?? "").trim(),
    businessName: String(
      input.businessName ?? current.businessName ?? "",
    ).trim(),
    mobile,
    normalizedMobile: normalizeMobile(input.normalizedMobile || mobile),
    email: String(input.email ?? current.email ?? "")
      .trim()
      .toLowerCase(),
    status: String(input.status ?? current.status ?? "active"),
    onboardingStage: String(
      input.onboardingStage ?? current.onboardingStage ?? "new",
    ),
    categorySlugs: toArray(input.categorySlugs ?? current.categorySlugs)
      .map((value) => String(value).trim())
      .filter(Boolean),
    skills: toArray(input.skills ?? current.skills)
      .map((value) => String(value).trim())
      .filter(Boolean),
    city: String(input.city ?? current.city ?? "").trim(),
    state: String(input.state ?? current.state ?? "").trim(),
    serviceAreas: toArray(input.serviceAreas ?? current.serviceAreas)
      .map((value) => String(value).trim())
      .filter(Boolean),
    availability: String(
      input.availability ?? current.availability ?? "available_today",
    ),
    rating: Number(input.rating ?? current.rating ?? 0),
    notes: String(input.notes ?? current.notes ?? ""),
    documentsVerified:
      input.documentsVerified !== undefined
        ? Boolean(input.documentsVerified)
        : Boolean(current.documentsVerified),
    portalAccessEnabled:
      input.portalAccessEnabled !== undefined
        ? Boolean(input.portalAccessEnabled)
        : current.portalAccessEnabled !== false,
    updatedAt: new Date(),
  };
}


function presentProvider(row = {}) {
  return {
    ...row,
    providerId: row.providerId || row.id || "",
  };
}

function providerQuery(providerId) {
  return { $or: [{ providerId }, { id: providerId }] };
}

async function list(filters = {}) {
  const { page, limit, skip } = getPagination(filters);
  const query = {};

  if (filters.status) query.status = filters.status;
  if (filters.categorySlug) query.categorySlugs = filters.categorySlug;
  if (filters.city) query.city = new RegExp(String(filters.city), "i");
  if (filters.q) {
    const search = new RegExp(String(filters.q), "i");
    query.$or = [
      { providerId: search },
      { name: search },
      { businessName: search },
      { mobile: search },
      { email: search },
      { city: search },
    ];
  }

  const [rows, total] = await Promise.all([
    Provider.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Provider.countDocuments(query),
  ]);

  return pageResult(rows.map(presentProvider), total, page, limit);
}

async function get(providerId) {
  const provider = await Provider.findOne(providerQuery(providerId)).lean();
  if (!provider)
    throw Object.assign(new Error("Provider not found"), { status: 404 });

  const [distributions, transactions] = await Promise.all([
    LeadDistribution.find({ providerId })
      .sort({ distributedAt: -1 })
      .limit(50)
      .lean(),
    WalletTransaction.find({ providerId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
  ]);

  return { ...presentProvider(provider), distributions, transactions };
}

async function create(input) {
  const data = normalize(input);
  if (!data.name)
    throw Object.assign(new Error("Provider name is required"), {
      status: 400,
    });
  const provider = await Provider.create(data);
  await syncApprovedLeads(provider);
  return get(provider.providerId);
}

async function update(providerId, input) {
  const current = await Provider.findOne(providerQuery(providerId)).lean();
  if (!current)
    throw Object.assign(new Error("Provider not found"), { status: 404 });

  await Provider.updateOne(providerQuery(providerId), { $set: normalize(input, current) });
  const provider = await Provider.findOne(providerQuery(providerId));
  await syncApprovedLeads(provider);
  return get(providerId);
}

async function syncApprovedLeads(providerDocument) {
  const rawProvider = providerDocument.toObject
    ? providerDocument.toObject()
    : providerDocument;
  const provider = presentProvider(rawProvider);
  const eligible =
    provider.status === "active" && provider.portalAccessEnabled !== false;

  if (!eligible) {
    await LeadDistribution.updateMany(
      { providerId: provider.providerId, contactUnlocked: { $ne: true } },
      { $set: { status: "withdrawn", updatedAt: new Date() } },
    );
    return;
  }

  const enquiries = await Enquiry.find({
    status: { $in: ["approved", "distributed"] },
    categorySlug: { $in: provider.categorySlugs || [] },
  });

  for (const enquiry of enquiries) {
    await enquiryService.distribute(enquiry, "provider-sync");
  }

  await LeadDistribution.updateMany(
    {
      providerId: provider.providerId,
      categorySlug: { $nin: provider.categorySlugs || [] },
      contactUnlocked: { $ne: true },
    },
    { $set: { status: "withdrawn", updatedAt: new Date() } },
  );
}

module.exports = { list, get, create, update, syncApprovedLeads, presentProvider };
