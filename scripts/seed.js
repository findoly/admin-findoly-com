require("dotenv").config();
const connectDatabase = require("../db/connection");
const Category = require("../models/Category");
const Provider = require("../models/Provider");
const Enquiry = require("../models/Enquiry");
const enquiryService = require("../services/enquiry/enquiry-service");
const categories = [
  "painting",
  "plumbing",
  "carpentry",
  "waterproofing",
  "wall-painting",
  "furniture-repair",
  "modular-kitchen",
  "door-window-repair",
  "wood-polishing",
  "woodoly-electrical-repair",
];
async function run() {
  await connectDatabase();
  for (const slug of categories)
    await Category.updateOne(
      { slug, sourceWebsite: "any" },
      {
        $setOnInsert: {
          name: slug
            .replace(/-/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase()),
          slug,
          sourceWebsite: "any",
          active: true,
        },
      },
      { upsert: true },
    );
  if (!(await Provider.countDocuments()))
    await Provider.create({
      name: "Demo Provider",
      businessName: "Demo Services",
      mobile: "9000000002",
      normalizedMobile: "9000000002",
      email: "provider@example.com",
      status: "active",
      portalAccessEnabled: true,
      categorySlugs: ["painting", "plumbing"],
      skills: ["painting", "plumbing"],
      city: "Mumbai",
      walletBalancePaise: 100000,
    });
  if (!(await Enquiry.countDocuments()))
    await enquiryService.create(
      {
        name: "Demo Customer",
        mobile: "9000000001",
        city: "Mumbai",
        categorySlug: "painting",
        category: "Painting",
        requirementTitle: "Paint a 2 BHK apartment",
        status: "approved",
        leadPricePaise: 15000,
      },
      "seed",
    );
  console.log("Seed completed");
  process.exit(0);
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
