const crypto = require("crypto");
const Category = require("../../models/Category");
const ServiceType = require("../../models/ServiceType");
const WebsiteMedia = require("../../models/WebsiteMedia");
const WebsiteCatalogItem = require("../../models/WebsiteCatalogItem");
const HomepageContent = require("../../models/HomepageContent");
const uuid = require("../../utils/uuid");
const storage = require("../storage/s3-service");
const { processWebsiteImage } = require("./image-processor");
const {
  humanTextValue,
  tokenValue,
  booleanValue,
  numberValue,
  identifierValue,
  validationError,
  queryTextValue,
} = require("../../utils/validation");

const WEBSITE_PREFIX = "website-content/";
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_WEBSITE_SOURCE_BYTES = 12 * 1024 * 1024;
const VARIANT_NAMES = ["thumbnail", "card", "medium", "large", "banner"];

function actorName(actor) {
  return String(actor?.employeeId || actor?.name || actor || "crm-admin").slice(0, 160);
}

function slugify(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function presentVariant(value = {}) {
  if (!value?.publicUrl && !value?.s3Key) return null;
  return {
    s3Key: value.s3Key || "",
    publicUrl: value.publicUrl || "",
    mimeType: value.mimeType || "image/webp",
    sizeBytes: Number(value.sizeBytes || 0),
    width: Number(value.width || 0),
    height: Number(value.height || 0),
  };
}

function presentVariants(row = {}) {
  const variants = {};
  for (const name of VARIANT_NAMES) {
    const value = presentVariant(row?.variants?.[name]);
    if (value) variants[name] = value;
  }
  return variants;
}

function mediaPublicUrl(row, variantName = "") {
  if (!row) return "";
  if (variantName && row.variants?.[variantName]?.publicUrl) return row.variants[variantName].publicUrl;
  return row.publicUrl || "";
}

function mediaPublicVariants(row) {
  if (!row) return {};
  const variants = {};
  for (const [name, value] of Object.entries(row.variants || {})) {
    if (value?.publicUrl) variants[name] = { ...value };
  }
  return variants;
}

function presentMedia(row = {}) {
  return {
    mediaId: row.mediaId || "",
    fileName: row.fileName || "",
    originalName: row.originalName || "",
    s3Key: row.s3Key || "",
    publicUrl: row.publicUrl || "",
    mimeType: row.mimeType || "",
    sizeBytes: Number(row.sizeBytes || 0),
    width: Number(row.width || 0),
    height: Number(row.height || 0),
    variants: presentVariants(row),
    altText: row.altText || "",
    caption: row.caption || "",
    active: row.active !== false,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  };
}

async function mediaMap(ids) {
  const values = [...new Set((ids || []).filter(Boolean))];
  if (!values.length) return new Map();
  const rows = await WebsiteMedia.find({ mediaId: { $in: values }, active: { $ne: false } }).lean();
  return new Map(rows.map((row) => [row.mediaId, presentMedia(row)]));
}

async function listMedia(options = {}) {
  const limit = numberValue(options.limit, { label: "Media limit", fallback: 100, min: 1, max: 500, integer: true });
  const q = queryTextValue(options.q, { label: "Media search", maxLength: 100 });
  const query = { active: { $ne: false } };
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");
    query.$or = [{ fileName: regex }, { originalName: regex }, { altText: regex }];
  }
  const rows = await WebsiteMedia.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
  return rows.map(presentMedia);
}

async function createMediaUpload(input = {}) {
  const settings = storage.publicConfig();
  if (!settings.configured) throw Object.assign(new Error(settings.configurationMessage || "S3 is not configured"), { status: 503 });
  if (!settings.cloudFrontDomain) {
    throw Object.assign(new Error("AWS_CLOUDFRONT_DOMAIN or S3_PUBLIC_BASE_URL is required for website images"), { status: 503 });
  }
  const mimeType = String(input.contentType || "").trim().toLowerCase();
  if (!IMAGE_TYPES.has(mimeType)) throw validationError("Website media must be JPEG, PNG, or WebP");
  const sizeBytes = numberValue(input.sizeBytes, { label: "Image size", min: 1, max: Math.min(settings.maxUploadMb, 12) * 1024 * 1024, integer: true });
  const rawName = humanTextValue(input.fileName, { label: "File name", required: true, maxLength: 180 });
  const extension = mimeType === "image/webp" ? ".webp" : mimeType === "image/png" ? ".png" : ".jpg";
  const base = slugify(rawName.replace(/\.[^.]+$/, "")) || "image";
  const fileName = `${base}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}${extension}`;
  const prefix = `${settings.publicPrefix}${WEBSITE_PREFIX}media/staging/`;
  return storage.createUploadUrl({ prefix, fileName, contentType: mimeType, sizeBytes, replace: false });
}

