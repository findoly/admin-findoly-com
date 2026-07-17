const Provider = require("../../models/Provider");
const Enquiry = require("../../models/Enquiry");
const LeadDistribution = require("../../models/LeadDistribution");
const WalletTransaction = require("../../models/WalletTransaction");
const { validateMobile } = require("../../utils/mobile");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const {
  textValue,
  emailValue,
  enumValue,
  booleanValue,
  numberValue,
  tokenValue,
  identifierValue,
  stringArrayValue,
  queryTextValue,
  validationError,
} = require("../../utils/validation");
const enquiryService = require("../enquiry/enquiry-service");

const PROVIDER_STATUSES = Object.freeze([
  "active",
  "inactive",
  "pending",
  "blocked",
]);
const ONBOARDING_STAGES = Object.freeze([
  "new",
  "documents_pending",
  "training_pending",
  "ready",
  "paused",
]);
const OFFER_STATUSES = Object.freeze([
  "offered",
  "unlocked",
  "withdrawn",
  "expired",
]);
const OUTCOME_VERIFICATION_STATUSES = Object.freeze([
  "pending_review",
  "verified",
  "unable_to_verify",
  "incorrect_status",
  "under_review",
]);
const PROVIDER_REVIEW_ACTIONS = Object.freeze(["none", "warning", "suspend", "ban"]);

function categoryToken(value) {
  return tokenValue(value, {
    label: "Category",
    required: true,
    maxLength: 80,
  });
}

function normalizeProviderInput(input = {}, current = {}) {
  const mobile = validateMobile(input.mobile ?? current.mobile ?? "", {
    label: "Provider mobile number",
  });
  return {
    name: textValue(input.name ?? current.name, {
      label: "Provider name",
      required: true,
      maxLength: 120,
    }),
    businessName: textValue(input.businessName ?? current.businessName, {
      label: "Business name",
      maxLength: 160,
    }),
    mobile,
    normalizedMobile: mobile,
    email: emailValue(input.email ?? current.email, {
      label: "Provider email",
      required: false,
    }),
    status: enumValue(input.status, PROVIDER_STATUSES, {
      label: "Provider status",
      fallback: current.status || "active",
    }),
    onboardingStage: enumValue(input.onboardingStage, ONBOARDING_STAGES, {
      label: "Onboarding stage",
      fallback: current.onboardingStage || "new",
    }),
    categorySlugs: stringArrayValue(
      input.categorySlugs ?? current.categorySlugs,
      {
        label: "Provider categories",
        required: true,
        maxItems: 50,
        itemMaxLength: 80,
        itemValidator: categoryToken,
      },
    ),
    skills: stringArrayValue(input.skills ?? current.skills, {
      label: "Provider skills",
      maxItems: 100,
      itemMaxLength: 100,
    }),
    city: textValue(input.city ?? current.city, {
      label: "Provider city",
      maxLength: 100,
    }),
    state: textValue(input.state ?? current.state, {
      label: "Provider state",
      maxLength: 100,
    }),
    serviceAreas: stringArrayValue(
      input.serviceAreas ?? current.serviceAreas,
      {
        label: "Service areas",
        maxItems: 100,
        itemMaxLength: 120,
      },
    ),
    availability: textValue(input.availability ?? current.availability, {
      label: "Availability",
      fallback: "available_today",
      maxLength: 80,
    }),
    rating: numberValue(input.rating, {
      label: "Provider rating",
      fallback: current.rating ?? 0,
      min: 0,
      max: 5,
    }),
    notes: textValue(input.notes ?? current.notes, {
      label: "Provider notes",
      maxLength: 5000,
    }),
    documentsVerified: booleanValue(input.documentsVerified, {
      label: "Documents verified",
      fallback: Boolean(current.documentsVerified),
    }),
    portalAccessEnabled: booleanValue(input.portalAccessEnabled, {
      label: "Portal access",
      fallback: current.portalAccessEnabled !== false,
    }),
    updatedAt: new Date(),
  };
}

function presentProvider(row = {}) {
  return {
    ...row,
    providerId: row.providerId || row.id || "",
  };
}

