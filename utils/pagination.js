function normalisePagination(input = {}) {
  const page = Math.max(parseInt(input.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(input.pageSize || input.limit, 10) || 25, 5), 100);
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize
  };
}

async function paginateModel(model, query = {}, options = {}) {
  const { page, pageSize, skip } = normalisePagination(options);
  const sort = options.sort || { updatedAt: -1, createdAt: -1 };
  const [items, total] = await Promise.all([
    model.find(query).sort(sort).skip(skip).limit(pageSize).lean(),
    model.countDocuments(query)
  ]);
  const pageCount = Math.max(Math.ceil(total / pageSize), 1);
  return {
    items,
    total,
    page,
    pageSize,
    pageCount,
    from: total ? skip + 1 : 0,
    to: Math.min(skip + items.length, total)
  };
}

function pageUrl(basePath, filters = {}, page = 1) {
  const params = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (key === 'page') return;
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((item) => item !== '' && params.append(key, item));
      return;
    }
    params.set(key, value);
  });
  params.set('page', String(page));
  return `${basePath}?${params.toString()}`;
}

function buildPagination(basePath, filters = {}, result = {}) {
  const page = result.page || 1;
  const pageCount = result.pageCount || 1;
  const pages = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(pageCount, page + 2);
  for (let i = start; i <= end; i += 1) {
    pages.push({ page: i, url: pageUrl(basePath, filters, i), active: i === page });
  }
  return {
    ...result,
    previousUrl: page > 1 ? pageUrl(basePath, filters, page - 1) : '',
    nextUrl: page < pageCount ? pageUrl(basePath, filters, page + 1) : '',
    firstUrl: pageUrl(basePath, filters, 1),
    lastUrl: pageUrl(basePath, filters, pageCount),
    pages
  };
}

module.exports = {
  normalisePagination,
  paginateModel,
  pageUrl,
  buildPagination
};
