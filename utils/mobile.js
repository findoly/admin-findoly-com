function normalizeMobile(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

function validateMobile(value, options = {}) {
  const label = options.label || "Mobile number";
  const required = options.required !== false;
  const raw = value === undefined || value === null ? "" : String(value).trim();

  if (!raw && !required) return "";
  if (!raw) {
    throw Object.assign(new Error(`${label} is required`), { status: 400 });
  }
  if (raw.length > 30) {
    throw Object.assign(new Error(`${label} is too long`), { status: 400 });
  }
  if (!/^[+\d\s()-]+$/.test(raw)) {
    throw Object.assign(
      new Error(`${label} may contain only digits and phone formatting`),
      { status: 400 },
    );
  }

  const normalized = normalizeMobile(raw);
  if (!/^\d{10}$/.test(normalized)) {
    throw Object.assign(
      new Error(`${label} must contain exactly 10 digits`),
      { status: 400 },
    );
  }

  return normalized;
}

module.exports = { normalizeMobile, validateMobile };
