/**
 * Node test for the payment-initiation safety helpers
 * (functions/paymentInitiationCore.js). This is duplicate-charge protection,
 * so the reuse rules (same plan+phone+pending+fresh+accepted-by-Lenco) and
 * the displayed-vs-charged amount check all get pinned.
 *
 * Pure module (requires ./lencoService for phone normalisation only) —
 * plain `node` script, repo convention.
 *
 * Run: node functions/paymentInitiationCore.test.js
 */

const assert = require("node:assert");
const {
  REUSE_WINDOW_MS,
  findReusablePendingPayment,
  quoteMismatch,
} = require("./paymentInitiationCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const NOW = Date.parse("2026-07-13T12:00:00Z");
const agoMs = (ms) => new Date(NOW - ms).toISOString();

function cand(id, overrides = {}) {
  return {
    id,
    data: {
      status: "pending",
      lencoStatus: "pending",
      lencoCollectionId: "col_" + id,
      planId: "max_monthly",
      phoneNumber: "0977740465",
      createdAt: agoMs(30 * 1000),
      ...overrides,
    },
  };
}

console.log("paymentInitiationCore");

// ── findReusablePendingPayment ─────────────────────────────────────────────
ok("reuses a fresh pending collection for the same phone",
    findReusablePendingPayment([cand("a")], {phone: "0977740465", nowMs: NOW})?.id === "a");
ok("matches across phone formats (+260 vs national)",
    findReusablePendingPayment([cand("a")], {phone: "+260 977 740 465", nowMs: NOW})?.id === "a");
ok("double-tap: two candidates → newest wins",
    findReusablePendingPayment([
      cand("old", {createdAt: agoMs(120 * 1000)}),
      cand("new", {createdAt: agoMs(5 * 1000)}),
    ], {phone: "0977740465", nowMs: NOW})?.id === "new");

ok("different phone is a NEW attempt, not a duplicate",
    findReusablePendingPayment([cand("a")], {phone: "0966123456", nowMs: NOW}) === null);
ok("stale pending (outside the reuse window) is not reused",
    findReusablePendingPayment([cand("a", {createdAt: agoMs(REUSE_WINDOW_MS + 1000)})],
        {phone: "0977740465", nowMs: NOW}) === null);
ok("doc without a Lenco collection id is not reused (no prompt exists)",
    findReusablePendingPayment([cand("a", {lencoCollectionId: null})],
        {phone: "0977740465", nowMs: NOW}) === null);
ok("settled doc is not reused even if status field lagged",
    findReusablePendingPayment([cand("a", {lencoStatus: "failed"})],
        {phone: "0977740465", nowMs: NOW}) === null);
ok("non-pending doc is not reused",
    findReusablePendingPayment([cand("a", {status: "successful"})],
        {phone: "0977740465", nowMs: NOW}) === null);
ok("otp-required collection IS reusable (still awaiting the customer)",
    findReusablePendingPayment([cand("a", {lencoStatus: "otp-required"})],
        {phone: "0977740465", nowMs: NOW})?.id === "a");
ok("invalid requester phone → no reuse",
    findReusablePendingPayment([cand("a")], {phone: "abc", nowMs: NOW}) === null);
ok("empty candidate list → null",
    findReusablePendingPayment([], {phone: "0977740465", nowMs: NOW}) === null);
ok("Timestamp-like createdAt supported",
    findReusablePendingPayment([cand("a", {createdAt: {toMillis: () => NOW - 10_000}})],
        {phone: "0977740465", nowMs: NOW})?.id === "a");

// ── quoteMismatch ──────────────────────────────────────────────────────────
ok("matching amount → no mismatch", quoteMismatch(57, 57) === false);
ok("drifted amount → mismatch", quoteMismatch(57, 60) === true);
ok("string expected amount is coerced", quoteMismatch("57", 57) === false);
ok("no expected amount → check skipped (legacy clients)",
    quoteMismatch(undefined, 57) === false && quoteMismatch(null, 57) === false && quoteMismatch("", 57) === false);
ok("garbage expected amount → check skipped", quoteMismatch("abc", 57) === false);

console.log(`\n✓ paymentInitiationCore: ${passed} assertions passed`);
