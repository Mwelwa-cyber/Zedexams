/**
 * functions/aiOperations.js
 *
 * The shared server-side idempotency service every AI-mutating Cloud
 * Function is meant to route through (see AI_DEVELOPMENT_GUIDE.md §2, and
 * the request-locking/idempotency initiative this shipped under). Backs the
 * durable `aiOperations/{idempotencyKey}` record: atomic reservation via a
 * transaction (§6), duplicate-request resume behaviour (§7), input-
 * fingerprint conflict rejection (§8), and status tracking for client
 * refresh/resume (§13).
 *
 * Pure decision logic lives in aiOperationsCore.js (same *Core.js split as
 * subscriptionActivation.js's transaction / referralRedemption.js) so the
 * reservation state machine is unit-testable without Firestore; this file
 * is the thin Firestore-I/O shim around it.
 *
 * `reserveAiOperation` uses `tx.create()` (not `tx.set()`) for the brand-new
 * case specifically because `create()` throws ALREADY_EXISTS if another
 * concurrent transaction won the race to create the same doc first — that's
 * what makes "two simultaneous requests with the same key must not both call
 * the AI provider" (§6) hold under real concurrency, not just under a single
 * request. The ALREADY_EXISTS race loser simply retries the transaction (one
 * more read), which is exactly how Firestore transactions are meant to be
 * used.
 */

const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");
const {
  isValidIdempotencyKey,
  computeInputFingerprint,
  decideReservationOutcome,
  classifyProviderError,
} = require("./aiOperationsCore");

const COLLECTION = "aiOperations";

function opRef(idempotencyKey) {
  return admin.firestore().collection(COLLECTION).doc(idempotencyKey);
}

// Fields a caller is never allowed to control the value of — always
// server-derived. Guards against a client trying to smuggle a different
// userId/status into the reservation payload.
function sanitizeFingerprintInput(fingerprintInput) {
  const clean = {...(fingerprintInput || {})};
  delete clean.userId;
  delete clean.uid;
  delete clean.status;
  return clean;
}

/**
 * Reserve (or resume) an AI operation. Call this BEFORE calling the AI
 * provider. Returns one of:
 *   - {status:'created',   operation}  → brand new, caller must run the provider call.
 *   - {status:'retrying',  operation}  → a retryable failure is being retried, caller must run the provider call.
 *   - {status:'completed', operation}  → already done, caller must NOT call the provider; return operation.resultDocumentId.
 *   - {status:'processing',operation}  → already in flight (this tab, another tab, or a retry), caller must NOT call the provider.
 *   - {status:'cancelled', operation}  → user cancelled a still-queued run.
 *   - {status:'failed',    operation}  → terminal, non-retryable failure; caller must NOT call the provider.
 *
 * Throws HttpsError('permission-denied', ...) on cross-user key reuse, and
 * HttpsError('failed-precondition', 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_INPUT', ...)
 * when the same key is replayed with different logical input (§8).
 *
 * @param {Object} args
 * @param {string} args.uid              Authenticated caller (never trust a client-supplied userId).
 * @param {string} args.idempotencyKey   Client-generated UUID; same value across retries of one logical action.
 * @param {string} args.operationType    e.g. "generate_assessment", "regenerate_section".
 * @param {string|null} [args.schoolId]
 * @param {string|null} [args.targetDocumentId]
 * @param {string|null} [args.targetSectionId]
 * @param {Object} [args.fingerprintInput] Canonical operation-defining fields (curriculumId, gradeId, subjectId, settings, normalisedPrompt, …). userId/status are stripped even if present.
 * @param {number} [args.usageReserved]
 */
