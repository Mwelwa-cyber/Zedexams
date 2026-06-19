/**
 * Till — revenue-ops reconciliation agent (read → reconcile, Tier-A safe).
 *
 * Closes the webhook-drop gap in the Lenco payment flow. A buyer can pay
 * via mobile money, but if the `lencoWebhook` delivery fails (5xx, network)
 * AND the client-side status poll window closes before the money lands,
 * the `payments/{id}` doc stays "pending" forever — the buyer paid but
 * never got access, and nobody is told. There is currently no server-side
 * sweep that catches this (see getLencoPaymentStatus in index.js: the
 * authoritative Lenco status is only ever queried by the *client* poll).
 *
 * This sweep re-queries Lenco for stale pending payments and finishes what
 * the webhook should have done:
 *   • Lenco says "successful" → activate (idempotent) → buyer gets access.
 *   • Lenco says "failed"     → mark failed (never downgrades a success).
 *   • anything else (pending / otp-required / pay-offline) → leave it.
 *
 * Safety: every write goes through the SAME idempotent functions the
 * webhook and poll use — `activateSubscriptionFromPayment` guards on the
 * payment doc's own status inside a transaction, and `markPaymentFailed`
 * refuses to downgrade a success. So a reconcile sweep can never
 * double-grant or revoke a paid subscription, no matter how often it runs.
 *
 * Kept as a pure-ish runner with every effectful dependency injected
 * (db, getCollectionStatus, activate, markFailed) so it unit-tests under
 * the repo's `node` suite without Firebase or the network — same pattern
 * as monitor.js (runMonitorChecks) and lencoService.js.
 */

// Look back this far for stuck-pending payments. Beyond this, a still-
// pending doc is an abandoned checkout, not a dropped webhook — Echo's
// dunning/recovery flow (a later agent) owns those, not reconciliation.
const RECONCILE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

// Skip very fresh payments — the live client poll owns the first few
// minutes of a checkout. Reconciling them would just race the poll.
const MIN_AGE_MS = 5 * 60 * 1000; // 5 minutes

// Bound Lenco lookups (and cost) per run. The window + this cap keep a
// run cheap even if a burst of pending docs accumulates.
const MAX_PER_RUN = 100;

function clampMessage(err) {
  return String((err && err.message) || err || "").slice(0, 200);
}

/** Best-effort epoch-ms from a Firestore Timestamp / Date / number / ISO string. */
function toMillis(value) {
  if (value == null) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date ? d.getTime() : null;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

/**
 * Reconcile stale "pending" Lenco payments against Lenco's authoritative
 * status. Returns a structured summary (no throws for per-payment errors —
 * one bad lookup never aborts the sweep).
 *
 * @param {Object} args
 * @param {FirebaseFirestore.Firestore} args.db
 * @param {string}   args.apiKey                 Lenco API token.
 * @param {Function} args.getCollectionStatus    ({apiKey, reference}) -> Lenco resp.
 * @param {Function} args.activate               activateSubscriptionFromPayment.
 * @param {Function} args.markFailed             markPaymentFailed.
 * @param {Object}   [args.emailSecrets]         { senderEmail, senderPassword }.
 * @param {number}   [args.now]                  Injectable clock (ms).
 * @param {number}   [args.windowMs]
 * @param {number}   [args.minAgeMs]
 * @param {number}   [args.maxPerRun]
 * @returns {Promise<Object>} summary
 */
async function reconcilePendingPayments({
  db,
  apiKey,
  getCollectionStatus,
  activate,
  markFailed,
  emailSecrets = {},
  now = Date.now(),
  windowMs = RECONCILE_WINDOW_MS,
  minAgeMs = MIN_AGE_MS,
  maxPerRun = MAX_PER_RUN,
}) {
  const summary = {
    checked: 0, // payments actually queried against Lenco
    recovered: [], // paid-but-stuck buyers this sweep activated
    failedClosed: [], // pending docs Lenco reports as failed, now closed
    stillPending: 0, // genuinely not resolved yet (otp/offline/pending)
    skippedTooNew: 0, // younger than minAgeMs — live poll owns these
    errors: [],
    skipped: null,
  };

  if (!apiKey) {
    summary.skipped = "no-lenco-api-key";
    return summary;
  }

  // Firestore accepts a native Date for timestamp-field comparisons (the
  // Admin SDK converts it to a Timestamp), so the runner needs no
  // firebase-admin dependency — keeping it pure and unit-testable.
  const since = new Date(now - windowMs);

  const docs = [];
  try {
    const snap = await db.collection("payments")
        .where("status", "==", "pending")
        .where("createdAt", ">=", since)
        .orderBy("createdAt", "asc")
        .limit(maxPerRun)
        .get();
    snap.forEach((doc) => docs.push({id: doc.id, data: doc.data() || {}}));
  } catch (err) {
    summary.errors.push({stage: "query", message: clampMessage(err)});
    return summary;
  }

  for (const {id, data} of docs) {
    // Live poll owns the first few minutes of a checkout — don't race it.
    const createdMs = toMillis(data.createdAt);
    if (createdMs != null && (now - createdMs) < minAgeMs) {
      summary.skippedTooNew += 1;
      continue;
    }
    // Only Lenco-collected payments are reconcilable against Lenco. Manual
    // grants / overrides are already terminal by construction.
    if (data.provider && data.provider !== "lenco") continue;

    summary.checked += 1;

    let resp;
    try {
      resp = await getCollectionStatus({apiKey, reference: id});
    } catch (err) {
      // Transient lookup failure — leave the doc pending, surface the error,
      // and let the next sweep retry. Never mark failed on a lookup error.
      summary.errors.push({paymentId: id, stage: "lookup", message: clampMessage(err)});
      continue;
    }

    const status = String((resp && resp.data && resp.data.status) || "").toLowerCase();
    const reason = (resp && resp.data && resp.data.reasonForFailure) || "";

    try {
      if (status === "successful") {
        const r = await activate({paymentId: id, lencoStatus: status, emailSecrets});
        // activate() is idempotent — only a real flip counts as a recovery.
        if (r && r.activated) {
          summary.recovered.push({
            paymentId: id,
            userId: data.userId || null,
            amountZMW: data.amountZMW != null ? data.amountZMW : null,
            planId: data.planId || null,
          });
        }
      } else if (status === "failed") {
        await markFailed({paymentId: id, lencoStatus: status, reason});
        summary.failedClosed.push({paymentId: id});
      } else {
        // pending | otp-required | pay-offline | unknown — not our job.
        summary.stillPending += 1;
      }
    } catch (err) {
      summary.errors.push({paymentId: id, stage: "apply", message: clampMessage(err)});
    }
  }

  return summary;
}

module.exports = {
  reconcilePendingPayments,
  toMillis,
  RECONCILE_WINDOW_MS,
  MIN_AGE_MS,
  MAX_PER_RUN,
};
