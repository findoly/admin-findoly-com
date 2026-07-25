const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeMobile, validateMobile } = require("../utils/mobile");
const {
  humanTextValue,
  pincodeValue,
  stringArrayValue,
  plainObjectValue,
} = require("../utils/validation");

const root = path.join(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

function expect400(fn, pattern) {
  assert.throws(fn, (error) => error.status === 400 && pattern.test(error.message));
}

test("Indian mobile validation is strict and normalized", () => {
  assert.equal(normalizeMobile("+91 98765-43210"), "9876543210");
  assert.equal(validateMobile("9876543210"), "9876543210");
  expect400(() => validateMobile("98765abc10"), /only digits/);
  expect400(() => validateMobile("987654321"), /valid 10-digit/);
});

test("human lead text rejects emoji and HTML", () => {
  expect400(() => humanTextValue("Painter needed 😀", { label: "Requirement" }), /emoji/);
  expect400(() => humanTextValue("<b>Painter</b>", { label: "Requirement" }), /HTML/);
  assert.equal(humanTextValue("Painter needed", { label: "Requirement" }), "Painter needed");
});

test("pincode and service type list validation remain bounded", () => {
  assert.equal(pincodeValue("400064", { label: "Pincode", required: true }), "400064");
  expect400(() => pincodeValue("000001", { label: "Pincode", required: true }), /exactly 6 digits/);
  assert.deepEqual(stringArrayValue(["painting", "painting", "plumbing"], { label: "Categories", maxItems: 5 }), ["painting", "plumbing"]);
  expect400(() => stringArrayValue(["1", "2", "3", "4", "5", "6"], { label: "Service Types", maxItems: 5 }), /not contain more than 5/);
});

test("metadata validation blocks MongoDB operator injection", () => {
  expect400(() => plainObjectValue({ $where: "this.password" }, { label: "Metadata" }), /unsafe field/);
  expect400(() => plainObjectValue({ "profile.name": "x" }, { label: "Metadata" }), /unsafe field/);
});

test("lead service enforces mandatory one-to-five Service Types and unlock limits", () => {
  const service = source("services/enquiry/enquiry-service.js");
  assert.match(service, /resolveLeadServiceTypes/);
  assert.match(service, /maxProviderUnlocks/);
  assert.match(service, /fallback:\s*current\.maxProviderUnlocks \?\? 5/);
  assert.doesNotMatch(service, /distributionData|LeadDistribution/);
});

test("provider service validates categories and creates no marketplace fan-out rows", () => {
  const service = source("services/provider/provider-service.js");
  assert.match(service, /maxItems:\s*50/);
  assert.match(service, /assertUniqueProviderMobile/);
  assert.doesNotMatch(service, /LeadDistribution|scheduleProviderSync/);
});
