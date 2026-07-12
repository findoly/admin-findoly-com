require("dotenv").config();
const mongoose = require("mongoose");
const connectDatabase = require("../db/connection");
const Enquiry = require("../models/Enquiry");

async function run() {
  await connectDatabase();
  let updated = 0;
  const cursor = Enquiry.find({ agentId: { $ne: "" }, $or: [{ agentReferralValidation: { $exists: false } }, { partnerEligibilityDate: null }] }).select({ enquiryId: 1, createdAt: 1, status: 1, agentReferralValidation: 1, partnerPayoutStatus: 1 }).lean().cursor();
  for await (const row of cursor) {
    const eligibilityDate = new Date(new Date(row.createdAt || Date.now()).getTime() + 14 * 24 * 60 * 60 * 1000);
    const rejected = ["rejected", "invalid", "not_interested"].includes(String(row.status || "").toLowerCase());
    await Enquiry.updateOne({ enquiryId: row.enquiryId }, { $set: {
      agentReferralValidation: row.agentReferralValidation || "pending",
      agentSaleConversion: "pending",
      partnerEligibilityDate: eligibilityDate,
      partnerPayoutStatus: row.partnerPayoutStatus || (rejected ? "not_eligible" : "waiting_period"),
      updatedAt: new Date(),
    } });
    updated += 1;
  }
  console.log(`Migrated ${updated} agent requirements for payout tracking.`);
}
run().catch((error)=>{console.error(error);process.exitCode=1;}).finally(async()=>{await mongoose.disconnect().catch(()=>{});});
