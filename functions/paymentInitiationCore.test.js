/**
 * Node test for the payment-initiation safety helpers
 * (functions/paymentInitiationCore.js). This is duplicate-charge protection,
 * so the lock-decision rules (reuse the same reference for a repeated or
 * CONCURRENT attempt at the same purchase; already-paid short-circuit) and
 * the displayed-vs-charged amount check all get pinned — including the
 * Phase 7 concurrency scenarios (two tabs, repeated invocation, delayed
 * write, callback-before-poll).
 *
 * Pure module (requires ./lencoService for phone normalisation only) —
 * plain `node` script, repo convention.
 *
 * Run: node functions/paymentInitiationCore.test.js
 */

const assert = require("node:assert");
const {
  REUSE_WINDOW_MS,
  decideLockedInitiation,
  quoteMismatch,
  reuseInitiationMessage,
  statusLookupMessage,
} = require("./paymentInitiationCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const NOW = Date.parse("2026-07-14T12:00:00Z");
const agoMs = (ms) => new Date(NOW - ms).toISOString();

function existing(overrides = {}) {
  return {
    id: "pay1",
    data: {
      status: "pending",
      lencoStatus: "pending",
      lencoCollectionId: "col_1",
      planId: "max_monthly",
      phoneNumber: "0977740465",
      createdAt: agoMs(30 * 1000),
      ...overrides,
    },
  };
}

const decide = (ex, over = {}) =>
  decideLockedInitiation({existing: ex, planId: "max_monthly", phone: "0977740465", nowMs: NOW, ...over});

console.log("paymentInitiationCore");

// ── decideLockedInitiation: reuse rules ────────────────────────────────────
ok("double-tap / second tab: fresh pending attempt is resumed",
    decide(existing()).action === "reuse-pending");
ok("reused attempt keeps the SAME reference (one Lenco initiation)",
    decide(existing()).payment.id === "pay1");
ok("matches across phone formats (+260 vs national)",
    decide(existing(), {phone: "+260 977 740 465"}).action === "reuse-pending");
ok("CONCURRENT loser: doc created but Lenco call still in flight (no collection id) is STILL reused",
    decide(existing({lencoCollectionId: null, lencoStatus: undefined})).action === "reuse-pending");
ok("otp-required collection is reusable (still awaiting the customer)",
    decide(existing({lencoStatus: "otp-required"})).action === "reuse-pending");

// ── already-paid protection (callback lands before the retry) ─────────────
ok("fresh SUCCESSFUL attempt → already paid, never charge twice",
    decide(existing({status: "successful", lencoStatus: "successful"})).action === "reuse-paid");
ok("successful + concurrent retry returns the same paid reference",
    decide(existing({status: "successful"})).payment.id === "pay1");

// ── create (a genuinely new attempt) ───────────────────────────────────────
ok("different phone is a NEW attempt",
    decide(existing(), {phone: "0966123456"}).action === "create");
ok("different plan is a NEW attempt",
    decide(existing({planId: "pro_monthly"})).action === "create");

// ── a guardian paying for TWO children ─────────────────────────────────────
//
// The lock is keyed by PAYER, so a parent buying the same plan for a second
// child from the same phone inside the reuse window has identical plan and
// phone — which is exactly what this comparison exists to tell apart. Without
// the beneficiary in it, they are handed the FIRST child's payment: told it
// worked, not charged again, and the second child never credited.
ok("second child, same plan and phone, is a NEW attempt",
    decide(existing({beneficiaryUid: "kid-a"}), {beneficiaryUid: "kid-b"}).action === "create");
ok("the SAME child double-tapping is still one attempt",
    decide(existing({beneficiaryUid: "kid-a"}), {beneficiaryUid: "kid-a"}).action === "reuse-pending");
ok("a guardian attempt is never reused by a payment for the parent themselves",
    decide(existing({beneficiaryUid: "kid-a"})).action === "create");
ok("an ordinary attempt is never reused by a guardian payment",
    decide(existing(), {beneficiaryUid: "kid-a"}).action === "create");
// A doc written before the field existed must compare equal to an ordinary
// payment, not to every guardian one.
ok("a pre-field payment doc still reuses for an ordinary payment",
    decide(existing({beneficiaryUid: undefined})).action === "reuse-pending");
ok("stale attempt (outside the reuse window) → new attempt",
    decide(existing({createdAt: agoMs(REUSE_WINDOW_MS + 1000)})).action === "create");
ok("failed attempt → retry is a legitimate new attempt",
    decide(existing({status: "failed", lencoStatus: "failed"})).action === "create");
ok("pending doc whose collection already settled failed (status lag) → new attempt",
    decide(existing({lencoStatus: "failed"})).action === "create");
ok("delayed write: dangling lock (payment doc missing) → create",
    decide(null).action === "create");
ok("invalid requester phone → create (validation rejects upstream anyway)",
    decide(existing(), {phone: "abc"}).action === "create");
ok("future-dated createdAt (clock skew) → create",
    decide(existing({createdAt: new Date(NOW + 5 * 60 * 1000).toISOString()})).action === "create");
ok("Timestamp-like createdAt supported",
    decide(existing({createdAt: {toMillis: () => NOW - 10_000}})).action === "reuse-pending");

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

// ── reuseInitiationMessage ─────────────────────────────────────────────────
// A duplicate initiation (double-tap, second tab, reopened checkout) must
// never tell a pay-offline buyer to "approve the prompt" — nothing was
// pushed to approve.
ok("pay-offline reuse surfaces the real persisted instructions",
    reuseInitiationMessage("pay-offline", "Dial *115# and choose Pay Bill.") === "Dial *115# and choose Pay Bill.");
ok("pay-offline reuse with no persisted message → null, not a fabricated one",
    reuseInitiationMessage("pay-offline", null) === null);
ok("an ordinary pending reuse keeps the generic prompt-approval line",
    reuseInitiationMessage("pending", "Dial *115# and choose Pay Bill.")
      === "Your payment request is already in progress — approve the prompt on your phone.");
ok("otp-required reuse also keeps the generic line (a prompt path, not offline)",
    reuseInitiationMessage("otp-required", null)
      === "Your payment request is already in progress — approve the prompt on your phone.");

// ── statusLookupMessage ─────────────────────────────────────────────────────
// The regression this guards: `initiateLencoPayment` persists a message
// alongside EVERY status write, including a generic one for plain "pending".
// A later status lookup that transitions to pay-offline with no fresh
// message of its own must not resurface that unrelated earlier text as if
// it were pay-offline completion instructions.
ok("a fresh message always wins, whatever the persisted state",
    statusLookupMessage({
      freshMessage: "Dial *115# and choose Pay Bill.", currentStatus: "pay-offline",
      persistedStatus: "pending", persistedMessage: "Collection initiated.",
    }) === "Dial *115# and choose Pay Bill.");
ok("no fresh message, and the persisted status was NOT pay-offline → null (the regression)",
    statusLookupMessage({
      freshMessage: null, currentStatus: "pay-offline",
      persistedStatus: "pending", persistedMessage: "Collection initiated.",
    }) === null);
ok("no fresh message, but the persisted status WAS already pay-offline → reuse it",
    statusLookupMessage({
      freshMessage: null, currentStatus: "pay-offline",
      persistedStatus: "pay-offline", persistedMessage: "Dial *115# and choose Pay Bill.",
    }) === "Dial *115# and choose Pay Bill.");
ok("current status isn't pay-offline → null regardless of what's persisted",
    statusLookupMessage({
      freshMessage: null, currentStatus: "pending",
      persistedStatus: "pay-offline", persistedMessage: "Dial *115# and choose Pay Bill.",
    }) === null);
ok("persisted pay-offline with no message on file → null, not a crash",
    statusLookupMessage({
      freshMessage: null, currentStatus: "pay-offline",
      persistedStatus: "pay-offline", persistedMessage: null,
    }) === null);

console.log(`\n✓ paymentInitiationCore: ${passed} assertions passed`);
