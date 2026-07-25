const crypto = require("crypto");
const Category = require("../../models/Category");
const Enquiry = require("../../models/Enquiry");
const enquiryService = require("../enquiry/enquiry-service");
const catalogService = require("../catalog/catalog-service");
const { validateMobile } = require("../../utils/mobile");
const { numberValue, plainObjectValue, pincodeValue } = require("../../utils/validation");

const CUSTOMER_VISIBLE_STATUS = Object.freeze({
  new: { key: "submitted", label: "Submitted", description: "Your enquiry has been received." },
  verification: { key: "review", label: "Under review", description: "The Findoly team is reviewing your requirement." },
  verification_pending: { key: "review", label: "Under review", description: "The Findoly team is reviewing your requirement." },
  verified: { key: "review", label: "Under review", description: "Your contact and requirement are being verified." },
  approved: { key: "matching", label: "Matching providers", description: "We are matching suitable service providers." },
  distributed: { key: "providers_notified", label: "Providers notified", description: "Eligible providers have received your enquiry." },
  in_progress: { key: "providers_notified", label: "Providers notified", description: "Service providers are reviewing your enquiry." },
  sale_converted: { key: "confirmed", label: "Service confirmed", description: "A provider has confirmed the service opportunity." },
  completed: { key: "completed", label: "Completed", description: "The enquiry has been completed." },
  closed: { key: "closed", label: "Closed", description: "The enquiry has been closed." },
  rejected: { key: "closed", label: "Closed", description: "This enquiry could not be processed." },
});

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function mobile(value) {
  return validateMobile(value, { label: "Customer mobile number" });
}

function identifier(value, label = "Reference") {
  const normalized = text(value, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(normalized)) {
    throw Object.assign(new Error(`${label} is invalid`), { status: 400 });
  }
  return normalized;
}

function presentStatus(row = {}) {
  if (row.isActive === false) {
    return {
      key: "cancelled",
      label: "Cancelled",
      description: "This enquiry was cancelled.",
    };
  }
  const raw = String(row.status || "new").toLowerCase();
  return CUSTOMER_VISIBLE_STATUS[raw] || CUSTOMER_VISIBLE_STATUS.new;
}

function presentCustomerEnquiry(row = {}) {
  const status = presentStatus(row);
  return {
    enquiryId: row.enquiryId || row.id || "",
    requirementTitle: row.requirementTitle || "",
    category: row.category || "",
    categorySlug: row.categorySlug || "",
    serviceType: row.serviceType || "",
    city: row.city || "",
    state: row.state || "",
    pincode: row.pincode || "",
    preferredDate: row.preferredDate || "",
    preferredSlot: row.preferredSlot || "",
    notes: row.notes || "",
    additionalDetails: row.additionalDetails || {},
    status,
    providerActivityCount: Number(row.distributionCount || 0),
    providerUnlockedCount: Number(row.unlockedCount || 0),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    canCancel:
      row.isActive !== false &&
      Number(row.unlockedCount || 0) === 0 &&
      ["new", "verification", "verification_pending", "verified", "approved"].includes(
        String(row.status || "new").toLowerCase(),
      ),
  };
}

async function categories() {
  const rows = await catalogService.listCategories({ includeInactive: false });
  return rows
    .filter((row) => row.active !== false)
    .map((row) => ({
      categoryId: row.categoryId || "",
      name: row.name || "",
      slug: row.slug || "",
      description: row.description || "",
    }));
}

