const RADIUS_STAGES = Object.freeze([
  { maxDistanceKm: 5, delayMinutes: 0, label: "Nearby" },
  { maxDistanceKm: 10, delayMinutes: 5, label: "Local" },
  { maxDistanceKm: 25, delayMinutes: 15, label: "Local area" },
  { maxDistanceKm: 50, delayMinutes: 30, label: "Extended area" },
  { maxDistanceKm: 100, delayMinutes: 60, label: "Regional" },
  { maxDistanceKm: 200, delayMinutes: 120, label: "Wide regional" },
  { maxDistanceKm: 400, delayMinutes: 240, label: "Long distance" },
  { maxDistanceKm: Number.POSITIVE_INFINITY, delayMinutes: 480, label: "Open network" },
]);

function numericCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
  const distance = Number(distanceKm);
  if (!Number.isFinite(distance) || distance < 0) return null;
  return RADIUS_STAGES.find((stage) => distance <= stage.maxDistanceKm)
    || RADIUS_STAGES[RADIUS_STAGES.length - 1];
}

function marketplaceVisibleAt(publishedAt, distanceKm) {
  const published = new Date(publishedAt || Date.now());
  const stage = stageForDistance(distanceKm);
  if (Number.isNaN(published.getTime()) || !stage) return null;
  return new Date(published.getTime() + stage.delayMinutes * 60 * 1000);
}

function isMarketplaceVisible(record = {}, now = new Date()) {
  if (record.contactUnlocked === true || record.status === "unlocked") return true;
  const visibleAt = record.marketplaceVisibleAt ? new Date(record.marketplaceVisibleAt) : null;
  const current = new Date(now);
  return Boolean(
    visibleAt
    && !Number.isNaN(visibleAt.getTime())
    && !Number.isNaN(current.getTime())
    && visibleAt <= current,
  );
}

module.exports = {
  RADIUS_STAGES,
  haversineDistanceKm,
  isMarketplaceVisible,
  marketplaceVisibleAt,
  stageForDistance,
};
