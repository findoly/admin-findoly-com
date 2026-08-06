#!/usr/bin/env node
"use strict";

const path = require("path");
const { spawn } = require("child_process");
const { StringDecoder } = require("string_decoder");
const { bootstrapRuntime } = require("../config/bootstrap-runtime");
const { createCloudWatchLogger } = require("../services/logging/cloudwatch-logger");

const cloudwatchLogger = createCloudWatchLogger({
  service: "crm-maintenance",
  credentialPrefix: "CRM_SECRETS_",
  defaultLogGroup: "/findoly/crm/production",
});
cloudwatchLogger.install();

function forwardChildStream(stream, output, level, source) {
  if (!stream || typeof stream.on !== "function") return;
  const decoder = new StringDecoder("utf8");
  let pending = "";

  const captureLines = (text, flush = false) => {
    pending += text;
    const lines = pending.split(/\r?\n/);
    pending = flush ? "" : lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) cloudwatchLogger.capture(level, [line], { source });
    }
    if (flush && pending.trim()) {
      cloudwatchLogger.capture(level, [pending], { source });
      pending = "";
    }
  };

  stream.on("data", (chunk) => {
    output.write(chunk);
    captureLines(decoder.write(chunk));
  });
  stream.on("end", () => captureLines(decoder.end(), true));
}

async function main() {
  const [, , script, ...args] = process.argv;
  if (!script) throw new Error("A script path is required");

  const secretResult = await bootstrapRuntime();
  cloudwatchLogger.configureFromEnv();
  if (!secretResult.skipped) {
    console.log(`CRM configuration loaded from AWS Secrets Manager (${secretResult.loaded} values)`);
  }

  const target = path.resolve(process.cwd(), script);
  const child = spawn(process.execPath, [target, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  forwardChildStream(child.stdout, process.stdout, "info", "maintenance-stdout");
  forwardChildStream(child.stderr, process.stderr, "error", "maintenance-stderr");

  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));

  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", async (code, signal) => {
      await cloudwatchLogger.flush({ timeoutMs: 2000 });
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exitCode = code === null ? 1 : code;
      resolve();
    });
  });
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error("CRM script startup failed:", error.message);
    process.exitCode = 1;
    await cloudwatchLogger.flush({ timeoutMs: 2000 });
  });
}

module.exports = { cloudwatchLogger, forwardChildStream, main };
