const crypto = require("crypto");
const Agent = require("../../models/Agent");
const Category = require("../../models/Category");
const Enquiry = require("../../models/Enquiry");
const { validateMobile } = require("../../utils/mobile");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const { applyDateRange, dateSort } = require("../../utils/date-query");
const { textValue, emailValue, enumValue, booleanValue, numberValue, tokenValue, queryTextValue, identifierValue, validationError, pincodeValue } = require("../../utils/validation");
const accountRegistrationService = require("../communication/account-registration-service");

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
  return { ...row, agentId: row.agentId || "", referralId: row.referralId || "", displayName: row.businessName || row.name || "Agent" };
}

async function assignedCategory(input = {}, current = {}) {
  const requested = tokenValue(input.categorySlug ?? current.categorySlug, { label: "Agent category", required: true, maxLength: 80 });
  const category = await Category.findOne({ slug: requested, active: { $ne: false } }).lean();
  if (!category) throw validationError("Select an active CRM category for the agent");
  return { categoryId: category.categoryId || "", categorySlug: category.slug, categoryName: category.name };
}

function actorValue(actor) {
  return actor?.employeeId || actor?.email || actor?.mobile || actor?.name || String(actor || "crm-admin");
}

async function normalizeInput(input = {}, current = {}, actor = "crm-admin") {
  const mobile = validateMobile(input.mobile ?? current.mobile ?? "", { label: "Agent mobile number" });
  if (!/^[6-9]\d{9}$/.test(mobile)) throw validationError("Agent mobile number must be a valid Indian mobile number");
  const category = await assignedCategory(input, current);
  const agentType = enumValue(input.agentType, AGENT_TYPES, { label: "Agent type", fallback: current.agentType || "individual" });
  const businessName = textValue(input.businessName ?? current.businessName, { label: "Business or shop name", maxLength: 160 });
  if (agentType === "shop" && !businessName) throw validationError("Business or shop name is required for shop agents");
  const addressLine = textValue(input.addressLine ?? current.addressLine, { label: "Address", maxLength: 500 });
  const city = textValue(input.city ?? current.city, { label: "City", maxLength: 100 });
  const state = textValue(input.state ?? current.state, { label: "State", maxLength: 100 });
  const pincode = pincodeValue(input.pincode ?? current.pincode, { label: "Pincode", required: false });
  if (pincode && (!city || !state)) throw validationError("City and state are required when an agent pincode is provided");
  return {
    agentType,
    name: textValue(input.name ?? current.name, { label: "Agent name", required: true, maxLength: 120 }),
    businessName,
    mobile,
    normalizedMobile: mobile,
    email: emailValue(input.email ?? current.email, { label: "Agent email", required: false }),
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

function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

async function list(filters = {}) {
  const { limit, cursor } = getPagination(filters);
  const query = {};
  if (filters.status) query.status = enumValue(filters.status, AGENT_STATUSES, { label: "Agent status filter" });
  if (filters.agentType) query.agentType = enumValue(filters.agentType, AGENT_TYPES, { label: "Agent type filter" });
  if (filters.categorySlug) query.categorySlug = tokenValue(filters.categorySlug, { label: "Category filter", maxLength: 80 });
  const q = queryTextValue(filters.q, { label: "Agent search", maxLength: 100 });
  if (q) { const search = new RegExp(escapeRegex(q), "i"); query.$or = [{ agentId: search }, { referralId: search }, { name: search }, { businessName: search }, { mobile: search }, { email: search }, { city: search }]; }
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
    try {
      const row = await Agent.create({ ...data, referralId: generateReferralId(), createdBy: actorValue(actor) });
      const created = await get(row.agentId);
      await accountRegistrationService.dispatch(
        "agent_created",
        { agent: created, registrationDate: created.createdAt, idempotencySuffix: created.createdAt },
        actor,
      );
      return created;
    } catch (error) {
      if (error?.code === 11000 && error?.keyPattern?.referralId) continue;
      if (error?.code === 11000 && (error?.keyPattern?.normalizedMobile || error?.keyPattern?.mobile)) throw Object.assign(new Error("An agent already uses this mobile number"), { status: 409 });
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
  try { await Agent.updateOne({ agentId: existing.agentId }, { $set: data }); }
  catch (error) { if (error?.code === 11000) throw Object.assign(new Error("An agent already uses this mobile number"), { status: 409 }); throw error; }
  return get(existing.agentId);
}

async function requirements(agentId, filters = {}) {
  const agent = await get(agentId);
  const { limit, cursor } = getPagination(filters);
  const query = { agentId: agent.agentId };
  if (filters.status) query.status = textValue(filters.status, { label: "Requirement status filter", maxLength: 40 });
  return cursorPaginate(Enquiry, { query, sort: { createdAt: -1, _id: -1 }, limit, cursor, select: { enquiryId: 1, requirementTitle: 1, name: 1, mobile: 1, city: 1, category: 1, status: 1, customerMobileVerified: 1, agentReferralValidation: 1, agentSaleConversion: 1, partnerEligibilityDate: 1, partnerPayoutStatus: 1, partnerPaidAt: 1, createdAt: 1, updatedAt: 1 } });
}

module.exports = { list, get, create, update, requirements, generateReferralId, normalizeInput, AGENT_TYPES, AGENT_STATUSES };
