const crypto = require("crypto");
const uuid = require("../../utils/uuid");
const Agent = require("../../models/Agent");
const Category = require("../../models/Category");
const Enquiry = require("../../models/Enquiry");
const { validateMobile } = require("../../utils/mobile");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const { applyDateRange, dateSort } = require("../../utils/date-query");
const { textValue, emailValue, enumValue, booleanValue, numberValue, tokenValue, queryTextValue, identifierValue, validationError, pincodeValue } = require("../../utils/validation");
const { categorySnapshots, withCategoryCompatibility } = require("../../utils/agent-categories");
const accountRegistrationService = require("../communication/account-registration-service");
const { buildSearchAlternatives } = require("../../utils/search-query");
const { withTransaction } = require("../../utils/transaction");
const { syncEntityContacts } = require("../contact-identity/contact-identity-service");

const AGENT_TYPES = Object.freeze(["individual", "shop"]);
const AGENT_STATUSES = Object.freeze(["active", "inactive", "pending", "blocked"]);
const REFERRAL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generateReferralId() {
  let output = "";
  for (let index = 0; index < 6; index += 1) output += REFERRAL_ALPHABET[crypto.randomInt(0, REFERRAL_ALPHABET.length)];
  return output;
}

function agentQuery(agentId) {
  const value = identifierValue(agentId, { label: "Agent ID" });
  return { $or: [{ agentId: value }, { referralId: String(value).toUpperCase() }] };
}

function presentAgent(row = {}) {
  const normalized = withCategoryCompatibility(row);
  return { ...normalized, agentId: normalized.agentId || "", referralId: normalized.referralId || "", displayName: normalized.businessName || normalized.name || "Agent" };
}

function requestedCategorySlugs(input = {}, current = {}) {
  const hasPlural = Object.prototype.hasOwnProperty.call(input, "categorySlugs");
  const hasSingle = Object.prototype.hasOwnProperty.call(input, "categorySlug");
  const fallback = categorySnapshots(current).map((category) => category.categorySlug);
  const raw = hasPlural ? input.categorySlugs : hasSingle ? [input.categorySlug] : fallback;
  const values = Array.isArray(raw) ? raw : [raw];
  const slugs = [];
  const seen = new Set();
  values.forEach((value) => {
    const slug = tokenValue(value, { label: "Agent category", required: true, maxLength: 80 });
    if (!seen.has(slug)) {
      seen.add(slug);
      slugs.push(slug);
    }
  });
  if (!slugs.length) throw validationError("Select at least one active CRM category for the agent");
  return slugs;
}

async function assignedCategories(input = {}, current = {}) {
  const requested = requestedCategorySlugs(input, current);
  const rows = await Category.find({ slug: { $in: requested }, active: { $ne: false } })
    .sort({ sourceWebsite: 1, name: 1, _id: 1 })
    .lean();
  const bySlug = new Map();
  rows.forEach((category) => {
    if (!bySlug.has(category.slug)) bySlug.set(category.slug, category);
  });
  const missing = requested.filter((slug) => !bySlug.has(slug));
  if (missing.length) throw validationError(`Select active CRM categories only. Unavailable: ${missing.join(", ")}`);

  const currentPrimary = withCategoryCompatibility(current).categorySlug;
  const primarySlug = currentPrimary && requested.includes(currentPrimary) ? currentPrimary : requested[0];
  const ordered = [primarySlug, ...requested.filter((slug) => slug !== primarySlug)];
  const categories = ordered.map((slug) => {
    const category = bySlug.get(slug);
    return {
      categoryId: category.categoryId || "",
      categorySlug: category.slug,
      categoryName: category.name,
    };
  });
  const primary = categories[0];
  return {
    categoryId: primary.categoryId,
    categorySlug: primary.categorySlug,
    categoryName: primary.categoryName,
    categories,
    categorySlugs: categories.map((category) => category.categorySlug),
  };
}

function actorValue(actor) {
  return actor?.employeeId || actor?.email || actor?.mobile || actor?.name || String(actor || "crm-admin");
}

