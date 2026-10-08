"use strict";

/**
 * linkPaymentCore — the pure decisions behind paying from the guardian pay
 * link with NO login.
 *
 * A guardian who opens `/guardian-unlock?t=…` types their own mobile-money
 * number and approves the prompt on their phone. They have no ZedExams
 * account, so nothing here can ask "who are you"; the only credential is the
 * 32-byte one-time token, whose sha256 is the `guardianRequests` document id
 * (the raw token is never stored). Possession of that token is the same trust
 * boundary `resolveGuardianPayLink` and `guardianBillingAuth` rule 4 already
 * rely on.
 *
 * ── What the payment IS ────────────────────────────────────────────────
 *
 * It is the CHILD's own payment, made with a parent's phone number: the
 * `payments` document is owned by the child (`userId`), credited to the child,
 * and charged at the plan the child's request quoted. It is the same thing the
 * web checkout now lets a learner do by typing a parent's number, reached from
 * the other side. That choice is what lets it reuse the one money path rather
 * than fork a second one, and it is why a confirmed charge also records the
 * guardian's approval (guardianConsent/paymentConsent).
 *
 * Everything the client can influence is therefore: the phone number, the
 * network, and (for follow-ups) which payment of THIS request it is asking
 * about. The plan, the amount and the account are all read from the stored
 * request.
 */

const crypto = require("node:crypto");

const MAX_TOKEN_CHARS = 200;

/** sha256 of the raw token, which is the request document id. */
function hashToken(raw) {
  const token = typeof raw === "string" ? raw.trim() : "";
  if (!token || token.length > MAX_TOKEN_CHARS) return null;
  return crypto.createHash("sha256").update(token).digest("hex");
}

function toMillis(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value.toMillis === "function") {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * May this stored request be used for the given purpose?
 *
 * @param {object} args
 * @param {object|null} args.record     the guardianRequests document
 * @param {"start"|"follow"} args.purpose
 *   `start` begins a payment: the request must still be outstanding and
 *   unexpired. `follow` reads or completes a payment ALREADY begun (status
 *   poll, OTP): it must keep working after the request flips to `paid`, or the
 *   parent's own success screen could never be told, and a link that expires
 *   mid-prompt must not strand a charge the parent has already approved.
 * @param {Date} [args.now]
 */
function decideLinkUse({record, purpose, now = new Date()} = {}) {
  if (!record || typeof record !== "object") {
    return {ok: false, code: "not-found", reason: "unknown", message: "We could not find that link."};
  }
  if (typeof record.uid !== "string" || !record.uid) {
    return {ok: false, code: "not-found", reason: "unknown", message: "We could not find that link."};
  }
  if (purpose === "follow") {
    if (record.status === "sent" || record.status === "paid") return {ok: true};
    return {ok: false, code: "failed-precondition", reason: "withdrawn", message: "This request is no longer open."};
  }
  if (record.status === "paid") {
    return {ok: false, code: "failed-precondition", reason: "already-paid", message: "This has already been paid for."};
  }
  if (record.status !== "sent") {
    return {ok: false, code: "failed-precondition", reason: "withdrawn", message: "This request is no longer open."};
  }
  const expiresAt = toMillis(record.expiresAt);
  if (expiresAt != null && expiresAt <= now.getTime()) {
    return {ok: false, code: "failed-precondition", reason: "expired", message: "This link has expired. Ask your child to send a new one."};
  }
  if (typeof record.planId !== "string" || !record.planId) {
    return {ok: false, code: "failed-precondition", reason: "no-plan", message: "This request has no plan attached."};
  }
  return {ok: true};
}

/**
 * Is this payment one the token may follow?
 *
 * Both halves must hold: the payment belongs to the child the request names,
 * AND it was started from THIS request. The first alone would let a token
 * holder poll or complete any other payment the child has ever made.
 */
function paymentBelongsToRequest({payment, childUid, requestId} = {}) {
  if (!payment || typeof payment !== "object") return false;
  return payment.userId === childUid && payment.guardianRequestId === requestId;
}

/**
 * A callable request carrying the child's uid and no email, so
 * `assertVerifiedAuth` runs its suspension / deletion check and nothing else.
 * Built ONLY after the token has been verified against a stored request.
 */
function syntheticChildRequest({childUid, data, rawRequest} = {}) {
  return {auth: {uid: childUid, token: {}}, data: data || {}, rawRequest};
}

/** The fields a guardian-link client may be shown from a payment result. */
function publicPaymentResult(res) {
  const r = res && typeof res === "object" ? res : {};
  return {
    paymentId: r.paymentId || null,
    status: r.status || "pending",
    requiresOtp: r.requiresOtp === true,
    amountZMW: Number.isFinite(Number(r.amountZMW)) ? Number(r.amountZMW) : null,
    message: typeof r.message === "string" ? r.message : null,
    alreadyPaid: r.alreadyPaid === true,
  };
}

module.exports = {
  MAX_TOKEN_CHARS,
  decideLinkUse,
  hashToken,
  paymentBelongsToRequest,
  publicPaymentResult,
  syntheticChildRequest,
};
