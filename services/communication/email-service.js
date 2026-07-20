const { SESv2Client, SendEmailCommand } = require("@aws-sdk/client-sesv2");
const { emailValue, textValue, validationError } = require("../../utils/validation");

let client;

const getClient = function () {
  if (!client) {
    client = new SESv2Client({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1",
    });
  }
  return client;
};

const fromAddress = function () {
  const email = emailValue(process.env.SES_FROM_EMAIL || "", {
    label: "SES sender email",
    required: true,
  });
  const name = textValue(process.env.SES_FROM_NAME || process.env.APP_NAME || "Findoly", {
    label: "SES sender name",
    maxLength: 120,
  });
  return name ? `${name.replace(/[<>\r\n"]/g, "")} <${email}>` : email;
};

const sendEmail = async function (payload) {
  const to = emailValue(payload.to, { label: "Recipient email", required: true });
  const subject = textValue(payload.subject, {
    label: "Email subject",
    required: true,
    maxLength: 300,
  });
  const html = textValue(payload.html || "", {
    label: "Email HTML",
    maxLength: 100000,
    preserveWhitespace: true,
  });
  const text = textValue(payload.text || "", {
    label: "Email text",
    maxLength: 100000,
    preserveWhitespace: true,
  });
  if (!html && !text) throw validationError("Email body is required");

  const input = {
    FromEmailAddress: fromAddress(),
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: {},
      },
    },
    EmailTags: [
      { Name: "communication_id", Value: String(payload.communicationId || "unknown").slice(0, 256) },
      { Name: "purpose", Value: String(payload.purpose || "manual").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256) },
    ],
  };
  if (html) input.Content.Simple.Body.Html = { Data: html, Charset: "UTF-8" };
  if (text) input.Content.Simple.Body.Text = { Data: text, Charset: "UTF-8" };
  if (process.env.SES_CONFIGURATION_SET) {
    input.ConfigurationSetName = process.env.SES_CONFIGURATION_SET;
  }
  if (process.env.SES_REPLY_TO_EMAIL) {
    input.ReplyToAddresses = [emailValue(process.env.SES_REPLY_TO_EMAIL, { label: "SES reply-to email" })];
  }

  const result = await getClient().send(new SendEmailCommand(input));
  return {
    provider: "ses",
    providerMessageId: result.MessageId || "",
    status: "sent",
    response: result,
  };
};

module.exports = { sendEmail };