async function normalizeInput(input = {}, current = {}, actor = "crm-admin") {
  const mobile = validateMobile(input.mobile ?? current.mobile ?? "", { label: "Agent mobile number" });
  if (!/^[6-9]\d{9}$/.test(mobile)) throw validationError("Agent mobile number must be a valid Indian mobile number");
  const category = await assignedCategories(input, current);
  const agentType = enumValue(input.agentType, AGENT_TYPES, { label: "Agent type", fallback: current.agentType || "individual" });
  const businessName = textValue(input.businessName ?? current.businessName, { label: "Business or shop name", maxLength: 160 });
  if (agentType === "shop" && !businessName) throw validationError("Business or shop name is required for shop agents");
  const addressLine = textValue(input.addressLine ?? current.addressLine, { label: "Address", maxLength: 500 });
  const city = textValue(input.city ?? current.city, { label: "City", maxLength: 100 });
  const state = textValue(input.state ?? current.state, { label: "State", maxLength: 100 });
  const pincode = pincodeValue(input.pincode ?? current.pincode, { label: "Pincode", required: false });
  if (pincode && (!city || !state)) throw validationError("City and state are required when an agent pincode is provided");
  const email = emailValue(input.email ?? current.email, { label: "Agent email", required: false });
  return {
    agentType,
    name: textValue(input.name ?? current.name, { label: "Agent name", required: true, maxLength: 120 }),
    businessName,
    mobile,
    normalizedMobile: mobile,
    email,
    normalizedEmail: email,
    addressLine,
    city,
    state,
    pincode,
    ...category,
    status: enumValue(input.status, AGENT_STATUSES, { label: "Agent status", fallback: current.status || "active" }),
    portalAccessEnabled: booleanValue(input.portalAccessEnabled, { label: "Portal access", fallback: current.portalAccessEnabled !== false }),
    notes: textValue(input.notes ?? current.notes, { label: "Agent notes", maxLength: 5000 }),
    payoutPerReferralPaise: numberValue(input.payoutPerReferralPaise, { label: "Payout per referral", fallback: current.payoutPerReferralPaise ?? 5000, min: 5000, max: 20000, integer: true }),
    payoutEnabled: booleanValue(input.payoutEnabled, { label: "Payout enabled", fallback: current.payoutEnabled === true }),
    payoutMode: enumValue(input.payoutMode, ["UPI", "IMPS", "NEFT", "RTGS"], { label: "Payout mode", fallback: current.payoutMode || "IMPS", normalize: false }),
    razorpayContactId: textValue(input.razorpayContactId ?? current.razorpayContactId, { label: "Razorpay contact ID", maxLength: 80 }),
    razorpayFundAccountId: textValue(input.razorpayFundAccountId ?? current.razorpayFundAccountId, { label: "Razorpay fund account ID", maxLength: 80 }),
    payoutAccountLabel: textValue(input.payoutAccountLabel ?? current.payoutAccountLabel, { label: "Payout account label", maxLength: 160 }),
    updatedBy: actorValue(actor),
    updatedAt: new Date(),
  };
}

async function list(filters = {}) {
  const { limit, cursor } = getPagination(filters);
  const query = {};
  if (filters.status) query.status = enumValue(filters.status, AGENT_STATUSES, { label: "Agent status filter" });
  if (filters.agentType) query.agentType = enumValue(filters.agentType, AGENT_TYPES, { label: "Agent type filter" });
  if (filters.categorySlug) {
    const categorySlug = tokenValue(filters.categorySlug, { label: "Category filter", maxLength: 80 });
    query.$and = [...(query.$and || []), { $or: [{ categorySlugs: categorySlug }, { categorySlug }] }];
  }
  const q = queryTextValue(filters.q, { label: "Agent search", maxLength: 100 });
  if (q) {
    query.$or = buildSearchAlternatives(q, {
      identifierFields: ["agentId", "referralId"],
      phoneFields: ["normalizedMobile", "mobile"],
      emailFields: ["email"],
      prefixFields: ["name", "businessName", "city"],
    });
  }
  applyDateRange(query, filters, { fields: { createdAt: "Created date", updatedAt: "Updated date" } });
  const result = await cursorPaginate(Agent, { query, sort: dateSort(filters, { fields: ["createdAt", "updatedAt"] }), limit, cursor });
  return { ...result, data: result.data.map(presentAgent) };
}

