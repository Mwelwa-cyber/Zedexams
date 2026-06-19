/**
 * functions/subscriptionActivation.js
 *
 * Server-side subscription activation for automated payments (Lenco).
 *
 * This is the modern replacement for the old MoMo `markPaymentSuccessful`
 * path the codebase grew around (see referralRedemption.js + invoiceGenerator.js
 * comments). It is the single, idempotent place where a confirmed
 * `payments/{id}` doc flips the buyer's user record to premium and fires
 * the receipt + referral side effects.
 *
 * Idempotency is the whole point: it is called from BOTH the Lenco
 * webhook AND the client-driven status poll (and possibly an immediate
 * "successful" on initiate). Whoever wins, the rest no-op — guarded by
 * the payment doc's own status inside a transaction.
 *
 * Mirrors the expiry-stacking + user-field shape of the admin grant flow
 * (`grantAccessByEmail` in src/hooks/useFirestore.js) so every existing
 * dashboard query (today's revenue, activations, My-payments, premium
 * count) keeps working unchanged.
 */

const admin = require("firebase-admin");

const {getPlan} = require("./plans");

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Activate the subscription for a successful payment. Idempotent.
 *
 * @param {Object} args
 * @param {string} args.paymentId           payments/{id} to activate.
 * @param {string} [args.lencoStatus]       Raw Lenco status to record.
 * @param {Object} [args.emailSecrets]      { senderEmail, senderPassword } for the receipt email.
 * @returns {Promise<{ok:boolean, activated?:boolean, alreadyActive?:boolean, reason?:string}>}
 */
