require("dotenv").config();

const mongoose = require("mongoose");
const connectDatabase = require("../db/connection");
const Provider = require("../models/Provider");
const Enquiry = require("../models/Enquiry");
const LeadDistribution = require("../models/LeadDistribution");
const { geocodePincode, normalizePincode } = require("../services/location/geocoding-service");
const { haversineDistanceKm, marketplaceVisibleAt } = require("../utils/marketplace-radius");

function providerIdOf(provider = {}) {
  return String(provider.providerId || provider.id || "").trim();
}

function enquiryIdOf(enquiry = {}) {
  return String(enquiry.enquiryId || enquiry.id || "").trim();
}

async function backfillProviders() {
  let updated = 0;
  let skipped = 0;
  const cursor = Provider.find({ servicePincode: { $nin: [null, ""] } }).cursor();
  for await (const provider of cursor) {
    try {
      const pincode = normalizePincode(provider.servicePincode);
      const location = await geocodePincode(pincode);
      await Provider.updateOne(
        { _id: provider._id },
        {
          $set: {
            servicePincode: pincode,
            serviceLatitude: location.latitude,
            serviceLongitude: location.longitude,
            serviceLocality: location.locality || location.city || "",
            serviceDistrict: location.district || "",
            serviceState: location.state || "",
            serviceCountry: location.country || "India",
            serviceLocationVerifiedAt: location.verifiedAt || new Date(),
            serviceLocationSource: location.source || "google_geocoding",
            city: provider.city || location.city || location.locality || "",
            state: provider.state || location.state || "",
            updatedAt: new Date(),
          },
        },
      );
      updated += 1;
    } catch (error) {
      skipped += 1;
      console.warn(`Provider ${providerIdOf(provider) || provider._id}: ${error.message}`);
    }
  }
  return { updated, skipped };
}

async function backfillEnquiries() {
  let updated = 0;
  let skipped = 0;
  const cursor = Enquiry.find({ pincode: { $nin: [null, ""] } }).cursor();
  for await (const enquiry of cursor) {
    try {
      const pincode = normalizePincode(enquiry.pincode);
      const location = await geocodePincode(pincode);
      const publishedAt = enquiry.marketplacePublishedAt || enquiry.distributedAt || enquiry.createdAt || new Date();
      await Enquiry.updateOne(
        { _id: enquiry._id },
        {
          $set: {
            locationPincode: pincode,
            locationLatitude: location.latitude,
            locationLongitude: location.longitude,
            locationLocality: location.locality || location.city || "",
            locationDistrict: location.district || "",
            locationState: location.state || "",
            locationCountry: location.country || "India",
            locationVerifiedAt: location.verifiedAt || new Date(),
            locationSource: location.source || "google_geocoding",
            marketplacePublishedAt: publishedAt,
            updatedAt: new Date(),
          },
        },
      );
      updated += 1;
    } catch (error) {
      skipped += 1;
      console.warn(`Lead ${enquiryIdOf(enquiry) || enquiry._id}: ${error.message}`);
    }
  }
  return { updated, skipped };
}

async function backfillDistributions() {
  const providers = await Provider.find({}).select({
    providerId: 1,
    id: 1,
    serviceLatitude: 1,
    serviceLongitude: 1,
  }).lean();
  const providerMap = new Map(providers.map((provider) => [providerIdOf(provider), provider]));

  const enquiries = await Enquiry.find({}).select({
    enquiryId: 1,
    id: 1,
    locationLatitude: 1,
    locationLongitude: 1,
    marketplacePublishedAt: 1,
    distributedAt: 1,
    createdAt: 1,
  }).lean();
  const enquiryMap = new Map(enquiries.map((enquiry) => [enquiryIdOf(enquiry), enquiry]));

  let updated = 0;
  let skipped = 0;
  const operations = [];
  const flush = async () => {
    if (!operations.length) return;
    const result = await LeadDistribution.bulkWrite(operations.splice(0), { ordered: false });
    updated += Number(result.modifiedCount || 0);
  };

  const cursor = LeadDistribution.find({ contactUnlocked: { $ne: true } }).select({
    _id: 1,
    providerId: 1,
    enquiryId: 1,
    distributedAt: 1,
  }).cursor();

  for await (const row of cursor) {
    const provider = providerMap.get(String(row.providerId || ""));
    const enquiry = enquiryMap.get(String(row.enquiryId || ""));
    const coordinatesReady = provider && enquiry
      && Number.isFinite(Number(provider.serviceLatitude))
      && Number.isFinite(Number(provider.serviceLongitude))
      && Number.isFinite(Number(enquiry.locationLatitude))
      && Number.isFinite(Number(enquiry.locationLongitude));
    if (!coordinatesReady) {
      skipped += 1;
      continue;
    }
    const publishedAt = enquiry.marketplacePublishedAt || enquiry.distributedAt || row.distributedAt || enquiry.createdAt || new Date();
    const distance = haversineDistanceKm(
      provider.serviceLatitude,
      provider.serviceLongitude,
      enquiry.locationLatitude,
      enquiry.locationLongitude,
    );
    operations.push({
      updateOne: {
        filter: { _id: row._id },
        update: {
          $set: {
            leadLatitude: Number(enquiry.locationLatitude),
            leadLongitude: Number(enquiry.locationLongitude),
            providerDistanceKm: distance,
            marketplacePublishedAt: publishedAt,
            marketplaceVisibleAt: marketplaceVisibleAt(publishedAt, distance),
            updatedAt: new Date(),
          },
        },
      },
    });
    if (operations.length >= 500) await flush();
  }
  await flush();
  return { updated, skipped };
}

async function main() {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    throw new Error("GOOGLE_MAPS_API_KEY is required for marketplace location backfill");
  }
  await connectDatabase();
  console.log("Backfilling provider service locations...");
  console.log(await backfillProviders());
  console.log("Backfilling lead locations...");
  console.log(await backfillEnquiries());
  console.log("Recalculating marketplace visibility...");
  console.log(await backfillDistributions());
}

main()
  .then(async () => {
    await mongoose.disconnect();
    console.log("Marketplace location backfill complete");
  })
  .catch(async (error) => {
    console.error(error);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
