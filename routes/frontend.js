const router = require("express").Router();
const page = require("../controllers/frontendController");
const employeeGuide = require("../controllers/employeeGuideController");
const { pageAuth, requirePermission } = require("../middleware/auth");

const protectedPage = (permission) => [pageAuth, requirePermission(permission)];

function communicationChannel(channel) {
  return (req, res, next) => {
    res.locals.communicationChannel = channel;
    next();
  };
}

function templateChannelFromQuery(req, res, next) {
  res.locals.communicationChannel = String(req.query.channel || "whatsapp").toLowerCase() === "email"
    ? "email"
    : "whatsapp";
  next();
}

router.get("/login", page.login);
router.get("/", (req, res) => res.redirect(req.admin ? "/dashboard" : "/login"));
router.get("/dashboard", ...protectedPage("dashboard.view"), page.dashboard);
router.get("/employee-guide", pageAuth, employeeGuide.page);
router.get("/employee-guide/content", pageAuth, employeeGuide.content);
router.get("/employee-guide/pdf", pageAuth, employeeGuide.pdf);
router.get("/enquiries", ...protectedPage("requirements.view"), page.enquiries);
router.get("/requirements", ...protectedPage("requirements.view"), page.enquiries);
router.get("/enquiries/new", ...protectedPage("requirements.create"), page.enquiryCreate);
router.get("/requirements/new", ...protectedPage("requirements.create"), page.enquiryCreate);
router.get("/enquiries/:enquiryId/edit", ...protectedPage("requirements.edit"), page.enquiryEdit);
router.get("/requirements/:enquiryId/edit", ...protectedPage("requirements.edit"), page.enquiryEdit);
router.get("/enquiries/:enquiryId/providers/:providerLeadUnlockId", ...protectedPage("requirements.view"), page.enquiryProviderStatusShow);
router.get("/requirements/:enquiryId/providers/:providerLeadUnlockId", ...protectedPage("requirements.view"), page.enquiryProviderStatusShow);
router.get("/enquiries/:enquiryId/providers", ...protectedPage("requirements.view"), page.enquiryProviderStatuses);
router.get("/requirements/:enquiryId/providers", ...protectedPage("requirements.view"), page.enquiryProviderStatuses);
router.get("/enquiries/:enquiryId", ...protectedPage("requirements.view"), page.enquiryShow);
router.get("/requirements/:enquiryId", ...protectedPage("requirements.view"), page.enquiryShow);
router.get("/providers", ...protectedPage("providers.view"), page.providers);
router.get("/provider-requests", ...protectedPage("provider_requests.view"), page.providerRequests);
router.get("/provider-requests/:providerJoinRequestId", ...protectedPage("provider_requests.view"), page.providerRequestShow);
router.get("/providers/new", ...protectedPage("providers.create"), page.providerCreate);
router.get("/providers/:providerId/edit", ...protectedPage("providers.edit"), page.providerEdit);
router.get("/providers/:providerId", ...protectedPage("providers.view"), page.providerShow);
router.get("/agents", ...protectedPage("agents.view"), page.agents);
router.get("/agents/new", ...protectedPage("agents.create"), page.agentCreate);
router.get("/agents/:agentId/edit", ...protectedPage("agents.edit"), page.agentEdit);
router.get("/agents/:agentId", ...protectedPage("agents.view"), page.agentShow);
router.get("/partner-withdrawals", ...protectedPage("partnerPayouts.view"), page.partnerWithdrawals);
router.get("/partner-withdrawals/:withdrawalId", ...protectedPage("partnerPayouts.view"), page.partnerWithdrawalShow);
router.get("/categories", ...protectedPage("categories.view"), page.categories);
router.get("/service-types", ...protectedPage("categories.view"), page.serviceTypes);
router.get("/website-content", ...protectedPage("websiteContent.view"), (req, res) => res.redirect(302, "/website-content/homepage"));
router.get("/website-content/homepage", ...protectedPage("websiteContent.view"), page.websiteHomepage);
router.get("/website-content/services", ...protectedPage("websiteContent.view"), page.websiteServices);
router.get("/website-content/products", ...protectedPage("websiteContent.view"), page.websiteProducts);
router.get("/website-content/media", ...protectedPage("websiteContent.view"), page.websiteMedia);
router.get("/website-content/csv-import", ...protectedPage("websiteContent.view"), page.websiteCatalogImport);
router.get("/follow-ups", ...protectedPage("followUps.view"), page.followUps);
router.get("/follow-ups/new", ...protectedPage("followUps.create"), page.followUpCreate);
router.get("/follow-ups/:followUpId/edit", ...protectedPage("followUps.edit"), page.followUpEdit);
router.get("/communications", ...protectedPage("communications.view"), (req, res) => res.redirect(302, "/communications/whatsapp"));
router.get("/communications/whatsapp", ...protectedPage("communications.view"), communicationChannel("whatsapp"), page.communicationWhatsapp);
router.get("/communications/whatsapp/templates", ...protectedPage("communications.view"), communicationChannel("whatsapp"), page.communicationWhatsappTemplates);
router.get("/communications/whatsapp/automations", ...protectedPage("communications.view"), communicationChannel("whatsapp"), page.communicationWhatsappRules);
router.get("/communications/whatsapp/logs", ...protectedPage("communications.view"), communicationChannel("whatsapp"), page.communicationWhatsappLogs);
router.get("/communications/email", ...protectedPage("communications.view"), communicationChannel("email"), page.communicationEmail);
router.get("/communications/email/internal-alerts", ...protectedPage("communications.view"), communicationChannel("email"), page.communicationEmailInternalAlerts);
router.get("/communications/email/templates", ...protectedPage("communications.view"), communicationChannel("email"), page.communicationEmailTemplates);
router.get("/communications/email/automations", ...protectedPage("communications.view"), communicationChannel("email"), page.communicationEmailRules);
router.get("/communications/email/logs", ...protectedPage("communications.view"), communicationChannel("email"), page.communicationEmailLogs);
router.get("/communications/logs", ...protectedPage("communications.view"), (req, res) => {
  const channel = String(req.query.channel || "").toLowerCase();
  res.redirect(302, channel === "whatsapp" ? "/communications/whatsapp/logs" : "/communications/email/logs");
});
router.get("/whatsapp-inbox", ...protectedPage("communications.view"), page.whatsappInbox);
router.get("/communications/whatsapp-inbox", ...protectedPage("communications.view"), (req, res) => {
  const queryIndex = req.originalUrl.indexOf("?");
  const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";
  res.redirect(302, `/whatsapp-inbox${query}`);
});
router.get("/communications/send", ...protectedPage("communications.send"), page.communicationSend);
router.get("/communications/templates", ...protectedPage("communications.view"), (req, res) => {
  const channel = String(req.query.channel || "").toLowerCase();
  res.redirect(302, channel === "whatsapp" ? "/communications/whatsapp/templates" : "/communications/email/templates");
});
router.get("/communications/templates/new", ...protectedPage("communications.manage"), templateChannelFromQuery, page.communicationTemplateCreate);
router.get("/communications/templates/:templateId/edit", ...protectedPage("communications.manage"), templateChannelFromQuery, page.communicationTemplateEdit);
router.get("/communications/rules", ...protectedPage("communications.view"), (req, res) => {
  const channel = String(req.query.channel || "").toLowerCase();
  res.redirect(302, channel === "whatsapp" ? "/communications/whatsapp/automations" : "/communications/email/automations");
});
router.get("/communications/otp", ...protectedPage("communications.view"), page.communicationOtp);
router.get("/communications/settings", ...protectedPage("communications.manage"), (req, res) => res.redirect(302, "/communications/email"));
router.get("/communications/new", ...protectedPage("communications.send"), page.communicationCreate);
router.get("/communications/:communicationId/edit", ...protectedPage("communications.manage"), page.communicationEdit);
router.get("/communications/:communicationId", ...protectedPage("communications.view"), page.communicationShow);
router.get("/billing", ...protectedPage("billing.view"), page.invoices);
router.get("/billing/provider-subscriptions", ...protectedPage("billing.view"), page.providerSubscriptions);
router.get("/billing/new", ...protectedPage("billing.create"), page.invoiceCreate);
router.get("/billing/:invoiceId/edit", ...protectedPage("billing.edit"), page.invoiceEdit);
router.get("/provider-unlocks", ...protectedPage("provider_unlocks.view"), page.providerUnlocks);
router.get("/reports", ...protectedPage("reports.view"), page.reports);
router.get("/storage", ...protectedPage("storage.view"), page.storage);
router.get("/employees", ...protectedPage("employees.view"), page.employees);
router.get("/employees/new", ...protectedPage("employees.create"), page.employeeCreate);
router.get("/employees/:employeeId/edit", ...protectedPage("employees.edit"), page.employeeEdit);
router.get("/roles", ...protectedPage("roles.view"), page.roles);
router.get("/roles/new", ...protectedPage("roles.create"), page.roleCreate);
router.get("/roles/:roleId/edit", ...protectedPage("roles.edit"), page.roleEdit);
router.get("/search/enquiries", ...protectedPage("requirements.view"), page.enquiries);
router.get("/search/providers", ...protectedPage("providers.view"), page.providers);
router.get("/search/agents", ...protectedPage("agents.view"), page.agents);
router.get("/search/follow-ups", ...protectedPage("followUps.view"), page.followUps);
router.get("/search/communications", ...protectedPage("communications.view"), (req, res) => {
  const channel = String(req.query.channel || "").toLowerCase() === "whatsapp" ? "whatsapp" : "email";
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === "channel") continue;
    if (Array.isArray(value)) value.forEach((entry) => query.append(key, String(entry)));
    else if (value !== undefined && value !== null && String(value) !== "") query.set(key, String(value));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  res.redirect(302, `/communications/${channel}/logs${suffix}`);
});
router.get("/search/invoices", ...protectedPage("billing.view"), page.invoices);

module.exports = router;
