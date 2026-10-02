"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");

function loadEmailService({ firstError = null, secondResult = { MessageId: "message-2" } } = {}) {
  const absolute = require.resolve(path.join(root, "services/communication/email-service.js"));
  delete require.cache[absolute];
  const calls = [];
  class SESv2Client {
    async send(command) {
      calls.push(command.input);
      if (calls.length === 1 && firstError) throw firstError;
      return calls.length === 1 ? { MessageId: "message-1" } : secondResult;
    }
  }
  class SendEmailCommand {
    constructor(input) { this.input = input; }
  }
  const stubs = {
    "@aws-sdk/client-sesv2": { SESv2Client, SendEmailCommand },
  };
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const service = require(absolute);
    service.__calls = calls;
    return service;
  } finally {
    Module._load = originalLoad;
    delete require.cache[absolute];
  }
}

function env(overrides = {}) {
  return {
    AWS_REGION: "ap-south-1",
    SES_FROM_EMAIL: "no-reply@findoly.com",
    SES_FROM_NAME: "Findoly",
    ...overrides,
  };
}

async function withEnv(values, work) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await work();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function payload() {
  return {
    to: "provider@example.com",
    subject: "New requirement assigned",
    text: "A new requirement has been assigned.",
    communicationId: "communication-1",
    purpose: "provider_manual_assignment",
  };
}

test("SES sends normally with the configured configuration set", async () => {
  await withEnv(env({ SES_CONFIGURATION_SET: "findoly-transactional" }), async () => {
    const service = loadEmailService();
    const result = await service.sendEmail(payload());

    assert.equal(result.status, "sent");
    assert.equal(result.configurationSetFallback, false);
    assert.equal(service.__calls.length, 1);
    assert.equal(service.__calls[0].ConfigurationSetName, "findoly-transactional");
  });
});

test("SES retries once without the optional configuration set when AWS rejects that set", async () => {
  await withEnv(env({ SES_CONFIGURATION_SET: "missing-set" }), async () => {
    const firstError = Object.assign(
      new Error("Configuration set <missing-set> does not exist."),
      { name: "BadRequestException" },
    );
    const service = loadEmailService({ firstError });
    const result = await service.sendEmail(payload());

    assert.equal(result.status, "sent");
    assert.equal(result.configurationSetFallback, true);
    assert.equal(service.__calls.length, 2);
    assert.equal(service.__calls[0].ConfigurationSetName, "missing-set");
    assert.equal(Object.hasOwn(service.__calls[1], "ConfigurationSetName"), false);
  });
});

test("SES does not hide credential, sender identity, sandbox or permission failures", async () => {
  const cases = [
    Object.assign(new Error("The security token included in the request is invalid"), { name: "UnrecognizedClientException" }),
    Object.assign(new Error("Email address is not verified"), { name: "MessageRejected" }),
    Object.assign(new Error("User is not authorized to perform ses:SendEmail"), { name: "AccessDeniedException" }),
  ];
  for (const firstError of cases) {
    await withEnv(env({ SES_CONFIGURATION_SET: "findoly-transactional" }), async () => {
      const service = loadEmailService({ firstError });
      await assert.rejects(() => service.sendEmail(payload()), firstError);
      assert.equal(service.__calls.length, 1);
    });
  }
});

test("configuration-set classifier requires a configuration-set-specific AWS error", () => {
  const service = loadEmailService();
  assert.equal(
    service.configurationSetRejected(
      Object.assign(new Error("Configuration set does not exist"), { name: "BadRequestException" }),
    ),
    true,
  );
  assert.equal(
    service.configurationSetRejected(
      Object.assign(new Error("Email address is not verified"), { name: "MessageRejected" }),
    ),
    false,
  );
});
