require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const mongoose = require("mongoose");
const connectDatabase = require("./db/connection");
const { assertRuntimeConfig } = require("./utils/runtime-config");
const { attachAdmin } = require("./middleware/auth");
const { notFound, errorHandler } = require("./middleware/error");
const frontendRoutes = require("./routes/frontend");
const apiRoutes = require("./routes/main");

assertRuntimeConfig();

const app = express();
const production = process.env.NODE_ENV === "production";
const trustProxy = String(process.env.TRUST_PROXY || (production ? "1" : "0")).trim();
if (trustProxy === "true") app.set("trust proxy", 1);
else if (trustProxy === "false" || trustProxy === "0") app.set("trust proxy", false);
else if (/^\d+$/.test(trustProxy)) app.set("trust proxy", Number(trustProxy));
else app.set("trust proxy", trustProxy);

app.disable("x-powered-by");
app.locals.appName = process.env.APP_NAME || "Service CRM Admin";
app.locals.apiBase = "/api";
app.locals.databaseError = null;
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const allowedOrigins = String(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((value) => value.trim().replace(/\/+$/, ""))
  .filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const normalized = String(origin).replace(/\/+$/, "");
    return callback(null, allowedOrigins.includes(normalized));
  },
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Customer-Portal-Token", "X-Findoly-Customer-Token", "X-Findoly-Intake-Token", "X-Communication-Token", "X-Communication-Otp-Token", "X-Webhook-Secret"],
  maxAge: 600,
}));
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "SAMEORIGIN");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (production) res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});
app.use(morgan(production ? "combined" : "dev"));

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
app.post(
  "/api/webhooks/razorpay/payouts",
  express.raw({ type: "application/json", limit: "256kb" }),
  require("./controllers/partnerPayoutController").webhook,
);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));
app.use(cookieParser());
app.post("/api/webhooks/message-delivery", communicationController.lambdaDeliveryWebhook);
app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  maxAge: production ? "1h" : 0,
  index: false,
}));
app.use(attachAdmin);

app.get("/api/health", (req, res) =>
  res.json({
    success: true,
    data: {
      service: "crm",
      status: "alive",
      databaseState: mongoose.connection.readyState,
      database: mongoose.connection.name || null,
    },
  }),
);
app.get("/api/ready", (req, res) => {
  const ready = process.env.SKIP_DB === "true" || mongoose.connection.readyState === 1;
  return res.status(ready ? 200 : 503).json({
    success: ready,
    data: { service: "crm", status: ready ? "ready" : "not_ready", databaseState: mongoose.connection.readyState },
  });
});

app.use("/", frontendRoutes);
app.use("/frontend", frontendRoutes);
app.use("/api", apiRoutes);
app.use(notFound);
app.use(errorHandler);

app.locals.databasePromise = process.env.SKIP_DB === "true"
  ? Promise.resolve(mongoose.connection)
  : connectDatabase();
app.locals.databasePromise.catch((error) => {
  app.locals.databaseError = error;
  console.error("MongoDB connection error:", error.message);
});

module.exports = app;
