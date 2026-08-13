const mongoose = require("mongoose");

const homepageContentSchema = new mongoose.Schema(
  {
    homepageKey: { type: String, default: "main", unique: true, index: true, immutable: true },
    draft: { type: mongoose.Schema.Types.Mixed, default: {} },
    published: { type: mongoose.Schema.Types.Mixed, default: {} },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: String, default: "", trim: true, maxlength: 160 },
    updatedBy: { type: String, default: "crm-admin", trim: true, maxlength: 160 },
  },
  { collection: "homepagecontent", timestamps: true, strict: true },
);

module.exports = mongoose.model("HomepageContent", homepageContentSchema, "homepagecontent");
