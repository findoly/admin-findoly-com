const Category = require("../../models/Category");
const ServiceType = require("../../models/ServiceType");
const Enquiry = require("../../models/Enquiry");
const Provider = require("../../models/Provider");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const { applyDateRange, dateSort } = require("../../utils/date-query");
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

function presentCategory(row = {}) {
  return {
    ...row,
    categoryId: row.categoryId || row.id || "",
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

  if (!includeInactive) {
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
  const includeInactive = booleanValue(options.includeInactive, {
    label: "Include inactive",
    fallback: false,
  });
  if (!includeInactive) query.active = { $ne: false };
  const q = queryTextValue(options.q, {
    label: "Category search",
    maxLength: 100,
  });
  if (q) {
    const search = new RegExp(escapeRegex(q), "i");
    query.$or = [{ name: search }, { slug: search }, { description: search }];
  }
  applyDateRange(query, options, {
    fields: { createdAt: "Created date", updatedAt: "Updated date" },
    defaultField: "updatedAt",
  });
  const sort = dateSort(options, {
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
    return presentCategory(category.toObject());
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

  await Category.updateOne(query, {
    $set: {
      name: data.name,
      description: data.description,
      active: data.active,
      updatedAt: new Date(),
    },
  });

  const updated = await Category.findOne(query).lean();
  return presentCategory(updated);
}

async function getCategory(categoryId) {
  const category = await Category.findOne(categoryQuery(categoryId)).lean();
  if (!category) throw Object.assign(new Error("Category not found"), { status: 404 });
  return presentCategory(category);
}

async function listServiceTypes(options = {}) {
  const query = {};
  const includeInactive = booleanValue(options.includeInactive, {
    label: "Include inactive Service Types",
    fallback: false,
  });
  if (!includeInactive) query.active = { $ne: false };
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
    const search = new RegExp(escapeRegex(q), "i");
    query.$or = [{ name: search }, { slug: search }, { description: search }];
  }

  if (String(options.paginate) === "true") {
    const { limit, cursor } = getPagination(options);
    applyDateRange(query, options, {
      fields: { createdAt: "Created date", updatedAt: "Updated date" },
      defaultField: "updatedAt",
    });
    const sortOrder = String(options.sortOrder || "").toLowerCase();
    const direction = sortOrder === "oldest" ? 1 : -1;
    return cursorPaginate(ServiceType, {
      query,
      sort: options.dateField
        ? dateSort(options, { fields: ["createdAt", "updatedAt"], defaultField: "updatedAt" })
        : { displayOrder: 1, name: 1, _id: 1 },
      limit,
      cursor,
    }).then((result) => ({ ...result, data: result.data.map(presentServiceType), direction }));
  }

  const rows = await ServiceType.find(query)
    .sort({ displayOrder: 1, name: 1, _id: 1 })
    .limit(500)
    .lean();
  return rows.map(presentServiceType);
}

async function createServiceType(categoryId, input = {}) {
  const category = await getCategory(categoryId);
  if (!category.categoryId || category.legacy) {
    throw validationError("Create the parent category in Catalog before adding Service Types");
  }
  const data = normalizeServiceTypeInput(input);
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
  resolveLeadServiceTypes,
  slugify,
  normalizeCategoryInput,
  normalizeServiceTypeInput,
};
