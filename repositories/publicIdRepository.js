function publicIdQuery(id) {
  const value = String(id || '').trim();
  if (!value) {
    const error = new Error('A public UUID/id is required');
    error.status = 400;
    throw error;
  }
  return { id: value };
}

function publicIdsQuery(ids = []) {
  return { id: { $in: ids.map((id) => String(id || '').trim()).filter(Boolean) } };
}

async function findOneByPublicId(Model, id) {
  return Model.findOne(publicIdQuery(id)).lean();
}

async function updateOneByPublicId(Model, id, update, options = {}) {
  return Model.findOneAndUpdate(publicIdQuery(id), update, {
    new: true,
    runValidators: true,
    ...options
  }).lean();
}

module.exports = {
  publicIdQuery,
  publicIdsQuery,
  findOneByPublicId,
  updateOneByPublicId
};
