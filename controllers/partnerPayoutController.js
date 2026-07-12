const service = require("../services/partner-payout/partner-payout-service");
const razorpay = require("../services/partner-payout/razorpay-service");

function actor(req) {
  return req.admin?.email || req.admin?.name || "crm-admin";
}

async function list(req, res, next) {
  try { const result = await service.listWithdrawals(req.query); res.json({ success: true, ...result }); } catch (error) { next(error); }
}
async function get(req, res, next) {
  try { res.json({ success: true, data: await service.getWithdrawal(req.params.withdrawalId) }); } catch (error) { next(error); }
}
async function agentSummary(req, res, next) {
  try { res.json({ success: true, data: await service.summaryForAgent(req.params.agentId) }); } catch (error) { next(error); }
}
async function agentWithdrawals(req, res, next) {
  try { const result = await service.listAgentWithdrawals(req.params.agentId, req.query); res.json({ success: true, ...result }); } catch (error) { next(error); }
}
async function transition(req, res, next) {
  try { res.json({ success: true, data: await service.transitionWithdrawal(req.params.withdrawalId, req.body?.action, req.body?.note, actor(req)) }); } catch (error) { next(error); }
}
async function payout(req, res, next) {
  try { res.json({ success: true, data: await service.processPayout(req.params.withdrawalId, req.body?.note, actor(req)) }); } catch (error) { next(error); }
}
async function webhook(req, res) {
  try {
    const signature = req.get("x-razorpay-signature");
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    if (!razorpay.verifyWebhookSignature(raw, signature)) return res.status(400).json({ success: false, message: "Invalid webhook signature" });
    const event = JSON.parse(raw.toString("utf8"));
    await service.handleWebhook(event);
    return res.json({ success: true });
  } catch (error) {
    console.error("Razorpay payout webhook error:", error.message);
    return res.status(400).json({ success: false, message: "Webhook could not be processed" });
  }
}

module.exports = { list, get, agentSummary, agentWithdrawals, transition, payout, webhook };