function storedVariant(settings, key, output) {
  return {
    s3Key: key,
    publicUrl: storage.publicUrl(key, settings),
    mimeType: output.mimeType,
    sizeBytes: output.sizeBytes,
    width: output.width,
    height: output.height,
  };
}

async function uploadProcessedMedia(mediaId, processed, settings) {
  const prefix = `${settings.publicPrefix}${WEBSITE_PREFIX}media/${mediaId}/`;
  const uploadedKeys = [];
  try {
    const originalKey = `${prefix}original.webp`;
    await storage.putObject({ key: originalKey, contentType: "image/webp", body: processed.original.buffer });
    uploadedKeys.push(originalKey);
    const variants = {};
    for (const name of VARIANT_NAMES) {
      const output = processed.variants[name];
      if (!output) continue;
      const key = `${prefix}${name}.webp`;
      await storage.putObject({ key, contentType: "image/webp", body: output.buffer });
      uploadedKeys.push(key);
      variants[name] = storedVariant(settings, key, output);
    }
    return {
      original: storedVariant(settings, originalKey, processed.original),
      variants,
      uploadedKeys,
    };
  } catch (error) {
    await Promise.allSettled(uploadedKeys.map((key) => storage.deleteObject({ key })));
    throw error;
  }
}

async function registerMedia(input = {}, actor) {
  const settings = storage.config();
  const sourceKey = storage.normalizeObjectKey(input.s3Key, settings);
  const expectedPrefix = `${settings.publicPrefix}${WEBSITE_PREFIX}media/staging/`;
  if (!sourceKey.startsWith(expectedPrefix)) throw validationError("Website image key is invalid");
  const mediaId = uuid();
  try {
    const uploaded = await storage.getObject({ key: sourceKey, maxBytes: MAX_WEBSITE_SOURCE_BYTES });
    const uploadedType = String(uploaded.contentType || "").split(";")[0].trim().toLowerCase();
    if (uploadedType && !IMAGE_TYPES.has(uploadedType)) throw validationError("Uploaded S3 object is not a supported website image");
    const declaredSize = numberValue(input.sizeBytes, { label: "Image size", min: 1, max: MAX_WEBSITE_SOURCE_BYTES, integer: true });
    if (Math.abs(Number(uploaded.sizeBytes) - declaredSize) > 1) throw validationError("Uploaded image size does not match the registered file");

    const processed = await processWebsiteImage(uploaded.body);
    const stored = await uploadProcessedMedia(mediaId, processed, settings);
    let row;
    try {
      const originalName = humanTextValue(input.originalName, { label: "Original file name", maxLength: 255 });
      const baseName = slugify(String(originalName || input.fileName || "image").replace(/\.[^.]+$/, "")) || "image";
      row = await WebsiteMedia.create({
        mediaId,
        fileName: `${baseName}.webp`,
        originalName,
        s3Key: stored.original.s3Key,
        publicUrl: stored.original.publicUrl,
        mimeType: "image/webp",
        sizeBytes: stored.original.sizeBytes,
        width: stored.original.width,
        height: stored.original.height,
        variants: stored.variants,
        altText: humanTextValue(input.altText, { label: "Alt text", maxLength: 300 }),
        caption: humanTextValue(input.caption, { label: "Caption", maxLength: 1000 }),
        uploadedBy: actorName(actor),
        updatedBy: actorName(actor),
      });
    } catch (error) {
      await Promise.allSettled(stored.uploadedKeys.map((key) => storage.deleteObject({ key })));
      throw error;
    }
    return presentMedia(row.toObject());
  } finally {
    await storage.deleteObject({ key: sourceKey }).catch((error) => {
      console.warn(`Website media staging cleanup failed for ${mediaId}: ${error.code || "S3_DELETE_FAILED"}`);
    });
  }
}

async function updateMedia(mediaId, input = {}, actor) {
  const id = identifierValue(mediaId, { label: "Media ID" });
  const row = await WebsiteMedia.findOne({ mediaId: id, active: { $ne: false } });
  if (!row) throw Object.assign(new Error("Media not found"), { status: 404 });
  if (input.altText !== undefined) row.altText = humanTextValue(input.altText, { label: "Alt text", maxLength: 300 });
  if (input.caption !== undefined) row.caption = humanTextValue(input.caption, { label: "Caption", maxLength: 1000 });
  row.updatedBy = actorName(actor);
  await row.save();
  return presentMedia(row.toObject());
}

