const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

process.env.SKIP_DB = "true";

const { normalizeMobile, validateMobile } = require("../utils/mobile");
const {
  normalizeInput: normalizeLead,
  normalizeMetadata,
  assertReferenceIdUnchanged,
  distributionData,
  presentEnquiry,
} = require("../services/enquiry/enquiry-service");
const {
  normalizeProviderInput,
  assertProviderIdUnchanged,
} = require("../services/provider/provider-service");
const {
  normalizeCategoryInput,
  slugify,
} = require("../services/catalog/catalog-service");
const {
  normalizeFollowUpInput,
  assertFollowUpIdUnchanged,
} = require("../services/follow-up/follow-up-service");
const {
  normalizeCommunicationInput,
  normalizeRecipientContact,
  assertCommunicationIdUnchanged,
} = require("../services/communication/communication-service");
const {
  calculate,
  normalizeInvoiceItems,
  normalizeInvoiceInput,
  assertInvoiceIdUnchanged,
  generateInvoiceNumber,
} = require("../services/invoice/invoice-service");

function expect400(fn, pattern = /./) {
  assert.throws(fn, (error) => {
    assert.equal(error.status, 400);
    assert.match(error.message, pattern);
    return true;
  });
}

const validLead = Object.freeze({
  name: "Asha Customer",
  mobile: "+91 98765 43210",
  email: "ASHA@example.com",
  category: "Home Painting",
  categorySlug: "home-painting",
  requirementTitle: "Paint a two bedroom home",
  priority: "high",
  pincode: "400001",
  preferredDate: "2026-08-01",
  leadPricePaise: 15000,
  additionalDetails: { rooms: 2, occupied: true },
  metadata: { campaignCode: "JULY" },
});

const mobileCases = [
  ["mobile accepts a plain ten-digit number", () => assert.equal(normalizeMobile("9876543210"), "9876543210")],
  ["mobile strips an Indian country code", () => assert.equal(normalizeMobile("+91 98765-43210"), "9876543210")],
  ["mobile strips a leading zero", () => assert.equal(normalizeMobile("09876543210"), "9876543210")],
  ["mobile accepts parentheses formatting", () => assert.equal(normalizeMobile("(+91) 98765 43210"), "9876543210")],
  ["mobile rejects letters instead of silently stripping them", () => expect400(() => validateMobile("98765abc10"), /only digits and phone formatting/)],
  ["mobile rejects nine digits", () => expect400(() => validateMobile("987654321"), /exactly 10 digits/)],
  ["mobile rejects eleven digits without a supported prefix", () => expect400(() => validateMobile("19876543210"), /exactly 10 digits/)],
  ["mobile rejects excessively long formatted input", () => expect400(() => validateMobile("9".repeat(31)), /too long/)],
];
for (const [name, fn] of mobileCases) test(name, fn);

