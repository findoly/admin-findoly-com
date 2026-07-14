require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const mongoose = require("mongoose");
const connectDatabase = require("./db/connection");
const { attachAdmin } = require("./middleware/auth");
const { notFound, errorHandler } = require("./middleware/error");
const frontendRoutes = require("./routes/frontend");
const apiRoutes = require("./routes/main");

const app = express();

app.locals.appName = process.env.APP_NAME || "Service CRM Admin";
app.locals.apiBase = "/api";
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(cors());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
const communicationController = require("./controllers/communicationController");
app.get("/api/webhooks/whatsapp", communicationController.verifyWhatsAppWebhook);
app.post(
  "/api/webhooks/whatsapp",
  express.raw({ type: "application/json", limit: "1mb" }),
  communicationController.whatsappWebhook,
);
app.post(
  "/api/webhooks/ses",
  express.raw({ type: "application/json", limit: "1mb" }),
  communicationController.sesWebhook,
);
app.post("/api/webhooks/razorpay/payouts", express.raw({ type: "application/json", limit: "256kb" }), require("./controllers/partnerPayoutController").webhook);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));
app.use(cookieParser());
app.post("/api/webhooks/message-delivery", communicationController.lambdaDeliveryWebhook);
app.use(express.static(path.join(__dirname, "public")));
app.use(attachAdmin);

app.get("/api/health", (req, res) =>
  res.json({
    success: true,
    data: { service: "crm", database: mongoose.connection.name || null },
  }),
);

app.use("/", frontendRoutes);
app.use("/frontend", frontendRoutes);
app.use("/api", apiRoutes);
app.use(notFound);
app.use(errorHandler);

if (process.env.SKIP_DB !== "true") {
  connectDatabase().catch((error) =>
    console.error("MongoDB connection error:", error.message),
  );
}

module.exports = app;
