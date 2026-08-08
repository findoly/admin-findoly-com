"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("WhatsApp Inbox is a protected standalone route and legacy URL redirects", () => {
  const routes = source("routes/frontend.js");
  const controller = source("controllers/frontendController.js");
  assert.match(routes, /router\.get\("\/whatsapp-inbox", \.\.\.protectedPage\("communications\.view"\), page\.whatsappInbox\)/);
  assert.match(routes, /communications\/whatsapp-inbox[\s\S]*res\.redirect\(302, `\/whatsapp-inbox\$\{query\}`\)/);
  assert.match(controller, /whatsappInbox: render\("whatsapp-inbox\/index"/);
});

test("CRM navigation opens WhatsApp Inbox in a new tab outside Communication Center", () => {
  const sidebar = source("views/partials/sidebar.ejs");
  const communicationNavigation = source("views/communication/_navigation.ejs");
  assert.match(sidebar, /href="\/whatsapp-inbox" target="_blank" rel="noopener"/);
  assert.doesNotMatch(communicationNavigation, /WhatsApp Inbox/);
});

test("standalone inbox has Findoly shell and rich chat controls", () => {
  const view = source("views/whatsapp-inbox/index.ejs");
  const css = source("public/css/app.css");
  assert.doesNotMatch(view, /crm-wa-app-header/);
  assert.match(view, /crm-wa-list-brand/);
  assert.match(view, /Findoly/);
  assert.match(view, /Message logs/);
  assert.match(view, /Employee guide/);
  assert.match(view, /Open CRM/);
  assert.match(view, /Search inside this conversation/);
  assert.match(view, /Copy message/);
  assert.match(view, /Copy location link/);
  assert.match(view, /Open in Maps/);
  assert.doesNotMatch(view, /formatCoordinates/);
  assert.match(view, /messageItems\(\)/);
  assert.match(view, /dateSeparatorLabel/);
  assert.match(view, /newMessageCount/);
  assert.match(view, /updateDocumentTitle/);
  assert.match(view, /Search chats/);
  assert.match(view, /crm-wa-filter-menu/);
  assert.match(view, /Load more chats/);
  assert.match(view, /crm-wa-info-drawer/);
  assert.match(view, /crm-wa-send-spinner/);
  assert.match(view, /loadMoreConversations/);
  assert.match(view, /options\.append \|\| options\.preserve/);
  assert.match(view, /is-grouped/);
  assert.doesNotMatch(view, />Previous<|>Next</);
  assert.match(css, /\.crm-wa-standalone-body/);
  assert.match(css, /height: 100dvh/);
  assert.match(css, /\.crm-whatsapp-inbox-standalone/);
  assert.match(css, /\.crm-wa-copy-toast/);
  assert.match(css, /background: #d9fdd3/);
  assert.match(css, /crm-wa-message-row\.is-inbound[\s\S]*border-color: transparent #fff/);
  assert.match(css, /\.crm-wa-info-drawer/);
});

test("UI action telemetry logs identifiers only", () => {
  const controller = source("controllers/whatsappInboxController.js");
  const routes = source("routes/whatsapp-inbox.js");
  assert.match(routes, /router\.post\("\/events"/);
  assert.match(controller, /whatsapp_inbox_message_copied/);
  assert.match(controller, /whatsapp_inbox_location_opened/);
  assert.match(controller, /whatsapp_inbox_location_link_copied/);
  const telemetry = controller.slice(controller.indexOf("function recordUiEvent"));
  assert.doesNotMatch(telemetry, /messageText|messageBody|latitude|longitude|mapUrl/);
});
