const mongoose = require('mongoose');

let connectionPromise;

function getMongoUri() {
  return process.env.MONGODB_URI || process.env.MONGO_URI || '';
}

async function connectDb() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connectionPromise) return connectionPromise;

  const uri = getMongoUri();
  if (!uri) {
    throw new Error('MONGODB_URI is required. For local testing use mongodb://127.0.0.1:27017/service_crm_admin in .env.');
  }

  connectionPromise = mongoose.connect(uri, {
    autoIndex: process.env.NODE_ENV !== 'production',
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000)
  });

  await connectionPromise;
  console.log(`MongoDB connected: ${mongoose.connection.name}`);
  return mongoose.connection;
}

async function disconnectDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  connectionPromise = null;
}

module.exports = { connectDb, disconnectDb, mongoose };
