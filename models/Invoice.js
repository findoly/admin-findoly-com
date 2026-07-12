const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const invoiceSchema = new mongoose.Schema(
  {
    invoiceId: { type: String, default: uuid, unique: true, index: true, immutable: true },
    invoiceNo: { type: String, required: true, unique: true, index: true, maxlength: 80 },
    enquiryId: { type: String, default: "", index: true },
    customerName: { type: String, default: "" },
    providerName: { type: String, default: "" },
    status: { type: String, default: "draft", index: true, enum: ["draft", "sent", "paid", "overdue", "cancelled"] },
    issueDate: { type: String, default: "" },
    dueDate: { type: String, default: "" },
    items: { type: [mongoose.Schema.Types.Mixed], default: [] },
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    notes: { type: String, default: "", maxlength: 5000 },
  },
  {
    collection: "invoices",
    timestamps: true,
    strict: false,
  },
);

invoiceSchema.index({ createdAt: -1, _id: -1 });
invoiceSchema.index({ status: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model("Invoice", invoiceSchema, "invoices");
