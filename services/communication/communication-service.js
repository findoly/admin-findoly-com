const Communication = require("../../models/Communication");
const { getPagination, pageResult } = require("../../utils/pagination");

async function list(filters = {}) {
  const { page, limit, skip } = getPagination(filters);
  const query = {};
  if (filters.channel) query.channel = filters.channel;
  if (filters.enquiryId) query.enquiryId = filters.enquiryId;
  if (filters.q) {
    const search = new RegExp(String(filters.q), "i");
    query.$or = [
      { recipientName: search },
      { recipientContact: search },
      { message: search },
      { enquiryId: search },
    ];
  }
  const [rows, total] = await Promise.all([
    Communication.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Communication.countDocuments(query),
  ]);
  return pageResult(rows, total, page, limit);
}

async function get(communicationId) {
  const communication = await Communication.findOne({ communicationId }).lean();
  if (!communication)
    throw Object.assign(new Error("Communication not found"), { status: 404 });
  return communication;
}

async function create(input) {
  return Communication.create({
    enquiryId: input.enquiryId || "",
    providerId: input.providerId || "",
    recipientName: input.recipientName || "",
    recipientContact: input.recipientContact || "",
    channel: input.channel || "call",
    direction: input.direction || "outbound",
    message: input.message || "",
    status: input.status || "logged",
  });
}

async function update(communicationId, input) {
  const result = await Communication.updateOne(
    { communicationId },
    { $set: { ...input, updatedAt: new Date() } },
  );
  if (!result.matchedCount)
    throw Object.assign(new Error("Communication not found"), { status: 404 });
  return get(communicationId);
}

module.exports = { list, get, create, update };
