"use strict";

const Enquiry = require("../../models/Enquiry");
const Provider = require("../../models/Provider");
const Communication = require("../../models/Communication");
const providerAlertStateService = require("./provider-alert-state-service");
const { identifierValue } = require("../../utils/validation");

const MAX_RECENT_COMMUNICATIONS = 500;

function communicationStatusAt(row = {}) {
  return row.readAt
    || row.deliveredAt
    || row.failedAt
    || row.sentAt
    || row.updatedAt
    || row.createdAt
    || null;
}

function latestByProvider(rows = []) {
  const output = new Map();
  for (const row of rows) {
    const providerId = String(row?.providerId || "").trim();
    if (!providerId) continue;
    const current = output.get(providerId) || { latest: null, count: 0 };
    current.count += 1;
    if (!current.latest) current.latest = row;
    output.set(providerId, current);
  }
  return output;
}

async function getProviderAlertAudit(enquiryId) {
  const value = identifierValue(enquiryId, { label: "Lead Reference ID" });
  const lead = await Enquiry.findOne({ $or: [{ enquiryId: value }, { id: value }] })
    .select({ enquiryId: 1, id: 1, providerWhatsappAlerts: 1 })
    .lean();
  if (!lead) {
    throw Object.assign(new Error("Lead not found"), { status: 404 });
  }

  const resolvedEnquiryId = String(lead.enquiryId || lead.id || value);
  const communications = await Communication.find({
    enquiryId: resolvedEnquiryId,
    channel: "whatsapp",
    purpose: "nearby_lead_available",
  })
    .select({
      communicationId: 1,
      providerId: 1,
      status: 1,
      actor: 1,
      failureReason: 1,
      createdAt: 1,
      updatedAt: 1,
      sentAt: 1,
      deliveredAt: 1,
      readAt: 1,
      failedAt: 1,
    })
    .sort({ createdAt: -1, _id: -1 })
    .limit(MAX_RECENT_COMMUNICATIONS)
    .lean();

  const durableAlerts = providerAlertStateService.normalizedProviderAlerts(lead);
  const durableByProvider = new Map(durableAlerts.map((entry) => [entry.providerId, entry]));
  const recentByProvider = latestByProvider(communications);
  const providerIds = [...new Set([
    ...durableByProvider.keys(),
    ...recentByProvider.keys(),
  ])];

  const providers = providerIds.length
    ? await Provider.find({ providerId: { $in: providerIds } })
      .select({ providerId: 1, name: 1, businessName: 1 })
      .lean()
    : [];
  const providerById = new Map(
    providers.map((provider) => [String(provider.providerId || ""), provider]),
  );

  const rows = providerIds.map((providerId) => {
    const durable = durableByProvider.get(providerId) || null;
    const recent = recentByProvider.get(providerId) || null;
    const latest = recent?.latest || null;
    const provider = providerById.get(providerId) || {};
    const deliveryDetailAvailable = Boolean(latest);
    return {
      providerId,
      providerName: provider.name || provider.businessName || "Provider",
      mode: durable?.mode || "unknown",
      actor: latest?.actor || durable?.actor || "",
      alertedAt: durable?.alertedAt || latest?.createdAt || null,
      latestStatus: latest?.status || (durable ? "sent" : "unknown"),
      latestStatusAt: communicationStatusAt(latest),
      failureReason: latest?.failureReason || "",
      deliveryDetailAvailable,
      deliveryDetailExpired: Boolean(durable && !latest),
      recentAttemptCount: Number(recent?.count || 0),
      communicationId: latest?.communicationId || "",
    };
  }).sort((left, right) => {
    const leftTime = new Date(left.latestStatusAt || left.alertedAt || 0).getTime();
    const rightTime = new Date(right.latestStatusAt || right.alertedAt || 0).getTime();
    return rightTime - leftTime;
  });

  return {
    enquiryId: resolvedEnquiryId,
    rows,
    communicationRetentionDays: Math.max(
      1,
      Number(process.env.COMMUNICATION_LOG_RETENTION_DAYS || 7) || 7,
    ),
  };
}

module.exports = {
  MAX_RECENT_COMMUNICATIONS,
  communicationStatusAt,
  latestByProvider,
  getProviderAlertAudit,
};
