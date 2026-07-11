function normalizeMobile(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

module.exports = { normalizeMobile };
