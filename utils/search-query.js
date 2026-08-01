"use strict";

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizedSearch(value) {
  return String(value || "").trim().slice(0, 120);
}

function phoneSearch(value) {
  const digits = normalizedSearch(value).replace(/\D/g, "");
  return /^[6-9]\d{9}$/.test(digits) ? digits : "";
}

function emailSearch(value) {
  const normalized = normalizedSearch(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized) ? normalized : "";
}

function identifierSearch(value) {
  const normalized = normalizedSearch(value);
  return /^[A-Za-z0-9][A-Za-z0-9_:-]{2,127}$/.test(normalized) ? normalized : "";
}

function prefixRegex(value) {
  return new RegExp(`^${escapeRegex(normalizedSearch(value))}`, "i");
}

function buildSearchAlternatives(value, {
  identifierFields = [],
  phoneFields = [],
  emailFields = [],
  prefixFields = [],
} = {}) {
  const q = normalizedSearch(value);
  if (!q) return [];

  const phone = phoneSearch(q);
  if (phone && phoneFields.length) {
    return phoneFields.map((field) => ({ [field]: phone }));
  }

  const email = emailSearch(q);
  if (email && emailFields.length) {
    return emailFields.map((field) => ({ [field]: email }));
  }

  const id = identifierSearch(q);
  const alternatives = [];
  if (id) identifierFields.forEach((field) => alternatives.push({ [field]: id }));
  const search = prefixRegex(q);
  prefixFields.forEach((field) => alternatives.push({ [field]: search }));
  return alternatives;
}

module.exports = {
  escapeRegex,
  normalizedSearch,
  phoneSearch,
  emailSearch,
  identifierSearch,
  prefixRegex,
  buildSearchAlternatives,
};
