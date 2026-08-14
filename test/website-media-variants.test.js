"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("website media uses server-side Sharp processing with fixed responsive variants", () => {
  const pkg = JSON.parse(source("package.json"));
  const model = source("models/WebsiteMedia.js");
  const processor = source("services/website-content/image-processor.js");
  assert.match(pkg.dependencies.sharp, /^\^0\.35\.3$/);
  assert.match(processor, /require\("sharp"\)/);
  for (const [name, width, height] of [
    ["thumbnail", 320, 240],
    ["card", 640, 480],
    ["medium", 960, 720],
    ["large", 1440, 1080],
    ["banner", 1600, 600],
  ]) {
    assert.match(processor, new RegExp(`${name}: Object\\.freeze\\(\\{ width: ${width}, height: ${height}`));
    assert.match(model, new RegExp(`${name}: \\{ type: mediaVariantSchema`));
  }
  assert.match(processor, /\.webp\(\{ quality, effort: 4, smartSubsample: true \}\)/);
  assert.match(processor, /withoutEnlargement: true/);
});

test("media upload stages the source and CRM generates and removes variant objects safely", () => {
  const service = source("services/website-content/website-content-service.js");
  const view = source("views/website-content/media.ejs");
  assert.match(service, /media\/staging\//);
  assert.match(service, /storage\.getObject\(\{ key: sourceKey/);
  assert.match(service, /processWebsiteImage\(uploaded\.body\)/);
  assert.match(service, /original\.webp/);
  for (const name of ["thumbnail", "card", "medium", "large", "banner"]) assert.match(service, new RegExp(name));
  assert.match(service, /mediaStorageKeys/);
  assert.match(service, /Promise\.allSettled\(mediaStorageKeys\(row\)/);
  assert.doesNotMatch(view, /createImageBitmap|canvas\.toBlob/);
  assert.match(view, /responsive WebP sizes generated/);
  assert.match(view, /variants\?\.thumbnail\?\.publicUrl/);
});

test("public website payload exposes context-appropriate image variants and backfill exists", () => {
  const service = source("services/website-content/website-content-service.js");
  const migration = source("scripts/backfill-website-media-variants.js");
  const pkg = JSON.parse(source("package.json"));
  assert.match(service, /imageVariants: mediaPublicVariants\(cover\)/);
  assert.match(service, /mediaPublicUrl\(cover, "card"\)/);
  assert.match(service, /mediaPublicUrl\(bannerAsset, "banner"\)/);
  assert.match(service, /mediaVariants: mediaPublicVariants\(businessMedia\)/);
  assert.equal(pkg.scripts["migrate:website-media-variants"], "node scripts/run-with-runtime.js scripts/backfill-website-media-variants.js");
  assert.match(migration, /"variants\.card\.publicUrl"/);
  assert.match(migration, /processWebsiteImage/);
});

test("S3 getObject returns binary content with a processing size guard", async () => {
  const previousEnv = {
    AWS_REGION: process.env.AWS_REGION,
    AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_SESSION_TOKEN: process.env.AWS_SESSION_TOKEN,
  };
  const previousFetch = global.fetch;
  Object.assign(process.env, {
    AWS_REGION: "ap-south-1",
    AWS_S3_BUCKET: "findoly-prod",
    AWS_ACCESS_KEY_ID: "AKIAEXAMPLE123456789",
    AWS_SECRET_ACCESS_KEY: "secret-example-value-with-enough-length",
  });
  delete process.env.AWS_SESSION_TOKEN;
  const bytes = Buffer.from([0, 1, 2, 3, 255]);
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls += 1;
    if (options.method === "HEAD") {
      return { ok: true, status: 200, headers: new Headers({ "content-length": String(bytes.length), "content-type": "image/png" }) };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  };
  try {
    delete require.cache[require.resolve("../services/storage/s3-service")];
    const storage = require("../services/storage/s3-service");
    const value = await storage.getObject({ key: "public/website-content/media/staging/test.png", maxBytes: 1024 });
    assert.deepEqual(value.body, bytes);
    assert.equal(value.contentType, "image/png");
    assert.equal(calls, 2);
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve("../services/storage/s3-service")];
  }
});
