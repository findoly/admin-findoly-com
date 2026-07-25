const { dateOnlyValue, enumValue, validationError } = require("./validation");

function dateBoundary(value, endOfDay = false) {
  if (!value) return null;
  return new Date(`${value}${endOfDay ? "T23:59:59.999+05:30" : "T00:00:00.000+05:30"}`);
}

function applyDateRange(query, filters = {}, options = {}) {
  const {
    fields = { createdAt: "Created date" },
    defaultField = Object.keys(fields)[0] || "createdAt",
    fromKey = "startDate",
    toKey = "endDate",
    fieldKey = "dateField",
  } = options;
  const allowedFields = Object.keys(fields);
  const dateField = filters[fieldKey]
    ? enumValue(filters[fieldKey], allowedFields, { label: "Date field", normalize: false })
    : defaultField;
  const startDate = dateOnlyValue(filters[fromKey], { label: "Start date", required: false });
  const endDate = dateOnlyValue(filters[toKey], { label: "End date", required: false });
  if (startDate && endDate && endDate < startDate) {
    throw validationError("End date cannot be before start date");
  }
  if (startDate || endDate) {
    query[dateField] = {};
    if (startDate) query[dateField].$gte = dateBoundary(startDate, false);
    if (endDate) query[dateField].$lte = dateBoundary(endDate, true);
  }
  return { dateField, startDate, endDate };
}

function dateSort(filters = {}, options = {}) {
  const {
    fields = ["createdAt"],
    defaultField = fields[0] || "createdAt",
    fieldKey = "dateField",
    orderKey = "sortOrder",
  } = options;
  const field = filters[fieldKey]
    ? enumValue(filters[fieldKey], fields, { label: "Date sort field", normalize: false })
    : defaultField;
  const order = filters[orderKey]
    ? enumValue(filters[orderKey], ["newest", "oldest"], { label: "Date sort order" })
    : "newest";
  return { [field]: order === "oldest" ? 1 : -1, _id: order === "oldest" ? 1 : -1 };
}

module.exports = { applyDateRange, dateSort, dateBoundary };
