"use strict";

const COMPONENT_LABELS = Object.freeze({
  subject: "Email subject",
  header: "Header",
  body: "Body",
  body_html: "HTML body",
  footer: "Footer",
  button: "URL button",
});

const VARIABLE_REGISTRY = Object.freeze({
  "1": { label: "Parameter 1", description: "First dynamic value required by the template.", example: "Sample value 1" },
  "2": { label: "Parameter 2", description: "Second dynamic value required by the template.", example: "Sample value 2" },
  "3": { label: "Parameter 3", description: "Third dynamic value required by the template.", example: "Sample value 3" },
  "4": { label: "Parameter 4", description: "Fourth dynamic value required by the template.", example: "Sample value 4" },
  "5": { label: "Parameter 5", description: "Fifth dynamic value required by the template.", example: "Sample value 5" },
  "6": { label: "Parameter 6", description: "Sixth dynamic value required by the template.", example: "Sample value 6" },
  "7": { label: "Parameter 7", description: "Seventh dynamic value required by the template.", example: "Sample value 7" },
  "8": { label: "Parameter 8", description: "Eighth dynamic value required by the template.", example: "Sample value 8" },
  "9": { label: "Parameter 9", description: "Ninth dynamic value required by the template.", example: "Sample value 9" },
  "10": { label: "Parameter 10", description: "Tenth dynamic value required by the template.", example: "Sample value 10" },
  customer_name: { label: "Customer name", description: "Name of the customer linked to the enquiry.", example: "Amit Sharma" },
  lead_id: { label: "Lead ID", description: "Unique CRM enquiry or lead reference.", example: "FND-ENQ-10245" },
  requirement_title: { label: "Requirement title", description: "Short summary of the customer's requirement.", example: "Interior wall painting required" },
  service_type: { label: "Service type", description: "Primary service requested for the lead.", example: "Painter" },
  service_types: { label: "Service types", description: "All services selected for the lead.", example: "Painter, Waterproofing" },
  service_name: { label: "Service name", description: "Service or category matched to the provider.", example: "Painting Services" },
  priority: { label: "Priority", description: "Priority assigned to the enquiry.", example: "Normal" },
  lead_status: { label: "Lead status", description: "Current CRM status of the enquiry.", example: "Approved" },
  category: { label: "Category", description: "Category assigned to the lead or account.", example: "Home Services" },
  provider_name: { label: "Provider name", description: "Name of the provider receiving the communication.", example: "Dhiraj Services" },
  provider_id: { label: "Provider ID", description: "Unique provider account reference.", example: "PRV-1024" },
  note: { label: "Note", description: "Internal or contextual note supplied by the event.", example: "Follow up tomorrow" },
  lead_location: { label: "Lead location", description: "Customer city, state and PIN code for the lead.", example: "Malad West, Mumbai, 400064" },
  lead_url: { label: "Lead URL", description: "Complete Provider Portal URL for the lead.", example: "https://provider.findoly.com/lead/FND-ENQ-10245" },
  lead_url_suffix: { label: "Lead URL suffix", description: "Dynamic lead ID or suffix appended to a template URL button.", example: "FND-ENQ-10245" },
  business_name: { label: "Business name", description: "Registered provider or partner business name.", example: "Dhiraj Home Services" },
  email: { label: "Email", description: "Email address supplied by the event.", example: "contact@example.com" },
  phone: { label: "Phone", description: "Mobile or WhatsApp number supplied by the event.", example: "919876543210" },
  status: { label: "Status", description: "Current account or workflow status.", example: "Active" },
  onboarding_stage: { label: "Onboarding stage", description: "Current provider onboarding stage.", example: "Profile completed" },
  service_categories: { label: "Service categories", description: "Categories assigned to the provider.", example: "Painting, Plumbing" },
  service_location: { label: "Service location", description: "Primary service area configured for the provider.", example: "Mumbai" },
  city: { label: "City", description: "City supplied by the event.", example: "Mumbai" },
  state: { label: "State", description: "State supplied by the event.", example: "Maharashtra" },
  login_url: { label: "Login URL", description: "Portal sign-in URL for the recipient.", example: "https://provider.findoly.com/login" },
  support_email: { label: "Support email", description: "Findoly support email address.", example: "support@findoly.com" },
  registration_date: { label: "Registration date", description: "Date the account was created.", example: "5 August 2026" },
  agent_name: { label: "Partner name", description: "Name of the Partner who submitted the enquiry.", example: "Rishabh" },
  agent_id: { label: "Partner ID", description: "Unique Partner account reference used by CRM.", example: "AGT-1008" },
  referral_id: { label: "Referral ID", description: "Partner referral reference linked to the enquiry.", example: "REF-2048" },
  agent_type: { label: "Partner type", description: "Classification of the Partner account.", example: "Referral partner" },
  category_name: { label: "Category name", description: "Primary category assigned to the Partner.", example: "Painting" },
  assigned_location: { label: "Assigned location", description: "Location assigned to the Partner account.", example: "Mumbai" },
  employee_name: { label: "Employee name", description: "Name of the employee linked to the event.", example: "Anita Patel" },
  employee_id: { label: "Employee ID", description: "Unique employee record reference.", example: "EMP-101" },
  employee_code: { label: "Employee code", description: "Internal employee code.", example: "FND-EMP-101" },
  designation: { label: "Designation", description: "Employee job title.", example: "Operations Executive" },
  department: { label: "Department", description: "Employee department.", example: "Operations" },
  role_name: { label: "Role name", description: "CRM role assigned to the employee.", example: "Operations Manager" },
  source_channel: { label: "Source channel", description: "Channel through which the lead was created.", example: "Partner" },
  source_website: { label: "Source website", description: "Portal or website that submitted the lead.", example: "partner.findoly.com" },
});

