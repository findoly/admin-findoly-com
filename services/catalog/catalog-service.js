const Category = require("../../models/Category");
const Enquiry = require("../../models/Enquiry");
const Provider = require("../../models/Provider");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const {
  textValue,
  tokenValue,
  booleanValue,
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

function categoryQuery(categoryId) {
  const value = identifierValue(categoryId, { label: "Category ID" });
  return { $or: [{ categoryId: value }, { id: value }] };
}

function presentCategory(row = {}) {
  return {
    ...row,
    categoryId: row.categoryId || row.id || "",
  };
}

function normalizeCategoryInput(input = {}, current = null) {
  const existing = current || {};
  const name = textValue(input.name ?? existing.name, {
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
    description: textValue(input.description ?? existing.description, {
      label: "Category description",
      maxLength: 2000,
    }),
    active: booleanValue(input.active, {
      label: "Category active state",
      fallback: existing.active !== false,
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
  const slugs = new Map(
    saved.map((category) => [category.slug, presentCategory(category)]),
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
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const search = new RegExp(escaped, "i");
    query.$or = [{ name: search }, { slug: search }, { description: search }];
  }
  const result = await cursorPaginate(Category, {
    query,
    sort: { name: 1, _id: 1 },
    limit,
    cursor,
  });
  return { ...result, data: result.data.map(presentCategory) };
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

module.exports = {
  listCategories,
  listCategoryPage,
  createCategory,
  updateCategory,
  slugify,
  normalizeCategoryInput,
};
