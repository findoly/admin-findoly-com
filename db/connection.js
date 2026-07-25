const mongoose = require("mongoose");

async function connectDatabase() {
  if (process.env.SKIP_DB === "true") return mongoose.connection;
  if (
    mongoose.connection.readyState === 1 ||
    mongoose.connection.readyState === 2
  )
    return mongoose.connection;

  const uri = String(process.env.MONGODB_URI || "").trim();
  if (!uri) {
    throw Object.assign(new Error("MONGODB_URI is required"), { code: "MONGODB_URI_MISSING" });
  }
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: Number(
      process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000,
    ),
  });
  console.log(`MongoDB connected: ${mongoose.connection.name}`);
  return mongoose.connection;
}

module.exports = connectDatabase;
