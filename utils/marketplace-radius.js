const RADIUS_STAGES = Object.freeze([
  { maxDistanceKm: 20, delayMinutes: 0, label: "Nearby" },
  { maxDistanceKm: 50, delayMinutes: 10, label: "Local area" },
  { maxDistanceKm: 100, delayMinutes: 30, label: "Regional" },
  { maxDistanceKm: Number.POSITIVE_INFINITY, delayMinutes: 60, label: "Open network" },
]);

const MARKETPLACE_MAX_AGE_MONTHS = 6;

function numericCoordinate(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numericDistance(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const values = [lat1, lon1, lat2, lon2].map(numericCoordinate);
  if (values.some((value) => value === null)) return null;
  const [fromLat, fromLon, toLat, toLon] = values;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(toLat - fromLat);
  const longitudeDelta = toRadians(toLon - fromLon);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat))
    * Math.sin(longitudeDelta / 2) ** 2;
  const distance = 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(distance * 10) / 10;
}

function stageForDistance(distanceKm) {
  const distance = numericDistance(distanceKm);
  if (distance === null) return null;
  return RADIUS_STAGES.find((stage) => distance <= stage.maxDistanceKm)
    || RADIUS_STAGES[RADIUS_STAGES.length - 1];
}

function marketplaceVisibleAt(publishedAt, distanceKm) {
  const published = new Date(publishedAt || Date.now());
  // When a provider location is unavailable, the lead becomes eligible only
  // after the unrestricted 60-minute marketplace stage.
  const stage = stageForDistance(distanceKm) || RADIUS_STAGES[RADIUS_STAGES.length - 1];
  if (Number.isNaN(published.getTime())) return null;
  return new Date(published.getTime() + stage.delayMinutes * 60 * 1000);
}

function marketplaceAgeCutoff(now = new Date()) {
  const cutoff = new Date(now);
  if (Number.isNaN(cutoff.getTime())) return null;
  cutoff.setUTCMonth(cutoff.getUTCMonth() - MARKETPLACE_MAX_AGE_MONTHS);
  return cutoff;
}

function isMarketplaceWithinAge(publishedAt, now = new Date()) {
  const published = new Date(publishedAt || "");
  const current = new Date(now);
  const cutoff = marketplaceAgeCutoff(current);
  return Boolean(
    cutoff
    && !Number.isNaN(published.getTime())
    && !Number.isNaN(current.getTime())
    && published <= current
    && published >= cutoff,
  );
}

function isMarketplaceVisible(record = {}, now = new Date()) {
  if (record.contactUnlocked === true || record.status === "unlocked") return true;
  const publishedAt = record.marketplacePublishedAt || record.distributedAt;
  if (!isMarketplaceWithinAge(publishedAt, now)) return false;
  const calculatedVisibleAt = marketplaceVisibleAt(
    publishedAt,
    record.providerDistanceKm,
  );
  const visibleAt = record.marketplaceVisibleAt
    ? new Date(record.marketplaceVisibleAt)
    : calculatedVisibleAt;
  const current = new Date(now);
  return Boolean(
    visibleAt
    && !Number.isNaN(visibleAt.getTime())
    && !Number.isNaN(current.getTime())
    && visibleAt <= current,
  );
}

module.exports = {
  MARKETPLACE_MAX_AGE_MONTHS,
  RADIUS_STAGES,
  haversineDistanceKm,
  isMarketplaceVisible,
  isMarketplaceWithinAge,
  marketplaceAgeCutoff,
  marketplaceVisibleAt,
  stageForDistance,
};
