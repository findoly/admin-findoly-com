"use strict";

const Communication = require("../../models/Communication");
const Enquiry = require("../../models/Enquiry");
const communicationService = require("./communication-service");
const providerActionService = require("../integration/provider-action-service");
const {
  isUnlockActionToken,
  verifyUnlockAction,
  tokenHash,
} = require("./whatsapp-action-token");
const { normalizeMobile } = require("../../utils/mobile");
const { boundedJsonValue } = require("../../utils/bounded-json");
const { QUESTIONS } = require("../../utils/lead-qualification");

const ACTION_HISTORY_LIMIT = 200;
const PROVIDER_QUALIFICATION_FIELDS = Object.freeze([
  Object.freeze({ id: "readiness", label: "Readiness" }),
  Object.freeze({ id: "timeline", label: "Service timeline" }),
  Object.freeze({ id: "clarity", label: "Requirement clarity" }),
  Object.freeze({ id: "responsiveness", label: "Responsiveness" }),
  Object.freeze({ id: "requirement_size", label: "Requirement size" }),
]);

function actionHistoryPush(entry) {
  return { $each: [entry], $slice: -ACTION_HISTORY_LIMIT };
}

function textFrom(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  return "";
}

function humanize(value) {
  const text = textFrom(value).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function quickReplyDetails(event = {}) {
  const envelope = event.payload || {};
  const content = envelope.payload || {};
  const nested = content.payload || {};
  const envelopeType = String(envelope.type || "").trim().toLowerCase();
  const contentType = String(content.type || "").trim().toLowerCase();
  const nestedType = String(nested.type || "").trim().toLowerCase();
  const postbackText = textFrom(
    content.postbackText
      || nested.postbackText
      || content.postback_text
      || nested.postback_text,
  );
  const visibleText = textFrom(
    content.text?.body
      || content.text
      || content.title
      || nested.title
      || nested.text?.body
      || nested.text
      || content.body,
  );
  const source = textFrom(envelope.source || envelope.sender?.phone || content.source);
  const inboundMessageId = textFrom(envelope.id || envelope.gsId || content.id);
  const contextMessageIds = [
    envelope.context?.gsId,
    envelope.context?.id,
    content.context?.gsId,
    content.context?.id,
    nested.context?.gsId,
    nested.context?.id,
  ].map(textFrom).filter(Boolean).filter((value, index, values) => values.indexOf(value) === index);
  const contextMessageId = contextMessageIds[0] || "";
  const appName = textFrom(event.app || envelope.app || envelope.appName || event.appName);
  const senderName = textFrom(envelope.sender?.name || content.sender?.name);
  const replyTypes = new Set([envelopeType, contentType, nestedType]);
  const isQuickReply = Boolean(postbackText)
    || replyTypes.has("quick_reply")
    || replyTypes.has("button_reply")
    || replyTypes.has("button");
  return {
    isQuickReply,
    postbackText,
    visibleText,
    source,
    inboundMessageId,
    contextMessageId,
    contextMessageIds,
    appName,
    senderName,
  };
}

function redactedEvent(event, postbackText = "") {
  const cloned = boundedJsonValue(event || {});
  const secret = String(postbackText || "");
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    Object.entries(value).forEach(([key, entry]) => {
      const normalizedKey = key.replace(/_/g, "").toLowerCase();
      if (normalizedKey === "postbacktext" || (secret && entry === secret)) {
        value[key] = "[REDACTED]";
        return;
      }
      visit(entry);
    });
  };
  visit(cloned);
  return cloned;
}

function joinLocation(lead = {}) {
  const address = textFrom(lead.customerAddress || lead.addressLine);
  const parts = address ? [address] : [];
  const normalizedAddress = address.toLowerCase();
  [lead.city, lead.state, lead.pincode]
    .map(textFrom)
    .filter(Boolean)
    .forEach((part) => {
      if (!normalizedAddress.includes(part.toLowerCase())) parts.push(part);
    });
  return parts.join(", ");
}

function coordinateValue(value, min, max) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= min && numeric <= max ? numeric : null;
}

