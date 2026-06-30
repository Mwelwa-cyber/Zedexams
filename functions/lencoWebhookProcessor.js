/**
 * Lenco webhook event dispatch.
 *
 * The `lencoWebhook` onRequest handler (functions/index.js) keeps the HTTP
 * plumbing and the security-critical signature check. Everything that
 * happens *after* a signature is verified — resolving which payment the
 * event refers to and routing by status — lives here as a single function
 * with every effectful dependency injected, so it can be unit-tested
 * without Firebase or the network (mirrors Till's reconcilePendingPayments).
 *
 * Activation is idempotent (see subscriptionActivation.js), so Lenco
 * retrying a delivered-but-500'd webhook can never double-grant; that
 * property lets the handler fail loud (500) on any thrown error.
 */

/**
 * @param {object} args
 * @param {object} args.event - The parsed webhook body ({event|type, data}).
 * @param {object} args.db - Firestore instance (admin.firestore()).
 * @param {Function} args.activate - ({paymentId, lencoStatus}) => Promise.
 *   Bound to activateSubscriptionFromPayment by the caller.
 * @param {Function} args.markFailed - ({paymentId, lencoStatus, reason}) =>
 *   Promise. Bound to markPaymentFailed by the caller.
 * @returns {Promise<{matched: boolean, action: string,
 *   paymentId: (string|null), status: string}>}
 *   action ∈ 'activated' | 'failed' | 'updated' | 'ignored'.
 */
async function processLencoWebhookEvent({event, db, activate, markFailed}) {
  const ev = event || {};
  const type = String(ev.event || ev.type || "");
  const data = ev.data || {};
  const reference = data.reference || null;
  const collectionId = data.id || null;
  const status = String(data.status || "");

  // The pending-payment doc id IS the Lenco reference (see
  // initiateLencoPayment), so the common path is a direct doc lookup.
  let paymentId = reference;
  let paySnap = paymentId ?
    await db.collection("payments").doc(paymentId).get() :
    null;

  // Fall back to resolving by Lenco's own collection id if the reference
  // didn't map (e.g. a card flow that minted its own ref).
  if ((!paySnap || !paySnap.exists) && collectionId) {
    const q = await db.collection("payments")
        .where("lencoCollectionId", "==", collectionId).limit(1).get();
    if (!q.empty) {
      paySnap = q.docs[0];
      paymentId = paySnap.id;
    }
  }

  if (!paySnap || !paySnap.exists) {
    return {matched: false, action: "ignored", paymentId: null, status};
  }

  if (status === "successful" || type.endsWith("successful")) {
    // Forward the amount Lenco reports collecting so activation can verify it
    // against the amount we charged before granting access.
    const r = await activate({
      paymentId,
      lencoStatus: status || "successful",
      collectedAmount: data.amount,
      collectedCurrency: data.currency,
    });
    if (r && r.reason === "amount-mismatch") {
      return {matched: true, action: "amount_mismatch", paymentId, status, amountMismatch: r.amountMismatch};
    }
    return {
      matched: true, action: "activated", paymentId, status,
      overCollected: (r && r.overCollected) || null,
    };
  }

  if (status === "failed" || type.endsWith("failed")) {
    await markFailed({
      paymentId,
      lencoStatus: status || "failed",
      reason: data.reasonForFailure || "",
    });
    return {matched: true, action: "failed", paymentId, status};
  }

  // Any other (still-pending) status: keep the mirror fresh, best-effort.
  await db.collection("payments").doc(paymentId)
      .update({lencoStatus: status || "pending"}).catch(() => {});
  return {matched: true, action: "updated", paymentId, status};
}

module.exports = {processLencoWebhookEvent};
