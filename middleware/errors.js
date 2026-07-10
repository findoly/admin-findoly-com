function notFound(req, res) {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ ok: false, message: 'Not found' });
  }
  return res.status(404).render('errors/404', { title: 'Page not found' });
}

function errorHandler(error, req, res, next) {
  console.error(error);
  const status = error.status || (error.name === 'ValidationError' ? 400 : 500);
  if (req.path.startsWith('/api')) {
    return res.status(status).json({
      ok: false,
      message: error.message || 'Something went wrong'
    });
  }
  return res.status(status).render('errors/error', {
    title: 'Something went wrong',
    error: process.env.NODE_ENV === 'production' ? null : error
  });
}

module.exports = { notFound, errorHandler };
