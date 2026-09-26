function creditsFromPaise(value) {
  const paise = Number(value || 0);
  if (!Number.isFinite(paise)) return 0;
  return Math.max(0, Math.round(paise)) / 100;
}

function paiseFromCredits(value) {
  const credits = Number(value || 0);
  if (!Number.isFinite(credits)) return 0;
  return Math.max(0, Math.round(credits * 100));
}

function leadCostCredits(record = {}) {
  const explicit = Number(record.leadCostCredits);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  return creditsFromPaise(record.leadPricePaise);
}

module.exports = { creditsFromPaise, paiseFromCredits, leadCostCredits };
