function notFound(req, res) {
  if (req.originalUrl.startsWith('/api')) return res.status(404).json({ success: false, message: 'API route not found' });
  return res.status(404).render('404', { title: 'Page not found' });
}

function errorHandler(error, req, res, next) {
  console.error(error);
  const status = Number(error.status || error.statusCode || 500);
  const message = status >= 500 ? 'Something went wrong' : error.message;
  if (req.originalUrl.startsWith('/api')) return res.status(status).json({ success: false, message });
  return res.status(status).render('error', { title: 'Error', message });
}

module.exports = { notFound, errorHandler };
