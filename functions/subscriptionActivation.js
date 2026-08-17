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

// Tolerance (ZMW) that absorbs rounding between our integer charge and Lenco's
// reported amount. Both are in ZMW major units — `initiateLencoPayment` sends
// `amount` = `amountZMW` to Lenco, and the webhook/status reports the same.
const AMOUNT_TOLERANCE_ZMW = 1;

/**
 * Verify the amount Lenco actually collected against the amount we charged.
 * Pure — unit-tested without Firebase.
 *
 * Policy (decided with the product owner): block ONLY on under-collection or a
 * currency mismatch. Over-collection still activates (we never deny a buyer the
 * plan they paid for) but is flagged. When no collected amount is supplied
 * (legacy callers / poll), the check is skipped so nothing regresses.
 *
 * @returns {{ok:boolean, checked:boolean, reason?:string, over?:boolean,
 *   collected?:number, charged?:number}}
 */
function checkCollectedAmount({chargedZMW, chargedCurrency, collectedAmount, collectedCurrency}) {
  const collected = Number(collectedAmount);
  const charged = Number(chargedZMW);
  if (!Number.isFinite(collected) || collected <= 0) return {ok: true, checked: false};
  if (!Number.isFinite(charged) || charged <= 0) return {ok: true, checked: false};

  const curCharged = String(chargedCurrency || "ZMW").toUpperCase();
  const curCollected = String(collectedCurrency || curCharged).toUpperCase();
  if (curCollected !== curCharged) {
    return {
      ok: false, checked: true, collected, charged,
      reason: `currency mismatch: charged ${curCharged}, collected ${curCollected}`,
    };
  }
  if (collected < charged - AMOUNT_TOLERANCE_ZMW) {
    return {
      ok: false, checked: true, collected, charged,
      reason: `under-collection: charged ${charged} ${curCharged}, collected ${collected} ${curCollected}`,
    };
  }
  return {ok: true, checked: true, over: collected > charged + AMOUNT_TOLERANCE_ZMW, collected, charged};
}

/**
 * Activate the subscription for a successful payment. Idempotent.
 *
 * @param {Object} args
 * @param {string} args.paymentId           payments/{id} to activate.
 * @param {string} [args.lencoStatus]       Raw Lenco status to record.
 * @param {Object} [args.emailSecrets]      { senderEmail, senderPassword } for the receipt email.
 * @param {number} [args.collectedAmount]   Amount Lenco actually collected (ZMW). When
 *   supplied, activation is blocked on under-collection / currency mismatch.
 * @param {string} [args.collectedCurrency] Currency Lenco collected in.
 * @returns {Promise<{ok:boolean, activated?:boolean, alreadyActive?:boolean,
 *   reason?:string, amountMismatch?:object, overCollected?:object}>}
 */