async function activateSubscriptionFromPayment({paymentId, lencoStatus = "successful", emailSecrets = {}}) {
  if (!paymentId) return {ok: false, reason: "no-payment-id"};

  const db = admin.firestore();
  const payRef = db.collection("payments").doc(paymentId);

  let activated = false;
  let isTopUp = false;
  let planForInvoice = null;
  let payloadForInvoice = null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(payRef);
    if (!snap.exists) {
      throw new Error(`payment ${paymentId} not found`);
    }
    const pay = snap.data() || {};

    // Already activated — no-op. This is what makes webhook + poll +
    // immediate-success races safe.
    if (pay.status === "successful" || pay.status === "confirmed") {
      return;
    }

    const plan = getPlan(pay.planId);
    if (!plan) {
      throw new Error(`unknown plan "${pay.planId}" on payment ${paymentId}`);
    }
    if (!pay.userId) {
      throw new Error(`payment ${paymentId} has no userId`);
    }

    const userRef = db.collection("users").doc(pay.userId);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      throw new Error(`user ${pay.userId} not found for payment ${paymentId}`);
    }
    const user = userSnap.data() || {};

    // ── Pay-per-generation top-up ─────────────────────────────────────────
    // A one-off purchase, NOT a subscription: grant `credits` extra
    // generations (usable on any metered tool) and leave plan/premium/expiry
    // untouched. Same status guard above makes the grant idempotent across
    // the webhook + poll + immediate-success races, so a credit is never
    // double-granted on a retry.
    if (plan.kind === "topup") {
      const credits = Math.max(1, Number(plan.credits || 1));
      tx.update(payRef, {
        status: "successful",
        lencoStatus,
        confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.update(userRef, {
        generationCredits: admin.firestore.FieldValue.increment(credits),
        generationCreditsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastTopUpAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      activated = true;
      isTopUp = true;
      planForInvoice = {id: pay.planId, name: plan.name, durationDays: 0};
      payloadForInvoice = {
        id: paymentId,
        amount: pay.amountZMW,
        currency: pay.currency || "ZMW",
        planId: pay.planId,
        phoneNumber: pay.phoneNumber || null,
        provider: "lenco",
        userId: pay.userId,
      };
      return;
    }

    // Expiry policy:
    //  • Tier upgrade (Pro → Max, pay.isUpgrade): keep the SAME renewal date.
    //    The buyer only paid the prorated difference for the days they had
    //    left, so we must NOT add a fresh period — just flip the tier.
    //  • Early renewal of an active sub: stack onto the days already paid for.
    //  • Otherwise (new / expired): start a fresh period from today.
    const currentExpiry = toDate(user.subscriptionExpiry) || toDate(user.teacherPlanExpiresAt);
    const hasActiveExpiry = !!currentExpiry && currentExpiry > new Date();
    const isUpgrade = pay.isUpgrade === true && hasActiveExpiry;
    const days = isUpgrade ? 0 : Number(plan.durationDays || 30);
    const baseDate = hasActiveExpiry ? currentExpiry : new Date();
    const expiry = new Date(baseDate);
    expiry.setDate(expiry.getDate() + days);

    tx.update(payRef, {
      status: "successful",
      lencoStatus,
      confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const userUpdate = {
      plan: "premium",
      premium: true,
      isPremium: true,
      paymentStatus: "active",
      subscriptionStatus: "active",
      premiumActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
      subscriptionPlan: pay.planId,
      subscriptionExpiry: admin.firestore.Timestamp.fromDate(expiry),
      subscriptionActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
      subscriptionProvider: "lenco",
      subscriptionPaymentId: paymentId,
      // Reset the reminder cooldown so the next near-expiry window can
      // send a renewal nudge.
      expiryReminderSentAt: null,
    };
    if (pay.phoneNumber) {
      userUpdate.subscriptionPhoneNumber = pay.phoneNumber;
    }
    // Teacher studio quotas are gated by a SEPARATE field that the usage
    // meter reads (functions/teacherTools/usageMeter.js → users.teacherPlan),
    // NOT by subscriptionPlan/premium. Without this, a teacher who buys
    // Pro/Max gets premium content access but stays on Free studio caps.
    // Map the purchased teacher plan onto the canonical pro/max tier.
    const teacherTier =
      (pay.planId === "pro_monthly" || pay.planId === "pro_yearly") ? "pro" :
      (pay.planId === "max_monthly" || pay.planId === "max_yearly") ? "max" :
      null;
    if (teacherTier) {
      userUpdate.teacherPlan = teacherTier;
      userUpdate.teacherPlanExpiresAt = admin.firestore.Timestamp.fromDate(expiry);
      userUpdate.teacherPlanActivatedAt = admin.firestore.FieldValue.serverTimestamp();
    }
    tx.update(userRef, userUpdate);

    activated = true;
    // An upgrade adds 0 days, but the receipt should still read the plan's
    // nominal length rather than "0 days".
    planForInvoice = {id: pay.planId, name: plan.name, durationDays: isUpgrade ? Number(plan.durationDays || 30) : days};
    payloadForInvoice = {
      id: paymentId,
      amount: pay.amountZMW,
      currency: pay.currency || "ZMW",
      planId: pay.planId,
      phoneNumber: pay.phoneNumber || null,
      provider: "lenco",
      userId: pay.userId,
    };
  });

  if (!activated) {
    return {ok: true, alreadyActive: true};
  }

  // Post-commit side effects — best effort, never block or undo the
  // activation the buyer just paid for. Order mirrors the old MoMo
  // success path: invoice, then referral redemption, then credit
  // consumption.
  try {
    const {emitInvoice} = require("./invoiceGenerator");
    await emitInvoice({
      payment: payloadForInvoice,
      plan: planForInvoice,
      senderEmail: emailSecrets.senderEmail || process.env.EMAIL_SMTP_USER || "",
      senderPassword: emailSecrets.senderPassword || process.env.EMAIL_SMTP_PASSWORD || "",
    });
  } catch (err) {
    console.error("[subscriptionActivation] invoice failed", err);
  }

  // Referral credits reward subscriptions, not one-off top-ups — skip them
  // for a top-up so a K25 credit purchase can't redeem/consume a free month.
  if (!isTopUp) {
    try {
      const {redeemReferralCredit, consumeReferralCredits} = require("./referralRedemption");
      await redeemReferralCredit({userId: payloadForInvoice.userId, paymentId, planId: planForInvoice.id});
      await consumeReferralCredits({userId: payloadForInvoice.userId, paymentId, planId: planForInvoice.id});
    } catch (err) {
      console.error("[subscriptionActivation] referral side effects failed", err);
    }
  }

  return {ok: true, activated: true, topUp: isTopUp};
}

/**
 * Record a failed payment. Never downgrades a payment that already
 * succeeded (a late failure webhook after a successful retry must not
 * revoke access).
 */
async function markPaymentFailed({paymentId, lencoStatus = "failed", reason = ""}) {
  if (!paymentId) return {ok: false, reason: "no-payment-id"};
  const db = admin.firestore();
  const payRef = db.collection("payments").doc(paymentId);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(payRef);
      if (!snap.exists) return;
      const pay = snap.data() || {};
      if (pay.status === "successful" || pay.status === "confirmed") return;
      tx.update(payRef, {
        status: "failed",
        lencoStatus,
        failureReason: String(reason || "").slice(0, 300),
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    return {ok: true};
  } catch (err) {
    console.error("[subscriptionActivation] markPaymentFailed error", err);
    return {ok: false, reason: String(err?.message || err).slice(0, 200)};
  }
}

module.exports = {activateSubscriptionFromPayment, markPaymentFailed};
