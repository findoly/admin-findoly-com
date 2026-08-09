"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AUTH_COOKIE_SECRET = "crm-session-test-secret-with-at-least-32-characters";

const { setAdminCookie, decodeSession, SESSION_MS } = require("../middleware/auth");

test("CRM employee sessions remain fixed at 24 hours", () => {
  const captured = {};
  const response = {
    cookie(name, value, options) {
      captured.name = name;
      captured.value = value;
      captured.options = options;
    },
  };

  const session = setAdminCookie(response, {
    employeeId: "EMP-SESSION-1",
    mobile: "9000000000",
    name: "Session Test",
    roleId: "ROLE-1",
    roleName: "Tester",
    permissions: [],
  });

  assert.equal(SESSION_MS, 24 * 60 * 60 * 1000);
  assert.equal(captured.options.maxAge, SESSION_MS);
  assert.equal(session.exp - session.iat, SESSION_MS);
  assert.deepEqual(decodeSession(captured.value), session);
});
