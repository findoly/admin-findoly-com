const mongoose = require("mongoose");
const uuid = require("../utils/uuid");
const { isKnownPermission } = require("../utils/permissions");

const roleSchema = new mongoose.Schema(
  {
    roleId: {
      type: String,
      default: uuid,
      unique: true,
      index: true,
      immutable: true,
      match: /^[a-f0-9]{32}$/,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
      maxlength: 80,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    description: { type: String, default: "", trim: true, maxlength: 1000 },
    permissions: {
      type: [String],
      default: [],
      validate: {
        validator: (values) => Array.isArray(values) && values.every(isKnownPermission),
        message: "Role contains an unknown permission",
      },
    },
    active: { type: Boolean, default: true, index: true },
    isSystem: { type: Boolean, default: false, index: true },
    isSuperAdmin: { type: Boolean, default: false, index: true },
    createdBy: { type: String, default: "crm-admin" },
    updatedBy: { type: String, default: "crm-admin" },
  },
  { collection: "crmroles", timestamps: true, strict: true },
);

roleSchema.index({ active: 1, name: 1, _id: 1 });

module.exports = mongoose.model("Role", roleSchema, "crmroles");
