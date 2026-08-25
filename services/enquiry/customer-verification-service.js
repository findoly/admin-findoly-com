"use strict";

const Enquiry = require("../../models/Enquiry");
const { canonicalLeadStatus } = require("../../utils/lead-journey");

async function ensureApprovedCustomerMobileVerified(lead = {}) {
  if (!lead || typeof lead !== "object" || Array.isArray(lead)) return lead;
  if (canonicalLeadStatus(lead.status || lead.journeyStatus) !== "approved") return lead;

  const verifiedAt = lead.customerMobileVerifiedAt || lead.statusUpdatedAt || new Date();
  const normalized = {
    ...lead,
    customerMobileVerified: true,
    customerMobileVerifiedAt: verifiedAt,
  };
  if (lead.customerMobileVerified === true && lead.customerMobileVerifiedAt) return normalized;

  const enquiryId = String(lead.enquiryId || lead.id || "").trim();
  if (!enquiryId) return normalized;

  try {
    await Enquiry.updateOne(
      { $or: [{ enquiryId }, { id: enquiryId }] },
      {
        $set: {
          customerMobileVerified: true,
          customerMobileVerifiedAt: verifiedAt,
          updatedAt: new Date(),
        },
      },
    );
  } catch (error) {
    console.warn({
      event: "approved_customer_mobile_verification_save_failed",
      enquiryId,
      code: String(error.code || "CUSTOMER_MOBILE_VERIFICATION_SAVE_FAILED"),
      message: String(error.message || error).slice(0, 1000),
    });
  }

  return normalized;
}

module.exports = { ensureApprovedCustomerMobileVerified };
