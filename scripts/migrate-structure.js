require("dotenv").config();
const mongoose = require("mongoose");
const connectDatabase = require("../db/connection");
const uuid = require("../utils/uuid");
const { normalizeMobile } = require("../utils/mobile");

const idCollections = [
  ["categories", "categoryId"],
  ["enquiries", "enquiryId"],
  ["providers", "providerId"],
  ["leaddistributions", "leadDistributionId"],
  ["wallettransactions", "walletTransactionId"],
  ["paymentorders", "paymentOrderId"],
  ["followups", "followUpId"],
  ["communications", "communicationId"],
  ["invoices", "invoiceId"],
  ["formtemplates", "formTemplateId"],
];

function text(value) {
  return value === undefined || value === null ? "" : String(value);
}

function isUuid32(value) {
  return /^[a-f0-9]{32}$/i.test(text(value));
}

async function collectionExists(name) {
  const collections = await mongoose.connection.db
    .listCollections({ name })
    .toArray();
  return collections.length > 0;
}

async function assignCollectionIds(collectionName, fieldName) {
  const map = new Map();
  if (!(await collectionExists(collectionName))) return map;

  const collection = mongoose.connection.collection(collectionName);
  const documents = await collection.find({}).toArray();

  for (const document of documents) {
    const newId = isUuid32(document[fieldName]) ? document[fieldName] : uuid();
    const oldValues = [document[fieldName], document.id, document._id]
      .map(text)
      .filter(Boolean);

    await collection.updateOne(
      { _id: document._id },
      { $set: { [fieldName]: newId } },
    );

    map.set(newId, newId);
    for (const oldValue of oldValues) map.set(oldValue, newId);
  }

  console.log(
    `${collectionName}: ${documents.length} ${fieldName} values ready`,
  );
  return map;
}

async function flattenEnquiries() {
  if (!(await collectionExists("enquiries"))) return;
  const collection = mongoose.connection.collection("enquiries");
  const documents = await collection.find({}).toArray();

  for (const document of documents) {
    const source = document.source || {};
    const category =
      typeof document.category === "string"
        ? document.category
        : document.category?.name || document.categorySlug || "";

    await collection.updateOne(
      { _id: document._id },
      {
        $set: {
          name: document.name || document.customer?.name || "",
          mobile: document.mobile || document.customer?.mobile || "",
          email: document.email || document.customer?.email || "",
          addressLine: document.addressLine || document.address?.line1 || "",
          city: document.city || document.address?.city || "",
          state: document.state || document.address?.state || "",
          pincode: document.pincode || document.address?.pincode || "",
          category,
          categorySlug: document.categorySlug || document.category?.slug || "",
          sourceWebsite:
            document.sourceWebsite || source.website || "manual-admin",
          sourceChannel: document.sourceChannel || source.channel || "admin",
          sourceType: document.sourceType || source.sourceType || "manual",
          sourceName: document.sourceName || source.sourceName || "",
          campaign: document.campaign || source.campaign || "",
          externalEnquiryId:
            document.externalEnquiryId || source.externalEnquiryId || "",
          additionalDetails:
            document.additionalDetails ||
            document.fields ||
            document.formData ||
            document.dynamicFields ||
            {},
          updatedAt: new Date(),
        },
      },
    );
  }
}

async function normalizeProviders() {
  if (!(await collectionExists("providers"))) return;
  const collection = mongoose.connection.collection("providers");
  const documents = await collection.find({}).toArray();

  for (const document of documents) {
    await collection.updateOne(
      { _id: document._id },
      {
        $set: {
          normalizedMobile: normalizeMobile(
            document.normalizedMobile || document.mobile,
          ),
          updatedAt: new Date(),
        },
      },
    );
  }
}

async function updateRelations(maps) {
  if (await collectionExists("leaddistributions")) {
    const collection = mongoose.connection.collection("leaddistributions");
    const documents = await collection.find({}).toArray();
    for (const document of documents) {
      const oldEnquiryId = text(document.enquiryId || document.requirementId);
      const oldProviderId = text(document.providerId);
      const enquiryId = maps.enquiries.get(oldEnquiryId) || oldEnquiryId;
      const providerId = maps.providers.get(oldProviderId) || oldProviderId;
      const walletTransactionId =
        maps.wallettransactions.get(text(document.walletTransactionId)) ||
        text(document.walletTransactionId);
      await collection.updateOne(
        { _id: document._id },
        {
          $set: {
            enquiryId,
            providerId,
            walletTransactionId,
            updatedAt: new Date(),
          },
        },
      );
    }
  }

  if (await collectionExists("wallettransactions")) {
    const collection = mongoose.connection.collection("wallettransactions");
    const documents = await collection.find({}).toArray();
    for (const document of documents) {
      const providerId =
        maps.providers.get(text(document.providerId)) ||
        text(document.providerId);
      await collection.updateOne(
        { _id: document._id },
        { $set: { providerId, updatedAt: new Date() } },
      );
    }
  }

  if (await collectionExists("paymentorders")) {
    const collection = mongoose.connection.collection("paymentorders");
    const documents = await collection.find({}).toArray();
    for (const document of documents) {
      const providerId =
        maps.providers.get(text(document.providerId)) ||
        text(document.providerId);
      const walletTransactionId =
        maps.wallettransactions.get(text(document.walletTransactionId)) ||
        text(document.walletTransactionId);
      await collection.updateOne(
        { _id: document._id },
        {
          $set: {
            providerId,
            walletTransactionId,
            razorpayOrderId:
              document.razorpayOrderId || document.gatewayOrderId || "",
            razorpayPaymentId:
              document.razorpayPaymentId || document.gatewayPaymentId || "",
            updatedAt: new Date(),
          },
        },
      );
    }
  }

  for (const collectionName of ["followups", "communications", "invoices"]) {
    if (!(await collectionExists(collectionName))) continue;
    const collection = mongoose.connection.collection(collectionName);
    const documents = await collection.find({}).toArray();
    for (const document of documents) {
      const enquiryId =
        maps.enquiries.get(
          text(document.enquiryId || document.requirementId),
        ) || text(document.enquiryId || document.requirementId);
      const update = { enquiryId, updatedAt: new Date() };
      if (collectionName === "communications" && document.providerId) {
        update.providerId =
          maps.providers.get(text(document.providerId)) ||
          text(document.providerId);
      }
      await collection.updateOne({ _id: document._id }, { $set: update });
    }
  }
}

async function rebuildApprovedLeadOffers() {
  const Enquiry = require("../models/Enquiry");
  const enquiryService = require("../services/enquiry/enquiry-service");
  const approved = await Enquiry.find({
    status: { $in: ["approved", "distributed"] },
  });
  for (const enquiry of approved) {
    await enquiryService.distribute(enquiry, "id-migration");
  }
  console.log(`Rebuilt offers for ${approved.length} approved enquiries`);
}

async function run() {
  await connectDatabase();

  const maps = {};
  for (const [collectionName, fieldName] of idCollections) {
    maps[collectionName] = await assignCollectionIds(collectionName, fieldName);
  }

  await flattenEnquiries();
  await normalizeProviders();
  await updateRelations(maps);
  await rebuildApprovedLeadOffers();

  console.log(
    "Migration complete. Existing _id and id fields were not changed.",
  );
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