const leadCases = [
  ["lead normalizer accepts valid lead data", () => {
    const result = normalizeLead(validLead);
    assert.equal(result.mobile, "9876543210");
    assert.equal(result.email, "asha@example.com");
    assert.equal(result.currency, "INR");
    assert.equal(result.leadPricePaise, 15000);
  }],
  ["lead normalizer defaults priority, source and lead price", () => {
    const result = normalizeLead({
      name: "Customer",
      mobile: "9876543210",
      categorySlug: "painting",
      requirementTitle: "Painting required",
    });
    assert.equal(result.priority, "normal");
    assert.equal(result.leadPricePaise, 10000);
    assert.equal(result.sourceWebsite, "manual-admin");
    assert.equal(result.sourceChannel, "admin");
  }],
  ["lead normalizer rejects missing customer name", () => expect400(() => normalizeLead({ ...validLead, name: "" }), /Customer name is required/)],
  ["lead normalizer rejects missing mobile", () => expect400(() => normalizeLead({ ...validLead, mobile: "" }), /is required/)],
  ["lead normalizer rejects invalid email", () => expect400(() => normalizeLead({ ...validLead, email: "bad" }), /invalid/)],
  ["lead normalizer rejects missing category", () => expect400(() => normalizeLead({ ...validLead, categorySlug: "" }), /Category is required/)],
  ["lead normalizer rejects unsafe category slug", () => expect400(() => normalizeLead({ ...validLead, categorySlug: "home painting" }), /letters, numbers/)],
  ["lead normalizer rejects missing requirement title", () => expect400(() => normalizeLead({ ...validLead, requirementTitle: "" }), /Requirement title is required/)],
  ["lead normalizer rejects unsupported priority", () => expect400(() => normalizeLead({ ...validLead, priority: "critical" }), /must be one of/)],
  ["lead normalizer rejects invalid pincode", () => expect400(() => normalizeLead({ ...validLead, pincode: "000001" }), /exactly 6 digits/)],
  ["lead normalizer rejects invalid preferred date", () => expect400(() => normalizeLead({ ...validLead, preferredDate: "2026-02-30" }), /invalid/)],
  ["lead normalizer rejects negative lead price", () => expect400(() => normalizeLead({ ...validLead, leadPricePaise: -1 }), /at least 0/)],
  ["lead normalizer rejects decimal paise", () => expect400(() => normalizeLead({ ...validLead, leadPricePaise: 10.5 }), /whole number/)],
  ["lead normalizer rejects oversized lead price", () => expect400(() => normalizeLead({ ...validLead, leadPricePaise: 1_000_000_001 }), /must not exceed/)],
  ["lead normalizer rejects unsafe additional detail keys", () => expect400(() => normalizeLead({ ...validLead, additionalDetails: { $where: "x" } }), /unsafe field/)],
  ["lead normalizer rejects oversized notes", () => expect400(() => normalizeLead({ ...validLead, notes: "x".repeat(5001) }), /must not exceed 5000/)],
  ["lead normalizer preserves internal journey metadata", () => {
    const current = { ...normalizeLead(validLead), metadata: { rejectedFromStatus: "approved", old: "value" } };
    const result = normalizeLead({ metadata: { campaign: "new", rejectedFromStatus: "new" } }, current);
    assert.equal(result.metadata.rejectedFromStatus, "approved");
    assert.equal(result.metadata.campaign, "new");
  }],
  ["lead metadata removes client-supplied internal fields when no existing value exists", () => {
    assert.deepEqual(normalizeMetadata({ rejectedFromStatus: "approved", public: "ok" }), { public: "ok" });
  }],
  ["lead normalizer can edit a presented legacy lead without replacing correct values", () => {
    const current = presentEnquiry({
      id: "legacy-1",
      customer: { name: "Legacy", mobile: "9876543210", email: "legacy@example.com" },
      category: { name: "Painting", slug: "painting" },
      address: { city: "Mumbai", pincode: "400001" },
      requirementTitle: "Legacy requirement",
      status: "new",
    });
    const result = normalizeLead({ notes: "Reviewed" }, current);
    assert.equal(result.name, "Legacy");
    assert.equal(result.categorySlug, "painting");
    assert.equal(result.city, "Mumbai");
  }],
  ["lead presentation supports legacy nested customer data", () => {
    const result = presentEnquiry({
      id: "legacy-1",
      customer: { name: "Legacy", mobile: "9876543210" },
      category: { name: "Painting", slug: "painting" },
      address: { city: "Mumbai" },
      status: "verified",
    });
    assert.equal(result.enquiryId, "legacy-1");
    assert.equal(result.name, "Legacy");
    assert.equal(result.categorySlug, "painting");
    assert.equal(result.journeyStatus, "verification");
  }],
  ["lead reference guard accepts matching reference IDs", () => assert.doesNotThrow(() => assertReferenceIdUnchanged({ enquiryId: "REQ-1", _id: "db1" }, { enquiryId: "REQ-1", id: "REQ-1", _id: "db1" }))],
  ["lead reference guard rejects changed reference ID", () => expect400(() => assertReferenceIdUnchanged({ enquiryId: "REQ-1" }, { enquiryId: "REQ-2" }), /cannot be changed/)],
  ["lead reference guard rejects changed legacy ID", () => expect400(() => assertReferenceIdUnchanged({ enquiryId: "REQ-1" }, { id: "REQ-2" }), /cannot be changed/)],
  ["lead reference guard rejects changed database ID", () => expect400(() => assertReferenceIdUnchanged({ enquiryId: "REQ-1", _id: "db1" }, { _id: "db2" }), /database ID cannot be changed/)],
  ["distribution data keeps provider portal contract fields", () => {
    const result = distributionData(normalizeLead(validLead), {
      providerId: "provider-1",
      name: "Painter",
      businessName: "Paint Co",
      mobile: "9876543210",
    });
    assert.equal(result.providerId, "provider-1");
    assert.equal(result.customerMobile, "9876543210");
    assert.equal(result.leadPricePaise, 15000);
    assert.equal(result.currency, "INR");
  }],
  ["distribution data rejects invalid stored lead price", () => expect400(() => distributionData({ ...validLead, enquiryId: "REQ-1", leadPricePaise: -1 }, { providerId: "p1" }), /at least 0/)],
];
for (const [name, fn] of leadCases) test(name, fn);

