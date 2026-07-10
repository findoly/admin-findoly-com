const { randomUUID } = require('crypto');

function createUuid() {
  return randomUUID();
}

function createId(prefix = '') {
  const uuid = createUuid();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

function isUuidLike(value) {
  return /^[a-z]+_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

module.exports = { createId, createUuid, isUuidLike };
