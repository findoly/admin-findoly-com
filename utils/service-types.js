const { validationError } = require("./validation");

const MIN_SERVICE_TYPES = 1;
const MAX_SERVICE_TYPES = 5;

function normalizeServiceTypeIdentifiers(values) {
  if (!Array.isArray(values)) {
    throw validationError("Select at least one Service Type");
  }
  const identifiers = [...new Set(values.map((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return String(item.serviceTypeId || item.id || "").trim();
    }
    return String(item || "").trim();
  }).filter(Boolean))];
  if (identifiers.length < MIN_SERVICE_TYPES) {
    throw validationError("Select at least one Service Type");
  }
  if (identifiers.length > MAX_SERVICE_TYPES) {
    throw validationError("Select no more than 5 Service Types");
  }
  return identifiers;
}

module.exports = {
  MIN_SERVICE_TYPES,
  MAX_SERVICE_TYPES,
  normalizeServiceTypeIdentifiers,
};
