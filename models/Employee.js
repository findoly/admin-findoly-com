const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const employeeSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      default: uuid,
      unique: true,
      index: true,
      immutable: true,
      match: /^[a-f0-9]{32}$/,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    mobile: { type: String, required: true, trim: true, match: /^[6-9]\d{9}$/ },
    normalizedMobile: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
      match: /^[6-9]\d{9}$/,
    },
    email: { type: String, default: "", trim: true, lowercase: true, maxlength: 254 },
    employeeCode: { type: String, default: "", trim: true, uppercase: true, maxlength: 40, index: true },
    designation: { type: String, default: "", trim: true, maxlength: 120 },
    department: { type: String, default: "", trim: true, maxlength: 120, index: true },
    roleId: { type: String, required: true, trim: true, index: true },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended"],
      default: "active",
      index: true,
    },
    notes: { type: String, default: "", trim: true, maxlength: 5000 },
    lastLoginAt: { type: Date, default: null },
    createdBy: { type: String, default: "crm-admin" },
    updatedBy: { type: String, default: "crm-admin" },
  },
  { collection: "crmemployees", timestamps: true, strict: true },
);

employeeSchema.index({ status: 1, roleId: 1, createdAt: -1 });
employeeSchema.index({ name: 1, _id: 1 });

module.exports = mongoose.model("Employee", employeeSchema, "crmemployees");
