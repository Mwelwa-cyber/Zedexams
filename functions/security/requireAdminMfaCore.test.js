// Plain-node tests for the pure admin-MFA decision logic + claim/scrub helpers.
// Run: node functions/security/requireAdminMfaCore.test.js

const assert = require("node:assert");
const {
  tokenIsAdmin,
  tokenIsSuperAdmin,
  tokenHasSecondFactor,
  secondFactorType,
  evaluateAdminMfa,
} = require("./requireAdminMfaCore");
const { buildRoleClaims } = require("./adminClaims");
const { scrubMetadata } = require("./securityAudit");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// A token that completed a TOTP second factor.
const mfa = { firebase: { sign_in_second_factor: "totp", sign_in_provider: "password" } };
// A first-factor-only session (no second factor).
const noMfa = { firebase: { sign_in_provider: "password" } };

console.log("tokenIsAdmin");
test("boolean admin claim", () => assert.equal(tokenIsAdmin({ admin: true }), true));
test("boolean superAdmin claim", () => assert.equal(tokenIsAdmin({ superAdmin: true }), true));
test("legacy role=admin claim", () => assert.equal(tokenIsAdmin({ role: "admin" }), true));
test("legacy role=superAdmin claim", () => assert.equal(tokenIsAdmin({ role: "superAdmin" }), true));
test("platformAdmin break-glass claim", () => assert.equal(tokenIsAdmin({ platformAdmin: true }), true));
test("teacher role is not admin", () => assert.equal(tokenIsAdmin({ role: "teacher" }), false));
test("learner is not admin", () => assert.equal(tokenIsAdmin({ role: "learner" }), false));
test("admin:false is not admin", () => assert.equal(tokenIsAdmin({ admin: false }), false));
test("null token is not admin", () => assert.equal(tokenIsAdmin(null), false));
test("string is not admin", () => assert.equal(tokenIsAdmin("admin"), false));

console.log("tokenIsSuperAdmin");
test("superAdmin boolean", () => assert.equal(tokenIsSuperAdmin({ superAdmin: true }), true));
test("role=superAdmin", () => assert.equal(tokenIsSuperAdmin({ role: "superAdmin" }), true));
test("plain admin is not super", () => assert.equal(tokenIsSuperAdmin({ admin: true, role: "admin" }), false));

console.log("tokenHasSecondFactor");
test("totp present", () => assert.equal(tokenHasSecondFactor(mfa), true));
test("absent", () => assert.equal(tokenHasSecondFactor(noMfa), false));
test("empty string not counted", () =>
  assert.equal(tokenHasSecondFactor({ firebase: { sign_in_second_factor: "" } }), false));
test("no firebase block", () => assert.equal(tokenHasSecondFactor({}), false));
test("factor type reported", () => assert.equal(secondFactorType(mfa), "totp"));
test("factor type null when absent", () => assert.equal(secondFactorType(noMfa), null));

console.log("evaluateAdminMfa");
test("unauthenticated when no token", () =>
  assert.equal(evaluateAdminMfa(null).code, "unauthenticated"));
test("permission-denied for teacher even with MFA", () =>
  assert.equal(
    evaluateAdminMfa({ role: "teacher", firebase: { sign_in_second_factor: "totp" } }).code,
    "permission-denied",
  ));
test("failed-precondition for admin without MFA", () => {
  const d = evaluateAdminMfa({ admin: true, ...noMfa });
  assert.equal(d.ok, false);
  assert.equal(d.code, "failed-precondition");
  assert.equal(d.reason, "admin-mfa-required");
});
test("ok for admin with MFA", () => {
  const d = evaluateAdminMfa({ admin: true, ...mfa });
  assert.equal(d.ok, true);
  assert.equal(d.factor, "totp");
  assert.equal(d.isSuperAdmin, false);
});
test("ok + isSuperAdmin for superAdmin with MFA", () => {
  const d = evaluateAdminMfa({ superAdmin: true, role: "superAdmin", ...mfa });
  assert.equal(d.ok, true);
  assert.equal(d.isSuperAdmin, true);
});
test("requireSuperAdmin rejects plain admin (denied before mfa check)", () => {
  const d = evaluateAdminMfa({ admin: true, role: "admin", ...mfa }, { requireSuperAdmin: true });
  assert.equal(d.ok, false);
  assert.equal(d.code, "permission-denied");
  assert.equal(d.reason, "not-super-admin");
});
test("requireSuperAdmin accepts superAdmin with MFA", () => {
  const d = evaluateAdminMfa({ superAdmin: true, ...mfa }, { requireSuperAdmin: true });
  assert.equal(d.ok, true);
});
test("precedence: non-admin reported before mfa", () => {
  // A non-admin without MFA must read as permission-denied, never leak mfa-required.
  assert.equal(evaluateAdminMfa({ role: "learner", ...noMfa }).reason, "not-admin");
});

console.log("buildRoleClaims");
test("superAdmin sets both flags", () => {
  const c = buildRoleClaims({}, "superAdmin");
  assert.deepEqual(c, { role: "superAdmin", superAdmin: true, admin: true });
});
test("admin sets admin flag only", () => {
  const c = buildRoleClaims({}, "admin");
  assert.deepEqual(c, { role: "admin", admin: true });
});
test("teacher clears admin flags", () => {
  const c = buildRoleClaims({ admin: true, superAdmin: true, role: "superAdmin" }, "teacher");
  assert.deepEqual(c, { role: "teacher" });
});
test("preserves unrelated claims (platformAdmin)", () => {
  const c = buildRoleClaims({ platformAdmin: true }, "admin");
  assert.equal(c.platformAdmin, true);
  assert.equal(c.admin, true);
  assert.equal(c.role, "admin");
});

console.log("scrubMetadata");
test("drops forbidden secret keys", () => {
  const out = scrubMetadata({ totpSecret: "JBSWY", code: "123456", reason: "ok", factor: "totp" });
  assert.equal(out.totpSecret, undefined);
  assert.equal(out.code, undefined);
  assert.equal(out.reason, "ok");
  assert.equal(out.factor, "totp");
});
test("drops nested objects", () => {
  const out = scrubMetadata({ safe: "x", nested: { secret: "y" } });
  assert.deepEqual(out, { safe: "x" });
});
test("null for empty", () => assert.equal(scrubMetadata({}), null));
test("null for non-object", () => assert.equal(scrubMetadata("x"), null));

console.log(`\n${passed} assertions passed`);