const validProvider = Object.freeze({
  name: "Ravi Provider",
  mobile: "+91 98765 43210",
  email: "RAVI@example.com",
  categorySlugs: ["painting", "plumbing"],
  status: "active",
  onboardingStage: "ready",
  rating: 4.5,
  documentsVerified: "true",
  portalAccessEnabled: "false",
});

const providerCases = [
  ["provider normalizer accepts valid data", () => {
    const result = normalizeProviderInput(validProvider);
    assert.equal(result.mobile, "9876543210");
    assert.equal(result.email, "ravi@example.com");
    assert.equal(result.documentsVerified, true);
    assert.equal(result.portalAccessEnabled, false);
  }],
  ["provider normalizer deduplicates categories", () => assert.deepEqual(normalizeProviderInput({ ...validProvider, categorySlugs: ["painting", "painting"] }).categorySlugs, ["painting"])],
  ["provider normalizer parses comma-separated skills", () => assert.deepEqual(normalizeProviderInput({ ...validProvider, skills: "spray, brush" }).skills, ["spray", "brush"])],
  ["provider normalizer rejects missing name", () => expect400(() => normalizeProviderInput({ ...validProvider, name: "" }), /Provider name is required/)],
  ["provider normalizer rejects invalid mobile", () => expect400(() => normalizeProviderInput({ ...validProvider, mobile: "123" }), /exactly 10 digits/)],
  ["provider normalizer rejects invalid email", () => expect400(() => normalizeProviderInput({ ...validProvider, email: "ravi" }), /invalid/)],
  ["provider normalizer requires at least one category", () => expect400(() => normalizeProviderInput({ ...validProvider, categorySlugs: [] }), /at least one item/)],
  ["provider normalizer rejects unsafe category slug", () => expect400(() => normalizeProviderInput({ ...validProvider, categorySlugs: ["home repair"] }), /letters, numbers/)],
  ["provider normalizer rejects unsupported status", () => expect400(() => normalizeProviderInput({ ...validProvider, status: "deleted" }), /must be one of/)],
  ["provider normalizer rejects unsupported onboarding stage", () => expect400(() => normalizeProviderInput({ ...validProvider, onboardingStage: "complete" }), /must be one of/)],
  ["provider normalizer rejects negative rating", () => expect400(() => normalizeProviderInput({ ...validProvider, rating: -1 }), /at least 0/)],
  ["provider normalizer rejects rating over five", () => expect400(() => normalizeProviderInput({ ...validProvider, rating: 5.1 }), /must not exceed 5/)],
  ["provider normalizer rejects more than 100 service areas", () => expect400(() => normalizeProviderInput({ ...validProvider, serviceAreas: Array.from({ length: 101 }, (_, i) => `area-${i}`) }), /more than 100/)],
  ["provider ID guard accepts unchanged values", () => assert.doesNotThrow(() => assertProviderIdUnchanged({ providerId: "p1", _id: "db1" }, { providerId: "p1", id: "p1", _id: "db1" }))],
  ["provider ID guard rejects changed provider ID", () => expect400(() => assertProviderIdUnchanged({ providerId: "p1" }, { providerId: "p2" }), /cannot be changed/)],
  ["provider ID guard rejects changed database ID", () => expect400(() => assertProviderIdUnchanged({ providerId: "p1", _id: "db1" }, { _id: "db2" }), /database ID cannot be changed/)],
];
for (const [name, fn] of providerCases) test(name, fn);

