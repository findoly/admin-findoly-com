const Invoice = require("../../models/Invoice");
const uuid = require("../../utils/uuid");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const { applyDateRange, dateSort } = require("../../utils/date-query");
const {
  textValue,
  enumValue,
  numberValue,
  dateOnlyValue,
  identifierValue,
  queryTextValue,
  validationError,
} = require("../../utils/validation");

const INVOICE_STATUSES = Object.freeze([
  "draft",
  "sent",
  "paid",
  "overdue",
  "cancelled",
]);

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeInvoiceItems(value, fallback = []) {
  const items = value === undefined || value === null ? fallback : value;
  if (!Array.isArray(items)) {
    throw validationError("Invoice items must be a list");
  }
  if (!items.length) {
    throw validationError("Invoice must contain at least one item");
  }
  if (items.length > 100) {
    throw validationError("Invoice must not contain more than 100 items");
  }

  return items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw validationError(`Invoice item ${index + 1} is invalid`);
    }
    return {
      description: textValue(item.description, {
        label: `Invoice item ${index + 1} description`,
        required: true,
        maxLength: 500,
      }),
      qty: numberValue(item.qty, {
        label: `Invoice item ${index + 1} quantity`,
        fallback: 1,
        min: 0.01,
        max: 1_000_000,
      }),
      rate: numberValue(item.rate, {
        label: `Invoice item ${index + 1} rate`,
        fallback: 0,
        min: 0,
        max: 1_000_000_000,
      }),
    };
  });
}

function calculate(input = {}, current = {}) {
  const items = normalizeInvoiceItems(input.items, current.items || []);
  const subtotal = roundCurrency(
    items.reduce((sum, item) => sum + item.qty * item.rate, 0),
  );
  if (!Number.isFinite(subtotal) || subtotal > 1_000_000_000_000) {
    throw validationError("Invoice subtotal is too large");
  }
  const discount = roundCurrency(
    numberValue(input.discount, {
      label: "Invoice discount",
      fallback: current.discount ?? 0,
      min: 0,
      max: 1_000_000_000_000,
    }),
  );
  const tax = roundCurrency(
    numberValue(input.tax, {
      label: "Invoice tax",
      fallback: current.tax ?? 0,
      min: 0,
      max: 1_000_000_000_000,
    }),
  );
  return {
    items,
    subtotal,
    discount,
    tax,
    total: roundCurrency(Math.max(0, subtotal - discount + tax)),
  };
}

function optionalIdentifier(value, label) {
  if (value === undefined || value === null || value === "") return "";
  return identifierValue(value, { label, required: false });
}

function generateInvoiceNumber() {
  return `INV-${Date.now()}-${uuid().slice(0, 6).toUpperCase()}`;
}

function normalizeInvoiceInput(input = {}, current = {}) {
  const requestedInvoiceNo = String(input.invoiceNo ?? "").trim();
  const invoiceNo = requestedInvoiceNo || current.invoiceNo || generateInvoiceNumber();
  const issueDate = dateOnlyValue(input.issueDate ?? current.issueDate, {
    label: "Invoice issue date",
  });
  const dueDate = dateOnlyValue(input.dueDate ?? current.dueDate, {
    label: "Invoice due date",
  });
  if (issueDate && dueDate && dueDate < issueDate) {
    throw validationError("Invoice due date cannot be before the issue date");
  }

  return {
    invoiceNo: textValue(invoiceNo, {
      label: "Invoice number",
      required: true,
      maxLength: 80,
    }),
    enquiryId: optionalIdentifier(
      input.enquiryId ?? current.enquiryId,
      "Requirement ID",
    ),
    customerName: textValue(input.customerName ?? current.customerName, {
      label: "Customer name",
      maxLength: 120,
    }),
    providerName: textValue(input.providerName ?? current.providerName, {
      label: "Provider name",
      maxLength: 120,
    }),
    status: enumValue(input.status, INVOICE_STATUSES, {
      label: "Invoice status",
      fallback: current.status || "draft",
    }),
    issueDate,
    dueDate,
    ...calculate(input, current),
    notes: textValue(input.notes ?? current.notes, {
      label: "Invoice notes",
      maxLength: 5000,
    }),
  };
}

