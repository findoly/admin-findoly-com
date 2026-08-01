"use strict";

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : "";
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : "";
}

function contactEntries(contacts = {}) {
  const output = [];
  const seen = new Set();
  for (const [field, value] of [
    ["mobile", normalizePhone(contacts.mobile)],
    ["whatsapp", normalizePhone(contacts.whatsappNumber || contacts.whatsapp)],
    ["email", normalizeEmail(contacts.email)],
  ]) {
    if (!value) continue;
    const kind = field === "email" ? "email" : "phone";
    const key = `${kind}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ key, kind, value, field });
  }
  return output;
}

module.exports = { normalizePhone, normalizeEmail, contactEntries };
