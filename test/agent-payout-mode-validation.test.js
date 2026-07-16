const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SKIP_DB = "true";

const Category = require("../models/Category");
const { normalizeInput } = require("../services/agent/agent-service");

test("agent normalizer accepts every supported uppercase payout mode", async () => {
  const originalFindOne = Category.findOne;
  Category.findOne = () => ({
    lean: async () => ({
      categoryId: "category-1",
      slug: "painting",
      name: "Painting",
      active: true,
    }),
  });

  try {
    for (const payoutMode of ["UPI", "IMPS", "NEFT", "RTGS"]) {
      const normalized = await normalizeInput({
        name: "Test Agent",
        mobile: "9876543210",
        categorySlug: "painting",
        payoutMode,
      });
      assert.equal(normalized.payoutMode, payoutMode);
    }
  } finally {
    Category.findOne = originalFindOne;
  }
});