const categoryCases = [
  ["category slugify creates a stable lowercase token", () => assert.equal(slugify(" Home & Office Painting "), "home-office-painting")],
  ["category normalizer generates slug from name", () => assert.equal(normalizeCategoryInput({ name: "AC Repair" }).slug, "ac-repair")],
  ["category normalizer parses string false correctly", () => assert.equal(normalizeCategoryInput({ name: "AC Repair", active: "false" }).active, false)],
  ["category normalizer rejects missing name", () => expect400(() => normalizeCategoryInput({ name: "" }), /required/)],
  ["category normalizer rejects invalid explicit slug", () => expect400(() => normalizeCategoryInput({ name: "AC", slug: "AC Repair" }), /letters, numbers/)],
  ["category normalizer keeps existing slug on edit", () => assert.equal(normalizeCategoryInput({ name: "New Name" }, { name: "Old", slug: "old-slug", active: true }).slug, "old-slug")],
  ["category normalizer blocks slug changes", () => expect400(() => normalizeCategoryInput({ slug: "new-slug" }, { name: "Old", slug: "old-slug", active: true }), /cannot be changed/)],
  ["category normalizer limits description length", () => expect400(() => normalizeCategoryInput({ name: "AC", description: "x".repeat(2001) }), /must not exceed 2000/)],
];
for (const [name, fn] of categoryCases) test(name, fn);

const followUpCases = [
  ["follow-up normalizer accepts valid data", () => {
    const result = normalizeFollowUpInput({ title: "Call customer", dueAt: "2026-07-13T10:00", channel: "whatsapp", status: "pending" });
    assert.equal(result.channel, "whatsapp");
    assert.equal(result.status, "pending");
  }],
  ["follow-up normalizer defaults owner channel and status", () => {
    const result = normalizeFollowUpInput({ title: "Call customer" });
    assert.equal(result.owner, "admin");
    assert.equal(result.channel, "call");
    assert.equal(result.status, "open");
  }],
  ["follow-up normalizer requires a title", () => expect400(() => normalizeFollowUpInput({ title: "" }), /required/)],
  ["follow-up normalizer rejects invalid date", () => expect400(() => normalizeFollowUpInput({ title: "Call", dueAt: "tomorrow-ish" }), /invalid/)],
  ["follow-up normalizer rejects invalid channel", () => expect400(() => normalizeFollowUpInput({ title: "Call", channel: "sms" }), /must be one of/)],
  ["follow-up normalizer rejects invalid status", () => expect400(() => normalizeFollowUpInput({ title: "Call", status: "deleted" }), /must be one of/)],
  ["follow-up normalizer rejects invalid lead identifier", () => expect400(() => normalizeFollowUpInput({ title: "Call", enquiryId: "bad id" }), /invalid/)],
  ["follow-up ID guard rejects changed ID", () => expect400(() => assertFollowUpIdUnchanged({ followUpId: "f1" }, { followUpId: "f2" }), /cannot be changed/)],
  ["follow-up ID guard accepts unchanged ID", () => assert.doesNotThrow(() => assertFollowUpIdUnchanged({ followUpId: "f1" }, { id: "f1" }))],
];
for (const [name, fn] of followUpCases) test(name, fn);

const communicationCases = [
  ["communication normalizer accepts call mobile", () => assert.equal(normalizeCommunicationInput({ channel: "call", recipientContact: "+91 98765 43210" }).recipientContact, "9876543210")],
  ["communication normalizer accepts and lowercases email", () => assert.equal(normalizeCommunicationInput({ channel: "email", recipientContact: "USER@Example.com" }).recipientContact, "user@example.com")],
  ["communication normalizer defaults direction and status", () => {
    const result = normalizeCommunicationInput({ channel: "sms", recipientContact: "9876543210" });
    assert.equal(result.direction, "outbound");
    assert.equal(result.status, "logged");
  }],
  ["communication normalizer rejects unsupported channel", () => expect400(() => normalizeCommunicationInput({ channel: "telegram" }), /must be one of/)],
  ["communication normalizer rejects unsupported direction", () => expect400(() => normalizeCommunicationInput({ channel: "call", direction: "sideways" }), /must be one of/)],
  ["communication normalizer rejects email on phone channel", () => expect400(() => normalizeCommunicationInput({ channel: "call", recipientContact: "user@example.com" }), /only digits and phone formatting/)],
  ["communication normalizer rejects mobile on email channel", () => expect400(() => normalizeCommunicationInput({ channel: "email", recipientContact: "9876543210" }), /invalid/)],
  ["communication contact permits empty optional value", () => assert.equal(normalizeRecipientContact("", "call"), "")],
  ["communication normalizer limits message size", () => expect400(() => normalizeCommunicationInput({ channel: "call", message: "x".repeat(10001) }), /must not exceed 10000/)],
  ["communication ID guard rejects changed ID", () => expect400(() => assertCommunicationIdUnchanged({ communicationId: "c1" }, { communicationId: "c2" }), /cannot be changed/)],
  ["communication ID guard accepts matching legacy ID", () => assert.doesNotThrow(() => assertCommunicationIdUnchanged({ communicationId: "c1" }, { id: "c1" }))],
];
for (const [name, fn] of communicationCases) test(name, fn);