function assertInvoiceIdUnchanged(current, input = {}) {
  for (const field of ["invoiceId", "id"]) {
    if (input[field] === undefined || input[field] === null) continue;
    const reference = String(current.invoiceId || current.id || "");
    if (String(input[field]) !== reference) {
      throw validationError("Invoice ID cannot be changed");
    }
  }
  if (
    input._id !== undefined &&
    input._id !== null &&
    String(input._id) !== String(current._id || "")
  ) {
    throw validationError("Invoice database ID cannot be changed");
  }
}

async function list(filters = {}) {
  const { limit, cursor } = getPagination(filters);
  const query = {};
  if (filters.status) {
    query.status = enumValue(filters.status, INVOICE_STATUSES, {
      label: "Invoice status filter",
    });
  }
  const q = queryTextValue(filters.q, {
    label: "Invoice search",
    maxLength: 100,
  });
  if (q) {
    const search = new RegExp(escapeRegex(q), "i");
    query.$or = [
      { invoiceNo: search },
      { customerName: search },
      { providerName: search },
      { enquiryId: search },
    ];
  }
  applyDateRange(query, filters, { fields: { issueDate: "Issue date", dueDate: "Due date", createdAt: "Created date", updatedAt: "Updated date" }, defaultField: "issueDate" });
  return cursorPaginate(Invoice, {
    query,
    sort: dateSort(filters, { fields: ["issueDate", "dueDate", "createdAt", "updatedAt"], defaultField: "issueDate" }),
    limit,
    cursor,
  });
}

async function get(invoiceId) {
  const id = identifierValue(invoiceId, { label: "Invoice ID" });
  const invoice = await Invoice.findOne({ invoiceId: id }).lean();
  if (!invoice) {
    throw Object.assign(new Error("Invoice not found"), { status: 404 });
  }
  return invoice;
}

async function assertInvoiceNumberAvailable(invoiceNo, excludeInvoiceId = "") {
  const query = { invoiceNo };
  if (excludeInvoiceId) query.invoiceId = { $ne: excludeInvoiceId };
  const exists = await Invoice.exists(query);
  if (exists) throw validationError("Invoice number is already in use", 409);
}

function translateInvoiceWriteError(error) {
  if (error?.code === 11000 && error?.keyPattern?.invoiceNo) {
    throw validationError("Invoice number is already in use", 409);
  }
  throw error;
}

async function create(input = {}) {
  const data = normalizeInvoiceInput(input);
  await assertInvoiceNumberAvailable(data.invoiceNo);
  try {
    return await Invoice.create(data);
  } catch (error) {
    return translateInvoiceWriteError(error);
  }
}

async function update(invoiceId, input = {}) {
  const current = await get(invoiceId);
  assertInvoiceIdUnchanged(current, input);
  const data = normalizeInvoiceInput(input, current);
  await assertInvoiceNumberAvailable(data.invoiceNo, current.invoiceId);
  let result;
  try {
    result = await Invoice.updateOne(
      { invoiceId: current.invoiceId },
      {
        $set: {
          ...data,
          updatedAt: new Date(),
        },
      },
    );
  } catch (error) {
    return translateInvoiceWriteError(error);
  }
  if (!result.matchedCount) {
    throw Object.assign(new Error("Invoice not found"), { status: 404 });
  }
  return get(current.invoiceId);
}

module.exports = {
  list,
  get,
  create,
  update,
  calculate,
  normalizeInvoiceItems,
  normalizeInvoiceInput,
  assertInvoiceIdUnchanged,
  generateInvoiceNumber,
  assertInvoiceNumberAvailable,
  INVOICE_STATUSES,
};