async function createEnquiry(input = {}) {
  const normalizedMobile = mobile(input.mobile);
  const externalEnquiryId = identifier(
    input.externalEnquiryId || crypto.randomUUID(),
    "Submission reference",
  );

  const existing = await Enquiry.findOne({
    externalEnquiryId,
    sourceChannel: "customer-website",
  }).lean();
  if (existing) {
    if (existing.mobile !== normalizedMobile) {
      throw Object.assign(new Error("Submission reference already exists"), {
        status: 409,
      });
    }
    return presentCustomerEnquiry(existing);
  }

  const categorySlug = text(input.categorySlug, 80).toLowerCase();
  const category = await Category.findOne({
    slug: categorySlug,
    active: { $ne: false },
  }).lean();

  const created = await enquiryService.create(
    {
      name: text(input.name, 120),
      mobile: normalizedMobile,
      addressLine: text(input.addressLine, 500),
      city: text(input.city, 100),
      state: text(input.state, 100),
      pincode: pincodeValue(input.pincode, { label: "Pincode", required: true }),
      category: category?.name || text(input.category, 120) || categorySlug,
      categorySlug,
      serviceType: text(input.serviceType, 120),
      requirementTitle: text(input.requirementTitle, 200),
      preferredDate: text(input.preferredDate, 10),
      preferredSlot: text(input.preferredSlot, 100),
      priority: ["low", "normal", "high", "urgent"].includes(input.priority)
        ? input.priority
        : "normal",
      notes: text(input.notes, 5000),
      additionalDetails: plainObjectValue(input.additionalDetails, {
        label: "Additional details",
        fallback: {},
        maxKeys: 100,
        maxDepth: 6,
        maxArrayLength: 100,
        maxBytes: 50_000,
      }),
      sourceWebsite: "findoly.com",
      sourceChannel: "customer-website",
      sourceType: "direct-customer",
      sourceName: "Findoly Customer Website",
      externalEnquiryId,
      metadata: {
        customerPortalSubmission: true,
        customerMobileVerified: true,
        customerPortalVersion: "1.0",
      },
    },
    "customer-portal",
  );

  const now = new Date();
  await Enquiry.updateOne(
    { enquiryId: created.enquiryId },
    {
      $set: {
        customerMobileVerified: true,
        customerMobileVerifiedAt: now,
        updatedAt: now,
      },
      $push: {
        timeline: {
          timelineId: crypto.randomUUID(),
          type: "customer_mobile_verified",
          message: "Customer mobile verified through Findoly Customer Website",
          actor: "customer-portal",
          createdAt: now,
        },
      },
    },
  );

  return getEnquiry(normalizedMobile, created.enquiryId);
}

async function listEnquiries(mobileInput, options = {}) {
  const normalizedMobile = mobile(mobileInput);
  const limit = numberValue(options.limit, { label: "Enquiry list limit", fallback: 25, min: 1, max: 50, integer: true });
  const rows = await Enquiry.find({ mobile: normalizedMobile })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .lean();
  return rows.map(presentCustomerEnquiry);
}

async function getEnquiry(mobileInput, enquiryId) {
  const normalizedMobile = mobile(mobileInput);
  const reference = identifier(enquiryId, "Enquiry reference");
  const row = await Enquiry.findOne({
    mobile: normalizedMobile,
    $or: [{ enquiryId: reference }, { id: reference }],
  }).lean();
  if (!row) {
    throw Object.assign(new Error("Enquiry not found"), { status: 404 });
  }
  return presentCustomerEnquiry(row);
}

async function cancelEnquiry(mobileInput, enquiryId) {
  const normalizedMobile = mobile(mobileInput);
  const reference = identifier(enquiryId, "Enquiry reference");
  const row = await Enquiry.findOne({
    mobile: normalizedMobile,
    $or: [{ enquiryId: reference }, { id: reference }],
  }).lean();
  if (!row) {
    throw Object.assign(new Error("Enquiry not found"), { status: 404 });
  }
  if (!presentCustomerEnquiry(row).canCancel) {
    throw Object.assign(
      new Error("This enquiry can no longer be cancelled online"),
      { status: 409 },
    );
  }

  await enquiryService.setActiveState(
    row.enquiryId || row.id,
    false,
    { reason: "Cancelled by customer from Findoly Customer Website" },
    "customer-portal",
  );
  return getEnquiry(normalizedMobile, row.enquiryId || row.id);
}

module.exports = {
  categories,
  createEnquiry,
  listEnquiries,
  getEnquiry,
  cancelEnquiry,
  presentCustomerEnquiry,
  presentStatus,
};
