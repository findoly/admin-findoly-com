"use strict";

function safeLocalPath(value, fallback = "/dashboard") {
  const raw = String(value || "").trim();
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(raw)) {
    return fallback;
  }
  try {
    const base = new URL("https://crm.invalid");
    const parsed = new URL(raw, base);
    if (parsed.origin !== base.origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (_error) {
    return fallback;
  }
}

module.exports = { safeLocalPath };
