const crypto = require("crypto");
const {
  metaBaseUrl,
  defaultCountryCode,
} = require("./communication-config");
const { orderedValues } = require("./template-renderer");
const { textValue, validationError } = require("../../utils/validation");

const timeoutSignal = function (milliseconds) {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(milliseconds);
  const controller = new AbortController();
  setTimeout(function () {
    controller.abort();
  }, milliseconds).unref();
  return controller.signal;
};

const requireMetaConfig = function (templateManagement) {
  const config = {
    accessToken: process.env.META_WHATSAPP_ACCESS_TOKEN || "",
    phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID || "",
    businessAccountId: process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID || "",
  };
  if (!config.accessToken) throw validationError("Meta WhatsApp access token is not configured", 503);
  if (templateManagement && !config.businessAccountId) {
    throw validationError("Meta WhatsApp Business Account ID is not configured", 503);
  }
  if (!templateManagement && !config.phoneNumberId) {
    throw validationError("Meta WhatsApp phone number ID is not configured", 503);
  }
  return config;
};

const normalizeWhatsAppAddress = function (value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) throw validationError("WhatsApp recipient is required");
  if (digits.length === 10) digits = `${defaultCountryCode()}${digits}`;
  if (digits.length < 10 || digits.length > 15) {
    throw validationError("WhatsApp recipient must contain 10 to 15 digits");
  }
  return digits;
};

const metaRequest = async function (path, options) {
  const config = requireMetaConfig(Boolean(options && options.templateManagement));
  const response = await fetch(`${metaBaseUrl()}${path}`, {
    method: options?.method || "GET",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
    signal: timeoutSignal(Number(process.env.COMMUNICATION_HTTP_TIMEOUT_MS || 15000)),
  });
  const raw = await response.text();
  let data = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch (error) {
      data = { raw };
    }
  }
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `Meta API request failed with status ${response.status}`;
    const failure = Object.assign(new Error(message), {
      status: response.status >= 400 && response.status < 500 ? 400 : 502,
      providerResponse: data,
    });
    throw failure;
  }
  return data;
};

const whatsappParameters = function (values) {
  return values.map(function (value) {
    return { type: "text", text: String(value) };
  });
};

const sendTemplate = async function (payload) {
  const config = requireMetaConfig(false);
  const values = orderedValues(payload.variables || {});
  const components = [];
  if (values.length) {
    components.push({ type: "body", parameters: whatsappParameters(values) });
  }
  if (payload.category === "authentication" && values[0]) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: whatsappParameters([values[0]]),
    });
  }
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizeWhatsAppAddress(payload.to),
    type: "template",
    template: {
      name: payload.templateName,
      language: { code: payload.language || "en_US" },
    },
  };
  if (components.length) body.template.components = components;
  const data = await metaRequest(`/${config.phoneNumberId}/messages`, {
    method: "POST",
    body,
  });
  return {
    provider: "meta",
    providerMessageId: data?.messages?.[0]?.id || "",
    status: data?.messages?.[0]?.message_status || "sent",
    response: data,
  };
};

const buildTemplateComponents = function (template) {
  if (template.category === "authentication") {
    return [
      {
        type: "BODY",
        add_security_recommendation: true,
      },
      {
        type: "FOOTER",
        code_expiration_minutes: Number(template.otpExpiryMinutes || 5),
      },
      {
        type: "BUTTONS",
        buttons: [
          {
            type: "OTP",
            otp_type: "COPY_CODE",
            text: "Copy code",
          },
        ],
      },
    ];
  }

  const components = [];
  if (template.headerType === "text" && template.headerText) {
    components.push({ type: "HEADER", format: "TEXT", text: template.headerText });
  }
  components.push({ type: "BODY", text: template.body });
  if (template.footer) components.push({ type: "FOOTER", text: template.footer });
  if (Array.isArray(template.buttons) && template.buttons.length) {
    components.push({ type: "BUTTONS", buttons: template.buttons });
  }
  return components;
};

const submitTemplate = async function (template) {
  const config = requireMetaConfig(true);
  const body = {
    name: template.name,
    language: template.language || "en_US",
    category: String(template.category || "utility").toUpperCase(),
    components: buildTemplateComponents(template),
  };
  const data = await metaRequest(`/${config.businessAccountId}/message_templates`, {
    method: "POST",
    body,
    templateManagement: true,
  });
  return data;
};

const listTemplates = async function () {
  const config = requireMetaConfig(true);
  const fields = encodeURIComponent("id,name,status,category,language,components,rejected_reason,quality_score");
  let after = "";
  const rows = [];
  do {
    const suffix = after ? `&after=${encodeURIComponent(after)}` : "";
    const data = await metaRequest(`/${config.businessAccountId}/message_templates?fields=${fields}&limit=100${suffix}`, {
      templateManagement: true,
    });
    rows.push(...(data.data || []));
    after = data?.paging?.cursors?.after && data?.paging?.next ? data.paging.cursors.after : "";
  } while (after && rows.length < 1000);
  return rows;
};

const verifyWebhookSignature = function (rawBody, signature) {
  const secret = process.env.META_APP_SECRET || "";
  if (!secret) return false;
  const provided = String(signature || "");
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const webhookChallenge = function (query) {
  const mode = textValue(query["hub.mode"] || "", { label: "Webhook mode", maxLength: 50 });
  const token = textValue(query["hub.verify_token"] || "", { label: "Webhook token", maxLength: 500 });
  const challenge = textValue(query["hub.challenge"] || "", { label: "Webhook challenge", maxLength: 1000 });
  if (mode !== "subscribe" || !process.env.META_WEBHOOK_VERIFY_TOKEN || token !== process.env.META_WEBHOOK_VERIFY_TOKEN) {
    throw validationError("WhatsApp webhook verification failed", 403);
  }
  return challenge;
};

module.exports = {
  normalizeWhatsAppAddress,
  sendTemplate,
  submitTemplate,
  listTemplates,
  verifyWebhookSignature,
  webhookChallenge,
  buildTemplateComponents,
};
