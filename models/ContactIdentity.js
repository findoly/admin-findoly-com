"use strict";

const mongoose = require("mongoose");

const contactIdentitySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, maxlength: 320 },
    kind: { type: String, required: true, enum: ["phone", "email"], index: true },
    value: { type: String, required: true, trim: true, maxlength: 254 },
    entityType: {
      type: String,
      required: true,
      enum: ["agent", "provider", "employee", "provider_join_request"],
      index: true,
    },
    entityId: { type: String, required: true, trim: true, maxlength: 128, index: true },
    field: { type: String, required: true, enum: ["mobile", "whatsapp", "email"] },
    sourceCollection: { type: String, required: true, trim: true, maxlength: 80 },
  },
  {
    collection: "contactidentities",
    timestamps: true,
    strict: true,
  },
);

contactIdentitySchema.index({ entityType: 1, entityId: 1, createdAt: 1 });
contactIdentitySchema.index({ kind: 1, value: 1 });

module.exports = mongoose.models.ContactIdentity
  || mongoose.model("ContactIdentity", contactIdentitySchema, "contactidentities");
