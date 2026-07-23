const mongoose = require("mongoose");

function transactionUnavailable(error) {
  const message = String(error?.message || "");
  return (
    error?.code === 20 ||
    /Transaction numbers are only allowed on a replica set member or mongos/i.test(message) ||
    /transactions are not supported/i.test(message)
  );
}

async function withTransaction(work) {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(
      async () => {
        result = await work(session);
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        readPreference: "primary",
      },
    );
    return result;
  } catch (error) {
    if (transactionUnavailable(error)) {
      throw Object.assign(
        new Error(
          "Credit operations require MongoDB Atlas or a replica set with transactions enabled",
        ),
        { status: 503, code: "MONGODB_TRANSACTIONS_REQUIRED" },
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = { withTransaction };
