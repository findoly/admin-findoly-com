function render(view, title) {
  return (req, res) => res.render(view, { title });
}

const frontendController = {
  login: render("auth/login", "Admin login"),
  dashboard: render("dashboard/index", "Dashboard"),
  enquiries: render("enquiry/index", "Requirements"),
  enquiryCreate: render("enquiry/form", "Create requirement"),
  enquiryEdit: render("enquiry/form", "Edit requirement"),
  enquiryShow: render("enquiry/show", "Requirement details"),
  enquiryProviderStatuses: render(
    "enquiry/provider-statuses",
    "Lead provider statuses",
  ),
  enquiryProviderStatusShow: render(
    "enquiry/provider-status-show",
    "Provider lead journey",
  ),
  providers: render("provider/index", "Providers"),
  agents: render("agent/index", "Agents"),
  agentCreate: render("agent/form", "Create agent"),
  agentEdit: render("agent/form", "Edit agent"),
  agentShow: render("agent/show", "Agent details"),
  categories: render("category/index", "Categories"),
  providerCreate: render("provider/form", "Create provider"),
  providerEdit: render("provider/form", "Edit provider"),
  providerShow: render("provider/show", "Provider details"),
  followUps: render("follow-up/index", "Follow-ups"),
  followUpCreate: render("follow-up/form", "Create follow-up"),
  followUpEdit: render("follow-up/form", "Edit follow-up"),
  communications: render("communication/index", "Communications"),
  communicationCreate: render("communication/form", "Log communication"),
  communicationEdit: render("communication/form", "Edit communication"),
  invoices: render("invoice/index", "Invoices"),
  invoiceCreate: render("invoice/form", "Create invoice"),
  invoiceEdit: render("invoice/form", "Edit invoice"),
  distributions: render("distribution/index", "Lead distribution"),
  reports: render("report/index", "Reports"),
};

module.exports = frontendController;
