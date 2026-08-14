const crypto = require("crypto");
const Category = require("../../models/Category");
const ServiceType = require("../../models/ServiceType");
const Enquiry = require("../../models/Enquiry");
const enquiryService = require("../enquiry/enquiry-service");
const catalogService = require("../catalog/catalog-service");
const websiteContentService = require("../website-content/website-content-service");
const { geocodePincode } = require("../location/geocoding-service");
const { validateMobile } = require("../../utils/mobile");
const { plainObjectValue, pincodeValue } = require("../../utils/validation");

const ENQUIRY_TIMELINE_LIMIT = 50;

const timelinePush = function (entry) {
  return { $each: [entry], $slice: -ENQUIRY_TIMELINE_LIMIT };
};

const CUSTOMER_VISIBLE_STATUS = Object.freeze({
  new: { key: "submitted", label: "Submitted", description: "Your enquiry has been received." },
  verification: { key: "review", label: "Under review", description: "The Findoly team is reviewing your requirement." },
  verification_pending: { key: "review", label: "Under review", description: "The Findoly team is reviewing your requirement." },
  verified: { key: "review", label: "Under review", description: "Your contact and requirement are being verified." },
  approved: { key: "matching", label: "Matching providers", description: "We are matching suitable service providers." },
  in_progress: { key: "providers_notified", label: "Providers notified", description: "Service providers are reviewing your enquiry." },
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
    providerActivityCount: Number(row.unlockedCount || 0),
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
  const rows = await catalogService.listCategories({ includeInactive: false, includeLegacy: false });
  return rows
    .filter((row) => row.active !== false)
    .map((row) => ({
      categoryId: row.categoryId || "",
      name: row.name || "",
      slug: row.slug || "",
      description: row.description || "",
    }));
}


async function website() {
  return websiteContentService.publicWebsite();
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

  if (input.mobileVerified !== true) {
    throw Object.assign(new Error("Customer mobile must be verified by Findoly.com before submitting the requirement"), { status: 403 });
  }

  const categorySlug = text(input.categorySlug, 80).toLowerCase();
  const serviceTypeSlug = text(input.serviceTypeSlug, 80).toLowerCase();
  const category = await Category.findOne({
    slug: categorySlug,
    active: { $ne: false },
  }).lean();
  if (!category) {
    throw Object.assign(new Error("Customer requirement category is not configured in CRM"), { status: 422, code: "CUSTOMER_CATEGORY_NOT_CONFIGURED" });
  }

  let resolvedServiceType = null;
  if (serviceTypeSlug) {
    resolvedServiceType = await ServiceType.findOne({
      categorySlug,
      slug: serviceTypeSlug,
      active: { $ne: false },
    }).lean();
  }
  if (categorySlug === "other" && serviceTypeSlug === "not-classified" && !resolvedServiceType) {
    throw Object.assign(new Error("CRM fallback subcategory other / not-classified is not configured"), { status: 503, code: "CUSTOMER_FALLBACK_NOT_CONFIGURED" });
  }

  const resolvedServiceTypeId = text(resolvedServiceType?.serviceTypeId || input.serviceTypeId, 128);
  const resolvedServiceTypeName = text(resolvedServiceType?.name || input.serviceType, 120);
  const pincode = pincodeValue(input.pincode, { label: "Pincode", required: true });
  let city = text(input.city, 100);
  let state = text(input.state, 100);
  let addressLine = text(input.addressLine, 500);
  if (!city || !state) {
    const location = await geocodePincode(pincode);
    city = city || text(location?.city || location?.district || location?.locality, 100);
    state = state || text(location?.state, 100);
    addressLine = addressLine || text(location?.formattedAddress, 500);
  }

  const created = await enquiryService.create(
    {
      name: text(input.name, 120),
      mobile: normalizedMobile,
      addressLine,
      city,
      state,
      pincode,
      category: category.name || text(input.category, 120) || categorySlug,
      categorySlug,
      serviceTypes: resolvedServiceTypeId ? [resolvedServiceTypeId] : [],
      serviceType: resolvedServiceTypeName,
      requirementTitle: text(input.requirementTitle, 200),
      preferredDate: text(input.preferredDate, 10),
      preferredSlot: text(input.preferredSlot, 100),
      priority: ["low", "normal", "high", "urgent"].includes(input.priority)
        ? input.priority
        : "normal",
      notes: text(input.notes, 5000),
      additionalDetails: {
        ...plainObjectValue(input.additionalDetails, {
          label: "Additional details",
          fallback: {},
          maxKeys: 100,
          maxDepth: 6,
          maxArrayLength: 100,
          maxBytes: 50_000,
        }),
        categorySlug,
        serviceTypeSlug,
        resolvedServiceTypeId: resolvedServiceTypeId || "",
      },
      sourceWebsite: "findoly.com",
      sourceChannel: "customer-website",
      sourceType: "direct-customer",
      sourceName: "Findoly Customer Website",
      externalEnquiryId,
      metadata: {
        customerPortalSubmission: true,
        customerMobileVerified: true,
        customerPortalVersion: "3.0",
        customerVerificationSource: "findoly.com-direct-otp",
      },
    },
    "customer-portal",
  );

  const suppliedVerifiedAt = new Date(input.mobileVerifiedAt || "");
  const now = Number.isFinite(suppliedVerifiedAt.getTime()) && suppliedVerifiedAt <= new Date() ? suppliedVerifiedAt : new Date();
  await Enquiry.updateOne(
    { enquiryId: created.enquiryId },
    {
      $set: {
        customerMobileVerified: true,
        customerMobileVerifiedAt: now,
        updatedAt: now,
      },
      $push: {
        timeline: timelinePush({
          timelineId: crypto.randomUUID(),
          type: "customer_mobile_verified",
          message: "Customer mobile verified through Findoly Customer Website",
          actor: "customer-portal",
          createdAt: now,
        }),
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
  website,
  categories,
  createEnquiry,
  listEnquiries,
  getEnquiry,
  cancelEnquiry,
  presentCustomerEnquiry,
  presentStatus,
};
