"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("WhatsApp Inbox is a permission-protected CRM page and API", () => {
  const frontendRoutes = source("routes/frontend.js");
  const mainRoutes = source("routes/main.js");
  const inboxRoutes = source("routes/whatsapp-inbox.js");
  assert.match(frontendRoutes, /communications\/whatsapp-inbox.*communications\.view/);
  assert.match(mainRoutes, /communication\/whatsapp-inbox/);
  assert.match(inboxRoutes, /communications\.view/);
  assert.match(inboxRoutes, /communications\.send/);
  assert.match(inboxRoutes, /\/reply/);
  assert.match(inboxRoutes, /\/read/);
  assert.match(inboxRoutes, /\/unread/);
  assert.match(inboxRoutes, /messages\/:messageId\/media/);
});

test("WhatsApp Inbox UI includes shared list, thread, mobile flow and reply composer", () => {
  const view = source("views/communication/whatsapp-inbox.ejs");
  const css = source("public/css/app.css");
  const sidebar = source("views/partials/sidebar.ejs");
  assert.match(view, /Conversations/);
  assert.match(view, /Load older messages/);
  assert.match(view, /Mark unread/);
  assert.match(view, /Related requirements/);
  assert.match(view, /Type a WhatsApp message/);
  assert.match(view, /upsertThreadMessage\(body\.data\.message\)/);
  assert.match(view, /Message sent\. Chat history is syncing/);
  assert.match(view, /threadError/);
  assert.match(view, /mediaUrl\(message, 'inline'\)/);
  assert.match(view, /Download audio/);
  assert.match(view, /Media is being saved securely/);
  assert.match(view, /<video controls/);
  assert.match(view, /<audio controls/);
  assert.match(view, /setInterval\(\(\) => this\.poll\(\), 7000\)/);
  assert.match(css, /\.crm-whatsapp-inbox/);
  assert.match(css, /\.crm-wa-media-document/);
  assert.match(css, /@media \(max-width: 991\.98px\)/);
  assert.match(sidebar, /WhatsApp Inbox/);
});

test("persistent inbox collections have idempotency and scalable list indexes", () => {
  const conversation = source("models/WhatsAppConversation.js");
  const message = source("models/WhatsAppMessage.js");
  const ensure = source("scripts/ensure-indexes.js");
  const plans = source("scripts/verify-query-plans.js");
  assert.match(conversation, /contactNumber.*unique: true/s);
  assert.match(conversation, /status: 1, lastMessageAt: -1/);
  assert.match(message, /idempotencyKey: 1.*unique: true/s);
  assert.match(message, /conversationId: 1, occurredAt: -1/);
  assert.match(message, /providerMessageId: 1.*partialFilterExpression/s);
  assert.match(ensure, /WhatsAppConversation/);
  assert.match(ensure, /WhatsAppMessage/);
  assert.match(plans, /whatsapp-inbox\/messages/);
});

test("existing Communication log TTL remains unchanged and migration is idempotent", () => {
  const communication = source("models/Communication.js");
  const migration = source("scripts/backfill-whatsapp-inbox.js");
  const packageJson = source("package.json");
  assert.match(communication, /communication_log_ttl/);
  assert.match(migration, /--dry-run/);
  assert.match(migration, /alreadyImported/);
  assert.match(migration, /markUnread: false/);
  assert.match(packageJson, /migrate:whatsapp-inbox/);
});
