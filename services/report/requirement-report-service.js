const Enquiry = require("../../models/Enquiry");
const ProviderLeadUnlock = require("../../models/ProviderLeadUnlock");
const { dateBoundary } = require("../../utils/date-query");
const { validationError } = require("../../utils/validation");

const TIME_ZONE = "Asia/Kolkata";
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 184;
const PRESETS = Object.freeze(["today", "yesterday", "7d", "30d", "custom"]);
const VERIFICATION_STATUSES = Object.freeze(["verification", "verification_pending", "verified"]);

function dateOnlyInIndia(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function addDays(dateOnly, days) {
  const value = dateBoundary(dateOnly, false);
  return dateOnlyInIndia(new Date(value.getTime() + (Number(days || 0) * DAY_MS)));
}

function validDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))
    && !Number.isNaN(dateBoundary(String(value), false).getTime());
}

function rangeDays(startDate, endDate) {
  const start = dateBoundary(startDate, false);
  const end = dateBoundary(endDate, false);
  return Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

function resolvePeriod(filters = {}, now = new Date()) {
  const preset = String(filters.preset || "today").trim().toLowerCase();
  if (!PRESETS.includes(preset)) throw validationError("Report period is invalid");

  const today = dateOnlyInIndia(now);
  let startDate = today;
  let endDate = today;

  if (preset === "yesterday") {
    startDate = addDays(today, -1);
    endDate = startDate;
  } else if (preset === "7d") {
    startDate = addDays(today, -6);
  } else if (preset === "30d") {
    startDate = addDays(today, -29);
  } else if (preset === "custom") {
    startDate = String(filters.from || "").trim();
    endDate = String(filters.to || "").trim();
    if (!validDateOnly(startDate) || !validDateOnly(endDate)) {
      throw validationError("Custom report requires valid From and To dates");
    }
  }

  if (endDate < startDate) throw validationError("Report end date cannot be before start date");
  if (rangeDays(startDate, endDate) > MAX_RANGE_DAYS) {
    throw validationError("Requirement report range cannot exceed 6 months");
  }

  return {
    preset,
    startDate,
    endDate,
    startAt: dateBoundary(startDate, false),
    endAt: dateBoundary(endDate, true),
  };
}

function testingExclusion() {
  return {
    $nor: [
      { categorySlug: /^testing$/i },
      { category: /^testing$/i },
    ],
  };
}

function money(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function fillTrend(rows = [], startDate, endDate) {
  const map = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row._id || row.date || ""), Number(row.requirements || 0)]));
  const result = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const parsed = dateBoundary(date, false);
    result.push({
      date,
      label: new Intl.DateTimeFormat("en-IN", {
        timeZone: TIME_ZONE,
        day: "numeric",
        month: "short",
      }).format(parsed),
      requirements: map.get(date) || 0,
    });
  }
  return result;
}

function summaryDefaults() {
  return {
    requirementsReceived: 0,
    new: 0,
    verification: 0,
    approved: 0,
    rejected: 0,
    requirementsUnlocked: 0,
    totalProviderUnlocks: 0,
    unlockCredits: 0,
    directPaymentRupees: 0,
    notUnlocked: 0,
    estimatedMissedOpportunityRupees: 0,
    takenConverted: 0,
    notConvertedOrPending: 0,
  };
}