async function get(agentId) {
  const row = await Agent.findOne(agentQuery(agentId)).lean();
  if (!row) throw Object.assign(new Error("Agent not found"), { status: 404 });
  return presentAgent(row);
}

async function create(input = {}, actor = "crm-admin") {
  const data = await normalizeInput(input, {}, actor);
  if (data.payoutEnabled && !data.razorpayFundAccountId) throw validationError("Razorpay fund account ID is required when payouts are enabled");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const agentId = uuid();
    const referralId = generateReferralId();
    try {
      await withTransaction(async (session) => {
        await syncEntityContacts({
          entityType: "agent",
          entityId: agentId,
          contacts: { mobile: data.normalizedMobile, email: data.normalizedEmail },
          allowEmployeeRoleOverlap: true,
          session,
        });
        await Agent.create([{ ...data, agentId, referralId, createdBy: actorValue(actor) }], { session });
      }, { operationLabel: "Agent account creation" });
      const created = await get(agentId);
      await accountRegistrationService.dispatch(
        "agent_created",
        { agent: created, registrationDate: created.createdAt, idempotencySuffix: created.createdAt },
        actor,
      );
      return created;
    } catch (error) {
      if (error?.code === 11000 && error?.keyPattern?.referralId) continue;
      if (error?.code === 11000 || error?.code === "CONTACT_ALREADY_EXISTS") {
        throw Object.assign(new Error("An Agent, Provider, Employee, or provider request already uses these contact details"), {
          status: 409,
          code: "CONTACT_ALREADY_EXISTS",
        });
      }
      throw error;
    }
  }
  throw Object.assign(new Error("Unable to generate a unique referral ID"), { status: 503 });
}

async function update(agentId, input = {}, actor = "crm-admin") {
  const existing = await Agent.findOne(agentQuery(agentId)).lean();
  if (!existing) throw Object.assign(new Error("Agent not found"), { status: 404 });
  for (const field of ["agentId", "referralId"]) {
    if (input[field] !== undefined && String(input[field]).toUpperCase() !== String(existing[field]).toUpperCase()) throw validationError(`${field} cannot be changed`);
  }
  const data = await normalizeInput(input, existing, actor);
  if (data.payoutEnabled && !data.razorpayFundAccountId) throw validationError("Razorpay fund account ID is required when payouts are enabled");
  try {
    await withTransaction(async (session) => {
      await syncEntityContacts({
        entityType: "agent",
        entityId: existing.agentId,
        contacts: { mobile: data.normalizedMobile, email: data.normalizedEmail },
        allowEmployeeRoleOverlap: true,
        session,
      });
      const result = await Agent.updateOne({ agentId: existing.agentId }, { $set: data }, { session });
      if (result.matchedCount !== 1) throw Object.assign(new Error("Agent changed while it was being updated"), { status: 409 });
    }, { operationLabel: "Agent account update" });
  } catch (error) {
    if (error?.code === 11000 || error?.code === "CONTACT_ALREADY_EXISTS") {
      throw Object.assign(new Error("An Agent, Provider, Employee, or provider request already uses these contact details"), {
        status: 409,
        code: "CONTACT_ALREADY_EXISTS",
      });
    }
    throw error;
  }
  return get(existing.agentId);
}

async function requirements(agentId, filters = {}) {
  const agent = await get(agentId);
  const { limit, cursor } = getPagination(filters);
  const query = { agentId: agent.agentId };
  if (filters.status) query.status = textValue(filters.status, { label: "Requirement status filter", maxLength: 40 });
  return cursorPaginate(Enquiry, { query, sort: { createdAt: -1, _id: -1 }, limit, cursor, select: { enquiryId: 1, requirementTitle: 1, name: 1, mobile: 1, city: 1, category: 1, status: 1, customerMobileVerified: 1, agentReferralValidation: 1, agentSaleConversion: 1, partnerEligibilityDate: 1, partnerPayoutStatus: 1, partnerPaidAt: 1, createdAt: 1, updatedAt: 1 } });
}

module.exports = { list, get, create, update, requirements, generateReferralId, normalizeInput, assignedCategories, requestedCategorySlugs, AGENT_TYPES, AGENT_STATUSES };
