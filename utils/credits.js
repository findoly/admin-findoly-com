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

module.exports = { creditsFromPaise, paiseFromCredits };
