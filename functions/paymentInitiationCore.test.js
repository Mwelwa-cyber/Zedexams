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
  findReusableRecentPayment,
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

// ── findReusableRecentPayment ─────────────────────────────────────────────
ok("reuses a fresh pending collection for the same phone",
    findReusableRecentPayment([cand("a")], {phone: "0977740465", nowMs: NOW})?.id === "a");
ok("matches across phone formats (+260 vs national)",
    findReusableRecentPayment([cand("a")], {phone: "+260 977 740 465", nowMs: NOW})?.id === "a");
ok("double-tap: two candidates → newest wins",
    findReusableRecentPayment([
      cand("old", {createdAt: agoMs(120 * 1000)}),
      cand("new", {createdAt: agoMs(5 * 1000)}),
    ], {phone: "0977740465", nowMs: NOW})?.id === "new");

ok("different phone is a NEW attempt, not a duplicate",
    findReusableRecentPayment([cand("a")], {phone: "0966123456", nowMs: NOW}) === null);
ok("stale pending (outside the reuse window) is not reused",
    findReusableRecentPayment([cand("a", {createdAt: agoMs(REUSE_WINDOW_MS + 1000)})],
        {phone: "0977740465", nowMs: NOW}) === null);
ok("doc without a Lenco collection id is not reused (no prompt exists)",
    findReusableRecentPayment([cand("a", {lencoCollectionId: null})],
        {phone: "0977740465", nowMs: NOW}) === null);
ok("settled doc is not reused even if status field lagged",
    findReusableRecentPayment([cand("a", {lencoStatus: "failed"})],
        {phone: "0977740465", nowMs: NOW}) === null);
ok("failed doc is not reused",
    findReusableRecentPayment([cand("a", {status: "failed"})],
        {phone: "0977740465", nowMs: NOW}) === null);

// ── already-paid protection (lost response + retry must not double-charge) ─
ok("fresh SUCCESSFUL payment for the same purchase is returned (already paid)",
    findReusableRecentPayment([cand("a", {status: "successful", lencoStatus: "successful"})],
        {phone: "0977740465", nowMs: NOW})?.id === "a");
ok("fresh successful payment reused even without a collection id",
    findReusableRecentPayment([cand("a", {status: "successful", lencoCollectionId: null})],
        {phone: "0977740465", nowMs: NOW})?.id === "a");
ok("stale successful payment (outside window) → new purchase is legitimate",
    findReusableRecentPayment([cand("a", {status: "successful", createdAt: agoMs(REUSE_WINDOW_MS + 1000)})],
        {phone: "0977740465", nowMs: NOW}) === null);
ok("a completed attempt outranks a newer still-pending one",
    findReusableRecentPayment([
      cand("done", {status: "successful", createdAt: agoMs(90 * 1000)}),
      cand("waiting", {createdAt: agoMs(5 * 1000)}),
    ], {phone: "0977740465", nowMs: NOW})?.id === "done");
ok("otp-required collection IS reusable (still awaiting the customer)",
    findReusableRecentPayment([cand("a", {lencoStatus: "otp-required"})],
        {phone: "0977740465", nowMs: NOW})?.id === "a");
ok("invalid requester phone → no reuse",
    findReusableRecentPayment([cand("a")], {phone: "abc", nowMs: NOW}) === null);
ok("empty candidate list → null",
    findReusableRecentPayment([], {phone: "0977740465", nowMs: NOW}) === null);
ok("Timestamp-like createdAt supported",
    findReusableRecentPayment([cand("a", {createdAt: {toMillis: () => NOW - 10_000}})],
        {phone: "0977740465", nowMs: NOW})?.id === "a");

// ── quoteMismatch ──────────────────────────────────────────────────────────
ok("matching amount → no mismatch", quoteMismatch(57, 57) === false);
ok("drifted amount → mismatch", quoteMismatch(57, 60) === true);
ok("string expected amount is coerced", quoteMismatch("57", 57) === false);
ok("no expected amount → check skipped (legacy clients)",
    quoteMismatch(undefined, 57) === false && quoteMismatch(null, 57) === false && quoteMismatch("", 57) === false);
ok("garbage expected amount → check skipped", quoteMismatch("abc", 57) === false);

// ── quote drift end-to-end (quoteUpgradeForUser × quoteMismatch) ───────────
// These pin the review's boundary cases: a quote displayed before midnight
// and paid after it recomputes to fewer prorated days, and the mismatch
// check must catch it (server rejects with 'quote-changed', charges nothing).
{
  const {quoteUpgradeForUser} = require("./subscriptionUpgrade");
  const user = {subscriptionPlan: "pro_monthly", teacherPlanExpiresAt: "2026-07-20T00:00:00Z"};
  const beforeMidnight = quoteUpgradeForUser(user, "max_monthly", new Date("2026-07-13T23:59:00Z"));
  const afterMidnight = quoteUpgradeForUser(user, "max_monthly", new Date("2026-07-14T00:01:00Z"));
  ok("day boundary changes the prorated days-remaining",
      beforeMidnight.daysRemaining === afterMidnight.daysRemaining + 1);
  ok("quote shown before midnight, paid after → mismatch caught",
      quoteMismatch(beforeMidnight.amountZMW, afterMidnight.amountZMW) === true);
  // Renewal-day boundary: quote displayed while Pro was live, paid after it
  // lapsed → the charge becomes full price and the stale prorated display
  // must be refused.
  const lapsed = quoteUpgradeForUser(user, "max_monthly", new Date("2026-07-21T00:01:00Z"));
  ok("paid after the sub lapsed → full price, not prorated", lapsed.isUpgrade === false);
  ok("stale prorated display vs full price → mismatch caught",
      quoteMismatch(beforeMidnight.amountZMW, 149) === true);
  // Already-upgraded teacher: quoted as Pro, but the account is on Max by
  // pay time (other tab / other device already upgraded).
  const alreadyMax = quoteUpgradeForUser({teacherPlan: "max"}, "max_monthly", new Date("2026-07-13T12:00:00Z"));
  ok("already-on-Max recomputes as not-an-upgrade", alreadyMax.isUpgrade === false);
  ok("stale Pro-era quote vs Max account → mismatch caught",
      quoteMismatch(beforeMidnight.amountZMW, alreadyMax.isUpgrade ? alreadyMax.amountZMW : 149) === true);
}

console.log(`\n✓ paymentInitiationCore: ${passed} assertions passed`);
