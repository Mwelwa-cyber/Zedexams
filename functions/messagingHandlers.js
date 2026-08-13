/**
 * Outbound messaging callables — password-reset email and the two WhatsApp sends.
 *
 * Phase 5 batch 2 (docs/phase5-plan.md): the BODIES live here; the builders
 * and their frozen options — region, timeout, memory, secrets, App Check —
 * stay in functions/index.js, where the frozen-surface guard reads them.
 * Moving an option here would move it out of the guard's sight, which is the
 * one thing this phase must not do.
 *
 * Bodies are moved VERBATIM. An extraction PR carries no behaviour change, so
 * that a failure can be attributed to relocation or to behaviour and never
 * both; audit burn-down items are separate PRs even on these same functions.
 *
 * Everything the bodies close over is INJECTED rather than re-required. The
 * secret params (`defineSecret` handles) must be the same instances the
 * builders bind — re-declaring them here would create different objects
 * bound to nothing.
 */
exports.buildMessagingHandlers = (deps) => {
  const {
    HttpsError,
    admin,
    assertVerifiedAuth,
    buildPasswordResetEmailHtml,
    buildPasswordResetEmailText,
    cleanString,
    crypto,
    emailSmtpPassword,
    emailSmtpUser,
    nodemailer,
    passwordResetDayKey,
    passwordResetRateLimited,
    resolvePasswordResetContinueUrl,
  } = deps;

  return {
    sendPasswordResetEmail: async (request) => {
      const email = cleanString(request.data?.email, 254).toLowerCase();
      if (!email || !email.includes("@")) {
        throw new HttpsError("invalid-argument", "Valid email address is required.");
      }

      // Uniform reply for success, unknown-account, AND rate-limited alike.
      // Never reveal whether an account exists (was an enumeration oracle
      // via the old auth/user-not-found → "No account found" throw) and
      // never signal throttling — so this endpoint can't be used to mine
      // the user base or amplify an email-bomb.
      const uniformOk = {
        success: true,
        message:
          "If an account exists for that email, a password reset link has been sent.",
      };

      const db = admin.firestore();
      const ip = String(request.rawRequest?.ip || "unknown").slice(0, 64);
      const day = passwordResetDayKey();
      const limited = await passwordResetRateLimited(
        db,
        `email_${email}_${day}`,
        ip !== "unknown" ? `ip_${ip}_${day}` : null,
      );
      if (limited) return uniformOk;

      try {
        try {
          await admin.auth().getUserByEmail(email);
        } catch (lookupError) {
          if (lookupError.code === "auth/user-not-found") {
            // No account: do not send, do not reveal. Uniform reply.
            return uniformOk;
          }
          throw lookupError;
        }

        const senderEmail = cleanString(emailSmtpUser.value(), 254);
        const senderDomain = senderEmail.split("@")[1] || "zedexams.com";
        const continueUrl = resolvePasswordResetContinueUrl(request.data?.continueUrl);
        const actionCodeSettings = {url: continueUrl};
        const resetLink = await admin.auth().generatePasswordResetLink(email, actionCodeSettings);

        const transporter = nodemailer.createTransport({
          host: "mail.privateemail.com",
          port: 587,
          secure: false,
          requireTLS: true,
          auth: {
            user: senderEmail,
            pass: emailSmtpPassword.value(),
          },
          tls: {
            minVersion: "TLSv1.2",
            servername: "mail.privateemail.com",
          },
        });

        await transporter.sendMail({
          from: `ZedExams <${senderEmail}>`,
          sender: senderEmail,
          to: email,
          replyTo: senderEmail,
          subject: "ZedExams password reset request",
          text: buildPasswordResetEmailText({resetLink}),
          html: buildPasswordResetEmailHtml({resetLink, recipientEmail: email}),
          envelope: {
            from: senderEmail,
            to: [email],
          },
          messageId: `<password-reset-${crypto.randomUUID()}@${senderDomain}>`,
          headers: {
            "X-Auto-Response-Suppress": "All",
          },
        });

        return uniformOk;
      } catch (error) {
        console.error("sendPasswordResetEmail error:", error);
        // Generic failure only — never branch the response on account
        // existence (that was the enumeration oracle). A real send/SMTP
        // failure happens regardless of whether the account exists, so
        // surfacing it here is not an oracle.
        throw new HttpsError(
          "internal",
          "Failed to send password reset email. Please try again.",
        );
      }
    },

    sendActivationConfirmation: async (request) => {
    const uid = await assertVerifiedAuth(request, "Sign in required.");

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

    const {normalizeToWhatsApp, sendWhatsAppDigest} = require("./metaWhatsApp");
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
  },

    sendExpiryReminders: async (request) => {
    const uid = await assertVerifiedAuth(request, "Sign in required.");

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
    } = require("./metaWhatsApp");
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
  },
  };
};
