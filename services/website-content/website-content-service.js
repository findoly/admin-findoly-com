const crypto = require("crypto");
const Category = require("../../models/Category");
const ServiceType = require("../../models/ServiceType");
const WebsiteMedia = require("../../models/WebsiteMedia");
const WebsiteCatalogItem = require("../../models/WebsiteCatalogItem");
const HomepageContent = require("../../models/HomepageContent");
const storage = require("../storage/s3-service");
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

function actorName(actor) {
  return String(actor?.employeeId || actor?.name || actor || "crm-admin").slice(0, 160);
}

function slugify(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function mediaPublicUrl(row) {
  return row?.publicUrl || "";
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
  const prefix = `${settings.publicPrefix}${WEBSITE_PREFIX}media/`;
  return storage.createUploadUrl({ prefix, fileName, contentType: mimeType, sizeBytes, replace: false });
}

async function registerMedia(input = {}, actor) {
  const settings = storage.config();
  const s3Key = storage.normalizeObjectKey(input.s3Key, settings);
  const expectedPrefix = `${settings.publicPrefix}${WEBSITE_PREFIX}media/`;
  if (!s3Key.startsWith(expectedPrefix)) throw validationError("Website image key is invalid");
  const publicUrl = storage.publicUrl(s3Key, settings);
  if (!publicUrl) throw validationError("Website image public URL could not be generated");
  const mimeType = String(input.mimeType || "").trim().toLowerCase();
  if (!IMAGE_TYPES.has(mimeType)) throw validationError("Website media must be JPEG, PNG, or WebP");
  const uploaded = await storage.createDownloadUrl({ key: s3Key, disposition: "inline" });
  const uploadedType = String(uploaded.contentType || "").split(";")[0].trim().toLowerCase();
  if (uploadedType && !IMAGE_TYPES.has(uploadedType)) throw validationError("Uploaded S3 object is not a supported website image");
  const declaredSize = numberValue(input.sizeBytes, { label: "Image size", min: 1, max: 50 * 1024 * 1024, integer: true });
  if (uploaded.sizeBytes && Math.abs(Number(uploaded.sizeBytes) - declaredSize) > 1) {
    throw validationError("Uploaded image size does not match the registered file");
  }
  const row = await WebsiteMedia.create({
    fileName: humanTextValue(input.fileName || s3Key.split("/").pop(), { label: "File name", required: true, maxLength: 255 }),
    originalName: humanTextValue(input.originalName, { label: "Original file name", maxLength: 255 }),
    s3Key,
    publicUrl,
    mimeType,
    sizeBytes: Number(uploaded.sizeBytes || declaredSize),
    width: numberValue(input.width, { label: "Image width", fallback: 0, min: 0, max: 20000, integer: true }),
    height: numberValue(input.height, { label: "Image height", fallback: 0, min: 0, max: 20000, integer: true }),
    altText: humanTextValue(input.altText, { label: "Alt text", maxLength: 300 }),
    caption: humanTextValue(input.caption, { label: "Caption", maxLength: 1000 }),
    uploadedBy: actorName(actor),
    updatedBy: actorName(actor),
  });
  return presentMedia(row.toObject());
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

async function deleteMedia(mediaId) {
  const id = identifierValue(mediaId, { label: "Media ID" });
  const row = await WebsiteMedia.findOne({ mediaId: id, active: { $ne: false } });
  if (!row) throw Object.assign(new Error("Media not found"), { status: 404 });
  const usage = await mediaUsage(id);
  const references = Object.values(usage).flat();
  if (references.length) {
    throw Object.assign(new Error("This image is still used by website content. Remove those references before deleting it."), { status: 409, details: usage });
  }
  await storage.deleteObject({ key: row.s3Key });
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
  const rows = await WebsiteCatalogItem.find(query).sort({ kind: 1, displayOrder: 1, name: 1, _id: 1 }).limit(1000).lean();
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

const HOMEPAGE_SECTION_KEYS = ["popular", "featuredCategories", "homeCare", "repairs", "events"];

function defaultHomepage() {
  return {
    sectionOrder: [...HOMEPAGE_SECTION_KEYS],
    hero: { enabled: true, eyebrow: "Find services around you", heading: "What do you need today?" },
    featuredCategories: section({}, { heading: "What do you need help with?", subheading: "Browse popular categories", enabled: true }),
    popular: section({}, { heading: "Popular near you", subheading: "Services people commonly request", enabled: true }),
    homeCare: section({}, { heading: "For your home", subheading: "Popular home services", enabled: true }),
    repairs: section({}, { heading: "Home repairs", subheading: "Quick help for common repair needs", enabled: true }),
    events: section({}, { heading: "Events & occasions", subheading: "Find help for your next occasion", enabled: true }),
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
      buttonHref: "/business",
      mediaId: "",
    },
  };
}

function normalizeHomepage(input = {}) {
  const defaults = defaultHomepage();
  const steps = Array.isArray(input.howItWorks?.steps) ? input.howItWorks.steps.slice(0, 3) : defaults.howItWorks.steps;
  const requestedOrder = Array.isArray(input.sectionOrder) ? input.sectionOrder.map(String) : defaults.sectionOrder;
  const sectionOrder = [...new Set(requestedOrder.filter((key) => HOMEPAGE_SECTION_KEYS.includes(key)))];
  for (const key of HOMEPAGE_SECTION_KEYS) if (!sectionOrder.includes(key)) sectionOrder.push(key);
  return {
    sectionOrder,
    hero: {
      enabled: booleanValue(input.hero?.enabled, { label: "Hero visibility", fallback: defaults.hero.enabled }),
      eyebrow: text(input.hero?.eyebrow ?? defaults.hero.eyebrow, 120),
      heading: text(input.hero?.heading ?? defaults.hero.heading, 180),
    },
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
  const mediaIds = [draft.businessCta.mediaId, draft.featuredCategories.mediaId, draft.popular.mediaId, draft.homeCare.mediaId, draft.repairs.mediaId, draft.events.mediaId].filter(Boolean);
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
    homepage.featuredCategories?.mediaId,
    homepage.popular?.mediaId,
    homepage.homeCare?.mediaId,
    homepage.repairs?.mediaId,
    homepage.events?.mediaId,
  ];
  const mediaIds = [
    ...categories.flatMap((row) => [row.imageMediaId, row.bannerMediaId]),
    ...serviceTypes.map((row) => row.imageMediaId),
    ...items.flatMap((row) => [row.coverMediaId, ...(row.galleryMediaIds || [])]),
    ...homepageMediaIds,
  ].filter(Boolean);
  const media = await mediaMap(mediaIds);
  const itemRows = items.map((row) => ({
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
    image: mediaPublicUrl(media.get(row.coverMediaId)) || "/assets/requirement-fallback.svg",
    fallbackImage: "/assets/requirement-fallback.svg",
    gallery: (row.galleryMediaIds || []).map((id) => media.get(id)).filter(Boolean).map((asset) => asset.publicUrl),
  }));
  const subcategoryMap = new Map();
  for (const row of serviceTypes) {
    subcategoryMap.set(row.serviceTypeId, {
      serviceTypeId: row.serviceTypeId,
      id: row.slug,
      slug: row.slug,
      name: row.name,
      description: row.description || "",
      categoryId: row.categoryId,
      categorySlug: row.categorySlug,
      displayOrder: Number(row.displayOrder || 0),
      image: mediaPublicUrl(media.get(row.imageMediaId)) || "/assets/requirement-fallback.svg",
      items: itemRows.filter((item) => item.serviceTypeId === row.serviceTypeId),
    });
  }
  const categoryRows = categories.map((row) => ({
    categoryId: row.categoryId,
    id: row.slug,
    slug: row.slug,
    name: row.name,
    description: row.description || "",
    displayOrder: Number(row.displayOrder || 0),
    image: mediaPublicUrl(media.get(row.imageMediaId)) || "/assets/requirement-fallback.svg",
    bannerImage: mediaPublicUrl(media.get(row.bannerMediaId)) || "",
    subcategories: serviceTypes.filter((child) => child.categoryId === row.categoryId).map((child) => subcategoryMap.get(child.serviceTypeId)),
  }));
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    categories: categoryRows,
    items: itemRows,
    homepage: {
      ...homepage,
      businessCta: {
        ...homepage.businessCta,
        mediaUrl: mediaPublicUrl(media.get(homepage.businessCta?.mediaId)),
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
  homepageAdmin,
  saveHomepageDraft,
  publishHomepage,
  publicWebsite,
  defaultHomepage,
  normalizeHomepage,
};
