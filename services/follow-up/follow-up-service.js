const FollowUp = require("../../models/FollowUp");
const { getPagination, pageResult } = require("../../utils/pagination");

async function list(filters = {}) {
  const { page, limit, skip } = getPagination(filters);
  const query = {};
  if (filters.status) query.status = filters.status;
  if (filters.enquiryId) query.enquiryId = filters.enquiryId;
  if (filters.q) {
    const search = new RegExp(String(filters.q), "i");
    query.$or = [
      { title: search },
      { customerName: search },
      { notes: search },
      { enquiryId: search },
    ];
  }
  const [rows, total] = await Promise.all([
    FollowUp.find(query)
      .sort({ dueAt: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FollowUp.countDocuments(query),
  ]);
  return pageResult(rows, total, page, limit);
}

async function get(followUpId) {
  const followUp = await FollowUp.findOne({ followUpId }).lean();
  if (!followUp)
    throw Object.assign(new Error("Follow-up not found"), { status: 404 });
  return followUp;
}

async function create(input) {
  return FollowUp.create({
    enquiryId: input.enquiryId || "",
    customerName: input.customerName || "",
    title: input.title,
    dueAt: input.dueAt || "",
    owner: input.owner || "admin",
    channel: input.channel || "call",
    status: input.status || "open",
    notes: input.notes || "",
  });
}

async function update(followUpId, input) {
  const result = await FollowUp.updateOne(
    { followUpId },
    { $set: { ...input, updatedAt: new Date() } },
  );
  if (!result.matchedCount)
    throw Object.assign(new Error("Follow-up not found"), { status: 404 });
  return get(followUpId);
}

module.exports = { list, get, create, update };
