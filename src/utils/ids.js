const { randomUUID } = require('crypto');

function createId(prefix) {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

module.exports = { createId };
