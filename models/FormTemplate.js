const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const formTemplateSchema = new mongoose.Schema(
  {
    formTemplateId: { type: String, default: uuid, unique: true, index: true },
    name: { type: String, required: true },
    slug: { type: String, default: "" },
    categorySlug: { type: String, required: true, index: true },
    formType: { type: String, default: "default" },
    sourceWebsite: { type: String, default: "any" },
    description: { type: String, default: "" },
    fields: { type: [mongoose.Schema.Types.Mixed], default: [] },
    active: { type: Boolean, default: true },
  },
  {
    collection: "formtemplates",
    timestamps: true,
    strict: false,
  },
);

module.exports = mongoose.model(
  "FormTemplate",
  formTemplateSchema,
  "formtemplates",
);