function providerQuery(providerId) {
  const value = identifierValue(providerId, { label: "Provider ID" });
  return { $or: [{ providerId: value }, { id: value }] };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertProviderIdUnchanged(existing, input = {}) {
  const reference = String(existing.providerId || existing.id || "");
  for (const field of ["providerId", "id"]) {
    if (input[field] === undefined || input[field] === null) continue;
    if (String(input[field]) !== reference) {
      throw validationError("Provider ID cannot be changed");
    }
  }
  if (
    input._id !== undefined &&
    input._id !== null &&
    String(input._id) !== String(existing._id || "")
  ) {
    throw validationError("Provider database ID cannot be changed");
  }
}

async function list(filters = {}) {
  const { limit, cursor } = getPagination(filters);
  const query = {};

  if (filters.status) {
    query.status = enumValue(filters.status, PROVIDER_STATUSES, {
      label: "Provider status filter",
    });
  }
  if (filters.categorySlug) {
    query.categorySlugs = categoryToken(filters.categorySlug);
  }
  const city = queryTextValue(filters.city, {
    label: "Provider city filter",
    maxLength: 100,
  });
  if (city) query.city = new RegExp(escapeRegex(city), "i");
  const q = queryTextValue(filters.q, {
    label: "Provider search",
    maxLength: 100,
  });
  if (q) {
    const search = new RegExp(escapeRegex(q), "i");
    query.$or = [
      { providerId: search },
      { name: search },
      { businessName: search },
      { mobile: search },
      { email: search },
      { city: search },
    ];
  }

  const result = await cursorPaginate(Provider, {
    query,
    sort: { createdAt: -1, _id: -1 },
    limit,
    cursor,
  });
  return { ...result, data: result.data.map(presentProvider) };
}

async function get(providerId) {
  const provider = await Provider.findOne(providerQuery(providerId)).lean();
  if (!provider) {
    throw Object.assign(new Error("Provider not found"), { status: 404 });
  }
  return presentProvider(provider);
}

async function listDistributions(providerId, filters = {}) {
  const provider = await get(providerId);
  const { limit, cursor } = getPagination(filters);
  const query = { providerId: provider.providerId };
  if (filters.status) {
    query.status = enumValue(filters.status, OFFER_STATUSES, {
      label: "Offer status filter",
    });
  }
  if (filters.unlocked !== undefined && filters.unlocked !== "") {
    const unlocked = booleanValue(filters.unlocked, {
      label: "Unlocked filter",
    });
    query.contactUnlocked = unlocked ? true : { $ne: true };
  }

  return cursorPaginate(LeadDistribution, {
    query,
    sort: { distributedAt: -1, _id: -1 },
    limit,
    cursor,
    select: {
      leadDistributionId: 1,
      enquiryId: 1,
      leadTitle: 1,
      status: 1,
      providerSaleOutcome: 1,
      providerSaleOutcomeNote: 1,
      providerSaleOutcomeUpdatedAt: 1,
      outcomeVerificationStatus: 1,
      outcomeVerificationNote: 1,
      outcomeVerifiedAt: 1,
      outcomeVerifiedBy: 1,
      providerLeadStatus: 1,
      providerLeadReason: 1,
      providerLeadNote: 1,
      contactUnlocked: 1,
      leadPricePaise: 1,
      distributedAt: 1,
      updatedAt: 1,
    },
  });
}

async function listTransactions(providerId, filters = {}) {
  const provider = await get(providerId);
  const { limit, cursor } = getPagination(filters);
  const query = { providerId: provider.providerId };
  if (filters.type) {
    query.type = tokenValue(filters.type, {
      label: "Transaction type filter",
      maxLength: 50,
    });
  }

  return cursorPaginate(WalletTransaction, {
    query,
    sort: { createdAt: -1, _id: -1 },
    limit,
    cursor,
    select: {
      walletTransactionId: 1,
      type: 1,
      amountPaise: 1,
      balanceAfterPaise: 1,
      status: 1,
      source: 1,
      referenceId: 1,
      description: 1,
      createdAt: 1,
    },
  });
}

async function create(input) {
  const data = normalizeProviderInput(input);
  const provider = await Provider.create(data);
  await syncApprovedLeads(provider);
  return get(provider.providerId);
}

async function update(providerId, input = {}) {
  const query = providerQuery(providerId);
  const current = await Provider.findOne(query).lean();
  if (!current) {
    throw Object.assign(new Error("Provider not found"), { status: 404 });
  }
  assertProviderIdUnchanged(current, input);

  await Provider.updateOne(query, {
    $set: normalizeProviderInput(input, current),
  });
  const provider = await Provider.findOne(query);
  await syncApprovedLeads(provider);
  return get(providerId);
}

async function syncApprovedLeads(providerDocument) {
  if (!providerDocument) {
    throw Object.assign(new Error("Provider not found"), { status: 404 });
  }
  const rawProvider = providerDocument.toObject
    ? providerDocument.toObject()
    : providerDocument;
  const provider = presentProvider(rawProvider);
  const eligible =
    provider.status === "active" && provider.portalAccessEnabled !== false;

  if (!eligible) {
    await LeadDistribution.updateMany(
      { providerId: provider.providerId, contactUnlocked: { $ne: true } },
      { $set: { status: "withdrawn", updatedAt: new Date() } },
    );
    return;
  }

  const enquiries = Enquiry.find({
    status: { $in: ["approved", "distributed", "sale_converted"] },
    isActive: { $ne: false },
    categorySlug: { $in: provider.categorySlugs || [] },
  }).cursor();

  for await (const enquiry of enquiries) {
    await enquiryService.distribute(enquiry, "provider-sync");
  }

  await LeadDistribution.updateMany(
    {
      providerId: provider.providerId,
      categorySlug: { $nin: provider.categorySlugs || [] },
      contactUnlocked: { $ne: true },
    },
    { $set: { status: "withdrawn", updatedAt: new Date() } },
  );
}

async function reviewProviderOutcome(providerId, leadDistributionId, input = {}, actor = "admin") {
  const provider = await get(providerId);
  const distributionId = identifierValue(leadDistributionId, { label: "Lead distribution ID" });
  const distribution = await LeadDistribution.findOne({
    providerId: provider.providerId,
    leadDistributionId: distributionId,
    contactUnlocked: true,
  }).lean();
  if (!distribution) {
    throw Object.assign(new Error("Unlocked provider lead not found"), { status: 404 });
  }

  const verificationStatus = enumValue(input.verificationStatus, OUTCOME_VERIFICATION_STATUSES, {
    label: "Outcome verification status",
  });
  const reviewAction = enumValue(input.reviewAction, PROVIDER_REVIEW_ACTIONS, {
    label: "Provider account action",
    fallback: "none",
  });
  const note = textValue(input.note, {
    label: "Review note",
    required: true,
    maxLength: 2000,
    preserveWhitespace: true,
  });
  if (reviewAction !== "none" && verificationStatus !== "incorrect_status") {
    throw validationError("Warning or account restriction can be applied only after marking the outcome Incorrect status");
  }

  const now = new Date();
  await LeadDistribution.updateOne(
    { leadDistributionId: distributionId, providerId: provider.providerId },
    {
      $set: {
        outcomeVerificationStatus: verificationStatus,
        outcomeVerificationNote: note,
        outcomeVerifiedAt: now,
        outcomeVerifiedBy: actor,
        updatedAt: now,
      },
    },
  );

  const providerSet = { updatedAt: now };
  const providerUpdate = { $set: providerSet };
  if (reviewAction === "warning") {
    providerUpdate.$inc = { outcomeWarningCount: 1 };
    providerSet.outcomeLastWarningAt = now;
    providerSet.outcomeLastWarningReason = note;
  } else if (reviewAction === "suspend") {
    providerSet.status = "inactive";
    providerSet.portalAccessEnabled = false;
    providerSet.platformRestrictionReason = note;
    providerSet.platformRestrictedAt = now;
    providerSet.platformRestrictedBy = actor;
  } else if (reviewAction === "ban") {
    providerSet.status = "blocked";
    providerSet.portalAccessEnabled = false;
    providerSet.platformRestrictionReason = note;
    providerSet.platformRestrictedAt = now;
    providerSet.platformRestrictedBy = actor;
  }
  await Provider.updateOne(providerQuery(provider.providerId), providerUpdate);

  return {
    provider: await get(provider.providerId),
    distribution: await LeadDistribution.findOne({ leadDistributionId: distributionId }).lean(),
    reviewAction,
  };
}

module.exports = {
  list,
  get,
  listDistributions,
  listTransactions,
  create,
  update,
  syncApprovedLeads,
  presentProvider,
  normalizeProviderInput,
  assertProviderIdUnchanged,
  PROVIDER_STATUSES,
  ONBOARDING_STAGES,
  OFFER_STATUSES,
  OUTCOME_VERIFICATION_STATUSES,
  PROVIDER_REVIEW_ACTIONS,
  reviewProviderOutcome,
};
