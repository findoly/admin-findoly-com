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
const whatsappService = require("../services/communication/whatsapp-service");
const slackService = require("../services/communication/slack-service");
const { configurationStatus } = require("../services/communication/communication-config");
const providerStatusService = require("../services/distribution/provider-status-service");

const actor = function (req) {
  return req.admin?.email || "api";
};

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

const sendSlack = async function (req, res, next) {
  try {
    res.status(201).json({
      success: true,
      data: await service.send(
        {
          ...(req.body || {}),
          channel: "slack",
          purpose: req.body?.purpose || "internal_team_notification",
          trigger: req.body?.trigger || "manual_slack",
        },
        actor(req),
      ),
    });
  } catch (error) {
    next(error);
  }
};


const listSlackChannels = async function (req, res, next) {
  try {
    const refresh = ["1", "true", "yes"].includes(String(req.query?.refresh || "").toLowerCase());
    res.json({
      success: true,
      data: await slackService.listChannels({ refresh }),
    });
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
    res.json({ success: true, data: await templateService.list(req.query) });
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
    res.json({ success: true, data: await ruleService.list() });
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

const integrationEvent = async function (req, res, next) {
  try {
    const context = { ...(req.body || {}) };
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
          leadDistributionId:
            context.leadDistributionId || context.distributionId,
        },
        "provider-integration",
      );
      context.lead = providerStatusUpdate.lead;
      context.distribution = providerStatusUpdate.distribution;
      context.outcome = providerStatusUpdate.distribution.providerSaleOutcome;
      context.activityStatus = providerStatusUpdate.distribution.providerLeadStatus;
    } else if (!context.lead && context.enquiryId) {
      const lead = await Enquiry.findOne({ enquiryId: context.enquiryId }).lean();
      if (!lead) throw Object.assign(new Error("Lead not found"), { status: 404 });
      context.lead = lead;
    }

    const channelDeliveries = await systemEventService.dispatch(
      req.params.event,
      {
        ...context,
        source: "provider-portal",
        trigger: req.params.event,
      },
      "integration-api",
    );

    const notificationEvents = [];
    if (isProviderFeedbackEvent) {
      if (context.outcome === "confirmed") notificationEvents.push("provider_confirmed");
      if (context.outcome === "not_confirmed") notificationEvents.push("provider_not_confirmed");
      if (context.activityStatus) notificationEvents.push(`provider_${context.activityStatus}`);
    } else {
      notificationEvents.push(req.params.event);
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
    res.json({ success: true, data: await otpService.list(req.query) });
  } catch (error) {
    next(error);
  }
};

const verifyWhatsAppWebhook = function (req, res, next) {
  try {
    res.status(200).send(whatsappService.webhookChallenge(req.query));
  } catch (error) {
    next(error);
  }
};

const whatsappWebhook = async function (req, res, next) {
  try {
    const data = await webhookService.processWhatsApp(req.body, req.get("x-hub-signature-256"));
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
  sendSlack,
  listSlackChannels,
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
  integrationEvent,
  sendOtp,
  verifyOtp,
  listOtp,
  verifyWhatsAppWebhook,
  whatsappWebhook,
  sesWebhook,
  lambdaDeliveryWebhook,
};
