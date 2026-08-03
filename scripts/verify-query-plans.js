#!/usr/bin/env node
"use strict";

const mongoose = require("mongoose");
const connectDatabase = require("../db/connection");

const MODELS = {
  Agent: require("../models/Agent"),
  AgentWithdrawal: require("../models/AgentWithdrawal"),
  Communication: require("../models/Communication"),
  CommunicationRule: require("../models/CommunicationRule"),
  CommunicationTemplate: require("../models/CommunicationTemplate"),
  ContactIdentity: require("../models/ContactIdentity"),
  CrmOtpIpRateLimit: require("../models/CrmOtpIpRateLimit"),
  CrmOtpRateLimit: require("../models/CrmOtpRateLimit"),
  Employee: require("../models/Employee"),
  Enquiry: require("../models/Enquiry"),
  FollowUp: require("../models/FollowUp"),
  Invoice: require("../models/Invoice"),
  OtpRequest: require("../models/OtpRequest"),
  Provider: require("../models/Provider"),
  ProviderJoinRequest: require("../models/ProviderJoinRequest"),
  ProviderLeadUnlock: require("../models/ProviderLeadUnlock"),
  ProviderSubscription: require("../models/ProviderSubscription"),
};

const CASES = Object.freeze([
  ["providers/recent", "Provider", {}, { createdAt: -1, _id: -1 }],
  ["providers/status", "Provider", { status: "active" }, { createdAt: -1, _id: -1 }],
  ["providers/category", "Provider", { categorySlugs: "example-category" }, { createdAt: -1, _id: -1 }],
  ["providers/city", "Provider", { city: "Mumbai" }, { createdAt: -1, _id: -1 }],
  ["agents/status", "Agent", { status: "active" }, { createdAt: -1, _id: -1 }],
  ["agents/category", "Agent", { categorySlugs: "example-category" }, { createdAt: -1, _id: -1 }],
  ["employees/status", "Employee", { status: "active" }, { updatedAt: -1, _id: -1 }],
  ["employees/role", "Employee", { status: "active", roleId: "example-role" }, { createdAt: -1, _id: -1 }],
  ["enquiries/status", "Enquiry", { status: "new", isActive: { $ne: false } }, { createdAt: -1, _id: -1 }],
  ["enquiries/marketplace", "Enquiry", { marketplaceAvailable: true, categorySlug: "example-category" }, { marketplacePublishedAt: -1, _id: -1 }],
  ["enquiries/agent", "Enquiry", { agentId: "example-agent" }, { createdAt: -1, _id: -1 }],
  ["enquiries/payout-eligibility", "Enquiry", { agentId: "example-agent", agentReferralValidation: "valid", partnerEligibilityDate: { $lte: new Date() }, partnerPayoutStatus: "unpaid" }, { createdAt: 1, _id: 1 }],
  ["follow-ups/due", "FollowUp", { status: "open" }, { dueAt: 1, createdAt: -1, _id: -1 }],
  ["invoices/status", "Invoice", { status: "sent" }, { createdAt: -1, _id: -1 }],
  ["invoices/issue-date", "Invoice", {}, { issueDate: -1, _id: -1 }],
  ["communications/channel", "Communication", { channel: "whatsapp" }, { createdAt: -1, _id: -1 }],
  ["communications/status", "Communication", { status: "failed" }, { sentAt: -1, _id: -1 }],
  ["communications/purpose", "Communication", { purpose: "provider_created" }, { createdAt: -1, _id: -1 }],
  ["templates/channel-status", "CommunicationTemplate", { channel: "email", status: "active" }, { updatedAt: -1, _id: -1 }],
  ["rules/event", "CommunicationRule", { enabled: true, event: "provider_created" }, { _id: 1 }],
  ["provider-requests/status", "ProviderJoinRequest", { status: "new" }, { createdAt: -1, _id: -1 }],
  ["provider-requests/category", "ProviderJoinRequest", { categorySlug: "example-category", status: "new" }, { createdAt: -1, _id: -1 }],
  ["subscriptions/provider", "ProviderSubscription", { providerId: "example-provider" }, { purchasedAt: -1, _id: -1 }],
  ["subscriptions/status", "ProviderSubscription", { status: "active" }, { purchasedAt: -1, _id: -1 }],
  ["withdrawals/agent", "AgentWithdrawal", { agentId: "example-agent" }, { createdAt: -1, _id: -1 }],
  ["withdrawals/status", "AgentWithdrawal", { status: "submitted" }, { submittedAt: -1, _id: -1 }],
  ["unlocks/provider", "ProviderLeadUnlock", { providerId: "example-provider" }, { unlockedAt: -1, _id: -1 }],
  ["unlocks/enquiry", "ProviderLeadUnlock", { enquiryId: "example-enquiry" }, { unlockedAt: -1, _id: -1 }],
  ["otp/recipient", "OtpRequest", { recipient: "9876543210", purpose: "login" }, { createdAt: -1, _id: -1 }],
  ["otp/status", "OtpRequest", { status: "pending" }, { createdAt: -1, _id: -1 }],
  ["contact-identity/key", "ContactIdentity", { key: "phone:9876543210" }, { _id: 1 }],
  ["otp-mobile-rate-limit", "CrmOtpRateLimit", { mobile: "9876543210" }, { _id: 1 }],
  ["otp-ip-rate-limit", "CrmOtpIpRateLimit", { keyHash: "0".repeat(64) }, { _id: 1 }],
]);

