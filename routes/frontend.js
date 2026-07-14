const router = require("express").Router();
const page = require("../controllers/frontendController");
const { pageAuth } = require("../middleware/auth");
router.get("/login", page.login);
router.get("/", (req, res) =>
  res.redirect(req.admin ? "/dashboard" : "/login"),
);
router.get("/dashboard", pageAuth, page.dashboard);
router.get("/enquiries", pageAuth, page.enquiries);
router.get("/requirements", pageAuth, page.enquiries);
router.get("/enquiries/new", pageAuth, page.enquiryCreate);
router.get("/requirements/new", pageAuth, page.enquiryCreate);
router.get("/enquiries/:enquiryId/edit", pageAuth, page.enquiryEdit);
router.get("/requirements/:enquiryId/edit", pageAuth, page.enquiryEdit);
router.get(
  "/enquiries/:enquiryId/providers/:leadDistributionId",
  pageAuth,
  page.enquiryProviderStatusShow,
);
router.get(
  "/requirements/:enquiryId/providers/:leadDistributionId",
  pageAuth,
  page.enquiryProviderStatusShow,
);
router.get(
  "/enquiries/:enquiryId/providers",
  pageAuth,
  page.enquiryProviderStatuses,
);
router.get(
  "/requirements/:enquiryId/providers",
  pageAuth,
  page.enquiryProviderStatuses,
);
router.get("/enquiries/:enquiryId", pageAuth, page.enquiryShow);
router.get("/requirements/:enquiryId", pageAuth, page.enquiryShow);
router.get("/providers", pageAuth, page.providers);
router.get("/agents", pageAuth, page.agents);
router.get("/agents/new", pageAuth, page.agentCreate);
router.get("/agents/:agentId/edit", pageAuth, page.agentEdit);
router.get("/agents/:agentId", pageAuth, page.agentShow);
router.get("/partner-withdrawals", pageAuth, page.partnerWithdrawals);
router.get("/partner-withdrawals/:withdrawalId", pageAuth, page.partnerWithdrawalShow);
router.get("/categories", pageAuth, page.categories);
router.get("/providers/new", pageAuth, page.providerCreate);
router.get("/providers/:providerId/edit", pageAuth, page.providerEdit);
router.get("/providers/:providerId", pageAuth, page.providerShow);
router.get("/follow-ups", pageAuth, page.followUps);
router.get("/follow-ups/new", pageAuth, page.followUpCreate);
router.get("/follow-ups/:followUpId/edit", pageAuth, page.followUpEdit);
router.get("/communications", pageAuth, page.communications);
router.get("/communications/logs", pageAuth, page.communicationLogs);
router.get("/communications/send", pageAuth, page.communicationSend);
router.get("/communications/templates", pageAuth, page.communicationTemplates);
router.get("/communications/templates/new", pageAuth, page.communicationTemplateCreate);
router.get("/communications/templates/:templateId/edit", pageAuth, page.communicationTemplateEdit);
router.get("/communications/rules", pageAuth, page.communicationRules);
router.get("/communications/otp", pageAuth, page.communicationOtp);
router.get("/communications/settings", pageAuth, page.communicationSettings);
router.get("/communications/new", pageAuth, page.communicationCreate);
router.get(
  "/communications/:communicationId/edit",
  pageAuth,
  page.communicationEdit,
);
router.get("/billing", pageAuth, page.invoices);
router.get("/billing/new", pageAuth, page.invoiceCreate);
router.get("/billing/:invoiceId/edit", pageAuth, page.invoiceEdit);
router.get("/distributions", pageAuth, page.distributions);
router.get("/reports", pageAuth, page.reports);
router.get("/search/enquiries", pageAuth, page.enquiries);
router.get("/search/providers", pageAuth, page.providers);
router.get("/search/agents", pageAuth, page.agents);
router.get("/search/follow-ups", pageAuth, page.followUps);
router.get("/search/communications", pageAuth, page.communicationLogs);
router.get("/search/invoices", pageAuth, page.invoices);
module.exports = router;
