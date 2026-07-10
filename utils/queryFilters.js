function firstPresent(filters = {}, keys = []) {
  for (const key of keys) {
    const value = filters[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function startOfDay(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return `${clean}T00:00:00.000Z`;
  return clean;
}

function endOfDay(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return `${clean}T23:59:59.999Z`;
  return clean;
}

function addDateRange(query, field, filters = {}, options = {}) {
  const fromKeys = options.fromKeys || ['dateFrom', 'fromDate', 'createdFrom', 'from'];
  const toKeys = options.toKeys || ['dateTo', 'toDate', 'createdTo', 'to'];
  const dateOnly = options.dateOnly === true;
  const rawFrom = firstPresent(filters, fromKeys);
  const rawTo = firstPresent(filters, toKeys);
  if (!rawFrom && !rawTo) return query;

  const range = {};
  if (rawFrom) range.$gte = dateOnly ? rawFrom : startOfDay(rawFrom);
  if (rawTo) range.$lte = dateOnly ? rawTo : endOfDay(rawTo);
  query[field] = { ...(query[field] || {}), ...range };
  return query;
}

function cleanFilterParams(filters = {}) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => {
    if (value === undefined || value === null) return false;
    if (Array.isArray(value)) return value.length > 0;
    return String(value).trim() !== '';
  }));
}

module.exports = {
  addDateRange,
  cleanFilterParams,
  firstPresent,
  startOfDay,
  endOfDay
};
