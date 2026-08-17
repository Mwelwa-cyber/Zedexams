/**
 * functions/paymentInitiationCore.js
 *
 * Pure decision helpers for initiateLencoPayment — duplicate-initiation
 * protection and the displayed-vs-charged amount check. Dependency-light on
 * purpose (requires ./lencoService only for phone normalisation, which is
 * itself dependency-free) so the repo-root node test suite can exercise the
 * payment-safety rules without firebase-admin.
 *
 * Why this exists: initiation used to unconditionally create a new pending
 * payments doc per call, so a double-tap on Pay (or two tabs, or a retry
 * after a lost response) could push a second mobile-money prompt — two
 * approvals meant two charges. Activation was always idempotent per
 * reference; THIS layer makes the reference itself stable for repeated
 * attempts at the same purchase.
 *
 * The atomicity comes from the caller (functions/index.js): a Firestore
 * transaction reads the per-user lock doc `paymentLocks/{uid}` (which points
 * at the latest payment attempt) plus that payment doc, feeds them through
 * decideLockedInitiation below, and either returns the existing attempt or
 * creates the new payment doc AND updates the lock in the same transaction.
 * Two concurrent requests — two tabs, two devices, a repeated function
 * invocation — serialize on the lock doc: exactly one creates, the other
 * reuses the same reference. Lenco therefore never receives two initiation
 * requests for one purchase attempt.
 */

const {normalizePhone} = require("./lencoService");

// A payment attempt younger than this is treated as the SAME purchase
// attempt and reused instead of creating a second charge. Mobile-money
// prompts expire well within this window; after it, a fresh attempt is
// legitimate (the old doc stays pending until the webhook/Till settles it).
const REUSE_WINDOW_MS = 3 * 60 * 1000;

// Lenco statuses under which a pending collection can still complete. A
// missing lencoStatus means the winning request is still mid-initiation
// (doc created in the lock transaction, Lenco call in flight) — the
// concurrent loser must reuse it and poll, NOT start a second collection.
const REUSABLE_LENCO_STATUSES = new Set(["pending", "otp-required"]);

function toMillis(value) {
  if (!value) return null;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Decide what a new initiation request should do, given the payment doc the
 * per-user lock currently points at (read inside the same transaction).
 *
 * @param {object} args
 * @param {{id: string, data: object}|null} args.existing
 *   The payment doc referenced by paymentLocks/{uid}, or null when the lock
 *   is absent or dangling (doc deleted / never written — e.g. a delayed
 *   write from a crashed invocation).
 * @param {string} args.planId  plan requested NOW
 * @param {string} args.phone   raw phone requested NOW (normalised here)
 * @param {string|null} [args.beneficiaryUid]
 *   The account the purchase CREDITS, when that is not the payer — a
 *   guardian buying for a child. Absent/null on every ordinary payment.
 * @param {number} [args.nowMs]
 * @param {number} [args.reuseWindowMs]
 * @returns {{action: 'create'} |
 *           {action: 'reuse-pending', payment: {id, data}} |
 *           {action: 'reuse-paid',    payment: {id, data}}}
 */
function decideLockedInitiation({
  existing, planId, phone, beneficiaryUid = null,
  nowMs = Date.now(), reuseWindowMs = REUSE_WINDOW_MS,
} = {}) {
  const CREATE = {action: "create"};
  const normalized = normalizePhone(phone);
  if (!normalized || !existing?.data) return CREATE;
  const d = existing.data;

  // A different plan or a different destination phone is a NEW purchase,
  // not a duplicate of the locked attempt.
  if (d.planId !== planId) return CREATE;
  if (normalizePhone(d.phoneNumber) !== normalized) return CREATE;

  // …and so is a different BENEFICIARY. The lock is keyed by payer, so
  // without this a guardian buying the same plan for a second child from
  // the same phone inside the reuse window gets the FIRST child's payment
  // handed back: they are told it worked, they are not charged again, and
  // the second child is never credited. Plan and phone are identical in
  // exactly that case, which is the one this whole comparison exists to
  // tell apart. `|| null` so a doc predating the field compares equal to
  // an ordinary payment rather than to every guardian one.
  if ((d.beneficiaryUid || null) !== (beneficiaryUid || null)) return CREATE;

  // Stale attempt → the prompt has long expired; a fresh attempt is fine.
  // (Guard against clock skew: a createdAt more than a minute in the future
  // is treated as invalid.)
  const created = toMillis(d.createdAt);
  if (created == null || nowMs - created > reuseWindowMs || nowMs < created - 60 * 1000) return CREATE;

  // The FIRST attempt already completed (webhook landed before the retry's
  // poll, or the response was lost) → already paid, never charge twice.
  if (d.status === "successful") return {action: "reuse-paid", payment: existing};

  // Still awaiting the customer (including mid-initiation, before Lenco has
  // confirmed the collection) → resume the same reference.
  if (d.status === "pending" && REUSABLE_LENCO_STATUSES.has(String(d.lencoStatus || "pending"))) {
    return {action: "reuse-pending", payment: existing};
  }

  // Failed / declined / anything else → a retry is a legitimate new attempt.
  return CREATE;
}

/**
 * True when the client showed a price that no longer matches what the server
 * would charge — the caller must refuse to initiate and tell the client to
 * refresh its quote. A missing/invalid expected amount skips the check
 * (older clients that don't send one keep working; the server amount is
 * charged regardless — this check only protects the DISPLAY promise).
 */
function quoteMismatch(expectedAmountZMW, actualAmountZMW) {
  const expected = Number(expectedAmountZMW);
  if (!Number.isFinite(expected) || expectedAmountZMW == null || expectedAmountZMW === "") return false;
  return Math.round(expected) !== Math.round(Number(actualAmountZMW));
}

module.exports = {
  REUSE_WINDOW_MS,
  decideLockedInitiation,
  quoteMismatch,
};
