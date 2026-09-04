"use strict";

const crypto = require("node:crypto");
const Enquiry = require("../../models/Enquiry");
const Provider = require("../../models/Provider");
const { identifierValue } = require("../../utils/validation");

const TOKEN_PREFIX = "findoly_direct_lead_v1";

function configurationError() {
  return Object.assign(new Error("Employee direct lead links are not configured"), {
    status: 503,
    code: "DIRECT_LEAD_LINK_NOT_CONFIGURED",
  });
}

function signingKey(env = process.env) {
  const secret = String(
    env.PROVIDER_DIRECT_LEAD_LINK_SECRET
      || env.COMMUNICATION_EVENT_API_TOKEN
      || "",
  ).trim();
  if (secret.length < 32) throw configurationError();
  return crypto
    .createHash("sha256")
    .update(`findoly-provider-direct-lead-v1\0${secret}`, "utf8")
    .digest();
}

function signatureFor(payloadPart, env = process.env) {
  return crypto
    .createHmac("sha256", signingKey(env))
    .update(`${TOKEN_PREFIX}.${payloadPart}`, "utf8")
    .digest("base64url");
}

function expiryHours(env = process.env) {
  const value = Number(env.PROVIDER_DIRECT_LEAD_LINK_EXPIRY_HOURS || 168);
  if (!Number.isFinite(value)) return 168;
  return Math.min(720, Math.max(1, Math.trunc(value)));
}

function createToken({ providerId, enquiryId, now = new Date(), env = process.env } = {}) {
  const provider = identifierValue(providerId, { label: "Provider ID" });
  const enquiry = identifierValue(enquiryId, { label: "Lead Reference ID" });
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = {
    p: provider,
    e: enquiry,
    i: issuedAt,
    x: issuedAt + expiryHours(env) * 60 * 60,
  };
  const payloadPart = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${TOKEN_PREFIX}.${payloadPart}.${signatureFor(payloadPart, env)}`;
}

function providerPortalUrl(enquiryId, token) {
  const rawBase = process.env.PROVIDER_PORTAL_BASE_URL
    || process.env.PROVIDER_PORTAL_MARKETPLACE_URL
    || process.env.PROVIDER_PORTAL_LOGIN_URL
    || "https://provider.findoly.com";
  try {
    const url = new URL(rawBase);
    url.pathname = `/leads/${encodeURIComponent(String(enquiryId || ""))}`;
    url.search = "";
    url.searchParams.set("access", token);
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return `https://provider.findoly.com/leads/${encodeURIComponent(String(enquiryId || ""))}?access=${encodeURIComponent(token)}`;
  }
}

function leadAllowsDirectLink(lead, now = new Date()) {
  if (!lead || lead.status !== "approved" || lead.isActive === false) return false;
  if (!lead.marketplacePublishedAt || new Date(lead.marketplacePublishedAt) > now) return false;
  if (!lead.marketplaceExpiresAt || new Date(lead.marketplaceExpiresAt) <= now) return false;
  if (lead.marketplaceAvailable === true && lead.marketplaceStatus === "published") return true;
  return Number(lead.remainingUnlocks || 0) <= 0
    && lead.marketplaceStatus === "closed"
    && lead.marketplaceClosureReason === "unlock_limit";
}

async function createProviderDirectLink(enquiryIdInput, providerIdInput) {
  const enquiryId = identifierValue(enquiryIdInput, { label: "Lead Reference ID" });
  const providerId = identifierValue(providerIdInput, { label: "Provider ID" });
  const [lead, provider] = await Promise.all([
    Enquiry.findOne({ $or: [{ enquiryId }, { id: enquiryId }] })
      .select({
        enquiryId: 1,
        status: 1,
        isActive: 1,
        categorySlug: 1,
        marketplaceStatus: 1,
        marketplaceAvailable: 1,
        marketplaceClosureReason: 1,
        marketplacePublishedAt: 1,
        marketplaceExpiresAt: 1,
        remainingUnlocks: 1,
      })
      .lean(),
    Provider.findOne({ $or: [{ providerId }, { id: providerId }] })
      .select({ providerId: 1, status: 1, portalAccessEnabled: 1, categorySlugs: 1 })
      .lean(),
  ]);

  if (!lead) throw Object.assign(new Error("Lead not found"), { status: 404 });
  if (!provider || provider.status !== "active" || provider.portalAccessEnabled === false) {
    throw Object.assign(new Error("Provider account is not eligible for a direct lead link"), { status: 409 });
  }
  if (!(Array.isArray(provider.categorySlugs) && provider.categorySlugs.includes(lead.categorySlug))) {
    throw Object.assign(new Error("Provider does not match this lead category"), { status: 409 });
  }
  if (!leadAllowsDirectLink(lead)) {
    throw Object.assign(new Error("This requirement is not eligible for a direct provider link"), { status: 409 });
  }

  const token = createToken({ providerId, enquiryId: lead.enquiryId });
  return {
    providerId,
    enquiryId: lead.enquiryId,
    url: providerPortalUrl(lead.enquiryId, token),
    expiresInHours: expiryHours(),
  };
}

module.exports = {
  TOKEN_PREFIX,
  signingKey,
  signatureFor,
  expiryHours,
  createToken,
  providerPortalUrl,
  leadAllowsDirectLink,
  createProviderDirectLink,
};
