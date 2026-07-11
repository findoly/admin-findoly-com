const { v4: uuidv4 } = require('uuid');

function createId(prefix) {
  return `${prefix}_${uuidv4()}`;
}

function syncNamedId(document, field, prefix) {
  const value = document[field] || document.id || document._id || createId(prefix);
  document[field] = String(value);
  document.id = String(document.id || value);
  document._id = String(document._id || document.id);
}

module.exports = { createId, syncNamedId };
