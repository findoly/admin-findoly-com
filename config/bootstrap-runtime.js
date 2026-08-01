"use strict";

const { loadAwsSecrets } = require("./load-aws-secrets");

async function bootstrapRuntime({ env = process.env, dotenvOptions, loadSecrets = loadAwsSecrets } = {}) {
  require("dotenv").config(dotenvOptions);
  return loadSecrets({ env });
}

module.exports = { bootstrapRuntime };