function collectStages(value, stages = new Set()) {
  if (!value || typeof value !== "object") return stages;
  if (typeof value.stage === "string") stages.add(value.stage);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") collectStages(child, stages);
  }
  return stages;
}

function planSummary(explain) {
  const stages = [...collectStages(explain?.queryPlanner?.winningPlan || explain)].sort();
  const execution = explain?.executionStats || {};
  return {
    stages,
    nReturned: Number(execution.nReturned || 0),
    totalDocsExamined: Number(execution.totalDocsExamined || 0),
    totalKeysExamined: Number(execution.totalKeysExamined || 0),
    executionTimeMillis: Number(execution.executionTimeMillis || 0),
  };
}

async function explainCase([name, modelName, query, sort]) {
  const model = MODELS[modelName];
  if (!model) throw new Error(`Unknown query-plan model: ${modelName}`);
  const explain = await model.collection.find(query)
    .sort(sort)
    .limit(25)
    .explain("executionStats");
  const summary = planSummary(explain);
  const blocking = summary.stages.filter((stage) => ["COLLSCAN", "SORT"].includes(stage));
  const scanRatio = summary.nReturned > 0
    ? summary.totalDocsExamined / summary.nReturned
    : summary.totalDocsExamined;
  return {
    name,
    model: modelName,
    query,
    sort,
    ...summary,
    scanRatio,
    passed: blocking.length === 0 && scanRatio <= 100,
    blocking,
  };
}

async function run() {
  await connectDatabase();
  const results = [];
  for (const definition of CASES) {
    const result = await explainCase(definition);
    results.push(result);
    console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name}: stages=${result.stages.join(",") || "none"} docs=${result.totalDocsExamined} returned=${result.nReturned}`);
  }
  const failures = results.filter((result) => !result.passed);
  if (failures.length) {
    const error = new Error(`${failures.length} representative query plans require index or query changes`);
    error.code = "QUERY_PLAN_VERIFICATION_FAILED";
    error.report = failures;
    throw error;
  }
  return results;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(error.stack || error.message);
      if (error.report) console.error(JSON.stringify(error.report, null, 2));
      process.exitCode = 1;
    })
    .finally(async () => mongoose.disconnect().catch(() => {}));
}

module.exports = { CASES, collectStages, explainCase, planSummary, run };