function humanizeKey(value) {
  return String(value || "")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function metadataForKey(key) {
  const normalized = String(key || "").trim();
  const known = VARIABLE_REGISTRY[normalized] || {};
  return {
    key: normalized,
    label: known.label || humanizeKey(normalized) || "Variable",
    description: known.description || "Dynamic value supplied by the selected communication event.",
    example: known.example || "",
  };
}

function uniqueKeys(values) {
  const result = [];
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const key = String(value || "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(key);
  });
  return result;
}

function metadataForKeys(keys) {
  return uniqueKeys(keys).map(metadataForKey);
}

function placeholderMatches(value) {
  return Array.from(String(value || "").matchAll(/{{\s*([A-Za-z0-9_.-]+)\s*}}/g), (match) => match[1]);
}

function componentLabel(component) {
  return COMPONENT_LABELS[String(component || "").toLowerCase()] || humanizeKey(component);
}

function enrichParameterDefinitions(definitions, sampleVariables = []) {
  return (Array.isArray(definitions) ? definitions : []).map((definition, index) => {
    const source = definition && typeof definition === "object" ? definition : {};
    const key = String(source.placeholder || source.key || index + 1).trim();
    const metadata = metadataForKey(key);
    const component = String(source.component || "body").toLowerCase();
    const suppliedExample = sampleVariables[index] ?? source.example ?? "";
    return {
      ...source,
      position: Number.isInteger(Number(source.position)) ? Number(source.position) : index + 1,
      component,
      componentLabel: componentLabel(component),
      placeholder: key,
      variable: `{{${key}}}`,
      label: String(source.label || "").trim() || metadata.label,
      description: String(source.description || "").trim() || metadata.description,
      example: String(suppliedExample || metadata.example || "").trim(),
    };
  });
}

function detectEmailVariables(template = {}) {
  const definitions = [];
  const seen = new Set();
  const add = (component, value) => {
    placeholderMatches(value).forEach((key) => {
      if (seen.has(key)) return;
      seen.add(key);
      const metadata = metadataForKey(key);
      definitions.push({
        position: definitions.length + 1,
        component,
        componentLabel: componentLabel(component),
        placeholder: key,
        variable: `{{${key}}}`,
        label: metadata.label,
        description: metadata.description,
        example: metadata.example,
      });
    });
  };
  add("subject", template.subject);
  add("header", template.headerText);
  add("body", template.body);
  add("body_html", template.bodyHtml);
  add("footer", template.footer);
  return definitions;
}

function detectWhatsappVariables(template = {}) {
  const definitions = [];
  const add = (component, value, extra = {}) => {
    placeholderMatches(value).forEach((key) => {
      const metadata = metadataForKey(key);
      definitions.push({
        position: definitions.length + 1,
        component,
        componentLabel: componentLabel(component),
        placeholder: key,
        variable: `{{${key}}}`,
        label: extra.label || metadata.label,
        description: metadata.description,
        example: metadata.example,
        ...extra,
      });
    });
  };
  add("header", template.headerText);
  add("body", template.body);
  add("footer", template.footer);
  (Array.isArray(template.buttons) ? template.buttons : []).forEach((button, index) => {
    const type = String(button?.type || button?.buttonType || "").toUpperCase();
    if (!type.includes("URL")) return;
    add("button", button?.url || button?.value || "", {
      buttonIndex: Number.isInteger(Number(button?.index)) ? Number(button.index) : index,
      label: `${button?.text || button?.title || `Button ${index + 1}`} URL`,
    });
  });
  return enrichParameterDefinitions(definitions, template.sampleVariables);
}

function templateVariableDefinitions(template = {}) {
  if (String(template.channel || "").toLowerCase() === "email") {
    return detectEmailVariables(template);
  }
  if (Array.isArray(template.parameterDefinitions) && template.parameterDefinitions.length) {
    return enrichParameterDefinitions(template.parameterDefinitions, template.sampleVariables);
  }
  return detectWhatsappVariables(template);
}

module.exports = {
  VARIABLE_REGISTRY,
  metadataForKey,
  metadataForKeys,
  placeholderMatches,
  enrichParameterDefinitions,
  detectEmailVariables,
  detectWhatsappVariables,
  templateVariableDefinitions,
  humanizeKey,
  componentLabel,
};
