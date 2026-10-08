"use strict";

/**
 * paymentConsentCore — when a confirmed payment counts as a guardian's
 * approval of a learner's account.
 *
 * The product decision (2026-10): a learner under 18 pays with a PARENT's
 * mobile-money number, and the parent approving that prompt on their own phone
 * is treated as the guardian's approval of the account. Nobody has to open an
 * emailed link first — which is the point, because a parent who cannot work the
 * link is the parent this was built for.
 *
 * Pure: no firebase-admin, no clock, so the rules test under plain `node`.
 *
 * ── What it can and cannot do ───────────────────────────────────────────
 *
 * It only ever moves an account TOWARDS granted. It never overrides a
 * `denied` decision — a guardian who said "this wasn't me" outranks a payment,
 * because the alternative is a child's own pocket money reinstating an account
 * their parent shut — and it never touches a suspension, which an administrator
 * may have set for reasons that have nothing to do with consent.
 *
 * It is evidence that SOMEBODY with access to that mobile-money account
 * approved a charge. It cannot prove that somebody is the child's parent: a
 * child who enters a friend's or sibling's number produces the same record.
 * That residual is a stated consequence of the decision, not an oversight, and
 * is why the evidence kept is the payment id and the last four digits — enough
 * to reconstruct the transaction, not a second copy of the number.
 */

/**
 * Should this confirmed payment record guardian consent on this account?
 *
 * @param {object|null} user  the credited users/{uid} document
 * @return {{apply: boolean, reason: string}}  `reason` is for logs and tests.
 */
function decidePaymentConsent(user) {
  if (!user || typeof user !== "object") return {apply: false, reason: "no-profile"};

  // An allow-list on the learner role, like guardianConsentCore: a missing or
  // misspelled role must not be waved through as a child needing approval.
  if (user.role !== "learner") return {apply: false, reason: "not-a-learner"};

  // Only an explicit `false` makes a learner an adult — the same rule
  // `resolveLearnerAccess` applies. An absent flag is a child.
  if (user.isMinor === false) return {apply: false, reason: "adult-learner"};

  // Suspension is somebody else's decision (a guardian's decline, or an
  // administrator's). A payment lifts neither.
  if (user.suspended === true) return {apply: false, reason: "suspended"};

  const guardian = user.guardian && typeof user.guardian === "object" ? user.guardian : null;
  const raw = guardian ? guardian.consentStatus : undefined;
  if (raw === undefined || raw === null) return {apply: true, reason: "no-record"};

  // Trimmed like `normalizeStatus` in guardianConsentCore, so " granted" and
  // "granted" are the same answer here as they are at the gate.
  const status = typeof raw === "string" ? raw.trim() : "";
  if (status === "granted") return {apply: false, reason: "already-granted"};
  if (status === "denied") return {apply: false, reason: "guardian-denied"};

  // Pending, expired, unknown — and anything unrecognised, which the gate also
  // reads as pending. Nothing else is left to refuse.
  return {apply: true, reason: `was-${status || "unrecognised"}`};
}

/** Last four digits of a phone number; "" when there are not four. */
function lastFour(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}

/**
 * The audit evidence for a payment-backed approval — enough to find the
 * transaction again, and no more of the number than that.
 */
function paymentEvidence({paymentId, phoneNumber, operator} = {}) {
  return {
    via: "payment",
    paymentId: typeof paymentId === "string" ? paymentId : "",
    payerPhoneLast4: lastFour(phoneNumber),
    operator: typeof operator === "string" ? operator.toLowerCase().slice(0, 12) : "",
  };
}

module.exports = {
  decidePaymentConsent,
  paymentEvidence,
  lastFour,
};
