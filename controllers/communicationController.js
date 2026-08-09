const Communication = require("../models/Communication");
const CommunicationTemplate = require("../models/CommunicationTemplate");
const CommunicationRule = require("../models/CommunicationRule");
const OtpRequest = require("../models/OtpRequest");
const Enquiry = require("../models/Enquiry");
const service = require("../services/communication/communication-service");
const templateService = require("../services/communication/template-service");
const ruleService = require("../services/communication/rule-service");
const otpService = require("../services/communication/otp-service");
const notificationService = require("../services/communication/notification-service");
const systemEventService = require("../services/communication/system-event-service");
const webhookService = require("../services/communication/webhook-service");
const { configurationStatus } = require("../services/communication/communication-config");
const providerStatusService = require("../services/provider-unlock/provider-status-service");

const actor = function (req) {
  return req.admin?.email || "api";
};

function integrationIdentity(context = {}, eventName = "") {
  const normalizedEvent = String(eventName || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const providerEvents = new Set([
    "provider_lead_unlocked",
    "provider_feedback_updated",
    "provider_outcome_updated",
  ]);
  const integrationEventId = String(context.integrationEventId || "").trim();
  if (normalizedEvent === "partner_lead_submitted") {
    const enquiryId = String(context.enquiryId || context.lead?.enquiryId || "").trim();
    if (!integrationEventId || integrationEventId.length > 180 || /[\0\r\n]/.test(integrationEventId)) {
      throw Object.assign(new Error("Integration event ID is required and must be valid"), { status: 400 });
    }
    if (!enquiryId || enquiryId.length > 120 || /[\0\r\n]/.test(enquiryId)) {
      throw Object.assign(new Error("Enquiry ID is required and must be valid"), { status: 400 });
    }
    return { accepted: true, eventName: normalizedEvent, integrationEventId, enquiryId };
  }
  if (normalizedEvent === "provider_join_request_submitted") {
    const providerJoinRequestId = String(
      context.providerJoinRequestId || context.providerJoinRequest?.providerJoinRequestId || "",
    ).trim();
    if (!integrationEventId || integrationEventId.length > 180 || /[\0\r\n]/.test(integrationEventId)) {
      throw Object.assign(new Error("Integration event ID is required and must be valid"), { status: 400 });
    }
    if (!providerJoinRequestId || providerJoinRequestId.length > 120 || /[\0\r\n]/.test(providerJoinRequestId)) {
      throw Object.assign(new Error("Provider joining request ID is required and must be valid"), { status: 400 });
    }
    return { accepted: true, eventName: normalizedEvent, integrationEventId, providerJoinRequestId };
  }
  if (!providerEvents.has(normalizedEvent)) return null;
  const providerLeadUnlockId = String(context.providerLeadUnlockId || "").trim();
  const integrationEventSequence = context.integrationEventSequence;
  if (!integrationEventId || integrationEventId.length > 120 || /[\0\r\n]/.test(integrationEventId)) {
    throw Object.assign(new Error("Integration event ID is required and must be valid"), { status: 400 });
  }
  if (!providerLeadUnlockId || providerLeadUnlockId.length > 120 || /[\0\r\n]/.test(providerLeadUnlockId)) {
    throw Object.assign(new Error("Provider lead access ID is required and must be valid"), { status: 400 });
  }
  if (typeof integrationEventSequence !== "number" || !Number.isSafeInteger(integrationEventSequence) || integrationEventSequence < 1) {
    throw Object.assign(new Error("Integration event sequence must be a positive whole number"), { status: 400 });
  }
  return { accepted: true, eventName: normalizedEvent, integrationEventId, providerLeadUnlockId, integrationEventSequence };
}

const list = async function (req, res, next) {
  try {
    const result = await service.list(req.query);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

const get = async function (req, res, next) {
  try {
    res.json({ success: true, data: await service.get(req.params.communicationId) });
  } catch (error) {
    next(error);
  }
};

const create = async function (req, res, next) {
  try {
    res.status(201).json({ success: true, data: await service.create({ ...req.body, actor: actor(req) }) });
  } catch (error) {
    next(error);
  }
};

const update = async function (req, res, next) {
  try {
    res.json({ success: true, data: await service.update(req.params.communicationId, req.body) });
  } catch (error) {
    next(error);
  }
};

const send = async function (req, res, next) {
  try {
    res.status(201).json({ success: true, data: await service.send(req.body, actor(req)) });
  } catch (error) {
    next(error);
  }
};

const retry = async function (req, res, next) {  try {
    res.status(201).json({
      success: true,
      data: await service.retry(req.params.communicationId, actor(req)),
    });
  } catch (error) {
    next(error);
  }
};

const dashboard = async function (req, res, next) {
  try {
    await notificationService.ensureDefaultRules();
    const [communications, templates, rules, otp] = await Promise.all([
      service.dashboard(),
      CommunicationTemplate.aggregate([
        { $group: { _id: { channel: "$channel", status: "$status" }, count: { $sum: 1 } } },
      ]),
      CommunicationRule.aggregate([
        { $group: { _id: "$enabled", count: { $sum: 1 } } },
      ]),
      OtpRequest.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);
    res.json({
      success: true,
      data: {
        communications,
        templates,
        rules,
        otp,
        configuration: configurationStatus(),
      },
    });
  } catch (error) {
    next(error);
  }
};

const config = async function (req, res, next) {
  try {
    res.json({ success: true, data: configurationStatus() });
  } catch (error) {
    next(error);
  }
};

const listTemplates = async function (req, res, next) {
  try {
    await notificationService.ensureDefaultRules();
    const result = await templateService.list(req.query);
    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
      metadata: {
        gupshupSyncConfigured: Boolean(process.env.CRM_GUPSHUP_API_KEY && process.env.CRM_GUPSHUP_APP_ID),
      },
    });
  } catch (error) {
    next(error);
  }
};

const getTemplate = async function (req, res, next) {
  try {
    res.json({ success: true, data: await templateService.get(req.params.templateId) });
  } catch (error) {
    next(error);
  }
};

const createTemplate = async function (req, res, next) {
  try {
    res.status(201).json({ success: true, data: await templateService.create(req.body, actor(req)) });
  } catch (error) {
    next(error);
  }
};

const updateTemplate = async function (req, res, next) {
  try {
    res.json({ success: true, data: await templateService.update(req.params.templateId, req.body, actor(req)) });
  } catch (error) {
    next(error);
  }
};

const submitTemplate = async function (req, res, next) {
  try {
    res.json({ success: true, data: await templateService.submit(req.params.templateId, actor(req)) });
  } catch (error) {
    next(error);
  }
};

const syncTemplates = async function (req, res, next) {
  try {
    res.json({ success: true, data: await templateService.sync(actor(req)) });
  } catch (error) {
    next(error);
  }
};

const testTemplate = async function (req, res, next) {
  try {
    const template = await templateService.get(req.params.templateId);
    res.status(201).json({
      success: true,
      data: await service.send(
        {
          ...req.body,
          channel: template.channel,
          templateId: template.templateId,
          purpose: "template_test",
          trigger: "template_test",
        },
        actor(req),
      ),
    });
  } catch (error) {
    next(error);
  }
};

const listRules = async function (req, res, next) {
  try {
    await notificationService.ensureDefaultRules();
    const result = await ruleService.list(req.query);
    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
      metadata: {
        events: ruleService.EVENTS,
        recipientSources: ruleService.RECIPIENT_SOURCES,
        eventVariables: ruleService.EVENT_VARIABLES,
        eventVariableMetadata: ruleService.EVENT_VARIABLE_METADATA,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getRule = async function (req, res, next) {
  try {
    res.json({ success: true, data: await ruleService.get(req.params.ruleId) });
  } catch (error) {
    next(error);
  }
};

const createRule = async function (req, res, next) {
  try {
    res.status(201).json({ success: true, data: await ruleService.create(req.body, actor(req)) });
  } catch (error) {
    next(error);
  }
};

const updateRule = async function (req, res, next) {
  try {
    res.json({ success: true, data: await ruleService.update(req.params.ruleId, req.body, actor(req)) });
  } catch (error) {
    next(error);
  }
};

const triggerEvent = async function (req, res, next) {
  try {
    res.json({
      success: true,
      data: await notificationService.trigger(req.params.event, req.body || {}, actor(req)),
    });
  } catch (error) {
    next(error);
  }
};

const testInternalAlert = async function (req, res, next) {
  try {
    res.status(201).json({
      success: true,
      data: await systemEventService.testInternalAlert(req.params.event, actor(req)),
    });
  } catch (error) {
    next(error);
  }
};

const integrationEvent = async function (req, res, next) {
  try {
    const context = { ...(req.body || {}) };
    const normalizedIntegrationEvent = String(req.params.event || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const acknowledgement = integrationIdentity(context, normalizedIntegrationEvent);
    if (normalizedIntegrationEvent === "partner_lead_submitted") {
      console.info({ event: "partner_lead_event_received", integrationEventId: acknowledgement?.integrationEventId || "", enquiryId: acknowledgement?.enquiryId || "" });
    }
    if (normalizedIntegrationEvent === "provider_join_request_submitted") {
      console.info({ event: "provider_join_request_event_received", integrationEventId: acknowledgement?.integrationEventId || "", providerJoinRequestId: acknowledgement?.providerJoinRequestId || "" });
    }
    const providerLeadStatus = providerStatusService.providerStatusFromEvent(
      req.params.event,
      context.activityStatus || context.status,
    );
    const providerSaleOutcome = providerStatusService.providerOutcomeFromEvent(
      req.params.event,
      context.outcome || context.providerSaleOutcome,
    );
    const isProviderFeedbackEvent = Boolean(
      providerLeadStatus ||
      providerSaleOutcome ||
      ["provider_feedback_updated", "provider-feedback-updated", "provider_outcome_updated", "provider-outcome-updated"].includes(String(req.params.event || "").toLowerCase()),
    );
    let providerStatusUpdate = null;

    if (isProviderFeedbackEvent) {
      providerStatusUpdate = await providerStatusService.updateProviderLeadFeedback(
        {
          ...context,
          outcome: providerSaleOutcome || context.outcome,
          activityStatus: providerLeadStatus || context.activityStatus,
          enquiryId: context.enquiryId || context.lead?.enquiryId,
          providerId:
            context.providerId ||
            context.provider?.providerId ||
            context.provider?.id,
          providerLeadUnlockId:
            context.providerLeadUnlockId,
        },
        "provider-integration",
      );
      context.lead = providerStatusUpdate.lead;
      context.unlock = providerStatusUpdate.unlock;
      context.providerLeadUnlockId = providerStatusUpdate.unlock.providerLeadUnlockId;
      context.outcome = providerStatusUpdate.unlock.providerSaleOutcome;
      context.activityStatus = providerStatusUpdate.unlock.providerLeadStatus;
      if (providerStatusUpdate.stale) {
        return res.json({
          success: true,
          data: {
            channelDeliveries: [],
            notification: [],
            notificationEvents: [],
            providerStatusUpdate,
            ...(acknowledgement ? { acknowledgement: { ...acknowledgement, stale: true } } : {}),
          },
        });
      }
    } else if (!context.lead && context.enquiryId) {
      const lead = await Enquiry.findOne({ enquiryId: context.enquiryId }).lean();
      if (!lead) throw Object.assign(new Error("Lead not found"), { status: 404 });
      context.lead = lead;
    }

    const sourcePortal = normalizedIntegrationEvent === "partner_lead_submitted" ? "partner-portal" : "provider-portal";
    const channelDeliveries = await systemEventService.dispatch(
      normalizedIntegrationEvent,
      {
        ...context,
        source: sourcePortal,
        trigger: normalizedIntegrationEvent,
      },
      "integration-api",
    );

    const notificationEvents = [];
    if (isProviderFeedbackEvent) {
      if (context.outcome === "confirmed") notificationEvents.push("provider_confirmed");
      if (context.outcome === "not_confirmed") notificationEvents.push("provider_not_confirmed");
      if (context.activityStatus) notificationEvents.push(`provider_${context.activityStatus}`);
    } else {
      notificationEvents.push(normalizedIntegrationEvent);
    }

    const notification = [];
    for (const eventName of [...new Set(notificationEvents)]) {
      notification.push(
        ...(await notificationService.trigger(
          eventName,
          {
            ...context,
            status: eventName.startsWith("provider_")
              ? eventName.replace(/^provider_/, "")
              : context.status,
            trigger: eventName,
            source: sourcePortal,
            skipSystemDispatch: true,
          },
          "integration-api",
        )),
      );
    }
    res.json({
      success: true,
      data: {
        channelDeliveries,
        notification,
        notificationEvents,
        providerStatusUpdate,
        ...(acknowledgement ? { acknowledgement: { ...acknowledgement, stale: false } } : {}),
      },
    });
  } catch (error) {
    next(error);
  }
};

const sendOtp = async function (req, res, next) {
  try {
    res.status(201).json({ success: true, data: await otpService.send(req.body, req) });
  } catch (error) {
    next(error);
  }
};

const verifyOtp = async function (req, res, next) {
  try {
    res.json({ success: true, data: await otpService.verify(req.body) });
  } catch (error) {
    next(error);
  }
};

const listOtp = async function (req, res, next) {
  try {
    const result = await otpService.list(req.query);
    res.json({ success: true, data: result.data, pagination: result.pagination });
  } catch (error) {
    next(error);
  }
};

const whatsappWebhook = async function (req, res, next) {
  try {
    const data = await webhookService.processWhatsApp(req.body, {
      queryToken: req.query?.token || "",
      headerToken: req.get("x-webhook-token") || req.get("x-gupshup-signature") || "",
      requestId: req.requestId || "",
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const sesWebhook = async function (req, res, next) {
  try {
    const data = await webhookService.processSes(req.body);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const lambdaDeliveryWebhook = async function (req, res, next) {
  try {
    const data = await webhookService.processLambdaDelivery(req.body || {}, req.get("authorization"));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  list,
  get,
  create,
  update,
  send,
  retry,
  dashboard,
  config,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  submitTemplate,
  syncTemplates,
  testTemplate,
  listRules,
  getRule,
  createRule,
  updateRule,
  triggerEvent,
  testInternalAlert,
  integrationEvent,
  sendOtp,
  verifyOtp,
  listOtp,
  whatsappWebhook,
  sesWebhook,
  lambdaDeliveryWebhook,
};
