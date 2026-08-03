const CATEGORY_SLUG_PATTERN = /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/;

function cleanCategorySlug(value) {
  const slug = String(value || "").trim();
  return CATEGORY_SLUG_PATTERN.test(slug) ? slug : "";
}

function cleanCategorySnapshot(value = {}) {
  const categorySlug = cleanCategorySlug(value.categorySlug || value.slug);
  if (!categorySlug) return null;
  return {
    categoryId: String(value.categoryId || value.id || "").trim(),
    categorySlug,
    categoryName: String(value.categoryName || value.name || categorySlug).trim() || categorySlug,
  };
}

function categorySnapshots(row = {}) {
  const categories = [];
  const seen = new Set();
  const append = (value) => {
    const snapshot = cleanCategorySnapshot(value);
    if (!snapshot || seen.has(snapshot.categorySlug)) return;
    seen.add(snapshot.categorySlug);
    categories.push(snapshot);
  };

  if (Array.isArray(row.categories)) row.categories.forEach(append);
  if (Array.isArray(row.categorySlugs)) {
    row.categorySlugs.forEach((categorySlug) => append({ categorySlug }));
  }
  append({
    categoryId: row.categoryId,
    categorySlug: row.categorySlug,
    categoryName: row.categoryName,
  });

  const primarySlug = cleanCategorySlug(row.categorySlug);
  if (primarySlug) {
    const primaryIndex = categories.findIndex((category) => category.categorySlug === primarySlug);
    if (primaryIndex > 0) categories.unshift(categories.splice(primaryIndex, 1)[0]);
  }
  return categories;
}

function withCategoryCompatibility(row = {}) {
  const categories = categorySnapshots(row);
  const primary = categories[0] || { categoryId: "", categorySlug: "", categoryName: "" };
  return {
    ...row,
    categoryId: primary.categoryId,
    categorySlug: primary.categorySlug,
    categoryName: primary.categoryName,
    categories,
    categorySlugs: categories.map((category) => category.categorySlug),
  };
}

module.exports = {
  CATEGORY_SLUG_PATTERN,
  cleanCategorySlug,
  cleanCategorySnapshot,
  categorySnapshots,
  withCategoryCompatibility,
};