const invoiceCases = [
  ["invoice calculator computes subtotal discount tax and total", () => {
    const result = calculate({ items: [{ description: "Service", qty: 2, rate: 500 }], discount: 100, tax: 180 });
    assert.deepEqual({ subtotal: result.subtotal, discount: result.discount, tax: result.tax, total: result.total }, { subtotal: 1000, discount: 100, tax: 180, total: 1080 });
  }],
  ["invoice calculator rounds currency values", () => assert.equal(calculate({ items: [{ description: "Service", qty: 3, rate: 0.1 }] }).subtotal, 0.3)],
  ["invoice total never becomes negative", () => assert.equal(calculate({ items: [{ description: "Service", qty: 1, rate: 10 }], discount: 50 }).total, 0)],
  ["invoice item normalizer requires at least one item", () => expect400(() => normalizeInvoiceItems([]), /at least one item/)],
  ["invoice item normalizer rejects more than 100 items", () => expect400(() => normalizeInvoiceItems(Array.from({ length: 101 }, () => ({ description: "x", qty: 1, rate: 1 }))), /more than 100/)],
  ["invoice item normalizer rejects non-object items", () => expect400(() => normalizeInvoiceItems(["service"]), /invalid/)],
  ["invoice item normalizer requires description", () => expect400(() => normalizeInvoiceItems([{ description: "", qty: 1, rate: 1 }]), /required/)],
  ["invoice item normalizer rejects zero quantity", () => expect400(() => normalizeInvoiceItems([{ description: "x", qty: 0, rate: 1 }]), /at least 0.01/)],
  ["invoice item normalizer rejects negative rate", () => expect400(() => normalizeInvoiceItems([{ description: "x", qty: 1, rate: -1 }]), /at least 0/)],
  ["invoice normalizer generates a number for blank UI input", () => assert.match(normalizeInvoiceInput({ invoiceNo: "", items: [{ description: "x", qty: 1, rate: 1 }] }).invoiceNo, /^INV-\d+-[A-F0-9]{6}$/)],
  ["invoice normalizer preserves an existing number on edit", () => assert.equal(normalizeInvoiceInput({ invoiceNo: "", items: [{ description: "x", qty: 1, rate: 1 }] }, { invoiceNo: "INV-OLD" }).invoiceNo, "INV-OLD")],
  ["invoice normalizer rejects due date before issue date", () => expect400(() => normalizeInvoiceInput({ issueDate: "2026-07-12", dueDate: "2026-07-11", items: [{ description: "x", qty: 1, rate: 1 }] }), /cannot be before/)],
  ["invoice normalizer rejects unsupported status", () => expect400(() => normalizeInvoiceInput({ status: "refunded", items: [{ description: "x", qty: 1, rate: 1 }] }), /must be one of/)],
  ["invoice number generator creates distinct practical identifiers", () => {
    const one = generateInvoiceNumber();
    const two = generateInvoiceNumber();
    assert.match(one, /^INV-\d+-[A-F0-9]{6}$/);
    assert.notEqual(one, two);
  }],
  ["invoice ID guard rejects changed ID", () => expect400(() => assertInvoiceIdUnchanged({ invoiceId: "i1" }, { invoiceId: "i2" }), /cannot be changed/)],
  ["invoice ID guard accepts unchanged ID", () => assert.doesNotThrow(() => assertInvoiceIdUnchanged({ invoiceId: "i1" }, { id: "i1" }))],
  ["invoice ID guard rejects changed database ID", () => expect400(() => assertInvoiceIdUnchanged({ invoiceId: "i1", _id: new mongoose.Types.ObjectId() }, { _id: new mongoose.Types.ObjectId() }), /database ID cannot be changed/)],
];
for (const [name, fn] of invoiceCases) test(name, fn);
