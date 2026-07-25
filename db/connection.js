const mongoose = require("mongoose");

function positiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, maximum);
}

async function connectDatabase() {
  if (process.env.SKIP_DB === "true") return mongoose.connection;
  if ([1, 2].includes(mongoose.connection.readyState)) return mongoose.connection;

  const uri = String(process.env.MONGODB_URI || "").trim();
  if (!uri) {
    throw Object.assign(new Error("MONGODB_URI is required"), {
      code: "MONGODB_URI_MISSING",
    });
  }

  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: positiveInteger(
      process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS,
      10000,
      120000,
    ),
    maxPoolSize: positiveInteger(process.env.MONGO_MAX_POOL_SIZE, 30, 500),
    minPoolSize: positiveInteger(process.env.MONGO_MIN_POOL_SIZE, 2, 100),
    maxIdleTimeMS: positiveInteger(process.env.MONGO_MAX_IDLE_TIME_MS, 60000, 600000),
    autoIndex: process.env.MONGO_AUTO_INDEX === "true",
  });
  console.log(`MongoDB connected: ${mongoose.connection.name}`);
  return mongoose.connection;
}

module.exports = connectDatabase;