async function mediaUsage(mediaId) {
  const id = identifierValue(mediaId, { label: "Media ID" });
  const [items, categories, serviceTypes, homepage] = await Promise.all([
    WebsiteCatalogItem.find({ $or: [{ coverMediaId: id }, { galleryMediaIds: id }] }).select("itemId kind name").lean(),
    Category.find({ $or: [{ imageMediaId: id }, { bannerMediaId: id }] }).select("categoryId name").lean(),
    ServiceType.find({ imageMediaId: id }).select("serviceTypeId name").lean(),
    HomepageContent.findOne({ homepageKey: "main" }).lean(),
  ]);
  const homepageText = JSON.stringify(homepage?.draft || {}) + JSON.stringify(homepage?.published || {});
  return {
    items: items.map((row) => ({ type: row.kind, id: row.itemId, name: row.name })),
    categories: categories.map((row) => ({ type: "category", id: row.categoryId, name: row.name })),
    subcategories: serviceTypes.map((row) => ({ type: "subcategory", id: row.serviceTypeId, name: row.name })),
    homepage: homepageText.includes(id) ? [{ type: "homepage", id: "main", name: "Homepage" }] : [],
  };
}

function mediaStorageKeys(row) {
  return [...new Set([
    row?.s3Key,
    ...VARIANT_NAMES.map((name) => row?.variants?.[name]?.s3Key),
  ].filter(Boolean))];
}

async function deleteMedia(mediaId) {
  const id = identifierValue(mediaId, { label: "Media ID" });
  const row = await WebsiteMedia.findOne({ mediaId: id, active: { $ne: false } });
  if (!row) throw Object.assign(new Error("Media not found"), { status: 404 });
  const usage = await mediaUsage(id);
  const references = Object.values(usage).flat();
  if (references.length) {
    throw Object.assign(new Error("This image is still used by website content. Remove those references before deleting it."), { status: 409, details: usage });
  }
  const results = await Promise.allSettled(mediaStorageKeys(row).map((key) => storage.deleteObject({ key })));
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
  row.active = false;
  await row.save();
  return { mediaId: id, deleted: true };
}

