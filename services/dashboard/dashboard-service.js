const Enquiry = require('../../models/Enquiry');
const Provider = require('../../models/Provider');
const FollowUp = require('../../models/FollowUp');
const Invoice = require('../../models/Invoice');
const LeadDistribution = require('../../models/LeadDistribution');

async function getDashboard() {
  const statuses = ['new','verification_pending','verified','approved','distributed','in_progress','completed','rejected'];
  const statusCounts = {};
  await Promise.all(statuses.map(async status => { statusCounts[status] = await Enquiry.countDocuments({ status }); }));
  const [totalLeads, providers, activeProviders, openFollowUps, invoices, offered, unlocked, recentLeads] = await Promise.all([
    Enquiry.countDocuments(), Provider.countDocuments(), Provider.countDocuments({ status: 'active', portalAccessEnabled: { $ne: false } }),
    FollowUp.countDocuments({ status: { $in: ['open','pending'] } }), Invoice.countDocuments(),
    LeadDistribution.countDocuments({ status: 'offered' }), LeadDistribution.countDocuments({ contactUnlocked: true }),
    Enquiry.find().sort({ createdAt: -1 }).limit(10).lean()
  ]);
  return { totalLeads, providers, activeProviders, openFollowUps, invoices, offered, unlocked, statusCounts, recentLeads };
}

module.exports = { getDashboard };
