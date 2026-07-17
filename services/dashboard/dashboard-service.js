const Enquiry = require("../../models/Enquiry");
const Provider = require("../../models/Provider");
const FollowUp = require("../../models/FollowUp");
const Invoice = require("../../models/Invoice");
const LeadDistribution = require("../../models/LeadDistribution");
const { presentEnquiry } = require("../enquiry/enquiry-service");

async function getDashboard() {
  const statusGroups = {
    new: ["new"],
    verification: ["verification", "verification_pending", "verified"],
    approved: ["approved"],
    distributed: ["distributed", "in_progress", "completed", "closed"],
    sale_converted: ["sale_converted"],
    rejected: ["rejected"],
  };

  const statusCounts = {};
  await Promise.all(
    Object.entries(statusGroups).map(async ([status, values]) => {
      statusCounts[status] = await Enquiry.countDocuments({
        status: { $in: values },
      });
    }),
  );
  const [
    totalLeads,
    providers,
    activeProviders,
    openFollowUps,
    invoices,
    offered,
    unlocked,
    recentLeads,
  ] = await Promise.all([
    Enquiry.countDocuments(),
    Provider.countDocuments(),
    Provider.countDocuments({
      status: "active",
      portalAccessEnabled: { $ne: false },
    }),
    FollowUp.countDocuments({ status: { $in: ["open", "pending"] } }),
    Invoice.countDocuments(),
    LeadDistribution.countDocuments({ status: "offered" }),
    LeadDistribution.countDocuments({ contactUnlocked: true }),
    Enquiry.find().sort({ createdAt: -1 }).limit(10).lean(),
  ]);
  return {
    totalLeads,
    providers,
    activeProviders,
    openFollowUps,
    invoices,
    offered,
    unlocked,
    statusCounts,
    recentLeads: recentLeads.map(presentEnquiry),
  };
}

module.exports = { getDashboard };
