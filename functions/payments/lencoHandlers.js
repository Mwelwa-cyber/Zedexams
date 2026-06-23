function createLencoHandlers({
  onCall,
  onRequest,
  HttpsError,
  admin,
  cleanString,
  lencoApiKey,
  emailSmtpUser,
  emailSmtpPassword,
}) {
  function lencoApiKeyValue() {
    // Trim — a stray trailing newline/space pasted into
    // `functions:secrets:set` would otherwise corrupt the Bearer header
    // and surface as a confusing 401 Unauthorized from Lenco.
    return (lencoApiKey.value() || process.env.LENCO_API_KEY || "").trim();
  }

  function lencoEmailSecrets() {
    return {
      senderEmail: emailSmtpUser.value() || process.env.EMAIL_SMTP_USER || "",
      senderPassword: emailSmtpPassword.value() || process.env.EMAIL_SMTP_PASSWORD || "",
    };
  }

  const initiateLencoPayment = onCall({
    secrets: [lencoApiKey, emailSmtpUser, emailSmtpPassword],
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
  }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");

    const lenco = require("../lencoService");
    const {getPlan} = require("../plans");

    const planId = cleanString(request.data?.planId, 60);
    const requestedMethod = cleanString(request.data?.method, 20);
    if (requestedMethod === "card") {
      throw new HttpsError(
          "failed-precondition",
          "Card checkout is currently unavailable. Please use Mobile Money.",
      );
    }
    const method = "mobile_money";
    const plan = getPlan(planId);
    if (!plan) throw new HttpsError("invalid-argument", "Unknown plan.");

    const apiKey = lencoApiKeyValue();
    if (!apiKey) {
      throw new HttpsError("failed-precondition", "Payments are not configured yet. Please try again later.");
    }

    const db = admin.firestore();
    const userSnap = await db.collection("users").doc(uid).get();
    const user = userSnap.exists ? (userSnap.data() || {}) : {};
    const bearer = process.env.LENCO_FEE_BEARER === "customer" ? "customer" : "merchant";

    // Pro → Max upgrade: charge ONLY the prorated daily-rate difference for the
    // days the teacher has left, and keep their existing renewal date (the
    // activation step preserves the expiry when isUpgrade is set). Recomputed
    // server-side from the user record so the client can never dictate the
    // prorated amount.
    const {quoteUpgradeForUser} = require("../subscriptionUpgrade");
    const quote = quoteUpgradeForUser(user, planId);
    const amount = quote.isUpgrade ? quote.amountZMW : Number(plan.priceZMW);
    const upgradeFields = quote.isUpgrade ? {
      isUpgrade: true,
      upgradeFromPlanId: quote.fromPlanId,
      fullPriceZMW: Number(plan.priceZMW),
      proratedDaysRemaining: quote.daysRemaining,
    } : {};

    // Create the pending payment doc first; its id IS the Lenco reference,
    // so the webhook resolves the doc by a direct lookup (no query/index).
    const payRef = await db.collection("payments").add({
      userId: uid,
      displayName: user.displayName || "",
      email: user.email || "",
      userRole: user.role || "learner",
      planId,
      planName: plan.name,
      amountZMW: amount,
      currency: "ZMW",
      provider: "lenco",
      method,
      paymentReference: "",
      status: "pending",
      lencoStatus: "pending",
      ...upgradeFields,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const reference = payRef.id;

    try {
      const rawPhone = cleanString(request.data?.phone, 20);
      const phoneNumber = lenco.normalizePhone(rawPhone);
      if (!phoneNumber) {
        throw new HttpsError("invalid-argument", "Enter a valid Zambian mobile number, e.g. 0977 740 465.");
      }
      const operator = cleanString(request.data?.operator, 12).toLowerCase() || lenco.detectOperator(rawPhone);
      if (!operator) {
        throw new HttpsError("invalid-argument", "Could not detect your mobile money operator — please choose one.");
      }
      const resp = await lenco.initiateMobileMoneyCollection({apiKey, operator, phone: phoneNumber, amount, reference, bearer});

      const data = resp?.data || {};
      const lencoStatus = String(data.status || "pending");
      await payRef.update({
        lencoStatus,
        lencoCollectionId: data.id || null,
        phoneNumber,
        operator,
      });

      if (lencoStatus === "successful") {
        const {activateSubscriptionFromPayment} = require("../subscriptionActivation");
        await activateSubscriptionFromPayment({paymentId: reference, lencoStatus, emailSecrets: lencoEmailSecrets()})
            .catch((err) => console.error("[initiateLencoPayment] activation failed", err));
      } else if (lencoStatus === "failed") {
        const {markPaymentFailed} = require("../subscriptionActivation");
        await markPaymentFailed({paymentId: reference, lencoStatus, reason: data.reasonForFailure || data.message || ""})
            .catch(() => {});
      }

      return {
        paymentId: reference,
        reference,
        status: lencoStatus,
        requiresOtp: lencoStatus === "otp-required",
        message: data.message || resp?.message || null,
        authorization: null,
      };
    } catch (err) {
      await payRef.update({
        status: "failed",
        lencoStatus: "failed",
        failureReason: String(err?.message || err).slice(0, 300),
      }).catch(() => {});
      if (err instanceof HttpsError) throw err;
      // Surface Lenco's actual rejection reason (auth, operator, phone,
      // amount, account-not-enabled, …) so the buyer and support see WHY
      // instead of an opaque "try again". err.body holds Lenco's JSON.
      console.error("[initiateLencoPayment] Lenco error", {
        code: err?.code, message: err?.message, body: err?.body,
      });
      const detail = typeof err?.message === "string" && err.message ?
        `: ${err.message.slice(0, 160)}` :
        ".";
      throw new HttpsError("internal", `Could not start the payment${detail}`);
    }
  });

  const submitLencoOtp = onCall({
    secrets: [lencoApiKey, emailSmtpUser, emailSmtpPassword],
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
  }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");

    const paymentId = cleanString(request.data?.paymentId, 60);
    const otp = cleanString(request.data?.otp, 12);
    if (!paymentId || !otp) {
      throw new HttpsError("invalid-argument", "Payment reference and OTP are required.");
    }

    const db = admin.firestore();
    const payRef = db.collection("payments").doc(paymentId);
    const snap = await payRef.get();
    if (!snap.exists || (snap.data() || {}).userId !== uid) {
      throw new HttpsError("permission-denied", "This payment is not yours.");
    }

    const apiKey = lencoApiKeyValue();
    if (!apiKey) throw new HttpsError("failed-precondition", "Payments are not configured.");

    const lenco = require("../lencoService");
    let resp;
    try {
      resp = await lenco.submitMobileMoneyOtp({apiKey, reference: paymentId, otp});
    } catch (err) {
      throw new HttpsError("invalid-argument", err?.message || "The code could not be verified. Please try again.");
    }

    const data = resp?.data || {};
    const lencoStatus = String(data.status || "pending");
    await payRef.update({lencoStatus}).catch(() => {});

    if (lencoStatus === "successful") {
      const {activateSubscriptionFromPayment} = require("../subscriptionActivation");
      await activateSubscriptionFromPayment({paymentId, lencoStatus, emailSecrets: lencoEmailSecrets()})
          .catch((err) => console.error("[submitLencoOtp] activation failed", err));
    } else if (lencoStatus === "failed") {
      const {markPaymentFailed} = require("../subscriptionActivation");
      await markPaymentFailed({paymentId, lencoStatus, reason: data.reasonForFailure || ""}).catch(() => {});
    }

    return {status: lencoStatus, requiresOtp: lencoStatus === "otp-required"};
  });

  const getLencoPaymentStatus = onCall({
    secrets: [lencoApiKey, emailSmtpUser, emailSmtpPassword],
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
  }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");

    const paymentId = cleanString(request.data?.paymentId, 60);
    if (!paymentId) throw new HttpsError("invalid-argument", "Payment reference is required.");

    const db = admin.firestore();
    const payRef = db.collection("payments").doc(paymentId);
    const snap = await payRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "Payment not found.");
    const pay = snap.data() || {};
    const callerSnap = await db.collection("users").doc(uid).get();
    const callerRole = callerSnap.exists ? (callerSnap.data() || {}).role : null;
    const isAdmin = callerRole === "admin" || callerRole === "superAdmin";
    if (pay.userId !== uid && !isAdmin) {
      throw new HttpsError("permission-denied", "This payment is not yours.");
    }

    // Already activated — short-circuit without hitting Lenco.
    if (pay.status === "successful" || pay.status === "confirmed") {
      return {status: "successful"};
    }

    const apiKey = lencoApiKeyValue();
    if (!apiKey) throw new HttpsError("failed-precondition", "Payments are not configured.");

    const lenco = require("../lencoService");
    let resp;
    try {
      resp = await lenco.getCollectionStatus({apiKey, reference: paymentId});
    } catch (err) {
      // Transient lookup failure — report the last known status so the
      // client keeps polling rather than erroring out.
      console.warn("[getLencoPaymentStatus] lookup failed", err?.message);
      return {status: pay.lencoStatus || "pending"};
    }

    const data = resp?.data || {};
    const lencoStatus = String(data.status || pay.lencoStatus || "pending");
    await payRef.update({lencoStatus}).catch(() => {});

    if (lencoStatus === "successful") {
      const {activateSubscriptionFromPayment} = require("../subscriptionActivation");
      await activateSubscriptionFromPayment({paymentId, lencoStatus, emailSecrets: lencoEmailSecrets()})
          .catch((err) => console.error("[getLencoPaymentStatus] activation failed", err));
      return {status: "successful"};
    }
    if (lencoStatus === "failed") {
      const {markPaymentFailed} = require("../subscriptionActivation");
      await markPaymentFailed({paymentId, lencoStatus, reason: data.reasonForFailure || ""}).catch(() => {});
    }
    return {status: lencoStatus, requiresOtp: lencoStatus === "otp-required"};
  });

  // On-demand "I paid but didn't get my credit" recovery. The live checkout
  // poll only runs while the modal is open; if the buyer approves on their
  // phone after it closes AND the webhook is delayed/dropped, the credit is
  // stuck until the hourly Till sweep. This lets the buyer (or anyone hitting
  // the dashboard "Already paid? Restore it" affordance) trigger that same
  // reconciliation immediately for THEIR OWN pending payments. Reuses the
  // idempotent activation path, so it can never double-grant — re-runs are safe.
  const recoverMyPendingPayments = onCall({
    secrets: [lencoApiKey, emailSmtpUser, emailSmtpPassword],
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
  }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");

    const apiKey = lencoApiKeyValue();
    if (!apiKey) throw new HttpsError("failed-precondition", "Payments are not configured.");

    const lenco = require("../lencoService");
    const {activateSubscriptionFromPayment, markPaymentFailed} = require("../subscriptionActivation");
    const {reconcilePendingPayments} = require("../agents/runners/till");

    const summary = await reconcilePendingPayments({
      db: admin.firestore(),
      apiKey,
      getCollectionStatus: lenco.getCollectionStatus,
      activate: activateSubscriptionFromPayment,
      markFailed: markPaymentFailed,
      emailSecrets: lencoEmailSecrets(),
      userId: uid,
      // The user explicitly waited and asked — don't skip fresh payments.
      minAgeMs: 0,
      maxPerRun: 20,
    });

    return {
      recovered: summary.recovered.length,
      stillPending: summary.stillPending,
      failedClosed: summary.failedClosed.length,
      checked: summary.checked,
    };
  });

  // Server-to-server webhook. No CORS / App Check — security is the
  // x-lenco-signature HMAC over the raw body. We process fully (the
  // activation transaction is fast and the receipt is best-effort) and
  // only then respond: a non-200 makes Lenco retry, and our activation is
  // idempotent, so a retry can never double-grant.
  const lencoWebhook = onRequest({
    secrets: [lencoApiKey, emailSmtpUser, emailSmtpPassword],
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
  }, async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Use POST.");
      return;
    }

    const lenco = require("../lencoService");
    const signature = req.get("x-lenco-signature") || req.get("X-Lenco-Signature");
    const ok = lenco.verifyWebhookSignature({
      rawBody: req.rawBody,
      signature,
      apiToken: lencoApiKeyValue(),
      webhookKey: process.env.LENCO_WEBHOOK_KEY || "",
    });
    if (!ok) {
      console.warn("[lencoWebhook] rejected: bad or missing signature");
      res.status(401).send("invalid signature");
      return;
    }

    try {
      const {processLencoWebhookEvent} = require("../lencoWebhookProcessor");
      const {
        activateSubscriptionFromPayment,
        markPaymentFailed,
      } = require("../subscriptionActivation");
      const emailSecrets = lencoEmailSecrets();

      const result = await processLencoWebhookEvent({
        event: req.body || {},
        db: admin.firestore(),
        activate: ({paymentId, lencoStatus}) =>
          activateSubscriptionFromPayment({paymentId, lencoStatus, emailSecrets}),
        markFailed: ({paymentId, lencoStatus, reason}) =>
          markPaymentFailed({paymentId, lencoStatus, reason}),
      });

      if (!result.matched) {
        console.warn("[lencoWebhook] no matching payment", {
          reference: req.body?.data?.reference || null,
          collectionId: req.body?.data?.id || null,
          type: req.body?.event || req.body?.type || "",
        });
        res.status(200).send("ignored");
        return;
      }

      res.status(200).send("ok");
    } catch (err) {
      console.error("[lencoWebhook] processing error", err);
      // 500 → Lenco retries; activation is idempotent so this is safe.
      res.status(500).send("processing error");
    }
  });

  return {
    initiateLencoPayment,
    submitLencoOtp,
    getLencoPaymentStatus,
    recoverMyPendingPayments,
    lencoWebhook,
  };
}

module.exports = {createLencoHandlers};
