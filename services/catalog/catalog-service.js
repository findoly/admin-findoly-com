const Category = require("../../models/Category");
const Enquiry = require("../../models/Enquiry");
const Provider = require("../../models/Provider");
async function listCategories() {
  const saved = await Category.find({ active: { $ne: false } })
    .sort({ name: 1 })
    .lean();
  const slugs = new Map(
    saved.map((c) => [c.slug, { slug: c.slug, name: c.name }]),
  );
  const [leadSlugs, providerSlugs] = await Promise.all([
    Enquiry.distinct("categorySlug"),
    Provider.distinct("categorySlugs"),
  ]);
  for (const slug of [...leadSlugs, ...providerSlugs])
    if (slug && !slugs.has(slug))
      slugs.set(slug, {
        slug,
        name: String(slug)
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase()),
      });
  return Array.from(slugs.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}
module.exports = { listCategories };
