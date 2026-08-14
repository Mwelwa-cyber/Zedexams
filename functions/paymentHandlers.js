/**
 * Payments, billing and subscription-granting callables (Lenco checkout + webhook,
 * Google Play Billing verification, invoice resend, bulk demo trials).
 *
 * Phase 5 batch 3 (docs/phase5-plan.md): the BODIES live here; the builders
 * and their frozen options — region, timeout, memory, secrets, App Check —
 * stay in functions/index.js, where the frozen-surface guard reads them.
 * Moving an option here would move it out of the guard's sight, which is the
 * one thing this phase must not do.
 *
 * Bodies are moved VERBATIM. An extraction PR carries no behaviour change, so
 * that a failure can be attributed to relocation or to behaviour and never
 * both; the audit burn-down items on these same functions are separate PRs.
 *
 * Everything the bodies close over is INJECTED rather than re-required. The
 * secret params (`defineSecret` handles) must be the same instances the
 * builders bind — re-declaring them here would create different objects bound
 * to nothing.
 *
 * These are the phase's highest-risk surface: every one of them either moves
 * money or grants paid access. That is why they were held to last and why the
 * payment-lifecycle emulator and webhook-signature suites gate the batch.
 */
exports.buildPaymentHandlers = (deps) => {
  const {
    HttpsError,
    admin,
    assertAdminSecondFactor,
    assertVerifiedAuth,
    cleanString,
    crypto,
    emailSmtpPassword,
    emailSmtpUser,
    googlePlaySaJson,
    lencoApiKeyValue,
    lencoEmailSecrets,
    raisePlayConfigError,
    recordAppCheckCallable,
    shouldSendWebhookAlert,
  } = deps;

  return {
    resendInvoiceEmail: async (request) => {
      const uid = await assertVerifiedAuth(request, "Sign in required.");

      const invoiceId = String(request.data?.invoiceId || "").trim();
      if (!invoiceId) throw new HttpsError("invalid-argument", "invoiceId is required.");

      // Authorization: admin always; otherwise the buyer of this
      // invoice. (A teacher viewing /admin/payments has admin role
      // already; a parent should never reach this callable but the
      // ownership check costs us nothing extra.)
      const db = admin.firestore();
      const callerSnap = await db.collection("users").doc(uid).get();
      const callerRole = callerSnap.exists ? (callerSnap.data() || {}).role : null;
      const isAdmin = callerRole === "admin" || callerRole === "superAdmin";

      const invoiceSnap = await db.collection("invoices").doc(invoiceId).get();
      if (!invoiceSnap.exists) {
        throw new HttpsError("not-found", "Invoice not found.");
      }
      const invoice = invoiceSnap.data() || {};
      if (!isAdmin && invoice.userId !== uid) {
        throw new HttpsError("permission-denied", "Only the buyer or an admin can resend this invoice.");
      }

      const {resendInvoiceEmail: resendInvoiceEmailHelper} = require("./invoiceGenerator");
      const result = await resendInvoiceEmailHelper({
        invoiceId,
        senderEmail: emailSmtpUser.value() || process.env.EMAIL_SMTP_USER || "",
        senderPassword: emailSmtpPassword.value() || process.env.EMAIL_SMTP_PASSWORD || "",
        requestedByUid: uid,
      });

      if (!result.ok) {
        throw new HttpsError(
            "failed-precondition",
            result.reason || "Could not resend the invoice.",
        );
      }
      return {ok: true, emailedTo: result.emailedTo};
    },

    getUpgradeQuote: async (request) => {
      const uid = await assertVerifiedAuth(request, "Please sign in first.");
      const {getPlan} = require("./plans");
      const planId = cleanString(request.data?.planId, 60);
      const plan = getPlan(planId);
      if (!plan) throw new HttpsError("invalid-argument", "Unknown plan.");

      const db = admin.firestore();
      const userSnap = await db.collection("users").doc(uid).get();
      const user = userSnap.exists ? (userSnap.data() || {}) : {};
      const {quoteUpgradeForUser, projectRenewalDate} = require("./subscriptionUpgrade");
      const quote = quoteUpgradeForUser(user, planId);
      const renewal = projectRenewalDate(user, planId);
      return {
        planId,
        currency: "ZMW",
        amountZMW: quote.isUpgrade ? quote.amountZMW : Number(plan.priceZMW),
        fullPriceZMW: Number(plan.priceZMW),
        isUpgrade: quote.isUpgrade,
        daysRemaining: quote.daysRemaining,
        renewalDate: renewal ? renewal.toISOString() : null,
        quotedAt: new Date().toISOString(),
      };
    },

    initiateLencoPayment: async (request) => {
      const uid = await assertVerifiedAuth(request, "Please sign in first.");

      const lenco = require("./paymentProvider").getPaymentProvider();
      const {getPlan} = require("./plans");

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

      // Validate the destination BEFORE any write — an invalid number should
      // never mint a payments doc.
      const rawPhone = cleanString(request.data?.phone, 20);
      const phoneNumber = lenco.normalizePhone(rawPhone);
      if (!phoneNumber) {
        throw new HttpsError("invalid-argument", "Enter a valid Zambian mobile number, e.g. 0977 740 465.");
      }
      const operator = cleanString(request.data?.operator, 12).toLowerCase() || lenco.detectOperator(rawPhone);
      if (!operator) {
        throw new HttpsError("invalid-argument", "Could not detect your mobile money operator — please choose one.");
      }

      // Pro → Max upgrade: charge ONLY the prorated daily-rate difference for the
      // days the teacher has left, and keep their existing renewal date (the
      // activation step preserves the expiry when isUpgrade is set). Recomputed
      // server-side from the user record so the client can never dictate the
      // prorated amount.
      const {quoteUpgradeForUser, projectRenewalDate} = require("./subscriptionUpgrade");
      const quote = quoteUpgradeForUser(user, planId);
      const amount = quote.isUpgrade ? quote.amountZMW : Number(plan.priceZMW);

      // Displayed-price integrity: when the client echoes the amount it showed
      // (from getUpgradeQuote), refuse to charge a different one — the client
      // must refresh its quote and re-confirm with the buyer. Legacy clients
      // that send nothing skip the check (the server amount is charged either
      // way; this only protects the display promise).
      const {decideLockedInitiation, quoteMismatch} = require("./paymentInitiationCore");
      if (quoteMismatch(request.data?.expectedAmountZMW, amount)) {
        const renewal = projectRenewalDate(user, planId);
        throw new HttpsError(
            "failed-precondition",
            "The amount for this purchase has changed. Please review the updated amount.",
            {
              code: "quote-changed",
              amountZMW: amount,
              fullPriceZMW: Number(plan.priceZMW),
              isUpgrade: quote.isUpgrade,
              daysRemaining: quote.daysRemaining,
              renewalDate: renewal ? renewal.toISOString() : null,
            },
        );
      }

      const upgradeFields = quote.isUpgrade ? {
        isUpgrade: true,
        upgradeFromPlanId: quote.fromPlanId,
        fullPriceZMW: Number(plan.priceZMW),
        proratedDaysRemaining: quote.daysRemaining,
        // Capture the renewal date at quote time. Activation pins an upgrade to
        // THIS date (not a fresh period), so a webhook that lands after the sub has
        // lapsed can't grant a full month for the prorated price.
        ...(quote.expiry ? {intendedExpiry: admin.firestore.Timestamp.fromDate(quote.expiry)} : {}),
      } : {};

      // Duplicate-initiation protection — ATOMIC. paymentLocks/{uid} points at
      // the user's latest payment attempt (server-only collection: no Firestore
      // rule matches it, so clients are default-denied). Inside one transaction
      // we read the lock + the payment doc it points at, decide via the pure
      // rules in paymentInitiationCore, and either return that attempt (same
      // reference — double-tap, second tab, second device, repeated invocation,
      // retry after a lost response) or create the new payment doc AND move the
      // lock in the same commit. Concurrent requests serialize on the lock doc,
      // so Lenco can never receive two initiations for one purchase attempt,
      // and an attempt whose first response was lost after SUCCESS comes back
      // as already-paid instead of charging twice.
      //
      // The payment doc id IS the Lenco reference, so the webhook resolves the
      // doc by a direct lookup (no query/index).
      const lockRef = db.collection("paymentLocks").doc(uid);
      const newPayRef = db.collection("payments").doc();
      const outcome = await db.runTransaction(async (tx) => {
        const lockSnap = await tx.get(lockRef);
        const lock = lockSnap.exists ? (lockSnap.data() || {}) : null;
        let existing = null;
        if (lock?.paymentId) {
          const paySnap = await tx.get(db.collection("payments").doc(String(lock.paymentId)));
          if (paySnap.exists) existing = {id: paySnap.id, data: paySnap.data() || {}};
        }
        const decision = decideLockedInitiation({existing, planId, phone: rawPhone});
        if (decision.action !== "create") return decision;

        tx.set(newPayRef, {
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
          phoneNumber,
          operator,
          paymentReference: "",
          status: "pending",
          lencoStatus: "pending",
          ...upgradeFields,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        tx.set(lockRef, {
          paymentId: newPayRef.id,
          userId: uid,
          planId,
          phoneNumber,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return {action: "created"};
      });

      if (outcome.action === "reuse-paid") {
        const existing = outcome.payment.data;
        return {
          paymentId: outcome.payment.id,
          reference: outcome.payment.id,
          status: "successful",
          requiresOtp: false,
          amountZMW: Number(existing.amountZMW) || amount,
          reused: true,
          alreadyPaid: true,
          message: "This payment was already completed — your access is active.",
          authorization: null,
        };
      }
      if (outcome.action === "reuse-pending") {
        const existing = outcome.payment.data;
        const existingStatus = String(existing.lencoStatus || "pending");
        return {
          paymentId: outcome.payment.id,
          reference: outcome.payment.id,
          status: existingStatus,
          requiresOtp: existingStatus === "otp-required",
          amountZMW: Number(existing.amountZMW) || amount,
          reused: true,
          message: "Your payment request is already in progress — approve the prompt on your phone.",
          authorization: null,
        };
      }

      const payRef = newPayRef;
      const reference = payRef.id;

      try {
        const resp = await lenco.initiateMobileMoneyCollection({apiKey, operator, phone: phoneNumber, amount, reference, bearer});

        const data = resp?.data || {};
        const lencoStatus = String(data.status || "pending");
        await payRef.update({
          lencoStatus,
          lencoCollectionId: data.id || null,
          ...(phoneNumber ? {phoneNumber} : {}),
          ...(operator ? {operator} : {}),
        });

        if (lencoStatus === "successful") {
          const {activateSubscriptionFromPayment} = require("./subscriptionActivation");
          // Forward Lenco's reported collected amount so activation verifies it
          // against the charged amount (same guard as the webhook + Till paths;
          // undefined here just skips the check, so no regression).
          await activateSubscriptionFromPayment({paymentId: reference, lencoStatus, collectedAmount: data.amount, collectedCurrency: data.currency, emailSecrets: lencoEmailSecrets()})
              .catch((err) => console.error("[initiateLencoPayment] activation failed", err));
        } else if (lencoStatus === "failed") {
          const {markPaymentFailed} = require("./subscriptionActivation");
          await markPaymentFailed({paymentId: reference, lencoStatus, reason: data.reasonForFailure || data.message || ""})
              .catch(() => {});
        }

        return {
          paymentId: reference,
          reference,
          status: lencoStatus,
          requiresOtp: lencoStatus === "otp-required",
          amountZMW: amount,
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
    },

    submitLencoOtp: async (request) => {
      const uid = await assertVerifiedAuth(request, "Please sign in first.");

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

      const lenco = require("./paymentProvider").getPaymentProvider();
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
        const {activateSubscriptionFromPayment} = require("./subscriptionActivation");
        await activateSubscriptionFromPayment({paymentId, lencoStatus, collectedAmount: data.amount, collectedCurrency: data.currency, emailSecrets: lencoEmailSecrets()})
            .catch((err) => console.error("[submitLencoOtp] activation failed", err));
      } else if (lencoStatus === "failed") {
        const {markPaymentFailed} = require("./subscriptionActivation");
        await markPaymentFailed({paymentId, lencoStatus, reason: data.reasonForFailure || ""}).catch(() => {});
      }

      return {status: lencoStatus, requiresOtp: lencoStatus === "otp-required"};
    },

    getLencoPaymentStatus: async (request) => {
      const uid = await assertVerifiedAuth(request, "Please sign in first.");

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

      const lenco = require("./paymentProvider").getPaymentProvider();
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
        const {activateSubscriptionFromPayment} = require("./subscriptionActivation");
        await activateSubscriptionFromPayment({paymentId, lencoStatus, collectedAmount: data.amount, collectedCurrency: data.currency, emailSecrets: lencoEmailSecrets()})
            .catch((err) => console.error("[getLencoPaymentStatus] activation failed", err));
        return {status: "successful"};
      }
      if (lencoStatus === "failed") {
        const {markPaymentFailed} = require("./subscriptionActivation");
        await markPaymentFailed({paymentId, lencoStatus, reason: data.reasonForFailure || ""}).catch(() => {});
      }
      return {status: lencoStatus, requiresOtp: lencoStatus === "otp-required"};
    },

    recoverMyPendingPayments: async (request) => {
      const uid = await assertVerifiedAuth(request, "Please sign in first.");

      const apiKey = lencoApiKeyValue();
      if (!apiKey) throw new HttpsError("failed-precondition", "Payments are not configured.");

      const lenco = require("./paymentProvider").getPaymentProvider();
      const {activateSubscriptionFromPayment, markPaymentFailed} = require("./subscriptionActivation");
      const {reconcilePendingPayments} = require("./agents/runners/till");

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
    },

    verifyGooglePlayPurchase: async (request) => {
      await recordAppCheckCallable(request, "verifyGooglePlayPurchase");
      const uid = await assertVerifiedAuth(request, "Please sign in first.");

      const saJson = googlePlaySaJson.value() || process.env.GOOGLE_PLAY_SA_JSON || "";
      if (!saJson.trim()) {
        console.error("[verifyGooglePlayPurchase] GOOGLE_PLAY_SA_JSON is empty");
        await raisePlayConfigError({uid, reason: "sa-json-missing",
          message: "GOOGLE_PLAY_SA_JSON secret is empty"});
      }

      const raw = Array.isArray(request.data?.purchases) ? request.data.purchases : [];
      const purchases = raw
          .map((p) => ({
            purchaseToken: String(p?.purchaseToken || "").slice(0, 2000),
            productId: String(p?.productId || "").slice(0, 200),
          }))
          .filter((p) => p.purchaseToken);
      if (!purchases.length || purchases.length > 10) {
        throw new HttpsError("invalid-argument", "Send between 1 and 10 purchases to verify.");
      }
      const source = request.data?.source === "restore" ? "restore" : "purchase";

      const play = require("./googlePlayBilling");
      let accessToken;
      try {
        accessToken = await play.getAccessToken(saJson);
      } catch (err) {
        console.error("[verifyGooglePlayPurchase] token error", err);
        await raisePlayConfigError({uid,
          reason: err?.reason || "token-fetch-failed",
          message: String(err?.message || err)});
      }

      const results = [];
      for (const p of purchases) {
        try {
          const r = await play.verifyAndApplyPurchase({
            uid,
            purchaseToken: p.purchaseToken,
            accessToken,
            emailSecrets: lencoEmailSecrets(),
          });
          results.push(r);
        } catch (err) {
          if (err instanceof play.PlayConfigError) {
            console.error("[verifyGooglePlayPurchase] config error", err);
            await raisePlayConfigError({uid,
              reason: err.reason || "config",
              message: String(err.message || err)});
          }
          // Per-token failures (Google 5xx, transient network) become result
          // statuses so one bad token can't abort a multi-token restore.
          console.error("[verifyGooglePlayPurchase] verify failed", err);
          results.push({status: "error", productId: p.productId || null});
        }
      }
      console.log(`[verifyGooglePlayPurchase] uid=${uid} source=${source} ` +
        `results=${results.map((r) => r.status).join(",")}`);

      // Every result failed with a transient error → tell the client to retry
      // rather than pretending the verification concluded.
      if (results.length && results.every((r) => r.status === "error")) {
        throw new HttpsError("unavailable", "Could not reach Google Play. Please try again.");
      }

      return {results, verifiedAt: new Date().toISOString()};
    },

    lencoWebhook: async (req, res) => {
      if (req.method !== "POST") {
        res.status(405).send("Use POST.");
        return;
      }

      const lenco = require("./paymentProvider").getPaymentProvider();
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

      // Processed-event ledger (SECURITY_ENDPOINT_AUDIT §4.1) — after the
      // signature check, so an unsigned payload can never write a ledger row
      // and thereby suppress the genuine delivery it was forged to shadow.
      //
      // Identity is reference + type + status, NOT the collection id: Lenco
      // sends pending and then successful for one payment, both carrying the
      // same id, and dropping the second would leave a paid buyer without
      // access. Fails open — activation is already idempotent, so processing a
      // duplicate is safe, while refusing a real one is not.
      {
        const {claimWebhookEvent} = require("./webhookEventLedger");
        const {lencoEventParts, PROVIDERS} = require("./webhookEventLedgerCore");
        const body = req.body || {};
        const claim = await claimWebhookEvent({
          db: admin.firestore(),
          provider: PROVIDERS.LENCO,
          parts: lencoEventParts(body),
          meta: {
            reference: body?.data?.reference || body?.data?.id || null,
            type: String(body?.event || body?.type || ""),
            status: String(body?.data?.status || ""),
          },
        });
        if (!claim.shouldProcess) {
          // 200, not 4xx: Lenco should stop retrying something we have already
          // handled. A non-2xx would keep the redeliveries coming.
          res.status(200).send("duplicate");
          return;
        }
      }

      try {
        const {processLencoWebhookEvent} = require("./lencoWebhookProcessor");
        const {
          activateSubscriptionFromPayment,
          markPaymentFailed,
        } = require("./subscriptionActivation");
        const emailSecrets = lencoEmailSecrets();

        const result = await processLencoWebhookEvent({
          event: req.body || {},
          db: admin.firestore(),
          activate: ({paymentId, lencoStatus, collectedAmount, collectedCurrency}) =>
            activateSubscriptionFromPayment({
              paymentId, lencoStatus, collectedAmount, collectedCurrency, emailSecrets,
            }),
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

        // Lenco collected less than we charged (or a different currency): activation
        // was BLOCKED and the payment parked as 'amount_mismatch'. Page an admin to
        // resolve — the buyer paid but was not granted access. Throttled.
        if (result.action === "amount_mismatch") {
          const mm = result.amountMismatch || {};
          console.error("[lencoWebhook] amount mismatch — activation blocked", mm);
          try {
            if (shouldSendWebhookAlert(Date.now())) {
              const {sendOpsAlert} = require("./opsAlert");
              await sendOpsAlert({
                title: "Lenco payment amount mismatch — activation blocked",
                severity: "critical",
                lines: [
                  `Payment: ${mm.paymentId || result.paymentId || "(unknown)"}`,
                  `User: ${mm.userId || "(unknown)"}`,
                  `Reason: ${mm.reason || "amount mismatch"}`,
                  "The buyer was NOT granted access. Verify the collection in Lenco " +
                    "and resolve the payment manually.",
                ],
              });
            }
          } catch (_alertErr) { /* alerting is best-effort */ }
          res.status(200).send("amount mismatch recorded");
          return;
        }

        // Over-collection still activates (buyer keeps their plan) but is worth a
        // heads-up. Best-effort + throttled.
        if (result.overCollected) {
          console.warn("[lencoWebhook] over-collection", result.overCollected);
          try {
            if (shouldSendWebhookAlert(Date.now())) {
              const {sendOpsAlert} = require("./opsAlert");
              await sendOpsAlert({
                title: "Lenco over-collection (activated anyway)",
                severity: "warning",
                lines: [
                  `Payment: ${result.overCollected.paymentId || result.paymentId}`,
                  `Charged ${result.overCollected.charged}, collected ${result.overCollected.collected} ZMW.`,
                ],
              });
            }
          } catch (_alertErr) { /* best-effort */ }
        }

        res.status(200).send("ok");
      } catch (err) {
        console.error("[lencoWebhook] processing error", err);
        // A processing exception means the payment integration itself is broken
        // (key rotation, schema change making every event unprocessable) — the
        // money path is down and nobody is watching Cloud Logging. Page an admin.
        // Best-effort + throttled so a Lenco retry storm doesn't spam the inbox.
        try {
          if (shouldSendWebhookAlert(Date.now())) {
            const {sendOpsAlert} = require("./opsAlert");
            await sendOpsAlert({
              title: "Lenco webhook processing error — payment activation may be down",
              severity: "critical",
              lines: [
                `Error: ${String((err && err.message) || err).slice(0, 300)}`,
                `Event: ${req.body?.event || req.body?.type || "(unknown)"}`,
                "Lenco will retry (activation is idempotent), but if this repeats " +
                  "the integration is broken — check the LENCO secrets and the " +
                  "webhook payload schema.",
              ],
            });
          }
        } catch (_alertErr) { /* never let alerting mask the original error */ }
        // 500 → Lenco retries; activation is idempotent so this is safe.
        res.status(500).send("processing error");
      }
    },

    bulkGrantDemoTrials: async (request) => {
      const callerUid = await assertVerifiedAuth(request, "Sign in required.");

      const db = admin.firestore();
      const callerSnap = await db.collection("users").doc(callerUid).get();
      const callerRole = callerSnap.exists ? (callerSnap.data() || {}).role : null;
      if (callerRole !== "admin" && callerRole !== "superAdmin") {
        throw new HttpsError("permission-denied", "Admin access required.");
      }
      // Bulk account creation is a privileged admin op — require MFA evidence.
      await assertAdminSecondFactor(request, {actorRole: callerRole});

      const data = request.data || {};
      const rawEntries = Array.isArray(data.entries) ? data.entries : [];
      if (rawEntries.length === 0) {
        throw new HttpsError("invalid-argument", "Provide at least one entry.");
      }
      if (rawEntries.length > 50) {
        throw new HttpsError(
            "invalid-argument",
            "Max 50 demo accounts per batch. Split the list and try again.",
        );
      }

      const grade = Number.isInteger(data.grade) ? data.grade : 7;
      if (grade < 1 || grade > 12) {
        throw new HttpsError("invalid-argument", "grade must be 1–12.");
      }
      const days = Number.isInteger(data.days) ? data.days : 30;
      if (days < 1 || days > 365) {
        throw new HttpsError("invalid-argument", "days must be 1–365.");
      }
      const allowedPlans = new Set(["weekly", "monthly"]);
      const plan = typeof data.plan === "string" && allowedPlans.has(data.plan) ?
        data.plan :
        "monthly";
      const school = cleanString(data.school || "Demo School", 120);
      const sharedPassword = data.password ? String(data.password) : "";
      if (sharedPassword && (sharedPassword.length < 6 || sharedPassword.length > 128)) {
        throw new HttpsError(
            "invalid-argument",
            "Shared password must be 6–128 characters.",
        );
      }

      // Normalise each entry to { name, email }. Names that fail to slugify
      // or that produce a duplicate email abort the entire batch BEFORE any
      // Auth user is created — we never want a partial run that leaves
      // half the cohort in inconsistent state.
      const passwordAlphabet =
        "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
      function generatePassword() {
        let out = "";
        for (let i = 0; i < 12; i++) {
          out += passwordAlphabet[crypto.randomInt(0, passwordAlphabet.length)];
        }
        return out;
      }
      function slugify(name) {
        return String(name || "")
            .toLowerCase()
            .normalize("NFKD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/[^a-z0-9\s.-]/g, "")
            .trim()
            .replace(/\s+/g, ".")
            .replace(/\.+/g, ".")
            .replace(/^\.+|\.+$/g, "");
      }
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const seen = new Set();
      const planRows = rawEntries.map((entry, idx) => {
        const name = cleanString(entry?.name || "", 120);
        if (!name) {
          throw new HttpsError("invalid-argument", `Entry #${idx + 1} is missing a name.`);
        }
        let email = cleanString(entry?.email || "", 254).toLowerCase();
        if (!email) {
          const slug = slugify(name);
          if (!slug) {
            throw new HttpsError(
                "invalid-argument",
                `Could not derive an email from the name "${name}".`,
            );
          }
          email = `${slug}@zedexams.com`;
        }
        if (!emailRe.test(email)) {
          throw new HttpsError("invalid-argument", `Invalid email: ${email}`);
        }
        if (seen.has(email)) {
          throw new HttpsError(
              "invalid-argument",
              `Duplicate email in batch: ${email}`,
          );
        }
        seen.add(email);
        return {name, email, password: sharedPassword || generatePassword()};
      });

      // Now do the writes. Each entry is independent — one failure does
      // not abort the rest, but its row is reported back with an error
      // status so the operator can retry just the failed names.
      const adminId = `admin:bulkGrantDemoTrials:${callerUid}`;
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + days);
      const expiryTs = admin.firestore.Timestamp.fromDate(expiry);
      const ts = admin.firestore.FieldValue.serverTimestamp();

      const results = [];
      for (const row of planRows) {
        try {
          let userRecord;
          let createdAuth = false;
          try {
            userRecord = await admin.auth().createUser({
              email: row.email,
              password: row.password,
              displayName: row.name,
              emailVerified: true,
              disabled: false,
            });
            createdAuth = true;
          } catch (err) {
            if (err && err.code === "auth/email-already-exists") {
              userRecord = await admin.auth().getUserByEmail(row.email);
            } else {
              throw err;
            }
          }

          const uid = userRecord.uid;

          // Account-takeover guard. An email collision — a slugified name
          // that matches a real staff @zedexams.com mailbox, or an explicit
          // email pointing at an existing teacher/admin/paying learner —
          // used to silently overwrite that account with role:"learner",
          // demo:true and a premium grant (role downgrade + data clobber).
          // Only (re)apply the demo grant to a brand-new account or one that
          // is ALREADY a demo account. Real collisions are refused and
          // surfaced so the operator handles them explicitly.
          if (!createdAuth) {
            const existingSnap = await db.doc(`users/${uid}`).get();
            if (existingSnap.exists && existingSnap.data()?.demo !== true) {
              results.push({
                name: row.name,
                email: row.email,
                uid: "",
                password: row.password,
                status: "error",
                error:
                  "Refused: an existing non-demo account already uses this " +
                  "email (possible staff/teacher/paying user). Provide a " +
                  "unique explicit email for this entry.",
              });
              continue;
            }
          }

          // merge: true so we never wipe out fields on a re-used uid (e.g.
          // an existing DEMO account whose trial is being extended).
          await db.doc(`users/${uid}`).set({
            displayName: row.name,
            email: row.email,
            role: "learner",
            grade,
            school,
            dailyAttempts: 0,
            lastAttemptDate: "",
            referralCode: null,
            referredBy: null,
            referralCount: 0,
            referralCredits: 0,
            demo: true,
            createdAt: ts,
            // Premium grant — same shape as grantPremium() in useFirestore.
            plan: "premium",
            premium: true,
            isPremium: true,
            paymentStatus: "active",
            subscriptionStatus: "active",
            premiumActivatedAt: ts,
            subscriptionPlan: plan,
            subscriptionExpiry: expiryTs,
            subscriptionActivatedBy: adminId,
            subscriptionActivatedAt: ts,
            subscriptionProvider: "manual_grant",
          }, {merge: true});

          results.push({
            name: row.name,
            email: row.email,
            uid,
            password: row.password,
            status: createdAuth ? "created" : "reused",
          });
        } catch (err) {
          results.push({
            name: row.name,
            email: row.email,
            uid: "",
            password: row.password,
            status: "error",
            error: err?.message || String(err),
          });
        }
      }

      return {
        ok: true,
        grade,
        days,
        plan,
        expiresAt: expiry.toISOString(),
        results,
      };
    },
  };
};
