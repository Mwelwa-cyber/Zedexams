/**
 * Unit tests for adminPaymentsCore — the Firebase-free field-shape math
 * behind the audited admin payment callables. Plain `node` assertions.
 */

const assert = require("node:assert");
const {
  teacherTierForPlan,
  resolveDurationDays,
  computeExpiry,
  buildActivationFields,
  buildRevokeFields,
} = require("./adminPaymentsCore");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("adminPaymentsCore");

test("teacherTierForPlan maps pro/max ids, null otherwise", () => {
  assert.strictEqual(teacherTierForPlan("pro_monthly"), "pro");
  assert.strictEqual(teacherTierForPlan("pro_yearly"), "pro");
  assert.strictEqual(teacherTierForPlan("max_monthly"), "max");
  assert.strictEqual(teacherTierForPlan("max_yearly"), "max");
  assert.strictEqual(teacherTierForPlan("monthly"), null);
  assert.strictEqual(teacherTierForPlan("grade7_termly"), null);
  assert.strictEqual(teacherTierForPlan(undefined), null);
});

test("resolveDurationDays honours a positive request", () => {
  assert.strictEqual(resolveDurationDays({durationDays: 30}, 7), 7);
});

test("resolveDurationDays falls back to plan then 30 on 0/NaN/negative", () => {
  assert.strictEqual(resolveDurationDays({durationDays: 90}, 0), 90);
  assert.strictEqual(resolveDurationDays({durationDays: 90}, NaN), 90);
  assert.strictEqual(resolveDurationDays({durationDays: 90}, -5), 90);
  assert.strictEqual(resolveDurationDays(null, 0), 30);
  assert.strictEqual(resolveDurationDays(undefined, undefined), 30);
});

test("resolveDurationDays allows an explicit lifetime (0) only when opted in", () => {
  assert.strictEqual(resolveDurationDays({durationDays: 30}, 0, {allowLifetime: true}), 0);
  // A non-zero request is unaffected by the flag.
  assert.strictEqual(resolveDurationDays({durationDays: 30}, 45, {allowLifetime: true}), 45);
});

test("computeExpiry adds days without mutating the base date", () => {
  const base = new Date("2026-01-01T00:00:00.000Z");
  const exp = computeExpiry(base, 30);
  assert.strictEqual(exp.toISOString(), "2026-01-31T00:00:00.000Z");
  // base untouched
  assert.strictEqual(base.toISOString(), "2026-01-01T00:00:00.000Z");
});

test("computeExpiry returns null for a lifetime grant", () => {
  assert.strictEqual(computeExpiry(new Date(), 0), null);
});

test("buildActivationFields (confirm) carries the full premium shape", () => {
  const expiry = new Date("2026-02-01T00:00:00.000Z");
  const f = buildActivationFields({
    planId: "monthly",
    expiry,
    adminId: "admin-1",
    provider: "manual_override",
    paymentId: "pay-9",
  });
  assert.strictEqual(f.plan, "premium");
  assert.strictEqual(f.premium, true);
  assert.strictEqual(f.isPremium, true);
  assert.strictEqual(f.paymentStatus, "active");
  assert.strictEqual(f.subscriptionStatus, "active");
  assert.strictEqual(f.subscriptionPlan, "monthly");
  assert.strictEqual(f.subscriptionExpiry, expiry);
  assert.strictEqual(f.subscriptionActivatedBy, "admin-1");
  assert.strictEqual(f.subscriptionProvider, "manual_override");
  assert.strictEqual(f.subscriptionPaymentId, "pay-9");
  // A learner plan carries no teacher tier and no lifetime marker.
  assert.ok(!("teacherPlan" in f));
  assert.ok(!("subscriptionLifetime" in f));
});

test("buildActivationFields sets teacher tier for a pro/max plan", () => {
  const expiry = new Date("2026-02-01T00:00:00.000Z");
  const f = buildActivationFields({
    planId: "pro_monthly",
    expiry,
    adminId: "admin-1",
    provider: "manual_grant",
  });
  assert.strictEqual(f.teacherPlan, "pro");
  assert.strictEqual(f.teacherPlanExpiresAt, expiry);
  // No payment id supplied → field omitted, not written as null.
  assert.ok(!("subscriptionPaymentId" in f));
});

test("buildActivationFields marks a lifetime grant with a null expiry", () => {
  const f = buildActivationFields({
    planId: "monthly",
    expiry: null,
    adminId: "admin-1",
    provider: "manual_grant",
    lifetime: true,
  });
  assert.strictEqual(f.subscriptionLifetime, true);
  assert.strictEqual(f.subscriptionExpiry, null);
});

test("buildRevokeFields returns the free-tier reset shape", () => {
  const f = buildRevokeFields();
  assert.strictEqual(f.plan, "free");
  assert.strictEqual(f.premium, false);
  assert.strictEqual(f.isPremium, false);
  assert.strictEqual(f.paymentStatus, "inactive");
  assert.strictEqual(f.subscriptionStatus, "inactive");
  assert.strictEqual(f.subscriptionPlan, "free");
  assert.strictEqual(f.subscriptionExpiry, null);
  assert.strictEqual(f.subscriptionProvider, null);
  assert.strictEqual(f.subscriptionPaymentId, null);
});

console.log(`\n${passed} passed`);
