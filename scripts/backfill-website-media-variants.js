#!/usr/bin/env node
"use strict";

const mongoose = require("mongoose");
const connectDatabase = require("../db/connection");
const WebsiteMedia = require("../models/WebsiteMedia");
const storage = require("../services/storage/s3-service");
const { processWebsiteImage } = require("../services/website-content/image-processor");

const WEBSITE_PREFIX = "website-content/";
const VARIANT_NAMES = ["thumbnail", "card", "medium", "large", "banner"];
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

function variantValue(settings, key, output) {
  return {
    s3Key: key,
    publicUrl: storage.publicUrl(key, settings),
    mimeType: "image/webp",
    sizeBytes: output.sizeBytes,
    width: output.width,
    height: output.height,
  };
}

async function uploadSet(row, processed, settings) {
  const prefix = `${settings.publicPrefix}${WEBSITE_PREFIX}media/${row.mediaId}/`;
  const createdKeys = [];
  try {
    const originalKey = `${prefix}original.webp`;
    await storage.putObject({ key: originalKey, contentType: "image/webp", body: processed.original.buffer });
    createdKeys.push(originalKey);
    const variants = {};
    for (const name of VARIANT_NAMES) {
      const output = processed.variants[name];
      const key = `${prefix}${name}.webp`;
      await storage.putObject({ key, contentType: "image/webp", body: output.buffer });
      createdKeys.push(key);
      variants[name] = variantValue(settings, key, output);
    }
    return { original: variantValue(settings, originalKey, processed.original), variants, createdKeys };
  } catch (error) {
    await Promise.allSettled(createdKeys.map((key) => storage.deleteObject({ key })));
    throw error;
  }
}

async function main() {
  await connectDatabase();
  const settings = storage.config();
  if (!settings.configured || !settings.cloudFrontDomain) throw new Error("Website S3 public storage is not configured");
  const rows = await WebsiteMedia.find({ active: { $ne: false }, "variants.card.publicUrl": { $in: [null, ""] } }).sort({ createdAt: 1, _id: 1 });
  console.log(`Website media variant backfill: ${rows.length} image(s) need processing.`);
  let completed = 0;
  for (const row of rows) {
    const previousKey = row.s3Key;
    const downloaded = await storage.getObject({ key: previousKey, maxBytes: MAX_SOURCE_BYTES });
    const processed = await processWebsiteImage(downloaded.body);
    const stored = await uploadSet(row, processed, settings);
    row.s3Key = stored.original.s3Key;
    row.publicUrl = stored.original.publicUrl;
    row.mimeType = "image/webp";
    row.sizeBytes = stored.original.sizeBytes;
    row.width = stored.original.width;
    row.height = stored.original.height;
    row.variants = stored.variants;
    row.updatedBy = "website-media-variant-backfill";
    try {
      await row.save();
    } catch (error) {
      await Promise.allSettled(stored.createdKeys.map((key) => storage.deleteObject({ key })));
      throw error;
    }
    if (previousKey !== stored.original.s3Key) {
      await storage.deleteObject({ key: previousKey }).catch((error) => {
        console.warn(`Could not delete legacy image ${row.mediaId}: ${error.code || "S3_DELETE_FAILED"}`);
      });
    }
    completed += 1;
    console.log(`Processed ${completed}/${rows.length}: ${row.mediaId}`);
  }
  console.log(`Website media variant backfill complete: ${completed} image(s) processed.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Website media variant backfill failed:", error.message);
    process.exitCode = 1;
  }).finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
}

module.exports = { main };
