"use strict";

const Enquiry = require("../../models/Enquiry");
const { canonicalLeadStatus } = require("../../utils/lead-journey");

function enquiryQuery(enquiryId) {
  return { $or: [{ enquiryId }, { id: enquiryId }] };
}

async function prepareApprovalCustomerMobileVerification(lead = {}) {
  if (!lead || typeof lead !== "object" || Array.isArray(lead)) return null;
  const enquiryId = String(lead.enquiryId || lead.id || "").trim();
  if (!enquiryId) return null;

  if (lead.customerMobileVerified === true && lead.customerMobileVerifiedAt) {
    return {
      changed: false,
      enquiryId,
      verifiedAt: lead.customerMobileVerifiedAt,
    };
  }

  const verifiedAt = lead.customerMobileVerifiedAt || new Date();
  await Enquiry.updateOne(
    enquiryQuery(enquiryId),
    {
      $set: {
        customerMobileVerified: true,
        customerMobileVerifiedAt: verifiedAt,
        updatedAt: new Date(),
      },
    },
  );

  return {
    changed: true,
    enquiryId,
    verifiedAt,
    previousVerified: lead.customerMobileVerified === true,
    previousVerifiedAt: lead.customerMobileVerifiedAt || null,
  };
}

async function rollbackPreparedApprovalCustomerMobileVerification(preparation) {
  if (!preparation?.changed || !preparation.enquiryId) return;
  try {
    await Enquiry.updateOne(
      {
        $and: [
          enquiryQuery(preparation.enquiryId),
          { status: { $ne: "approved" } },
          { customerMobileVerified: true },
          { customerMobileVerifiedAt: preparation.verifiedAt },
        ],
      },
      {
        $set: {
          customerMobileVerified: preparation.previousVerified === true,
          customerMobileVerifiedAt: preparation.previousVerifiedAt || null,
          updatedAt: new Date(),
        },
      },
    );
  } catch (error) {
    console.warn({
      event: "approval_customer_mobile_verification_rollback_failed",
      enquiryId: preparation.enquiryId,
      code: String(error.code || "CUSTOMER_MOBILE_VERIFICATION_ROLLBACK_FAILED"),
      message: String(error.message || error).slice(0, 1000),
    });
  }
}

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
      enquiryQuery(enquiryId),
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

module.exports = {
  prepareApprovalCustomerMobileVerification,
  rollbackPreparedApprovalCustomerMobileVerification,
  ensureApprovedCustomerMobileVerified,
};
