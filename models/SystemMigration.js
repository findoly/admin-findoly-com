"use strict";

const mongoose = require("mongoose");

const systemMigrationSchema = new mongoose.Schema(
  {
    migrationId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 120,
    },
    version: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      required: true,
      enum: ["completed"],
      default: "completed",
    },
    completedAt: { type: Date, required: true },
    details: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  {
    collection: "system_migrations",
    timestamps: true,
    strict: true,
  },
);

systemMigrationSchema.index({ completedAt: -1, _id: -1 });

module.exports = mongoose.models.SystemMigration
  || mongoose.model("SystemMigration", systemMigrationSchema, "system_migrations");
