"use strict";

const sharp = require("sharp");
const { validationError } = require("../../utils/validation");

const MAX_INPUT_PIXELS = 40_000_000;
const MAX_INPUT_WIDTH = 20_000;
const MAX_INPUT_HEIGHT = 20_000;
const SUPPORTED_FORMATS = new Set(["jpeg", "png", "webp"]);

const VARIANT_SPECS = Object.freeze({
  thumbnail: Object.freeze({ width: 320, height: 240, quality: 80 }),
  card: Object.freeze({ width: 640, height: 480, quality: 80 }),
  medium: Object.freeze({ width: 960, height: 720, quality: 82 }),
  large: Object.freeze({ width: 1440, height: 1080, quality: 84 }),
  banner: Object.freeze({ width: 1600, height: 600, quality: 84 }),
});

const ORIGINAL_SPEC = Object.freeze({ width: 2400, height: 2400, quality: 86 });

function newPipeline(buffer) {
  return sharp(buffer, {
    limitInputPixels: MAX_INPUT_PIXELS,
    sequentialRead: true,
  }).rotate();
}

async function inputMetadata(buffer) {
  let metadata;
  try {
    metadata = await sharp(buffer, {
      limitInputPixels: MAX_INPUT_PIXELS,
      sequentialRead: true,
    }).metadata();
  } catch (error) {
    throw Object.assign(validationError("Uploaded file could not be decoded as a supported image"), { cause: error });
  }
  const format = String(metadata.format || "").toLowerCase();
  if (!SUPPORTED_FORMATS.has(format)) throw validationError("Website media must be JPEG, PNG, or WebP");
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (!width || !height) throw validationError("Uploaded image dimensions could not be detected");
  if (width > MAX_INPUT_WIDTH || height > MAX_INPUT_HEIGHT || width * height > MAX_INPUT_PIXELS) {
    throw validationError("Uploaded image dimensions are too large");
  }
  return { format, width, height };
}

async function webpOutput(buffer, resize, quality) {
  const { data, info } = await newPipeline(buffer)
    .resize(resize)
    .webp({ quality, effort: 4, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });
  return {
    buffer: data,
    mimeType: "image/webp",
    sizeBytes: data.length,
    width: Number(info.width || 0),
    height: Number(info.height || 0),
  };
}

async function processWebsiteImage(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw validationError("Image content is required");
  const source = await inputMetadata(buffer);
  const original = await webpOutput(buffer, {
    width: ORIGINAL_SPEC.width,
    height: ORIGINAL_SPEC.height,
    fit: "inside",
    withoutEnlargement: true,
  }, ORIGINAL_SPEC.quality);

  const variants = {};
  for (const [name, spec] of Object.entries(VARIANT_SPECS)) {
    variants[name] = await webpOutput(buffer, {
      width: spec.width,
      height: spec.height,
      fit: "cover",
      position: "centre",
      withoutEnlargement: true,
    }, spec.quality);
  }

  return { source, original, variants };
}

module.exports = {
  MAX_INPUT_PIXELS,
  VARIANT_SPECS,
  ORIGINAL_SPEC,
  processWebsiteImage,
};
