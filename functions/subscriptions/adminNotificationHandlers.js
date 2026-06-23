function createAdminNotificationHandlers({
  onCall,
  HttpsError,
  admin,
  emailSmtpUser,
  emailSmtpPassword,
  whatsappSecrets,
}) {
  // Audit D3 follow-up — admin / owner-gated invoice resend. Runs
  // the email-only step against the existing PDF in Storage so the
  // receipt the parent receives matches the original invoice number
  // and total exactly.
  const resendInvoiceEmail = onCall({
    secrets: [emailSmtpUser, emailSmtpPassword],
    region: "us-central1",
    timeoutSeconds: 30,
  }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

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

    const {resendInvoiceEmail: resendInvoiceEmailHelper} = require("../invoiceGenerator");
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
  });

  // Admin-only — sends an activation confirmation to the customer's
  // WhatsApp via the Meta Cloud API helper that's already wired for the
  // parent digest (functions/metaWhatsApp.js). Soft-fails when the Meta
  // secrets aren't bound so local dev still works; the admin UI falls
  // back to the copy-paste WhatsApp deep link in that case.
  const sendActivationConfirmation = onCall({
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
    secrets: [...whatsappSecrets],
  }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

    const db = admin.firestore();
    const callerSnap = await db.collection("users").doc(uid).get();
    const role = callerSnap.exists ? (callerSnap.data()?.role || "") : "";
    if (role !== "admin" && role !== "superAdmin") {
      throw new HttpsError("permission-denied", "Admin only.");
    }

    const rawPhone = String(request.data?.phone || "").trim();
    const body = String(request.data?.body || "").trim();
    if (!rawPhone) throw new HttpsError("invalid-argument", "phone is required.");
    if (!body) throw new HttpsError("invalid-argument", "body is required.");

    const {normalizeToWhatsApp, sendWhatsAppDigest} = require("../metaWhatsApp");
    const to = normalizeToWhatsApp(rawPhone);
    if (!to) {
      throw new HttpsError(
          "invalid-argument",
          `Could not parse phone number "${rawPhone}" — use 09XXXXXXXX or +2609XXXXXXXX.`,
      );
    }

    const result = await sendWhatsAppDigest({to, body: body.slice(0, 1600)});
    return {
      status: result.status,
      messageId: result.messageId || null,
      reason: result.reason || null,
      error: result.error || null,
      to,
    };
  });

  // Admin-only — sends renewal nudges via WhatsApp to learners whose
  // subscription expires soon (next 3 days) or recently lapsed (last 14
  // days). Idempotent on a 20-hour cooldown: each user gets at most one
  // reminder per day even if the button is clicked repeatedly.
  //
  // Returns a summary so the admin can see how many sends fired vs.
  // were skipped (no phone on file, cooldown, Meta-not-configured).
  const sendExpiryReminders = onCall({
    region: "us-central1",
    timeoutSeconds: 120,
    memory: "256MiB",
    secrets: [...whatsappSecrets],
  }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

    const db = admin.firestore();
    const callerSnap = await db.collection("users").doc(uid).get();
    const role = callerSnap.exists ? (callerSnap.data()?.role || "") : "";
    if (role !== "admin" && role !== "superAdmin") {
      throw new HttpsError("permission-denied", "Admin only.");
    }

    const {
      normalizeToWhatsApp,
      sendWhatsAppDigest,
      isConfigured,
    } = require("../metaWhatsApp");
    if (!isConfigured()) {
      return {
        status: "skipped",
        reason: "meta-not-configured",
        sent: 0, skipped: 0, failed: 0, candidates: 0, results: [],
      };
    }

    const COOLDOWN_HOURS = 20;
    const REMIND_FUTURE_DAYS = 3;
    const REMIND_LAPSED_DAYS = 14;
    const now = new Date();
    const cooldownCutoff = new Date(now.getTime() - COOLDOWN_HOURS * 60 * 60 * 1000);
    const futureCutoff = new Date(now.getTime() + REMIND_FUTURE_DAYS * 24 * 60 * 60 * 1000);
    const lapsedCutoff = new Date(now.getTime() - REMIND_LAPSED_DAYS * 24 * 60 * 60 * 1000);

    // We query for premium=true and subscriptionExpiry <= futureCutoff,
    // then filter the bottom of the range (lapsedCutoff) client-side.
    // A single inequality is the cheapest server-side filter that still
    // shrinks the result set; this avoids needing a composite index.
    const snap = await db.collection("users")
      .where("premium", "==", true)
      .where("subscriptionExpiry", "<=", admin.firestore.Timestamp.fromDate(futureCutoff))
      .limit(200)
      .get();

    const results = [];
    let sent = 0; let skipped = 0; let failed = 0;

    for (const userDoc of snap.docs) {
      const user = userDoc.data() || {};
      const expiry = user.subscriptionExpiry?.toDate?.();
      if (!expiry || expiry < lapsedCutoff) {
        results.push({uid: userDoc.id, status: "skipped", reason: "out-of-window"});
        skipped += 1;
        continue;
      }

      const lastSent = user.expiryReminderSentAt?.toDate?.();
      if (lastSent && lastSent > cooldownCutoff) {
        results.push({uid: userDoc.id, status: "skipped", reason: "cooldown"});
        skipped += 1;
        continue;
      }

      const rawPhone = user.subscriptionPhoneNumber || user.phoneNumber || "";
      const to = rawPhone ? normalizeToWhatsApp(rawPhone) : null;
      if (!to) {
        results.push({uid: userDoc.id, status: "skipped", reason: "no-phone"});
        skipped += 1;
        continue;
      }

      const planId = user.subscriptionPlan || "";
      const planName = planId ? planId.replace(/_/g, " ") : "your ZedExams pack";
      const expiryStr = expiry.toLocaleDateString("en-ZM", {
        day: "2-digit", month: "short", year: "numeric",
      });
      const isLapsed = expiry < now;
      const firstName = String(user.displayName || "").trim().split(" ")[0] || "there";
      const body = isLapsed
        ? `Hi ${firstName}! Your ${planName} on ZedExams expired ${expiryStr}. ` +
          `Top up via Mobile Money to keep your access. Reply with a screenshot ` +
          `when you've paid and we'll reactivate within 30 minutes. — ZedExams`
        : `Hi ${firstName}! Your ${planName} on ZedExams expires ${expiryStr}. ` +
          `Top up via Mobile Money to renew before then so you don't lose access. ` +
          `Reply with a screenshot when paid. — ZedExams`;

      try {
        const sendResult = await sendWhatsAppDigest({to, body});
        if (sendResult.status === "sent") {
          sent += 1;
          results.push({
            uid: userDoc.id, status: "sent",
            messageId: sendResult.messageId, expiry: expiry.toISOString(),
          });
          // Stamp the cooldown ONLY on success so a failure doesn't burn
          // the next eligible retry.
          await userDoc.ref.update({
            expiryReminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } else {
          failed += 1;
          results.push({
            uid: userDoc.id, status: "failed",
            reason: sendResult.reason || sendResult.error || "unknown",
          });
        }
      } catch (err) {
        failed += 1;
        results.push({uid: userDoc.id, status: "failed", reason: String(err?.message || err)});
      }
    }

    return {
      status: "ok",
      candidates: snap.size,
      sent, skipped, failed,
      results,
    };
  });

  return {
    resendInvoiceEmail,
    sendActivationConfirmation,
    sendExpiryReminders,
  };
}

module.exports = {createAdminNotificationHandlers};
