function normalizeMobile(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

function validateMobile(value, options = {}) {
  const label = options.label || "Mobile number";
  const required = options.required !== false;
  const normalized = normalizeMobile(value);

  if (!normalized && !required) return "";
  if (!normalized) {
    throw Object.assign(new Error(`${label} is required`), { status: 400 });
  }
  if (!/^\d{10}$/.test(normalized)) {
    throw Object.assign(
      new Error(`${label} must contain exactly 10 digits`),
      { status: 400 },
    );
  }

  return normalized;
}

module.exports = { normalizeMobile, validateMobile };
