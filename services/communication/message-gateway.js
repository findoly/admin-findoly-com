const whatsappService = require("./whatsapp-service");
const emailService = require("./email-service");
const lambdaService = require("./lambda-message-service");
const { deliveryMode } = require("./communication-config");
const { validationError } = require("../../utils/validation");

const send = async function (payload) {
  const mode = deliveryMode();
  if (mode === "lambda") {
    return {
      mode,
      ...(await lambdaService.send(payload)),
    };
  }
  if (payload.channel === "whatsapp") {
    return {
      mode,
      ...(await whatsappService.sendTemplate(payload)),
    };
  }
  if (payload.channel === "email") {
    return {
      mode,
      ...(await emailService.sendEmail(payload)),
    };
  }
  throw validationError(`Delivery is not supported for channel ${payload.channel}`);
};

module.exports = { send };
