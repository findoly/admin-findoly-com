const Category = require("../../models/Category");
const ServiceType = require("../../models/ServiceType");
const Enquiry = require("../../models/Enquiry");
const Provider = require("../../models/Provider");
const WebsiteMedia = require("../../models/WebsiteMedia");
const WebsiteCatalogItem = require("../../models/WebsiteCatalogItem");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const { applyDateRange, dateSort } = require("../../utils/date-query");
const { prefixRegex } = require("../../utils/search-query");
const { normalizeServiceTypeIdentifiers } = require("../../utils/service-types");
const {
  humanTextValue,
  tokenValue,
  booleanValue,
  numberValue,
  queryTextValue,
  identifierValue,
  validationError,
} = require("../../utils/validation");

const DEFAULT_ALERT_DISTANCE_KM = 20;
const DEFAULT_PROVIDER_UNLOCKS = 3;
const CATEGORY_PROVIDER_UNLOCK_CACHE_TTL_MS = 5 * 60 * 1000;
const categoryProviderUnlockCache = new Map();

function normalizeDefaultProviderUnlocks(value) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized >= 1 && normalized <= 1000
    ? normalized
    : DEFAULT_PROVIDER_UNLOCKS;
}

function cacheCategoryProviderUnlocks(categorySlug, value) {
  const slug = String(categorySlug || "").trim().toLowerCase();
  if (!slug) return;
  categoryProviderUnlockCache.set(slug, {
    value: normalizeDefaultProviderUnlocks(value),
    expiresAt: Date.now() + CATEGORY_PROVIDER_UNLOCK_CACHE_TTL_MS,
  });
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function categoryQuery(categoryId) {
  const value = identifierValue(categoryId, { label: "Category ID" });
  return { $or: [{ categoryId: value }, { id: value }] };
}

function serviceTypeQuery(serviceTypeId) {
  const value = identifierValue(serviceTypeId, { label: "Service Type ID" });
  return { $or: [{ serviceTypeId: value }, { id: value }] };
}

async function validateWebsiteMediaIds(values = []) {
  const ids = [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  if (!ids.length) return;
  const count = await WebsiteMedia.countDocuments({ mediaId: { $in: ids }, active: { $ne: false } });
  if (count !== ids.length) throw validationError("One or more selected website images are invalid");
}

function presentCategory(row = {}) {
  const alertDistanceKm = Number(row.alertDistanceKm);
  return {
    ...row,
    categoryId: row.categoryId || row.id || "",
    alertDistanceKm: Number.isInteger(alertDistanceKm) && alertDistanceKm >= 1 && alertDistanceKm <= 100
      ? alertDistanceKm
      : DEFAULT_ALERT_DISTANCE_KM,
    defaultProviderUnlocks: normalizeDefaultProviderUnlocks(row.defaultProviderUnlocks),
    serviceTypeCount: Number(row.serviceTypeCount || 0),
  };
}

function presentServiceType(row = {}) {
  return {
    ...row,
    serviceTypeId: row.serviceTypeId || row.id || "",
  };
}

function normalizeCategoryInput(input = {}, current = null) {
  const existing = current || {};
  const name = humanTextValue(input.name ?? existing.name, {
    label: "Category name",
    required: true,
    maxLength: 120,
  });
  const requestedSlug = input.slug ?? existing.slug ?? slugify(name);
  const slug = tokenValue(requestedSlug, {
    label: "Category slug",
    required: true,
    maxLength: 80,
    lowercase: true,
  });
  if (current && input.slug !== undefined && slug !== existing.slug) {
    throw validationError(
      "Category slug cannot be changed because leads and providers use it for matching",
    );
  }

  return {
    name,
    slug,
    description: humanTextValue(input.description ?? existing.description, {
      label: "Category description",
      maxLength: 2000,
    }),
    alertDistanceKm: numberValue(input.alertDistanceKm, {
      label: "Provider alert distance",
      fallback: existing.alertDistanceKm ?? DEFAULT_ALERT_DISTANCE_KM,
      min: 1,
      max: 100,
      integer: true,
    }),
    defaultProviderUnlocks: numberValue(input.defaultProviderUnlocks, {
      label: "Default provider unlocks",
      fallback: existing.defaultProviderUnlocks ?? DEFAULT_PROVIDER_UNLOCKS,
      min: 1,
      max: 1000,
      integer: true,
    }),
    displayOrder: numberValue(input.displayOrder, {
      label: "Category display order",
      fallback: existing.displayOrder ?? 0,
      min: 0,
      max: 100000,
      integer: true,
    }),
    websiteVisible: booleanValue(input.websiteVisible, {
      label: "Category website visibility",
      fallback: existing.websiteVisible !== false,
    }),
    imageMediaId: String(input.imageMediaId ?? existing.imageMediaId ?? "").trim().slice(0, 64),
    bannerMediaId: String(input.bannerMediaId ?? existing.bannerMediaId ?? "").trim().slice(0, 64),
    active: booleanValue(input.active, {
      label: "Category active state",
      fallback: existing.active !== false,
    }),
  };
}

function normalizeServiceTypeInput(input = {}, current = {}) {
  const name = humanTextValue(input.name ?? current.name, {
    label: "Service Type name",
    required: true,
    maxLength: 120,
  });
  const requestedSlug = input.slug ?? current.slug ?? slugify(name);
  const slug = tokenValue(requestedSlug, {
    label: "Service Type slug",
    required: true,
    maxLength: 80,
    lowercase: true,
  });
  if (current.serviceTypeId && input.slug !== undefined && slug !== current.slug) {
    throw validationError(
      "Service Type slug cannot be changed because leads may already reference it",
    );
  }
  return {
    name,
    normalizedName: name.toLocaleLowerCase("en-IN"),
    slug,
    description: humanTextValue(input.description ?? current.description, {
      label: "Service Type description",
      maxLength: 1000,
    }),
    displayOrder: numberValue(input.displayOrder, {
      label: "Service Type display order",
      fallback: current.displayOrder ?? 0,
      min: 0,
      max: 100000,
      integer: true,
    }),
    websiteVisible: booleanValue(input.websiteVisible, {
      label: "Service Type website visibility",
      fallback: current.websiteVisible !== false,
    }),
    imageMediaId: String(input.imageMediaId ?? current.imageMediaId ?? "").trim().slice(0, 64),
    active: booleanValue(input.active, {
      label: "Service Type active state",
      fallback: current.active !== false,
    }),
  };
}

async function listCategories(options = {}) {
  const includeInactive = booleanValue(options.includeInactive, {
    label: "Include inactive",
    fallback: false,
  });
  const includeLegacy = booleanValue(options.includeLegacy, {
    label: "Include legacy categories",
    fallback: false,
  });
  const allSaved = await Category.find({}).sort({ name: 1 }).lean();
  const managedSlugs = new Set(allSaved.map((category) => category.slug));
  const saved = includeInactive
    ? allSaved
    : allSaved.filter((category) => category.active !== false);
  const counts = await ServiceType.aggregate([
    { $match: includeInactive ? {} : { active: { $ne: false } } },
    { $group: { _id: "$categorySlug", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((row) => [row._id, row.count]));
  const slugs = new Map(
    saved.map((category) => [
      category.slug,
      presentCategory({ ...category, serviceTypeCount: countMap.get(category.slug) || 0 }),
    ]),
  );

  if (!includeInactive && includeLegacy) {
    const [leadSlugs, providerSlugs] = await Promise.all([
      Enquiry.distinct("categorySlug"),
      Provider.distinct("categorySlugs"),
    ]);
    for (const slug of [...leadSlugs, ...providerSlugs]) {
      if (slug && !managedSlugs.has(slug) && !slugs.has(slug)) {
        slugs.set(slug, {
          categoryId: "",
          slug,
          name: String(slug)
            .replace(/[-_]/g, " ")
            .replace(/\b\w/g, (character) => character.toUpperCase()),
          description: "",
          alertDistanceKm: DEFAULT_ALERT_DISTANCE_KM,
          defaultProviderUnlocks: DEFAULT_PROVIDER_UNLOCKS,
          active: true,
          legacy: true,
          serviceTypeCount: countMap.get(slug) || 0,
        });
      }
    }
  }

  return Array.from(slugs.values()).sort((left, right) =>
    String(left.name || "").localeCompare(String(right.name || "")),
  );
}

async function listCategoryPage(options = {}) {
  const { limit, cursor } = getPagination(options);
  const query = {};
  const activeFilter = String(options.active || "").trim().toLowerCase();
  const includeInactive = booleanValue(options.includeInactive, {
    label: "Include inactive",
    fallback: false,
  });
  if (activeFilter === "true") query.active = { $ne: false };
  else if (activeFilter === "false") query.active = false;
  else if (!includeInactive) query.active = { $ne: false };
  const q = queryTextValue(options.q, {
    label: "Category search",
    maxLength: 100,
  });
  if (q) {
    const search = prefixRegex(q);
    query.$or = [{ name: search }, { slug: search }, { description: search }];
  }
  applyDateRange(query, options, {
    fields: { createdAt: "Created date", updatedAt: "Updated date" },
    defaultField: "updatedAt",
  });
  const sortMode = String(options.sort || "").trim().toLowerCase();
  const sort = {
    name_asc: { name: 1, _id: 1 },
    name_desc: { name: -1, _id: -1 },
    oldest: { updatedAt: 1, _id: 1 },
    newest: { updatedAt: -1, _id: -1 },
  }[sortMode] || dateSort(options, {
    fields: ["createdAt", "updatedAt"],
    defaultField: "updatedAt",
  });
  const result = await cursorPaginate(Category, { query, sort, limit, cursor });
  const slugs = result.data.map((row) => row.slug).filter(Boolean);
  const counts = slugs.length
    ? await ServiceType.aggregate([
        { $match: { categorySlug: { $in: slugs } } },
        { $group: { _id: "$categorySlug", count: { $sum: 1 } } },
      ])
    : [];
  const countMap = new Map(counts.map((row) => [row._id, row.count]));
  return {
    ...result,
    data: result.data.map((row) => presentCategory({
      ...row,
      serviceTypeCount: countMap.get(row.slug) || 0,
    })),
  };
}

async function createCategory(input = {}) {
  const data = normalizeCategoryInput(input);
  await validateWebsiteMediaIds([data.imageMediaId, data.bannerMediaId]);
  const existing = await Category.findOne({ slug: data.slug }).lean();
  if (existing) {
    throw Object.assign(new Error("A category with this slug already exists"), {
      status: 409,
    });
  }

  try {
    const category = await Category.create({
      ...data,
      sourceWebsite: "any",
      formType: "default",
    });
    const presented = presentCategory(category.toObject());
    cacheCategoryProviderUnlocks(presented.slug, presented.defaultProviderUnlocks);
    return presented;
  } catch (error) {
    if (error?.code === 11000) {
      throw Object.assign(new Error("A category with this slug already exists"), {
        status: 409,
      });
    }
    throw error;
  }
}

async function updateCategory(categoryId, input = {}) {
  const query = categoryQuery(categoryId);
  const existing = await Category.findOne(query).lean();
  if (!existing) {
    throw Object.assign(new Error("Category not found"), { status: 404 });
  }
  const data = normalizeCategoryInput(input, existing);
  await validateWebsiteMediaIds([data.imageMediaId, data.bannerMediaId]);

  await Category.updateOne(query, {
    $set: {
      name: data.name,
      description: data.description,
      alertDistanceKm: data.alertDistanceKm,
      defaultProviderUnlocks: data.defaultProviderUnlocks,
      displayOrder: data.displayOrder,
      websiteVisible: data.websiteVisible,
      imageMediaId: data.imageMediaId,
      bannerMediaId: data.bannerMediaId,
      active: data.active,
      updatedAt: new Date(),
    },
  });

  const updated = presentCategory(await Category.findOne(query).lean());
  cacheCategoryProviderUnlocks(updated.slug, updated.defaultProviderUnlocks);
  return updated;
}

async function getCategory(categoryId) {
  const category = await Category.findOne(categoryQuery(categoryId)).lean();
  if (!category) throw Object.assign(new Error("Category not found"), { status: 404 });
  return presentCategory(category);
}

async function getCategoryAlertDistanceKm(categorySlug) {
  const slug = tokenValue(categorySlug, {
    label: "Category",
    required: true,
    maxLength: 80,
    lowercase: true,
  });
  const category = await Category.findOne({ slug })
    .select({ alertDistanceKm: 1 })
    .lean();
  const value = Number(category?.alertDistanceKm);
  return Number.isInteger(value) && value >= 1 && value <= 100
    ? value
    : DEFAULT_ALERT_DISTANCE_KM;
}

async function getCategoryDefaultProviderUnlocks(categorySlug) {
  const slug = tokenValue(categorySlug, {
    label: "Category",
    required: true,
    maxLength: 80,
    lowercase: true,
  });
  const cached = categoryProviderUnlockCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) categoryProviderUnlockCache.delete(slug);

  const category = await Category.findOne({ slug })
    .select({ defaultProviderUnlocks: 1 })
    .lean();
  const value = normalizeDefaultProviderUnlocks(category?.defaultProviderUnlocks);
  cacheCategoryProviderUnlocks(slug, value);
  return value;
}

async function listServiceTypes(options = {}) {
  const query = {};
  const activeFilter = String(options.active || "").trim().toLowerCase();
  const includeInactive = booleanValue(options.includeInactive, {
    label: "Include inactive Service Types",
    fallback: false,
  });
  if (activeFilter === "true") query.active = { $ne: false };
  else if (activeFilter === "false") query.active = false;
  else if (!includeInactive) query.active = { $ne: false };
  if (options.categorySlug) {
    query.categorySlug = tokenValue(options.categorySlug, {
      label: "Category",
      maxLength: 80,
      lowercase: true,
    });
  }
  if (options.categoryId) {
    query.categoryId = identifierValue(options.categoryId, { label: "Category ID" });
  }
  const q = queryTextValue(options.q, { label: "Service Type search", maxLength: 100 });
  if (q) {
    const search = prefixRegex(q);
    query.$or = [{ name: search }, { slug: search }, { description: search }];
  }

  if (String(options.paginate) === "true") {
    const { limit, cursor } = getPagination(options);
    applyDateRange(query, options, {
      fields: { createdAt: "Created date", updatedAt: "Updated date" },
      defaultField: "updatedAt",
    });
    const sortMode = String(options.sort || "").trim().toLowerCase();
    const sort = {
      order_asc: { displayOrder: 1, name: 1, _id: 1 },
      order_desc: { displayOrder: -1, name: -1, _id: -1 },
      name_asc: { name: 1, _id: 1 },
      name_desc: { name: -1, _id: -1 },
      newest: { updatedAt: -1, _id: -1 },
      oldest: { updatedAt: 1, _id: 1 },
    }[sortMode] || (options.dateField
      ? dateSort(options, { fields: ["createdAt", "updatedAt"], defaultField: "updatedAt" })
      : { displayOrder: 1, name: 1, _id: 1 });
    const result = await cursorPaginate(ServiceType, {
      query,
      sort,
      limit,
      cursor,
    });
    const counts = await websiteItemCountsByServiceType(result.data.map((row) => row.serviceTypeId || row.id));
    return {
      ...result,
      data: result.data.map((row) => ({
        ...presentServiceType(row),
        ...(counts.get(row.serviceTypeId || row.id) || { serviceCount: 0, productCount: 0 }),
      })),
    };
  }

  const rows = await ServiceType.find(query)
    .sort({ displayOrder: 1, name: 1, _id: 1 })
    .limit(500)
    .lean();
  const counts = await websiteItemCountsByServiceType(rows.map((row) => row.serviceTypeId || row.id));
  return rows.map((row) => ({
    ...presentServiceType(row),
    ...(counts.get(row.serviceTypeId || row.id) || { serviceCount: 0, productCount: 0 }),
  }));
}

async function websiteItemCountsByServiceType(ids = []) {
  const values = [...new Set(ids.filter(Boolean))];
  if (!values.length) return new Map();
  const rows = await WebsiteCatalogItem.aggregate([
    { $match: { serviceTypeId: { $in: values } } },
    { $group: { _id: { serviceTypeId: "$serviceTypeId", kind: "$kind" }, count: { $sum: 1 } } },
  ]);
  const result = new Map();
  for (const row of rows) {
    const key = row._id.serviceTypeId;
    const current = result.get(key) || { serviceCount: 0, productCount: 0 };
    if (row._id.kind === "service") current.serviceCount = Number(row.count || 0);
    if (row._id.kind === "product") current.productCount = Number(row.count || 0);
    result.set(key, current);
  }
  return result;
}

async function serviceTypeUsage(serviceTypeId) {
  const query = serviceTypeQuery(serviceTypeId);
  const row = await ServiceType.findOne(query).lean();
  if (!row) throw Object.assign(new Error("Subcategory not found"), { status: 404 });
  const counts = await websiteItemCountsByServiceType([row.serviceTypeId]);
  return {
    serviceTypeId: row.serviceTypeId,
    name: row.name,
    ...(counts.get(row.serviceTypeId) || { serviceCount: 0, productCount: 0 }),
  };
}

async function deleteServiceType(serviceTypeId) {
  const query = serviceTypeQuery(serviceTypeId);
  const row = await ServiceType.findOne(query).lean();
  if (!row) throw Object.assign(new Error("Subcategory not found"), { status: 404 });
  const usage = await serviceTypeUsage(row.serviceTypeId);
  if (usage.serviceCount || usage.productCount) {
    throw Object.assign(
      new Error(`Cannot delete this subcategory. Delete all Services and Products under it first. Services remaining: ${usage.serviceCount}. Products remaining: ${usage.productCount}.`),
      { status: 409, expose: true, data: usage },
    );
  }
  await ServiceType.deleteOne({ serviceTypeId: row.serviceTypeId });
  return { serviceTypeId: row.serviceTypeId, name: row.name, deleted: true };
}

async function rejectCategoryDelete(categoryId) {
  await getCategory(categoryId);
  throw Object.assign(new Error("Categories cannot be deleted. You can edit or deactivate a Category instead."), { status: 405, expose: true });
}

async function createServiceType(categoryId, input = {}) {
  const category = await getCategory(categoryId);
  if (!category.categoryId || category.legacy) {
    throw validationError("Create the parent category in Catalog before adding Service Types");
  }
  const data = normalizeServiceTypeInput(input);
  await validateWebsiteMediaIds([data.imageMediaId]);
  try {
    const row = await ServiceType.create({
      ...data,
      categoryId: category.categoryId,
      categorySlug: category.slug,
    });
    return presentServiceType(row.toObject());
  } catch (error) {
    if (error?.code === 11000) {
      throw validationError("This category already has a Service Type with the same name or slug", 409);
    }
    throw error;
  }
}

async function updateServiceType(serviceTypeId, input = {}) {
  const query = serviceTypeQuery(serviceTypeId);
  const current = await ServiceType.findOne(query).lean();
  if (!current) throw Object.assign(new Error("Service Type not found"), { status: 404 });
  const data = normalizeServiceTypeInput(input, current);
  await validateWebsiteMediaIds([data.imageMediaId]);
  try {
    await ServiceType.updateOne(query, { $set: { ...data, updatedAt: new Date() } });
  } catch (error) {
    if (error?.code === 11000) {
      throw validationError("This category already has a Service Type with the same name or slug", 409);
    }
    throw error;
  }
  return presentServiceType(await ServiceType.findOne(query).lean());
}

async function resolveLeadServiceTypes(categorySlug, values, options = {}) {
  const { allowInactiveCurrent = [] } = options;
  const normalizedCategorySlug = tokenValue(categorySlug, {
    label: "Category",
    required: true,
    maxLength: 80,
    lowercase: true,
  });
  const category = await Category.findOne({ slug: normalizedCategorySlug }).lean();
  if (!category || category.active === false) {
    throw validationError("Select an active Category before choosing Service Types");
  }
  const identifiers = normalizeServiceTypeIdentifiers(values);

  const rows = await ServiceType.find({
    categorySlug: normalizedCategorySlug,
    $or: [
      { serviceTypeId: { $in: identifiers } },
      { id: { $in: identifiers } },
    ],
  }).lean();
  const allowedInactive = new Set((allowInactiveCurrent || []).map((item) => String(item.serviceTypeId || item.id || item)));
  const byId = new Map(rows.map((row) => [String(row.serviceTypeId || row.id), row]));
  const resolved = identifiers.map((id) => {
    const row = byId.get(id);
    if (!row) throw validationError("One or more selected Service Types do not belong to the selected Category");
    if (row.active === false && !allowedInactive.has(id)) {
      throw validationError(`${row.name} is inactive and cannot be selected`);
    }
    return {
      serviceTypeId: row.serviceTypeId || row.id,
      name: row.name,
      slug: row.slug,
    };
  });
  return resolved;
}

module.exports = {
  listCategories,
  listCategoryPage,
  createCategory,
  updateCategory,
  listServiceTypes,
  createServiceType,
  updateServiceType,
  serviceTypeUsage,
  deleteServiceType,
  rejectCategoryDelete,
  resolveLeadServiceTypes,
  getCategoryAlertDistanceKm,
  getCategoryDefaultProviderUnlocks,
  slugify,
  normalizeCategoryInput,
  normalizeServiceTypeInput,
};
