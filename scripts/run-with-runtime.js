#!/usr/bin/env node
"use strict";

const path = require("path");
const { spawn } = require("child_process");
const { bootstrapRuntime } = require("../config/bootstrap-runtime");

async function main() {
  const [, , script, ...args] = process.argv;
  if (!script) throw new Error("A script path is required");

  const secretResult = await bootstrapRuntime();
  if (!secretResult.skipped) {
    console.log(`CRM configuration loaded from AWS Secrets Manager (${secretResult.loaded} values)`);
  }

  const target = path.resolve(process.cwd(), script);
  const child = spawn(process.execPath, [target, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));

  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
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
  main().catch((error) => {
    console.error("CRM script startup failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
