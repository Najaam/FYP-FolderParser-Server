const mongoose = require("mongoose");

async function connectDB() {
  const mongoUri = process.env.MONGO_URI;
  const serverSelectionTimeoutMS = Number(
    process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 5000
  );

  if (!mongoUri) {
    throw new Error("MONGO_URI is missing in environment variables");
  }

  try {
    const connection = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS
    });

    console.log(
      `MongoDB connected successfully: ${connection.connection.host}/${connection.connection.name}`
    );
  } catch (error) {
    if (error.message.includes("ECONNREFUSED")) {
      throw new Error(
        "MongoDB connection refused. Start MongoDB on localhost:27017 or update MONGO_URI in .env."
      );
    }

    throw error;
  }
}

module.exports = connectDB;