function providerLocation(lead = {}, context = {}) {
  const latitude = coordinateValue(context.locationLatitude ?? lead.locationLatitude, -90, 90);
  const longitude = coordinateValue(context.locationLongitude ?? lead.locationLongitude, -180, 180);
  const address = textFrom(context.fullAddress) || joinLocation(lead);
  const mapQuery = latitude !== null && longitude !== null
    ? `${latitude},${longitude}`
    : address;
  return {
    address,
    latitude,
    longitude,
    mapUrl: mapQuery
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`
      : "",
  };
}

function qualificationAnswerLabel(snapshot = {}, questionId) {
  const saved = (Array.isArray(snapshot.answers) ? snapshot.answers : [])
    .find((item) => String(item?.questionId || "") === questionId);
  if (textFrom(saved?.answer)) return textFrom(saved.answer);
  const question = QUESTIONS.find((item) => item.id === questionId);
  const option = question?.options?.find((item) => item.id === saved?.answerId);
  return textFrom(option?.label);
}

function messageContextFromLead(lead = {}) {
  const qualification = lead.leadQualification && typeof lead.leadQualification === "object"
    ? lead.leadQualification
    : {};
  const completed = qualification.completed === true;
  const providerQualification = completed
    ? PROVIDER_QUALIFICATION_FIELDS
      .map((field) => ({ ...field, value: qualificationAnswerLabel(qualification, field.id) }))
      .filter((field) => field.value)
    : [];
  const final = completed && qualification.final && typeof qualification.final === "object"
    ? qualification.final
    : {};
  return {
    qualification: providerQualification,
    leadIntent: textFrom(final.leadIntent || (completed ? lead.leadIntent : "")),
    priority: textFrom(final.priority || (completed ? lead.priority : "")),
    marketplaceClosureReason: textFrom(lead.marketplaceClosureReason),
    marketplaceStatus: textFrom(lead.marketplaceStatus),
    marketplaceExpiresAt: lead.marketplaceExpiresAt || null,
    remainingUnlocks: Number(lead.remainingUnlocks || 0),
    providerConfirmedCount: Number(lead.providerConfirmedCount || 0),
    providerSaleConversionStatus: textFrom(lead.providerSaleConversionStatus),
    providerRequirementTitle: textFrom(lead.providerRequirementTitle || lead.requirementTitle),
    providerRequirementDetails: textFrom(lead.providerRequirementDetails),
    unlockedCount: Math.max(0, Number(lead.unlockedCount || 0)),
    fullAddress: joinLocation({
      customerAddress: lead.addressLine || lead.customerAddress,
      city: lead.city,
      state: lead.state,
      pincode: lead.pincode,
    }),
    locationLatitude: coordinateValue(lead.locationLatitude, -90, 90),
    locationLongitude: coordinateValue(lead.locationLongitude, -180, 180),
  };
}

async function enrichResultForMessage(original = {}, result = {}) {
  const status = String(result?.status || "");
  if (!["unlocked", "already_unlocked", "lead_unavailable"].includes(status)) return result;
  const enquiryId = textFrom(result?.lead?.enquiryId || original.enquiryId);
  if (!enquiryId || typeof Enquiry.findOne !== "function") return result;
  try {
    const query = Enquiry.findOne({ enquiryId });
    const selected = typeof query?.select === "function"
      ? query.select({
        leadQualification: 1,
        leadIntent: 1,
        priority: 1,
        marketplaceClosureReason: 1,
        marketplaceStatus: 1,
        marketplaceExpiresAt: 1,
        remainingUnlocks: 1,
        providerConfirmedCount: 1,
        providerSaleConversionStatus: 1,
        providerRequirementTitle: 1,
        providerRequirementDetails: 1,
        requirementTitle: 1,
        unlockedCount: 1,
        addressLine: 1,
        city: 1,
        state: 1,
        pincode: 1,
        locationLatitude: 1,
        locationLongitude: 1,
      })
      : query;
    const lead = typeof selected?.lean === "function" ? await selected.lean() : await selected;
    return lead ? { ...result, messageContext: messageContextFromLead(lead) } : result;
  } catch (_error) {
    return result;
  }
}

function successMessage(result = {}) {
  const lead = result.lead || {};
  const provider = result.provider || {};
  const context = result.messageContext || {};
  const lines = [
    result.status === "already_unlocked"
      ? "This enquiry is already available in your account."
      : "The enquiry details are now available.",
    "",
    `Service: ${lead.serviceType || lead.category || "Service"}`,
  ];

  const title = textFrom(
    context.providerRequirementTitle
      || lead.providerRequirementTitle
      || lead.requirementTitle,
  );
  if (title) lines.push(`Title: ${title}`);

  const description = textFrom(context.providerRequirementDetails || lead.providerRequirementDetails);
  if (description) lines.push(`Description: ${description}`);

  const intent = humanize(context.leadIntent || lead.leadIntent);
  if (intent) lines.push(`Intent: ${intent}`);

  const priority = humanize(context.priority || lead.priority);
  if (priority) lines.push(`Priority: ${priority}`);

  const unlockedCountValue = context.unlockedCount ?? lead.unlockedCount;
  if (unlockedCountValue !== undefined && unlockedCountValue !== null && String(unlockedCountValue).trim() !== "") {
    const unlockedCount = Number(unlockedCountValue);
    if (Number.isFinite(unlockedCount) && unlockedCount >= 0) {
      lines.push(`Providers unlocked: ${Math.trunc(unlockedCount)}`);
    }
  }

  const qualification = Array.isArray(context.qualification) ? context.qualification : [];
  qualification.forEach((field) => {
    const label = textFrom(field?.label);
    const value = textFrom(field?.value);
    if (label && value) lines.push(`${label}: ${value}`);
  });

  lines.push("");
  lines.push(`Customer: ${lead.customerName || "Not provided"}`);
  lines.push(`Mobile: ${lead.customerMobile || "Not provided"}`);
  if (lead.customerEmail) lines.push(`Email: ${lead.customerEmail}`);

  const location = providerLocation(lead, context);
  if (location.address) lines.push(`Address: ${location.address}`);
  if (location.mapUrl) {
    lines.push("Location:");
    lines.push("📍 Open in Google Maps");
    lines.push(location.mapUrl);
  }

  lines.push("");
  lines.push(`Credits used: ${Number(lead.chargedCredits || 0)}`);
  lines.push(`Balance: ${Number(provider.availableCredits ?? provider.walletCredits ?? 0)} credits`);
  lines.push("");
  lines.push("Contact the customer promptly.");
  return lines.join("\n");
}
function failureMessage(result = {}) {
  const status = String(result.status || "failed");
  if (status === "insufficient_credits") {
    return [
      "Your wallet does not have enough credits to view this enquiry.",
      "",
      `Required: ${Number(result.requiredCredits || 0)} credits`,
      `Available: ${Number(result.availableCredits || 0)} credits`,
      "",
      `Add credits in your Provider Portal: ${process.env.PROVIDER_PORTAL_WALLET_URL || "https://provider.findoly.com/wallet"}`,
    ].join("\n");
  }
  if (status === "direct_payment_pending") {
    return "A direct-payment checkout is already reserving this enquiry. Complete or cancel that checkout in the Provider Portal first.";
  }
  if (status === "provider_ineligible") {
    return "Your provider account is not currently eligible to view this enquiry. Please contact Findoly support.";
  }
  if (status === "lead_unavailable") {
    const context = result.messageContext || {};
    if (context.providerSaleConversionStatus === "converted" || Number(context.providerConfirmedCount || 0) > 0) {
      return "This enquiry has already been confirmed with a provider and is no longer available.";
    }
    const closureReason = textFrom(context.marketplaceClosureReason);
    const expiredAt = context.marketplaceExpiresAt ? new Date(context.marketplaceExpiresAt) : null;
    if (closureReason === "expired"
      || context.marketplaceStatus === "expired"
      || (expiredAt && !Number.isNaN(expiredAt.getTime()) && expiredAt <= new Date())) {
      return "This enquiry is no longer active. Please check the latest available enquiries.";
    }
    if (closureReason === "unlock_limit" || (!closureReason && Number(context.remainingUnlocks) === 0)) {
      return [
        "This enquiry has received enough provider interest and is now closed.",
        "To maintain lead quality and customer experience, we limit how many providers can access each enquiry. It may already be progressing with one of the connected providers.",
      ].join("\n");
    }
    return "This enquiry is no longer available. Please check the latest available enquiries.";
  }
  return "We could not open this enquiry from WhatsApp. Please try again in the Provider Portal or contact Findoly support.";
}

function responseMessage(result) {
  return ["unlocked", "already_unlocked"].includes(String(result?.status || ""))
    ? successMessage(result)
    : failureMessage(result);
}

async function saveActionResult(communicationId, result, status, error = "") {
  const fields = {
    "metadata.whatsappUnlock.processing": false,
    "metadata.whatsappUnlock.status": status,
    "metadata.whatsappUnlock.completedAt": new Date(),
    "metadata.whatsappUnlock.result": boundedJsonValue(result || {}),
    "metadata.whatsappUnlock.error": String(error || "").slice(0, 2000),
    updatedAt: new Date(),
  };
  await Communication.updateOne(
    { communicationId },
    {
      $set: fields,
      $push: {
        statusHistory: actionHistoryPush({
          status: `whatsapp_unlock_${String(status || "completed")}`,
          at: new Date(),
          source: "gupshup_quick_reply",
          reason: String(error || "").slice(0, 2000),
          details: boundedJsonValue(result || {}),
        }),
      },
    },
  );
}

async function findRelatedOutbound(details) {
  const messageIds = details.contextMessageIds || [];
  if (!messageIds.length || typeof Communication.findOne !== "function") return null;
  const record = await Communication.findOne({
    direction: "outbound",
    channel: "whatsapp",
    $or: [
      { providerMessageId: { $in: messageIds } },
      { "metadata.whatsappMessageIds": { $in: messageIds } },
      { "metadata.gupshupMessageId": { $in: messageIds } },
      { "metadata.metaMessageId": { $in: messageIds } },
    ],
  }).lean();
  if (!record) return null;
  return normalizeMobile(details.source) === normalizeMobile(record.recipientContact) ? record : null;
}

async function findOriginalForAction(details, action, expectedHash) {
  if (!action?.opaque) {
    return Communication.findOne({ communicationId: action.communicationId }).lean();
  }

  const related = await findRelatedOutbound(details);
  if (related?.metadata?.whatsappUnlock?.tokenHash === expectedHash) return related;
  if (typeof Communication.findOne !== "function") return null;
  return Communication.findOne({
    direction: "outbound",
    channel: "whatsapp",
    purpose: "nearby_lead_available",
    "metadata.whatsappUnlock.tokenHash": expectedHash,
  }).lean();
}

async function createRejectedInbound(details, event, reason, metadata = {}) {
  const related = await findRelatedOutbound(details);
  const inbound = await communicationService.createInbound({
    enquiryId: related?.enquiryId || "",
    providerId: related?.providerId || "",
    recipientName: related?.recipientName || details.senderName || "",
    recipientContact: details.source,
    providerMessageId: details.inboundMessageId,
    message: details.visibleText || "[Quick reply]",
    purpose: "whatsapp_button_reply",
    trigger: "gupshup_quick_reply",
    externalResponse: redactedEvent(event, details.postbackText),
    metadata: {
      actionStatus: "rejected",
      actionReason: reason,
      contextMessageIds: details.contextMessageIds || [],
      originalCommunicationId: related?.communicationId || "",
      accountType: related?.providerId ? "provider" : "manual",
      accountId: related?.providerId || "",
      ...metadata,
    },
  });
  if (related?.communicationId && typeof Communication.updateOne === "function") {
    await Communication.updateOne(
      { communicationId: related.communicationId },
      {
        $set: { updatedAt: new Date() },
        $push: {
          statusHistory: actionHistoryPush({
            status: "whatsapp_button_reply_received",
            at: new Date(),
            source: "gupshup_quick_reply",
            reason,
            details: {
              inboundCommunicationId: inbound?.communicationId || "",
              inboundMessageId: details.inboundMessageId,
              visibleText: details.visibleText || "",
              actionAuthorized: false,
            },
          }),
        },
      },
    );
  }
}

async function sendResultMessage({ original, details, result, idempotencyReference }) {
  return communicationService.sendWhatsappSession({
    enquiryId: original.enquiryId,
    providerId: original.providerId,
    recipientName: original.recipientName,
    recipientContact: details.source,
    message: responseMessage(result),
    contextMessageId: details.inboundMessageId,
    previewUrl: result.status === "insufficient_credits",
    purpose: "whatsapp_unlock_result",
    trigger: "gupshup_quick_reply",
    automatic: true,
    idempotencyKey: `whatsapp-unlock-result:${original.communicationId}:${idempotencyReference}`,
    metadata: {
      originalCommunicationId: original.communicationId,
      inboundMessageId: details.inboundMessageId,
      actionStatus: result.status,
      accountType: "provider",
      accountId: original.providerId,
    },
  }, "system");
}

async function processInbound(event, options = {}) {
  const details = quickReplyDetails(event);
  if (!details.isQuickReply) return { handled: false };

  if (!details.postbackText || !isUnlockActionToken(details.postbackText)) {
    const reason = details.postbackText ? "unsigned_action" : "missing_postback_action";
    await createRejectedInbound(details, event, reason);
    return { handled: true, status: "logged", reason };
  }

  let action;
  try {
    action = verifyUnlockAction(details.postbackText);
  } catch (error) {
    const reason = error.status === 410 ? "expired_action" : "invalid_action";
    await createRejectedInbound(details, event, reason);
    return { handled: true, status: "rejected", reason };
  }

  const expectedHash = tokenHash(details.postbackText);
  const original = await findOriginalForAction(details, action, expectedHash);
  if (!original) {
    await createRejectedInbound(details, event, "communication_not_found", {
      communicationId: action.communicationId || "",
    });
    return { handled: true, status: "ignored", reason: "communication_not_found" };
  }

  const unlockMetadata = original.metadata?.whatsappUnlock || {};
  const expiresAt = unlockMetadata.expiresAt ? new Date(unlockMetadata.expiresAt) : null;
  if (action.opaque && (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt < new Date())) {
    await createRejectedInbound(details, event, "expired_action", {
      communicationId: original.communicationId,
    });
    return { handled: true, status: "rejected", reason: "expired_action" };
  }
  const expectedApp = String(process.env.CRM_GUPSHUP_APP_NAME || "").trim();
  const phoneMatches = normalizeMobile(details.source) === normalizeMobile(original.recipientContact);
  const originalMessageIds = [
    original.providerMessageId,
    original.metadata?.gupshupMessageId,
    original.metadata?.metaMessageId,
    ...(Array.isArray(original.metadata?.whatsappMessageIds) ? original.metadata.whatsappMessageIds : []),
    original.externalResponse?.messageId,
    original.externalResponse?.id,
  ].map(textFrom).filter(Boolean);
  const contextMessageIds = details.contextMessageIds || (details.contextMessageId ? [details.contextMessageId] : []);
  const contextMatches = !contextMessageIds.length
    || !originalMessageIds.length
    || contextMessageIds.some((messageId) => originalMessageIds.includes(messageId));
  const actionMatches = original.direction === "outbound"
    && original.channel === "whatsapp"
    && original.purpose === "nearby_lead_available"
    && unlockMetadata.type === "unlock_lead"
    && unlockMetadata.tokenHash === expectedHash;
  const appMatches = !expectedApp || !details.appName || expectedApp === details.appName;

  if (!phoneMatches || !contextMatches || !actionMatches || !appMatches) {
    await createRejectedInbound(details, event, "action_context_mismatch", {
      communicationId: original.communicationId,
      phoneMatches,
      contextMatches,
      actionMatches,
      appMatches,
    });
    return { handled: true, status: "rejected", reason: "action_context_mismatch" };
  }

  const inboundReference = details.inboundMessageId || `action-${expectedHash.slice(0, 24)}`;
  const idempotencyReference = details.inboundMessageId || expectedHash.slice(0, 24);
  if (unlockMetadata.lastInboundMessageId === inboundReference) {
    return { handled: true, status: "duplicate", communicationId: original.communicationId };
  }

  const staleProcessingBefore = new Date(Date.now() - 2 * 60 * 1000);
  const claimed = await Communication.findOneAndUpdate(
    {
      communicationId: original.communicationId,
      "metadata.whatsappUnlock.tokenHash": expectedHash,
      $or: [
        { "metadata.whatsappUnlock.processing": { $ne: true } },
        { "metadata.whatsappUnlock.lastAttemptAt": { $lt: staleProcessingBefore } },
      ],
    },
    {
      $set: {
        "metadata.whatsappUnlock.processing": true,
        "metadata.whatsappUnlock.status": "processing",
        "metadata.whatsappUnlock.lastInboundMessageId": inboundReference,
        "metadata.whatsappUnlock.lastAttemptAt": new Date(),
        updatedAt: new Date(),
      },
      $inc: { "metadata.whatsappUnlock.attempts": 1 },
    },
    { new: true },
  ).lean();
  if (!claimed) return { handled: true, status: "busy_or_duplicate", communicationId: original.communicationId };

  const inboundCommunication = await communicationService.createInbound({
    enquiryId: original.enquiryId,
    providerId: original.providerId,
    recipientName: original.recipientName,
    recipientContact: details.source,
    providerMessageId: inboundReference,
    message: details.visibleText || "View Enquiry",
    purpose: "whatsapp_unlock_request",
    trigger: "gupshup_quick_reply",
    externalResponse: redactedEvent(event, details.postbackText),
    metadata: {
      originalCommunicationId: original.communicationId,
      originalProviderMessageId: original.providerMessageId,
      contextMessageId: details.contextMessageId,
      contextMessageIds,
      accountType: "provider",
      accountId: original.providerId,
    },
  });
  await Communication.updateOne(
    { communicationId: original.communicationId },
    {
      $set: { updatedAt: new Date() },
      $push: {
        statusHistory: actionHistoryPush({
          status: "whatsapp_unlock_requested",
          at: new Date(),
          source: "gupshup_quick_reply",
          details: {
            inboundCommunicationId: inboundCommunication?.communicationId || "",
            inboundMessageId: inboundReference,
            actionAuthorized: true,
          },
        }),
      },
    },
  );

  let result;
  try {
    result = await providerActionService.unlockLead({
      providerId: original.providerId,
      enquiryId: original.enquiryId,
      providerWhatsapp: details.source,
      communicationId: original.communicationId,
      inboundMessageId: inboundReference,
      originalProviderMessageId: original.providerMessageId,
      idempotencyKey: `whatsapp-unlock:${original.communicationId}:${idempotencyReference}`,
      requestId: options.requestId,
    });
    result = await enrichResultForMessage(original, result);
  } catch (error) {
    const fallbackResult = { status: "failed", code: error.code || "WHATSAPP_UNLOCK_FAILED" };
    let responseDeliveryFailed = false;
    try {
      await sendResultMessage({
        original,
        details,
        result: fallbackResult,
        idempotencyReference: `error:${idempotencyReference}`,
      });
    } catch (_sendError) {
      responseDeliveryFailed = true;
    }
    await saveActionResult(
      original.communicationId,
      { ...fallbackResult, responseDeliveryFailed },
      responseDeliveryFailed ? "failed_response_failed" : "failed",
      error.message,
    );
    return {
      handled: true,
      status: "failed",
      responseSent: !responseDeliveryFailed,
      communicationId: original.communicationId,
    };
  }

  try {
    await sendResultMessage({ original, details, result, idempotencyReference });
    await saveActionResult(original.communicationId, result, String(result.status || "completed"));
    return {
      handled: true,
      status: result.status,
      responseSent: true,
      communicationId: original.communicationId,
    };
  } catch (error) {
    await saveActionResult(
      original.communicationId,
      { ...result, responseDeliveryFailed: true },
      `${String(result.status || "completed")}_response_failed`,
      error.message,
    );
    return {
      handled: true,
      status: result.status,
      responseSent: false,
      communicationId: original.communicationId,
    };
  }
}

module.exports = {
  quickReplyDetails,
  redactedEvent,
  processInbound,
  successMessage,
  failureMessage,
  responseMessage,
  messageContextFromLead,
  enrichResultForMessage,
};