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
 * payments doc per call, so a double-tap on Pay (or reopening the checkout
 * while a prompt was still live) pushed a second mobile-money prompt — two
 * approvals meant two charges. Activation was always idempotent per
 * reference; THIS layer makes the reference itself stable for a repeated
 * attempt at the same purchase.
 */

const {normalizePhone} = require("./lencoService");

// A pending collection younger than this is treated as the SAME purchase
// attempt and reused instead of creating a second charge. Mobile-money
// prompts expire well within this window; after it, a fresh attempt is
// legitimate (the old doc stays pending until Till/webhook settles it).
const REUSE_WINDOW_MS = 3 * 60 * 1000;

// Lenco statuses under which a pending collection can still complete — a
// reused reference must still be awaiting the customer, not settled/failed.
const REUSABLE_LENCO_STATUSES = new Set(["pending", "otp-required"]);

function toMillis(value) {
  if (!value) return null;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Pick the pending payment to reuse for a repeated initiation of the same
 * purchase, or null when a fresh collection should be started.
 *
 * @param {Array<{id: string, data: object}>} candidates
 *   Pending payment docs already narrowed by the caller's query
 *   (userId + status=='pending' + planId equality filters).
 * @param {object} args
 * @param {string} args.phone   raw phone from the request (normalised here)
 * @param {number} [args.nowMs]
 * @param {number} [args.reuseWindowMs]
 * @returns {{id: string, data: object}|null} newest matching candidate
 */
function findReusablePendingPayment(candidates, {phone, nowMs = Date.now(), reuseWindowMs = REUSE_WINDOW_MS} = {}) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  let best = null;
  let bestCreated = -1;
  for (const cand of candidates || []) {
    const d = cand?.data || {};
    if (d.status !== "pending") continue;
    // Only reuse a collection Lenco actually accepted — a doc that failed
    // before the collection call has no prompt to wait on.
    if (!d.lencoCollectionId) continue;
    if (!REUSABLE_LENCO_STATUSES.has(String(d.lencoStatus || "pending"))) continue;
    // Same destination phone only. A changed number means the teacher wants
    // the prompt somewhere else — that's a new attempt, not a duplicate.
    if (normalizePhone(d.phoneNumber) !== normalized) continue;
    const created = toMillis(d.createdAt);
    if (created == null || nowMs - created > reuseWindowMs || nowMs < created - 60 * 1000) continue;
    if (created > bestCreated) {
      best = cand;
      bestCreated = created;
    }
  }
  return best;
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
  findReusablePendingPayment,
  quoteMismatch,
};