async function activateSubscriptionFromPayment({
  paymentId,
  lencoStatus = "successful",
  emailSecrets = {},
  collectedAmount = null,
  collectedCurrency = null,
}) {
  if (!paymentId) return {ok: false, reason: "no-payment-id"};

  const db = admin.firestore();
  const payRef = db.collection("payments").doc(paymentId);

  let activated = false;
  let isTopUp = false;
  let planForInvoice = null;
  let payloadForInvoice = null;
  let amountMismatch = null;
  let overCollected = null;

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

    // Verify Lenco actually collected what we charged BEFORE granting anything
    // (subscription or top-up). Blocks only on under-collection / currency
    // mismatch; the payment is parked as 'amount_mismatch' (not 'successful',
    // so a retry re-checks and an admin can resolve it) and the caller alerts.
    const amountCheck = checkCollectedAmount({
      chargedZMW: pay.amountZMW,
      chargedCurrency: pay.currency,
      collectedAmount,
      collectedCurrency,
    });
    if (!amountCheck.ok) {
      tx.update(payRef, {
        status: "amount_mismatch",
        lencoStatus,
        amountMismatchReason: amountCheck.reason,
        collectedAmount: amountCheck.collected,
        amountMismatchAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      amountMismatch = {
        paymentId,
        userId: pay.userId || null,
        reason: amountCheck.reason,
        collected: amountCheck.collected,
        charged: amountCheck.charged,
      };
      return;
    }
    if (amountCheck.over) {
      overCollected = {paymentId, collected: amountCheck.collected, charged: amountCheck.charged};
    }

    const plan = getPlan(pay.planId);
    if (!plan) {
      throw new Error(`unknown plan "${pay.planId}" on payment ${paymentId}`);
    }
    if (!pay.userId) {
      throw new Error(`payment ${paymentId} has no userId`);
    }

    // WHICH ACCOUNT THIS CREDITS. Ordinarily the payer; for a guardian
    // buying for a child, the child. `creditedUid` is the one place that
    // precedence is written down (functions/guardianBillingCore.js), and
    // `beneficiaryUid` only ever reaches a payment doc through the
    // authorisation in initiateLencoPayment — a client cannot set it.
    //
    // Everything downstream in this transaction reads `user` and writes
    // `userRef`, so switching them here moves the grant, the expiry
    // stacking, the teacher-tier mapping and the reminder reset together.
    // That is deliberate: the alternative — crediting some fields to one
    // account and some to the other — is the failure that would be
    // invisible until a renewal.
    const {creditedUid} = require("./guardianBillingCore");
    const grantUid = creditedUid(pay);
    if (!grantUid) {
      throw new Error(`payment ${paymentId} names no account to credit`);
    }

    const userRef = db.collection("users").doc(grantUid);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      throw new Error(`user ${grantUid} not found for payment ${paymentId}`);
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
        provider: pay.provider || "lenco",
        // The PAYER, always — the receipt is their money, their email and
        // their invoices/{uid}/ path, even when the access went to a child.
        userId: pay.userId,
        // Set by the guardian checkout, absent on every other payment. Carried
        // out of the transaction because `pay` is scoped to it.
        guardianRequestId: pay.guardianRequestId || null,
        beneficiaryUid: pay.beneficiaryUid || null,
        beneficiaryName: pay.beneficiaryName || null,
      };
      return;
    }

    // Expiry policy:
    //  • Tier upgrade (Pro → Max, pay.isUpgrade): the buyer paid ONLY the
    //    prorated tier difference, not a full period, so we pin the renewal
    //    date to the one captured when they were quoted (pay.intendedExpiry).
    //    We never add a fresh period — even if the sub has since lapsed by the
    //    time the webhook lands — so a late-arriving upgrade can't mint a full
    //    month for a near-zero price. Falls back to the live expiry, then to
    //    now, when the captured date is absent (pre-field payments).
    //  • Early renewal of an active sub: stack onto the days already paid for.
    //  • Otherwise (new / expired): start a fresh period from today.
    const currentExpiry = toDate(user.subscriptionExpiry) || toDate(user.teacherPlanExpiresAt);
    const hasActiveExpiry = !!currentExpiry && currentExpiry > new Date();
    const isUpgrade = pay.isUpgrade === true;

    // Provider-authoritative expiry (Google Play): the store owns the
    // renewal date, so a Play payment doc carries `grantExpiryAt` (Google's
    // expiryTime) and we pin to it — no durationDays stacking. Lenco docs
    // never carry this field, so the branch is inert for the web flow.
    const overrideExpiry = toDate(pay.grantExpiryAt);

    let expiry;
    let invoiceDays;
    if (overrideExpiry) {
      expiry = new Date(overrideExpiry);
      invoiceDays = Number(plan.durationDays || 30);
    } else if (isUpgrade) {
      const intended = toDate(pay.intendedExpiry) || currentExpiry || new Date();
      expiry = new Date(intended);
      // Receipt reads the plan's nominal length, not "0 days".
      invoiceDays = Number(plan.durationDays || 30);
    } else {
      const days = Number(plan.durationDays || 30);
      const baseDate = hasActiveExpiry ? currentExpiry : new Date();
      expiry = new Date(baseDate);
      expiry.setDate(expiry.getDate() + days);
      invoiceDays = days;
    }

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
      subscriptionProvider: pay.provider || "lenco",
      subscriptionPaymentId: paymentId,
      // Reset the reminder cooldown so the next near-expiry window can
      // send a renewal nudge.
      expiryReminderSentAt: null,
    };
    if (pay.phoneNumber) {
      userUpdate.subscriptionPhoneNumber = pay.phoneNumber;
    }
    // Google Play purchases: record which token/product owns this grant so
    // the verify path can tell "this user's premium is managed by THIS Play
    // subscription" apart from web/Lenco grants (never-downgrade guard).
    if (pay.provider === "google_play") {
      userUpdate.googlePlayPurchaseToken = pay.googlePlayPurchaseToken || null;
      userUpdate.googlePlayProductId = pay.googlePlayProductId || null;
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
    planForInvoice = {id: pay.planId, name: plan.name, durationDays: invoiceDays};
    payloadForInvoice = {
      id: paymentId,
      amount: pay.amountZMW,
      currency: pay.currency || "ZMW",
      planId: pay.planId,
      phoneNumber: pay.phoneNumber || null,
      provider: pay.provider || "lenco",
      // The PAYER, always — the receipt is their money, their email and
      // their invoices/{uid}/ path, even when the access went to a child.
      userId: pay.userId,
      // Set by the guardian checkout, absent on every other payment. Carried
      // out of the transaction because `pay` is scoped to it.
      guardianRequestId: pay.guardianRequestId || null,
      beneficiaryUid: pay.beneficiaryUid || null,
      beneficiaryName: pay.beneficiaryName || null,
    };
  });

  // Blocked on a short / wrong-currency collection — the payment is parked as
  // 'amount_mismatch'. Signal the caller so it can alert an admin (the buyer
  // was NOT granted access).
  if (amountMismatch) {
    return {ok: false, reason: "amount-mismatch", amountMismatch};
  }

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
  // Google Play purchases are skipped too: the store owns the renewal date
  // (grantExpiryAt pins expiry on every renewal), so bonus days appended here
  // would be silently overwritten at the next renewal — consuming the credit
  // without delivering it. Referral credits stay redeemable on web payments.
  if (!isTopUp && payloadForInvoice.provider !== "google_play") {
    try {
      const {redeemReferralCredit, consumeReferralCredits} = require("./referralRedemption");
      await redeemReferralCredit({userId: payloadForInvoice.userId, paymentId, planId: planForInvoice.id});
      await consumeReferralCredits({userId: payloadForInvoice.userId, paymentId, planId: planForInvoice.id});
    } catch (err) {
      console.error("[subscriptionActivation] referral side effects failed", err);
    }
  }

  // A payment that carries a guardian request id came from the link in a
  // guardian's message. Mark that request paid and tell the LEARNER — the
  // buyer already knows, and the learner is the one waiting. Best-effort and
  // after activation, so a failure here cannot undo access somebody paid for.
  if (payloadForInvoice.guardianRequestId) {
    try {
      const {settleGuardianRequest} = require("./guardianUnlock");
      await settleGuardianRequest({requestId: payloadForInvoice.guardianRequestId});
    } catch (err) {
      console.error("[subscriptionActivation] guardian request settle failed", err);
    }
  }

  // Notify the buyer in-app + push (best-effort).
  try {
    const {createNotification} = require("./notifications/createNotification");
    await createNotification({
      uid: payloadForInvoice.userId,
      category: "payments",
      type: "payment_success",
      title: isTopUp ? "Top-up successful" : "Payment successful",
      body: isTopUp
        ? "Your generation credits have been added. Happy creating!"
        : "Your subscription is now active. Enjoy full access to ZedExams.",
      priority: "medium",
      icon: "credit-card",
      action: {label: "View account", url: "/my-subscription"},
      dedupeKey: `payment-success-${paymentId}`,
      source: "subscription-activation",
    });
  } catch (err) {
    console.error("[subscriptionActivation] success notification failed", err);
  }

  // Tell the admins a payment landed (in-app complement to the receipt email).
  // Subscriptions only — a K25 top-up isn't worth an admin ping.
  if (!isTopUp) {
    try {
      const {notifyAdmins} = require("./notifications/notifyAudience");
      await notifyAdmins("payment_received", {
        paymentId,
        amount: payloadForInvoice.amount ?
          `${payloadForInvoice.amount} ${payloadForInvoice.currency || "ZMW"}` : "",
        plan: (planForInvoice && planForInvoice.name) || "",
        phone: payloadForInvoice.phoneNumber || "",
      });
    } catch (err) {
      console.error("[subscriptionActivation] admin payment notify failed", err);
    }
  }

  return {ok: true, activated: true, topUp: isTopUp, overCollected};
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
    let notifyUserId = null;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(payRef);
      if (!snap.exists) return;
      const pay = snap.data() || {};
      if (pay.status === "successful" || pay.status === "confirmed") return;
      notifyUserId = pay.userId || null;
      tx.update(payRef, {
        status: "failed",
        lencoStatus,
        failureReason: String(reason || "").slice(0, 300),
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    // Notify the buyer their payment didn't go through (best-effort).
    if (notifyUserId) {
      try {
        const {createNotification} = require("./notifications/createNotification");
        await createNotification({
          uid: notifyUserId,
          category: "payments",
          type: "payment_failed",
          title: "Payment didn't go through",
          body: "We couldn't confirm your payment. Please try again to activate your plan.",
          priority: "high",
          icon: "credit-card",
          action: {label: "Try again", url: "/pricing"},
          dedupeKey: `payment-failed-${paymentId}`,
          source: "subscription-activation",
        });
      } catch (err) {
        console.error("[subscriptionActivation] failure notification failed", err);
      }
      // Surface the failure to admins in-app too.
      try {
        const {notifyAdmins} = require("./notifications/notifyAudience");
        await notifyAdmins("payment_failed", {
          paymentId,
          reason: String(reason || "").slice(0, 120),
        });
      } catch (err) {
        console.error("[subscriptionActivation] admin failure notify failed", err);
      }
    }
    return {ok: true};
  } catch (err) {
    console.error("[subscriptionActivation] markPaymentFailed error", err);
    return {ok: false, reason: String(err?.message || err).slice(0, 200)};
  }
}

module.exports = {activateSubscriptionFromPayment, markPaymentFailed, checkCollectedAmount};
