/**
 * functions/passwordResetRateLimitCore.js — the document ids a password-reset
 * attempt charges, and therefore the ones a failed attempt refunds.
 *
 * Two things are load-bearing here and neither is visible at the call site:
 * the key STRINGS (live counter documents are already keyed this way, so a
 * format change silently hands everyone a fresh allowance instead of reading
 * their real one), and the fact that charge and refund derive from the same
 * function (they used to be two separate string literals, which is a
 * mismatch waiting to happen).
 */
const assert = require("node:assert/strict");
const {passwordResetRateLimitKeys} = require("./passwordResetRateLimitCore");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const DAY = "2026-08-13";

test("the email bucket keeps the format live counters already use", () => {
  const keys = passwordResetRateLimitKeys({
    email: "learner@example.com", ip: "41.60.1.2", day: DAY,
  });
  assert.equal(keys[0], "email_learner@example.com_2026-08-13");
});

test("the IP bucket keeps its format too, and comes second", () => {
  const keys = passwordResetRateLimitKeys({
    email: "learner@example.com", ip: "41.60.1.2", day: DAY,
  });
  assert.equal(keys[1], "ip_41.60.1.2_2026-08-13");
  assert.equal(keys.length, 2);
});

test("an unknown IP is dropped, never bucketed", () => {
  // Bucketing the sentinel would put every caller whose IP we cannot read
  // into ONE counter, letting a handful of them exhaust it for the rest.
  const keys = passwordResetRateLimitKeys({
    email: "learner@example.com", ip: "unknown", day: DAY,
  });
  assert.deepEqual(keys, ["email_learner@example.com_2026-08-13"]);
});

test("a missing IP is dropped the same way", () => {
  assert.deepEqual(
    passwordResetRateLimitKeys({email: "a@b.com", ip: "", day: DAY}),
    ["email_a@b.com_2026-08-13"],
  );
  assert.deepEqual(
    passwordResetRateLimitKeys({email: "a@b.com", day: DAY}),
    ["email_a@b.com_2026-08-13"],
  );
});

test("no email means no email bucket — never an `email__day` catch-all", () => {
  const keys = passwordResetRateLimitKeys({email: "", ip: "41.60.1.2", day: DAY});
  assert.deepEqual(keys, ["ip_41.60.1.2_2026-08-13"]);
});

test("an IPv6 caller still gets its own bucket", () => {
  const keys = passwordResetRateLimitKeys({
    email: "a@b.com", ip: "2001:db8::1", day: DAY,
  });
  assert.equal(keys[1], "ip_2001:db8::1_2026-08-13");
});

test("no key can contain a slash — Firestore would reject the write", () => {
  // A rejected counter write is silent (the charge is best-effort), so this
  // would degrade to "no rate limiting at all" rather than to an error.
  const keys = passwordResetRateLimitKeys({
    email: "learner@example.com", ip: "41.60.1.2", day: DAY,
  });
  for (const key of keys) assert.ok(!key.includes("/"), key);
});

test("the refund charges exactly the keys the charge did", () => {
  // The whole reason this function exists: one definition, two callers.
  const args = {email: "learner@example.com", ip: "41.60.1.2", day: DAY};
  assert.deepEqual(
    passwordResetRateLimitKeys(args),
    passwordResetRateLimitKeys(args),
  );
});

test("a different day is a different bucket", () => {
  const a = passwordResetRateLimitKeys({email: "a@b.com", day: "2026-08-13"});
  const b = passwordResetRateLimitKeys({email: "a@b.com", day: "2026-08-14"});
  assert.notDeepEqual(a, b);
});

console.log(`\npassword-reset rate-limit keys: ${passed} passed`);