function normalizeItemInput(input = {}, current = null) {
  const existing = current || {};
  const kind = ["service", "product"].includes(String(input.kind || existing.kind || "").toLowerCase())
    ? String(input.kind || existing.kind).toLowerCase()
    : "service";
  const name = humanTextValue(input.name ?? existing.name, { label: `${kind} name`, required: true, maxLength: 160 });
  const slug = tokenValue(input.slug ?? existing.slug ?? slugify(name), { label: `${kind} slug`, required: true, maxLength: 100, lowercase: true });
  return {
    kind,
    name,
    slug,
    shortDescription: humanTextValue(input.shortDescription ?? existing.shortDescription, { label: "Short description", maxLength: 500 }),
    description: humanTextValue(input.description ?? existing.description, { label: "Description", maxLength: 5000 }),
    coverMediaId: String(input.coverMediaId ?? existing.coverMediaId ?? "").trim(),
    galleryMediaIds: [...new Set((Array.isArray(input.galleryMediaIds) ? input.galleryMediaIds : existing.galleryMediaIds || []).map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 20),
    displayOrder: numberValue(input.displayOrder, { label: "Display order", fallback: existing.displayOrder ?? 0, min: 0, max: 100000, integer: true }),
    active: booleanValue(input.active, { label: "Active state", fallback: existing.active !== false }),
    websiteVisible: booleanValue(input.websiteVisible, { label: "Website visibility", fallback: existing.websiteVisible !== false }),
  };
}

async function resolveTaxonomy(input = {}, current = null) {
  const categoryId = String(input.categoryId || current?.categoryId || "").trim();
  const serviceTypeId = String(input.serviceTypeId || current?.serviceTypeId || "").trim();
  const category = await Category.findOne({ $or: [{ categoryId }, { id: categoryId }] }).lean();
  if (!category) throw validationError("Choose a valid Category");
  const serviceType = await ServiceType.findOne({ $or: [{ serviceTypeId }, { id: serviceTypeId }], categoryId: category.categoryId }).lean();
  if (!serviceType) throw validationError("Choose a valid Subcategory under the selected Category");
  return { category, serviceType };
}

async function validateMediaIds(values) {
  const ids = [...new Set((values || []).filter(Boolean))];
  if (!ids.length) return;
  const count = await WebsiteMedia.countDocuments({ mediaId: { $in: ids }, active: { $ne: false } });
  if (count !== ids.length) throw validationError("One or more selected website images are invalid");
}

async function listItems(options = {}) {
  const query = {};
  const kind = String(options.kind || "").trim().toLowerCase();
  if (kind) {
    if (!["service", "product"].includes(kind)) throw validationError("Content type must be service or product");
    query.kind = kind;
  }
  if (options.categorySlug) query.categorySlug = String(options.categorySlug).trim();
  if (options.serviceTypeSlug) query.serviceTypeSlug = String(options.serviceTypeSlug).trim();
  if (String(options.includeInactive || "") !== "true") query.active = { $ne: false };
  const rows = await WebsiteCatalogItem.find(query).sort({ kind: 1, displayOrder: 1, name: 1, _id: 1 }).limit(5000).lean();
  const ids = rows.flatMap((row) => [row.coverMediaId, ...(row.galleryMediaIds || [])]).filter(Boolean);
  const media = await mediaMap(ids);
  return rows.map((row) => ({
    ...row,
    coverImage: media.get(row.coverMediaId) || null,
    galleryImages: (row.galleryMediaIds || []).map((id) => media.get(id)).filter(Boolean),
  }));
}

async function createItem(input = {}, actor) {
  const taxonomy = await resolveTaxonomy(input);
  const normalized = normalizeItemInput(input);
  await validateMediaIds([normalized.coverMediaId, ...normalized.galleryMediaIds]);
  const row = await WebsiteCatalogItem.create({
    ...normalized,
    categoryId: taxonomy.category.categoryId,
    categorySlug: taxonomy.category.slug,
    serviceTypeId: taxonomy.serviceType.serviceTypeId,
    serviceTypeSlug: taxonomy.serviceType.slug,
    createdBy: actorName(actor),
    updatedBy: actorName(actor),
  });
  return (await listItems({ kind: row.kind, includeInactive: true })).find((item) => item.itemId === row.itemId);
}

async function updateItem(itemId, input = {}, actor) {
  const id = identifierValue(itemId, { label: "Website item ID" });
  const row = await WebsiteCatalogItem.findOne({ itemId: id });
  if (!row) throw Object.assign(new Error("Website item not found"), { status: 404 });
  const taxonomy = await resolveTaxonomy(input, row);
  const normalized = normalizeItemInput(input, row);
  if (normalized.kind !== row.kind) throw validationError("Website content type cannot be changed after creation");
  await validateMediaIds([normalized.coverMediaId, ...normalized.galleryMediaIds]);
  Object.assign(row, normalized, {
    categorySlug: taxonomy.category.slug,
    serviceTypeSlug: taxonomy.serviceType.slug,
    updatedBy: actorName(actor),
  });
  // Keep immutable taxonomy IDs stable once an item is created. Moving across taxonomy would break saved customer routes.
  if (taxonomy.category.categoryId !== row.categoryId || taxonomy.serviceType.serviceTypeId !== row.serviceTypeId) {
    throw validationError("Category and Subcategory cannot be changed after creation. Create a new item instead.");
  }
  await row.save();
  return (await listItems({ kind: row.kind, includeInactive: true })).find((item) => item.itemId === row.itemId);
}

async function deleteItem(itemId) {
  const id = identifierValue(itemId, { label: "Website item ID" });
  const row = await WebsiteCatalogItem.findOne({ itemId: id }).lean();
  if (!row) throw Object.assign(new Error("Website item not found"), { status: 404 });
  await WebsiteCatalogItem.deleteOne({ itemId: id });
  return {
    itemId: row.itemId,
    kind: row.kind,
    name: row.name,
    deleted: true,
  };
}

function text(value, max = 300) {
  return humanTextValue(value, { label: "Homepage content", maxLength: max });
}

function section(input = {}, defaults = {}) {
  return {
    enabled: booleanValue(input.enabled, { label: "Section visibility", fallback: defaults.enabled !== false }),
    heading: text(input.heading ?? defaults.heading ?? "", 160),
    subheading: text(input.subheading ?? defaults.subheading ?? "", 300),
    itemIds: [...new Set((Array.isArray(input.itemIds) ? input.itemIds : defaults.itemIds || []).map(String).filter(Boolean))].slice(0, 24),
    categorySlugs: [...new Set((Array.isArray(input.categorySlugs) ? input.categorySlugs : defaults.categorySlugs || []).map(String).filter(Boolean))].slice(0, 24),
    mediaId: String(input.mediaId ?? defaults.mediaId ?? "").trim(),
    buttonText: text(input.buttonText ?? defaults.buttonText ?? "", 100),
    buttonHref: String(input.buttonHref ?? defaults.buttonHref ?? "").trim().slice(0, 500),
  };
}

const DEFAULT_MARKETPLACE_GROUPS = [
  { id: "for-you", label: "For You", enabled: true, categorySlugs: [] },
  { id: "home-services", label: "Home", enabled: true, categorySlugs: [] },
  { id: "repairs", label: "Repairs", enabled: true, categorySlugs: [] },
  { id: "events", label: "Events", enabled: true, categorySlugs: [] },
  { id: "business", label: "Business", enabled: true, categorySlugs: [] },
];

function normalizeGroupId(value, fallback) {
  const candidate = slugify(String(value || fallback || ""));
  return candidate || fallback || "group";
}

function normalizeMarketplaceGroups(input) {
  const source = Array.isArray(input) && input.length ? input : DEFAULT_MARKETPLACE_GROUPS;
  const result = [];
  const used = new Set();
  for (let index = 0; index < source.length && result.length < 12; index += 1) {
    const raw = source[index] || {};
    const fallbackId = index === 0 ? "for-you" : `group-${index + 1}`;
    let id = normalizeGroupId(raw.id, fallbackId);
    if (used.has(id)) continue;
    used.add(id);
    result.push({
      id,
      label: text(raw.label || (id === "for-you" ? "For You" : id.replace(/-/g, " ")), 60),
      enabled: booleanValue(raw.enabled, { label: "Marketplace group visibility", fallback: true }),
      // Navigation tabs are presentation-only. Category curation belongs to homepage sections.
      categorySlugs: [],
    });
  }
  if (!result.some((row) => row.id === "for-you")) result.unshift({ id: "for-you", label: "For You", enabled: true, categorySlugs: [] });
  return result;
}

function normalizeDynamicSection(raw = {}, index = 0) {
  const contentType = ["categories", "items", "promotion"].includes(String(raw.contentType || "").toLowerCase())
    ? String(raw.contentType).toLowerCase()
    : "items";
  const layout = ["rail", "grid", "list", "callout"].includes(String(raw.layout || "").toLowerCase())
    ? String(raw.layout).toLowerCase()
    : contentType === "promotion" ? "callout" : "rail";
  return {
    id: normalizeGroupId(raw.id, `section-${index + 1}`),
    enabled: booleanValue(raw.enabled, { label: "Homepage section visibility", fallback: true }),
    groupId: normalizeGroupId(raw.groupId, "for-you"),
    contentType,
    layout,
    heading: text(raw.heading || "", 160),
    subheading: text(raw.subheading || "", 300),
    categorySlugs: [...new Set((Array.isArray(raw.categorySlugs) ? raw.categorySlugs : []).map(String).filter(Boolean))].slice(0, 24),
    itemIds: [...new Set((Array.isArray(raw.itemIds) ? raw.itemIds : []).map(String).filter(Boolean))].slice(0, 24),
    cardLimit: numberValue(raw.cardLimit, { label: "Homepage card limit", fallback: 6, min: 1, max: 24, integer: true }),
    seeAllHref: String(raw.seeAllHref || "/explore").trim().slice(0, 500),
    buttonText: text(raw.buttonText || "", 100),
    buttonHref: String(raw.buttonHref || "").trim().slice(0, 500),
    mediaId: String(raw.mediaId || "").trim(),
  };
}

function legacyDynamicSections(input = {}, defaults = {}) {
  const definitions = [
    ["popular", "popular", "for-you", "items", "rail"],
    ["featured-categories", "featuredCategories", "for-you", "categories", "grid"],
    ["home-care", "homeCare", "home-services", "items", "rail"],
    ["repairs", "repairs", "repairs", "items", "rail"],
    ["events", "events", "events", "items", "rail"],
  ];
  return definitions.map(([id, key, groupId, contentType, layout], index) => {
    const value = section(input[key], defaults[key]);
    return normalizeDynamicSection({ id, groupId, contentType, layout, ...value, seeAllHref: "/explore" }, index);
  });
}

function defaultHomepage() {
  const legacy = {
    featuredCategories: section({}, { heading: "What do you need help with?", subheading: "Browse by service category", enabled: false }),
    popular: section({}, { heading: "Popular near you", subheading: "Common requirements people look for every day", enabled: false }),
    homeCare: section({}, { heading: "For your home", subheading: "Cleaning, painting and everyday home care", enabled: false }),
    repairs: section({}, { heading: "Home repairs", subheading: "Quick access to common repair needs", enabled: false }),
    events: section({}, { heading: "Events & occasions", subheading: "Find help for celebrations and important days", enabled: false }),
  };
  return {
    hero: { enabled: true, eyebrow: "Find services around you", heading: "What do you need today?" },
    marketplaceGroups: normalizeMarketplaceGroups(DEFAULT_MARKETPLACE_GROUPS),
    sections: legacyDynamicSections(legacy, legacy),
    ...legacy,
    sectionOrder: ["popular", "featuredCategories", "homeCare", "repairs", "events"],
    howItWorks: {
      enabled: true,
      heading: "How Findoly works",
      steps: [
        { title: "Tell us what you need", text: "Choose a service or describe your requirement." },
        { title: "Add your location", text: "Share where you need the service." },
        { title: "Submit request", text: "Verify mobile and send it." },
      ],
    },
    businessCta: {
      enabled: true,
      eyebrow: "For business",
      heading: "Need something for your office or business?",
      text: "Explore sourcing, office support, marketing and operational requirements.",
      buttonText: "Explore business services",
      buttonHref: "/explore?group=business",
      mediaId: "",
    },
  };
}

function normalizeHomepage(input = {}) {
  const defaults = defaultHomepage();
  const steps = Array.isArray(input.howItWorks?.steps) ? input.howItWorks.steps.slice(0, 3) : defaults.howItWorks.steps;
  const marketplaceGroups = normalizeMarketplaceGroups(input.marketplaceGroups);
  const groupIds = new Set(marketplaceGroups.map((row) => row.id));
  const rawSections = Array.isArray(input.sections) ? input.sections : legacyDynamicSections(input, defaults);
  const sections = [];
  const sectionIds = new Set();
  for (let index = 0; index < rawSections.length && sections.length < 40; index += 1) {
    const row = normalizeDynamicSection(rawSections[index], index);
    if (sectionIds.has(row.id)) continue;
    sectionIds.add(row.id);
    if (!groupIds.has(row.groupId)) row.groupId = "for-you";
    sections.push(row);
  }
  return {
    hero: {
      enabled: booleanValue(input.hero?.enabled, { label: "Hero visibility", fallback: defaults.hero.enabled }),
      eyebrow: text(input.hero?.eyebrow ?? defaults.hero.eyebrow, 120),
      heading: text(input.hero?.heading ?? defaults.hero.heading, 180),
    },
    marketplaceGroups,
    sections,
    // Keep legacy keys so older customer builds and saved drafts remain readable during rollout.
    sectionOrder: Array.isArray(input.sectionOrder) ? input.sectionOrder.map(String).slice(0, 10) : defaults.sectionOrder,
    featuredCategories: section(input.featuredCategories, defaults.featuredCategories),
    popular: section(input.popular, defaults.popular),
    homeCare: section(input.homeCare, defaults.homeCare),
    repairs: section(input.repairs, defaults.repairs),
    events: section(input.events, defaults.events),
    howItWorks: {
      enabled: booleanValue(input.howItWorks?.enabled, { label: "How it works visibility", fallback: true }),
      heading: text(input.howItWorks?.heading ?? defaults.howItWorks.heading, 160),
      steps: steps.map((step, index) => ({
        title: text(step?.title ?? defaults.howItWorks.steps[index]?.title ?? "", 120),
        text: text(step?.text ?? defaults.howItWorks.steps[index]?.text ?? "", 300),
      })),
    },
    businessCta: {
      enabled: booleanValue(input.businessCta?.enabled, { label: "Business CTA visibility", fallback: true }),
      eyebrow: text(input.businessCta?.eyebrow ?? defaults.businessCta.eyebrow, 100),
      heading: text(input.businessCta?.heading ?? defaults.businessCta.heading, 180),
      text: text(input.businessCta?.text ?? defaults.businessCta.text, 400),
      buttonText: text(input.businessCta?.buttonText ?? defaults.businessCta.buttonText, 100),
      buttonHref: String(input.businessCta?.buttonHref ?? defaults.businessCta.buttonHref).trim().slice(0, 500),
      mediaId: String(input.businessCta?.mediaId || "").trim(),
    },
  };
}

async function validateHomepageSelections(homepage, { forPublish = false } = {}) {
  const groupIds = new Set(homepage.marketplaceGroups.map((row) => row.id));
  const categorySlugs = [...new Set(
    homepage.sections.flatMap((row) => row.categorySlugs || []).filter(Boolean),
  )];
  const itemIds = [...new Set(homepage.sections.flatMap((row) => row.itemIds || []).filter(Boolean))];

  if (categorySlugs.length) {
    const query = { slug: { $in: categorySlugs } };
    if (forPublish) Object.assign(query, { active: { $ne: false }, websiteVisible: { $ne: false } });
    const count = await Category.countDocuments(query);
    if (count !== categorySlugs.length) throw validationError(forPublish
      ? "One or more homepage Categories are missing, inactive, or hidden from Findoly.com"
      : "One or more homepage Categories no longer exist");
  }
  if (itemIds.length) {
    const query = { itemId: { $in: itemIds } };
    if (forPublish) Object.assign(query, { active: { $ne: false }, websiteVisible: { $ne: false } });
    const count = await WebsiteCatalogItem.countDocuments(query);
    if (count !== itemIds.length) throw validationError(forPublish
      ? "One or more homepage Services or Products are missing, inactive, or hidden from Findoly.com"
      : "One or more homepage Services or Products no longer exist");
  }
  for (const row of homepage.sections) {
    if (!groupIds.has(row.groupId)) throw validationError(`Homepage section \"${row.heading || row.id}\" uses an invalid marketplace group`);
    if (!forPublish || row.enabled === false) continue;
    if (row.contentType === "categories" && !row.categorySlugs.length) {
      throw validationError(`Homepage section \"${row.heading || row.id}\" is enabled but has no Categories`);
    }
    if (row.contentType === "items" && !row.itemIds.length) {
      throw validationError(`Homepage section \"${row.heading || row.id}\" is enabled but has no Services or Products`);
    }
  }
}

async function homepageAdmin() {
  const row = await HomepageContent.findOne({ homepageKey: "main" }).lean();
  return {
    draft: normalizeHomepage(row?.draft || defaultHomepage()),
    published: row?.published && Object.keys(row.published).length ? normalizeHomepage(row.published) : null,
    publishedAt: row?.publishedAt || null,
    updatedAt: row?.updatedAt || null,
  };
}

async function saveHomepageDraft(input = {}, actor) {
  const draft = normalizeHomepage(input);
  await validateHomepageSelections(draft);
  const mediaIds = [draft.businessCta.mediaId, ...draft.sections.map((row) => row.mediaId)].filter(Boolean);
  await validateMediaIds(mediaIds);
  const row = await HomepageContent.findOneAndUpdate(
    { homepageKey: "main" },
    { $set: { draft, updatedBy: actorName(actor) }, $setOnInsert: { homepageKey: "main" } },
    { upsert: true, new: true },
  ).lean();
  return { draft: normalizeHomepage(row.draft), publishedAt: row.publishedAt || null };
}

async function publishHomepage(actor) {
  const row = await HomepageContent.findOne({ homepageKey: "main" });
  const draft = normalizeHomepage(row?.draft || defaultHomepage());
  await validateHomepageSelections(draft, { forPublish: true });
  if (!row) {
    const created = await HomepageContent.create({ homepageKey: "main", draft, published: draft, publishedAt: new Date(), publishedBy: actorName(actor), updatedBy: actorName(actor) });
    return { published: normalizeHomepage(created.published), publishedAt: created.publishedAt };
  }
  row.published = draft;
  row.publishedAt = new Date();
  row.publishedBy = actorName(actor);
  row.updatedBy = actorName(actor);
  await row.save();
  return { published: normalizeHomepage(row.published), publishedAt: row.publishedAt };
}

async function publicWebsite() {
  const [categories, serviceTypes, items, homepageRow] = await Promise.all([
    Category.find({ active: { $ne: false }, websiteVisible: { $ne: false } }).sort({ displayOrder: 1, name: 1 }).lean(),
    ServiceType.find({ active: { $ne: false }, websiteVisible: { $ne: false } }).sort({ displayOrder: 1, name: 1 }).lean(),
    WebsiteCatalogItem.find({ active: { $ne: false }, websiteVisible: { $ne: false } }).sort({ displayOrder: 1, name: 1 }).lean(),
    HomepageContent.findOne({ homepageKey: "main" }).lean(),
  ]);
  const homepage = homepageRow?.published && Object.keys(homepageRow.published).length
    ? normalizeHomepage(homepageRow.published)
    : defaultHomepage();
  const homepageMediaIds = [
    homepage.businessCta?.mediaId,
    ...homepage.sections.map((row) => row.mediaId),
  ];
  const mediaIds = [
    ...categories.flatMap((row) => [row.imageMediaId, row.bannerMediaId]),
    ...serviceTypes.map((row) => row.imageMediaId),
    ...items.flatMap((row) => [row.coverMediaId, ...(row.galleryMediaIds || [])]),
    ...homepageMediaIds,
  ].filter(Boolean);
  const media = await mediaMap(mediaIds);
  const itemRows = items.map((row) => {
    const cover = media.get(row.coverMediaId);
    const galleryAssets = (row.galleryMediaIds || []).map((id) => media.get(id)).filter(Boolean);
    return {
      itemId: row.itemId,
      id: row.slug,
      kind: row.kind,
      name: row.name,
      slug: row.slug,
      categoryId: row.categoryId,
      categorySlug: row.categorySlug,
      serviceTypeId: row.serviceTypeId,
      serviceTypeSlug: row.serviceTypeSlug,
      shortDescription: row.shortDescription || "",
      description: row.description || "",
      displayOrder: Number(row.displayOrder || 0),
      image: mediaPublicUrl(cover, "card") || "/assets/requirement-fallback.svg",
      imageVariants: mediaPublicVariants(cover),
      fallbackImage: "/assets/requirement-fallback.svg",
      gallery: galleryAssets.map((asset) => mediaPublicUrl(asset, "medium") || asset.publicUrl).filter(Boolean),
      galleryVariants: galleryAssets.map(mediaPublicVariants),
    };
  });
  const subcategoryMap = new Map();
  for (const row of serviceTypes) {
    const imageAsset = media.get(row.imageMediaId);
    subcategoryMap.set(row.serviceTypeId, {
      serviceTypeId: row.serviceTypeId,
      id: row.slug,
      slug: row.slug,
      name: row.name,
      description: row.description || "",
      categoryId: row.categoryId,
      categorySlug: row.categorySlug,
      displayOrder: Number(row.displayOrder || 0),
      image: mediaPublicUrl(imageAsset, "card") || "/assets/requirement-fallback.svg",
      imageVariants: mediaPublicVariants(imageAsset),
      items: itemRows.filter((item) => item.serviceTypeId === row.serviceTypeId),
    });
  }
  const categoryRows = categories.map((row) => {
    const imageAsset = media.get(row.imageMediaId);
    const bannerAsset = media.get(row.bannerMediaId);
    return {
      categoryId: row.categoryId,
      id: row.slug,
      slug: row.slug,
      name: row.name,
      description: row.description || "",
      displayOrder: Number(row.displayOrder || 0),
      image: mediaPublicUrl(imageAsset, "card") || "/assets/requirement-fallback.svg",
      imageVariants: mediaPublicVariants(imageAsset),
      bannerImage: mediaPublicUrl(bannerAsset, "banner") || "",
      bannerImageVariants: mediaPublicVariants(bannerAsset),
      subcategories: serviceTypes.filter((child) => child.categoryId === row.categoryId).map((child) => subcategoryMap.get(child.serviceTypeId)),
    };
  });
  const businessMedia = media.get(homepage.businessCta?.mediaId);
  const homepageSections = homepage.sections.map((row) => {
    const sectionMedia = media.get(row.mediaId);
    return {
      ...row,
      mediaUrl: mediaPublicUrl(sectionMedia, "banner"),
      mediaVariants: mediaPublicVariants(sectionMedia),
    };
  });
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    categories: categoryRows,
    items: itemRows,
    homepage: {
      ...homepage,
      sections: homepageSections,
      businessCta: {
        ...homepage.businessCta,
        mediaUrl: mediaPublicUrl(businessMedia, "banner"),
        mediaVariants: mediaPublicVariants(businessMedia),
      },
    },
  };
}

module.exports = {
  listMedia,
  createMediaUpload,
  registerMedia,
  updateMedia,
  mediaUsage,
  deleteMedia,
  listItems,
  createItem,
  updateItem,
  deleteItem,
  homepageAdmin,
  saveHomepageDraft,
  publishHomepage,
  publicWebsite,
  defaultHomepage,
  normalizeHomepage,
};