async function getRequirementReport(filters = {}, now = new Date()) {
  const period = resolvePeriod(filters, now);
  const pipeline = [
    {
      $match: {
        createdAt: { $gte: period.startAt, $lte: period.endAt },
        ...testingExclusion(),
      },
    },
    {
      $project: {
        enquiryId: 1,
        status: 1,
        marketplaceStatus: 1,
        remainingUnlocks: 1,
        leadPricePaise: 1,
        providerSaleConversionStatus: 1,
        createdAt: 1,
      },
    },
    {
      $lookup: {
        from: ProviderLeadUnlock.collection.collectionName,
        let: { enquiryId: "$enquiryId" },
        pipeline: [
          { $match: { $expr: { $eq: ["$enquiryId", "$$enquiryId"] } } },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              credits: { $sum: { $ifNull: ["$chargedCredits", 0] } },
              directPaymentPaise: {
                $sum: {
                  $cond: [
                    { $eq: ["$unlockMethod", "direct_payment"] },
                    { $ifNull: ["$chargedPaise", 0] },
                    0,
                  ],
                },
              },
            },
          },
        ],
        as: "unlockSummary",
      },
    },
    {
      $set: {
        unlockStats: {
          $ifNull: [
            { $arrayElemAt: ["$unlockSummary", 0] },
            { count: 0, credits: 0, directPaymentPaise: 0 },
          ],
        },
      },
    },
    {
      $set: {
        unlockCount: { $ifNull: ["$unlockStats.count", 0] },
        unlockCredits: { $ifNull: ["$unlockStats.credits", 0] },
        directPaymentPaise: { $ifNull: ["$unlockStats.directPaymentPaise", 0] },
      },
    },
    {
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              requirementsReceived: { $sum: 1 },
              new: { $sum: { $cond: [{ $eq: ["$status", "new"] }, 1, 0] } },
              verification: { $sum: { $cond: [{ $in: ["$status", VERIFICATION_STATUSES] }, 1, 0] } },
              approved: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] } },
              rejected: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
              requirementsUnlocked: { $sum: { $cond: [{ $gt: ["$unlockCount", 0] }, 1, 0] } },
              totalProviderUnlocks: { $sum: "$unlockCount" },
              unlockCredits: { $sum: "$unlockCredits" },
              directPaymentPaise: { $sum: "$directPaymentPaise" },
              notUnlocked: {
                $sum: {
                  $cond: [
                    { $and: [{ $eq: ["$status", "approved"] }, { $eq: ["$unlockCount", 0] }] },
                    1,
                    0,
                  ],
                },
              },
              estimatedMissedOpportunityRupees: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ["$status", "approved"] },
                        { $in: ["$marketplaceStatus", ["closed", "expired"]] },
                        { $gt: [{ $ifNull: ["$remainingUnlocks", 0] }, 0] },
                      ],
                    },
                    {
                      $multiply: [
                        { $ifNull: ["$remainingUnlocks", 0] },
                        { $divide: [{ $ifNull: ["$leadPricePaise", 0] }, 100] },
                      ],
                    },
                    0,
                  ],
                },
              },
              takenConverted: {
                $sum: { $cond: [{ $eq: ["$providerSaleConversionStatus", "converted"] }, 1, 0] },
              },
              notConvertedOrPending: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gt: ["$unlockCount", 0] },
                        { $in: ["$providerSaleConversionStatus", ["pending", "not_converted"]] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ],
        trend: [
          {
            $group: {
              _id: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$createdAt",
                  timezone: TIME_ZONE,
                },
              },
              requirements: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],
      },
    },
  ];

  const rows = await Enquiry.aggregate(pipeline)
    .allowDiskUse(false)
    .option({ maxTimeMS: Math.min(Math.max(Number(process.env.CRM_QUERY_MAX_TIME_MS || 10000), 1000), 60000) });

  const aggregate = rows[0] || {};
  const rawSummary = aggregate.summary?.[0] || summaryDefaults();
  const summary = {
    ...summaryDefaults(),
    ...rawSummary,
    unlockCredits: money(rawSummary.unlockCredits),
    unlockValueRupees: money(rawSummary.unlockCredits),
    directPaymentRupees: money(Number(rawSummary.directPaymentPaise || 0) / 100),
    estimatedMissedOpportunityRupees: money(rawSummary.estimatedMissedOpportunityRupees),
  };
  delete summary._id;
  delete summary.directPaymentPaise;

  return {
    period: {
      preset: period.preset,
      from: period.startDate,
      to: period.endDate,
      maxRangeDays: MAX_RANGE_DAYS,
    },
    summary,
    status: {
      new: summary.new,
      verification: summary.verification,
      approved: summary.approved,
      rejected: summary.rejected,
      unlocked: summary.requirementsUnlocked,
      taken: summary.takenConverted,
    },
    trend: fillTrend(aggregate.trend || [], period.startDate, period.endDate),
    exclusions: { testingCategory: true },
  };
}

module.exports = {
  getRequirementReport,
  resolvePeriod,
  fillTrend,
  testingExclusion,
  summaryDefaults,
  PRESETS,
  MAX_RANGE_DAYS,
};
