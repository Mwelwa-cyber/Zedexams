/**
 * functions/aiOperationsCore.js
 *
 * Pure decision logic for the shared AI-operation idempotency service — no
 * firebase-functions / firebase-admin imports so it runs under plain
 * `node functions/aiOperationsCore.test.js` (same *Core.js split as
 * googlePlayBillingCore.js / metaWhatsAppCore.js). The effectful half
 * (the aiOperations/{idempotencyKey} transaction) lives in aiOperations.js.
 *
 * This is the chokepoint every AI-mutating Cloud Function is meant to route
 * through so that one logical request (one client-generated idempotency key)
 * produces exactly one provider call, one result write and one usage charge —
 * see AI_DEVELOPMENT_GUIDE.md §2 "Payments and activation are idempotent"; AI
 * generation spend is the same class of risk as a payment.
 */

const crypto = require("node:crypto");

const OPERATION_STATUSES = [
  "reserved", "queued", "processing", "completed", "failed", "cancelled",
];

// Statuses that mean "already running somewhere" — a concurrent duplicate
// request must be told to wait, never restart the provider call.
const IN_FLIGHT_STATUSES = new Set(["reserved", "queued", "processing"]);

const MAX_RETRIES = 3;
// Exponential backoff from the last failure: 2s, 4s, 8s, capped at 60s.
function retryBackoffMs(retryCount) {
  return Math.min(60_000, 2_000 * Math.pow(2, Math.max(0, Number(retryCount) || 0)));
}

const IDEMPOTENCY_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A client-generated idempotency key must be a UUID — reject anything else
 * up front rather than let a malformed/guessable key collide with another
 * user's operation doc. */
function isValidIdempotencyKey(key) {
  return typeof key === "string" && IDEMPOTENCY_KEY_RE.test(key.trim());
}

/**
 * Stable (key-sorted, undefined-stripped) JSON serialisation so the same
 * logical input always hashes to the same fingerprint regardless of key
 * insertion order.
 */
function stableStringify(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/**
 * Canonical fingerprint of everything that makes a request THIS logical
 * operation: userId, schoolId, operationType, target ids, curriculum
 * coordinates, generation settings and the normalised prompt/topic text (§8).
 * A caller reusing the same idempotencyKey with a different fingerprint is
 * asking for a DIFFERENT operation under the same key — that's rejected by
 * decideReservationOutcome below, never silently accepted.
 */
function computeInputFingerprint(fields) {
  return crypto.createHash("sha256").update(stableStringify(fields || {})).digest("hex");
}

function toMillis(value) {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  return null;
}

function computeNextRetryAt(existing) {
  const lastMs = toMillis(existing.updatedAt) ?? Date.now();
  return lastMs + retryBackoffMs(existing.retryCount);
}

/**
 * The pure heart of §6/§7/§8: given the existing aiOperations record (or
 * null if none exists) and the reservation the caller is asking for, decide
 * what should happen — WITHOUT touching Firestore. The transaction shim in
 * aiOperations.js turns each `action` into the matching tx.create/tx.update
 * (or throws the matching structured error).
 *
 * @param {Object} args
 * @param {Object|null} args.existing   Current aiOperations/{key} doc data, or null.
 * @param {string} args.uid             Authenticated caller uid (server-derived, never client-supplied).
 * @param {string} args.inputFingerprint
 * @param {number} args.now             Date.now() — injected so this stays pure/testable.
 * @returns {{action: string, reason?: string, nextRetryAt?: number}}
 */
function decideReservationOutcome({existing, uid, inputFingerprint, now}) {
  if (!existing) return {action: "create"};

  // Idempotency keys are per-user. A key that resolves to someone else's
  // operation is either a bug or an attempted cross-account read/replay —
  // fail closed rather than leak or resume another user's operation.
  if (existing.userId !== uid) return {action: "reject_cross_user"};

  // Same key, different logical request → the caller is misusing the key as
  // a request id rather than an idempotency token. Reject rather than either
  // silently resuming the wrong operation or overwriting it.
  if (existing.inputFingerprint !== inputFingerprint) {
    return {action: "reject_fingerprint_mismatch"};
  }

  if (existing.status === "completed") return {action: "return_completed"};
  if (IN_FLIGHT_STATUSES.has(existing.status)) return {action: "return_processing"};
  if (existing.status === "cancelled") return {action: "return_cancelled"};

  if (existing.status === "failed") {
    if (existing.retryable !== true) {
      return {action: "return_terminal_failure", reason: "not-retryable"};
    }
    const retryCount = Number(existing.retryCount || 0);
    if (retryCount >= MAX_RETRIES) {
      return {action: "return_terminal_failure", reason: "max-retries"};
    }
    const nextRetryAt = computeNextRetryAt(existing);
    if (now < nextRetryAt) return {action: "retry_wait", nextRetryAt};
    return {action: "retry"};
  }

  // Unknown/corrupt status — fail closed rather than guess.
  return {action: "return_terminal_failure", reason: "unknown-status"};
}

/**
 * Map an arbitrary thrown error (HttpsError from a downstream call, a raw
 * provider SDK error, a plain Error) to the structured AiOperationError
 * taxonomy so failAiOperation() always records a recognised code and a
 * correct retryable flag. Never echoes provider payloads/stack traces —
 * only a truncated message.
 */
function classifyProviderError(err) {
  const code = err && err.code;
  const rawMessage = String((err && err.message) || err || "Unknown error");
  const message = rawMessage.slice(0, 300);

  if (code === "unauthenticated") return {code: "UNAUTHENTICATED", message, retryable: false};
  if (code === "permission-denied") return {code: "PERMISSION_DENIED", message, retryable: false};
  if (code === "invalid-argument") return {code: "INVALID_INPUT", message, retryable: false};
  if (code === "failed-precondition" && /limit|quota|allowance|upgrade/i.test(rawMessage)) {
    return {code: "ALLOWANCE_EXCEEDED", message, retryable: false};
  }
  if (code === "already-exists") return {code: "ALREADY_PROCESSING", message, retryable: false};
  if (code === "deadline-exceeded" || /timeout|timed out/i.test(rawMessage)) {
    return {code: "PROVIDER_TIMEOUT", message, retryable: true};
  }
  if (/rate.?limit|overloaded|too many requests|\b429\b|\b503\b|\b529\b/i.test(rawMessage)) {
    return {code: "PROVIDER_ERROR", message, retryable: true};
  }
  if (code === "internal" || code === "unavailable") {
    return {code: "PROVIDER_ERROR", message, retryable: true};
  }
  return {code: "INTERNAL_ERROR", message, retryable: false};
}

module.exports = {
  OPERATION_STATUSES,
  IN_FLIGHT_STATUSES,
  MAX_RETRIES,
  retryBackoffMs,
  isValidIdempotencyKey,
  stableStringify,
  computeInputFingerprint,
  computeNextRetryAt,
  decideReservationOutcome,
  classifyProviderError,
  toMillis,
};
