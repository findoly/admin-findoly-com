const Category = require("../../models/Category");
const Enquiry = require("../../models/Enquiry");
const Provider = require("../../models/Provider");

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function categoryQuery(categoryId) {
  return { $or: [{ categoryId }, { id: categoryId }] };
}

function presentCategory(row = {}) {
  return {
    ...row,
    categoryId: row.categoryId || row.id || "",
  };
}

async function listCategories(options = {}) {
  const includeInactive =
    options.includeInactive === true || String(options.includeInactive) === "true";
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

async function createCategory(input = {}) {
  const name = String(input.name || "").trim();
  const slug = slugify(input.slug || name);
  if (!name) {
    throw Object.assign(new Error("Category name is required"), { status: 400 });
  }
  if (!slug) {
    throw Object.assign(new Error("Category slug is required"), { status: 400 });
  }

  const existing = await Category.findOne({ slug }).lean();
  if (existing) {
    throw Object.assign(new Error("A category with this slug already exists"), {
      status: 409,
    });
  }

  try {
    const category = await Category.create({
      name,
      slug,
      description: String(input.description || "").trim(),
      sourceWebsite: "any",
      formType: "default",
      active: input.active !== false,
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
  const existing = await Category.findOne(categoryQuery(categoryId)).lean();
  if (!existing) {
    throw Object.assign(new Error("Category not found"), { status: 404 });
  }

  const name = String(input.name ?? existing.name).trim();
  if (!name) {
    throw Object.assign(new Error("Category name is required"), { status: 400 });
  }

  await Category.updateOne(categoryQuery(categoryId), {
    $set: {
      name,
      description: String(input.description ?? existing.description ?? "").trim(),
      active:
        input.active === undefined ? existing.active !== false : Boolean(input.active),
      updatedAt: new Date(),
    },
  });

  const updated = await Category.findOne(categoryQuery(categoryId)).lean();
  return presentCategory(updated);
}

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  slugify,
};