async function reserveAiOperation({
  uid,
  idempotencyKey,
  operationType,
  schoolId = null,
  targetDocumentId = null,
  targetSectionId = null,
  fingerprintInput = {},
  usageReserved = 0,
}) {
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
  if (!operationType) {
    throw new HttpsError("invalid-argument", "operationType is required.");
  }
  if (!isValidIdempotencyKey(idempotencyKey)) {
    throw new HttpsError("invalid-argument", "A valid idempotencyKey (UUID) is required.");
  }

  const inputFingerprint = computeInputFingerprint({
    operationType,
    schoolId,
    targetDocumentId,
    targetSectionId,
    ...sanitizeFingerprintInput(fingerprintInput),
  });

  const ref = opRef(idempotencyKey);
  const db = admin.firestore();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? snap.data() : null;
    const decision = decideReservationOutcome({
      existing, uid, inputFingerprint, now: Date.now(),
    });

    switch (decision.action) {
      case "reject_cross_user":
        // Deliberately vague — do not confirm/deny whether the key exists
        // for another account.
        throw new HttpsError("permission-denied", "This operation does not belong to you.");

      case "reject_fingerprint_mismatch":
        throw new HttpsError(
            "failed-precondition",
            "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_INPUT",
            {code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_INPUT"},
        );

      case "return_completed":
        return {status: "completed", operation: existing};

      case "return_processing":
        return {status: "processing", operation: existing};

      case "return_cancelled":
        return {status: "cancelled", operation: existing};

      case "return_terminal_failure":
        return {status: "failed", operation: existing};

      case "retry_wait":
        // Retryable, but backoff hasn't elapsed — treat like "processing"
        // from the caller's point of view (don't call the provider yet).
        return {status: "processing", operation: existing, nextRetryAt: decision.nextRetryAt};

      case "retry": {
        const updates = {
          status: "processing",
          retryCount: admin.firestore.FieldValue.increment(1),
          errorCode: null,
          startedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        tx.update(ref, updates);
        return {
          status: "retrying",
          operation: {...existing, ...updates, retryCount: Number(existing.retryCount || 0) + 1},
        };
      }

      case "create": {
        const record = {
          idempotencyKey,
          userId: uid,
          schoolId,
          operationType,
          targetDocumentId,
          targetSectionId,
          inputFingerprint,
          status: "processing",
          resultDocumentId: null,
          providerRequestId: null,
          usageReserved,
          usageCharged: 0,
          retryCount: 0,
          retryable: null,
          errorCode: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          startedAt: admin.firestore.FieldValue.serverTimestamp(),
          completedAt: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        tx.create(ref, record);
        return {status: "created", operation: record};
      }

      default:
        throw new HttpsError("internal", "Unexpected reservation outcome.");
    }
  });
}

/** Mark a reserved operation as completed. Idempotent to call twice with the
 * same values (a duplicate settle is a no-op in effect, not in write count —
 * callers should only call this once per successful provider call). */
async function completeAiOperation({
  idempotencyKey, resultDocumentId = null, usageCharged = 0, providerRequestId = null,
}) {
  await opRef(idempotencyKey).update({
    status: "completed",
    resultDocumentId,
    usageCharged,
    providerRequestId,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/** Mark a reserved operation as failed. `err` is classified via
 * classifyProviderError so only a structured code/retryable flag — never a
 * raw stack trace or provider payload — lands in the durable record. */
async function failAiOperation({idempotencyKey, err, usageCharged = 0}) {
  const classified = classifyProviderError(err);
  await opRef(idempotencyKey).update({
    status: "failed",
    errorCode: classified.code,
    errorMessage: classified.message,
    retryable: classified.retryable,
    usageCharged,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return classified;
}

/** User-scoped cancellation intent. Only meaningfully stops anything for a
 * still-queued/reserved operation (§15) — an operation already `processing`
 * (the provider call is in flight) is flagged `cancelRequested` so
 * post-processing can skip saving the result, but the provider call itself
 * is never falsely reported as stopped. */
async function cancelAiOperation({uid, idempotencyKey}) {
  const ref = opRef(idempotencyKey);
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Operation not found.");
    const data = snap.data();
    if (data.userId !== uid) {
      throw new HttpsError("permission-denied", "This operation does not belong to you.");
    }
    if (data.status === "completed" || data.status === "failed" || data.status === "cancelled") {
      return {status: data.status, operation: data};
    }
    const updates = {
      cancelRequested: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    // A still-reserved/queued run (provider call not yet started) can be
    // fully cancelled; a `processing` run only gets the intent flag — we
    // never claim the in-flight provider call was actually stopped.
    if (data.status === "reserved" || data.status === "queued") {
      updates.status = "cancelled";
    }
    tx.update(ref, updates);
    return {status: updates.status || data.status, operation: {...data, ...updates}};
  });
}

/** User-scoped read for client resume-after-refresh (§13/§14). Returns null
 * (never another user's data) if the key doesn't exist or belongs to
 * someone else. */
async function getAiOperation({uid, idempotencyKey}) {
  if (!uid || !isValidIdempotencyKey(idempotencyKey)) return null;
  const snap = await opRef(idempotencyKey).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data.userId !== uid) return null;
  return data;
}

/**
 * The canonical way a generator enters the operation layer (Phase 6).
 *
 * ## Why this exists rather than each generator calling reserveAiOperation
 *
 * Every generator wired in #1861 wrote the same twenty lines by hand, and they
 * did not come out the same. Five of them guarded the reservation behind
 * `isValidIdempotencyKey`, so a request with no key skipped it entirely and ran
 * the old unprotected path — auto-id document, no reservation, nothing
 * recording that protection had been skipped. `generateAssessment` did not, so
 * a keyless request was refused. Two behaviours, one intent, and from outside
 * the two are indistinguishable: both reserve on the happy path, both pass
 * their tests.
 *
 * A shared entry point removes the opportunity. There is no keyless branch to
 * write, because there is no branch.
 *
 * ## What it guarantees, in order
 *
 * 1. A missing or malformed key is REFUSED — before usage charging, before the
 *    provider, before any result document exists. The refusal is the first
 *    thing that happens, so nothing has been spent when it fires.
 * 2. The reservation is atomic (see `reserveAiOperation`), so a second caller
 *    with the same key cannot also be told to proceed.
 * 3. Terminal outcomes that every caller handles identically — a non-retryable
 *    failure and a cancellation — are converted to HttpsErrors here rather
 *    than five times over.
 *
 * What it deliberately does NOT do is decide what "resume" looks like. A
 * completed operation returns to the caller as `{status:'completed'}` because
 * each generator's saved response has its own shape, and a generic resume would
 * have to guess at it.
 *
 * ## It is also the marker the inventory scanner keys on
 *
 * `scripts/aiGenerators/` cannot prove that a reservation happens BEFORE a
 * provider call — it reads markers, not order. One canonical call that cannot
 * be reached any other way makes the marker mean what the scan claims it means.
 * Behavioural callable tests remain the authority; this makes the completeness
 * net honest.
 *
 * @param {Object} args
 * @param {string} args.idempotencyKey  Client-generated UUID. Required.
 * @param {string} args.userId          Authenticated caller — derive it from
 *                                      the request context, never from the
 *                                      client payload.
 * @param {string} args.operationType   e.g. "generate_worksheet".
 * @param {Object} [args.inputFingerprint] Canonical operation-defining fields.
 * @returns {Promise<{status:'created'|'retrying'|'completed'|'processing', operation:Object}>}
 */
async function requireAndReserveAiOperation({
  idempotencyKey,
  userId,
  operationType,
  inputFingerprint = {},
  schoolId = null,
  targetDocumentId = null,
  targetSectionId = null,
}) {
  // First, and before anything is spent. `reserveAiOperation` validates the key
  // too, but it does so after its own uid/operationType checks — stating it
  // here makes the ordering a property of this function rather than an
  // accident of another one's argument validation.
  if (!isValidIdempotencyKey(idempotencyKey)) {
    throw new HttpsError(
        "invalid-argument",
        "This request is missing a valid idempotency key. Please refresh the " +
          "page and try again.",
        {code: "IDEMPOTENCY_KEY_REQUIRED", retryable: false},
    );
  }

  const reservation = await reserveAiOperation({
    uid: userId,
    idempotencyKey,
    operationType,
    fingerprintInput: inputFingerprint,
    schoolId,
    targetDocumentId,
    targetSectionId,
  });

  if (reservation.status === "failed") {
    throw new HttpsError(
        "failed-precondition",
        reservation.operation.errorMessage ||
          "This request already failed and cannot be retried automatically.",
        {
          code: reservation.operation.errorCode,
          retryable: false,
          operationId: idempotencyKey,
        },
    );
  }
  if (reservation.status === "cancelled") {
    throw new HttpsError("cancelled", "This request was cancelled.", {
      code: "OPERATION_CANCELLED",
      operationId: idempotencyKey,
    });
  }

  return reservation;
}

module.exports = {
  COLLECTION,
  reserveAiOperation,
  requireAndReserveAiOperation,
  completeAiOperation,
  failAiOperation,
  cancelAiOperation,
  getAiOperation,
};
