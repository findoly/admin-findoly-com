const Invoice = require("../../models/Invoice");
const { getPagination, pageResult } = require("../../utils/pagination");

function calculate(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  const normalizedItems = items.map((item) => ({
    description: String(item.description || ""),
    qty: Number(item.qty || 1),
    rate: Number(item.rate || 0),
  }));
  const subtotal = normalizedItems.reduce(
    (sum, item) => sum + item.qty * item.rate,
    0,
  );
  const discount = Number(input.discount || 0);
  const tax = Number(input.tax || 0);
  return {
    items: normalizedItems,
    subtotal,
    discount,
    tax,
    total: Math.max(0, subtotal - discount + tax),
  };
}

async function list(filters = {}) {
  const { page, limit, skip } = getPagination(filters);
  const query = {};
  if (filters.status) query.status = filters.status;
  if (filters.q) {
    const search = new RegExp(String(filters.q), "i");
    query.$or = [
      { invoiceNo: search },
      { customerName: search },
      { providerName: search },
      { enquiryId: search },
    ];
  }
  const [rows, total] = await Promise.all([
    Invoice.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Invoice.countDocuments(query),
  ]);
  return pageResult(rows, total, page, limit);
}

async function get(invoiceId) {
  const invoice = await Invoice.findOne({ invoiceId }).lean();
  if (!invoice)
    throw Object.assign(new Error("Invoice not found"), { status: 404 });
  return invoice;
}

async function create(input) {
  return Invoice.create({
    ...input,
    ...calculate(input),
    invoiceNo: input.invoiceNo || `INV-${Date.now()}`,
  });
}

async function update(invoiceId, input) {
  const current = await get(invoiceId);
  const result = await Invoice.updateOne(
    { invoiceId },
    {
      $set: {
        ...input,
        ...calculate({ ...current, ...input }),
        updatedAt: new Date(),
      },
    },
  );
  if (!result.matchedCount)
    throw Object.assign(new Error("Invoice not found"), { status: 404 });
  return get(invoiceId);
}

module.exports = { list, get, create, update };
