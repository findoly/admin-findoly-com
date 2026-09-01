const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("dashboard adds a bounded read-only needs-attention queue without replacing existing metrics", () => {
  const service = source("services/dashboard/dashboard-service.js");
  const view = source("views/dashboard/index.ejs");

  assert.match(service, /buildAttentionQueue/);
  assert.match(service, /LEAD_ATTENTION_NO_UNLOCK_MINUTES/);
  assert.match(service, /LEAD_ATTENTION_STAGE_HOURS/);
  assert.match(service, /purpose:\s*"nearby_lead_available"/);
  assert.match(service, /status:\s*\{ \$in: \["failed", "rejected"\] \}/);
  assert.match(service, /ATTENTION_ROW_LIMIT = 20/);
  assert.match(view, /Needs attention/);
  assert.match(view, /data\.needsAttention/);

  assert.match(view, /All requirements/);
  assert.match(view, /Active providers/);
  assert.match(view, /Available offers/);
  assert.match(view, /Open follow-ups/);
  assert.match(view, /Recent requirements/);
});

test("requirement page exposes a read-only provider WhatsApp alert audit", () => {
  const service = source("services/enquiry/provider-alert-audit-service.js");
  const controller = source("controllers/enquiryController.js");
  const routes = source("routes/enquiry.js");
  const view = source("views/enquiry/show.ejs");

  assert.match(service, /providerWhatsappAlerts/);
  assert.match(service, /purpose:\s*"nearby_lead_available"/);
  assert.match(service, /deliveryDetailExpired/);
  assert.match(service, /COMMUNICATION_LOG_RETENTION_DAYS/);
  assert.match(controller, /providerAlertAuditService\.getProviderAlertAudit/);
  assert.match(routes, /provider-alert-audit", requirePermission\("requirements\.view"\)/);
  assert.match(view, /Provider WhatsApp alert audit/);
  assert.match(view, /Delivery detail expired/);
  assert.match(view, /loadProviderAlertAudit/);
  assert.doesNotMatch(routes, /provider-alert-audit[^\n]*post/i);
});

test("provider performance is informational and uses durable unlock outcomes only", () => {
  const service = source("services/provider/provider-performance-service.js");
  const controller = source("controllers/providerController.js");
  const routes = source("routes/provider.js");
  const view = source("views/provider/show.ejs");
  const nearby = source("services/communication/nearby-lead-alert-service.js");

  assert.match(service, /MIN_RESOLVED_OUTCOMES = 3/);
  assert.match(service, /ProviderLeadUnlock\.aggregate/);
  assert.match(service, /conversionRate/);
  assert.match(service, /reliabilityScore/);
  assert.match(service, /performanceScore/);
  assert.match(controller, /providerPerformanceService\.getProviderPerformance/);
  assert.match(routes, /providerId\/performance", requirePermission\("providers\.view"\)/);
  assert.match(view, /Performance/);
  assert.match(view, /does not affect provider alert ranking/);
  assert.doesNotMatch(nearby, /provider-performance-service|performanceScore|reliabilityScore/);
});

test("existing automatic and manual nearby WhatsApp controls remain present", () => {
  const enquiry = source("services/enquiry/enquiry-service.js");
  const nearby = source("services/communication/nearby-lead-alert-service.js");
  const show = source("views/enquiry/show.ejs");

  assert.match(enquiry, /publishedLead\.automaticWhatsappLeadAlertsEnabled !== false/);
  assert.match(nearby, /automatic_alerts_disabled/);
  assert.match(nearby, /dispatchSelectedNearbyLeadAlerts[\s\S]*manual:\s*true/);
  assert.match(show, /Automatic nearby WhatsApp alerts/);
  assert.match(show, /Nearby Providers/);
});
