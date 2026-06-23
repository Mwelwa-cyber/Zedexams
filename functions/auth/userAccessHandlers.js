function createUserAccessHandlers({
  onCall,
  HttpsError,
  admin,
  nodemailer,
  crypto,
  emailSmtpUser,
  emailSmtpPassword,
  cleanString,
  resolveInitialUserRole,
}) {
  function getAllowedContinueOrigins() {
    return [
      "https://zedexams.com",
      "https://www.zedexams.com",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ];
  }

  function resolvePasswordResetContinueUrl(rawValue) {
    const fallbackUrl = "https://zedexams.com/login?reset=complete";

    if (!rawValue) {
      return fallbackUrl;
    }

    try {
      const requestedUrl = new URL(String(rawValue));
      if (!getAllowedContinueOrigins().includes(requestedUrl.origin)) {
        return fallbackUrl;
      }

      requestedUrl.pathname = "/login";
      requestedUrl.searchParams.set("reset", "complete");
      requestedUrl.hash = "";
      return requestedUrl.toString();
    } catch {
      return fallbackUrl;
    }
  }

  function buildPasswordResetEmailHtml({resetLink, recipientEmail}) {
    const logoUrl = "https://zedexams.com/password-reset-logo.png";
    return `
      <div style="margin:0;padding:24px;background-color:#f4f1ea;font-family:Arial,sans-serif;color:#1f2937;">
        <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
          <div style="padding:28px 32px;background:#1a1f2e;color:#ffffff;">
            <div style="margin-bottom:16px;">
              <img
                src="${logoUrl}"
                alt="ZedExams"
                width="96"
                height="96"
                style="display:block;width:96px;height:96px;border-radius:20px;"
              />
            </div>
            <div style="font-size:28px;font-weight:700;letter-spacing:0.02em;">ZedExams</div>
            <div style="margin-top:8px;font-size:14px;line-height:1.5;color:#d1d5db;">
              Password reset request
            </div>
          </div>
          <div style="padding:32px;">
            <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:#111827;">Reset your password</h1>
            <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
              We received a request to reset the password for your ZedExams account.
            </p>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
              Use the button below to choose a new password. If you did not request this, you can ignore this message and your password will stay the same.
            </p>
            <div style="margin:0 0 24px;">
              <a href="${resetLink}" style="display:inline-block;background:#ea580c;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:10px;">
                Reset password
              </a>
            </div>
            <p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:#4b5563;">
              If the button does not work, open this link:
            </p>
            <p style="margin:0 0 24px;padding:14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;font-size:12px;line-height:1.7;word-break:break-word;color:#374151;">
              ${resetLink}
            </p>
            <p style="margin:0;font-size:13px;line-height:1.7;color:#6b7280;">
              This email was sent to ${recipientEmail}.
            </p>
          </div>
        </div>
      </div>
    `;
  }

  function buildPasswordResetEmailText({resetLink}) {
    return [
      "ZedExams password reset request",
      "",
      "We received a request to reset the password for your ZedExams account.",
      "Open the link below to choose a new password:",
      resetLink,
      "",
      "If you did not request this, you can ignore this email.",
    ].join("\n");
  }

  function buildBootstrappedUserProfile({
    authUser,
    tokenRole,
  }) {
    const email = cleanString(authUser?.email || "", 254);
    const fallbackName =
      email.includes("@") ? email.split("@")[0] : "ZedExams User";
    const displayName = cleanString(
        authUser?.displayName || fallbackName,
        120,
    ) || "ZedExams User";
    const role = (tokenRole === "admin" || tokenRole === "superAdmin") ?
      tokenRole :
      resolveInitialUserRole(email);

    return {
      displayName,
      email,
      role,
      grade: null,
      school: "",
      plan: "free",
      premium: false,
      isPremium: false,
      paymentStatus: "inactive",
      subscriptionStatus: "inactive",
      subscriptionPlan: "free",
      subscriptionExpiry: null,
      subscriptionActivatedBy: null,
      subscriptionActivatedAt: null,
      subscriptionProvider: null,
      subscriptionPaymentId: null,
      subscriptionPhoneNumber: null,
      premiumActivatedAt: null,
      dailyAttempts: 0,
      lastAttemptDate: "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
  }

  const PWRESET_RL_COLLECTION = "passwordResetRateLimit";
  const PWRESET_MAX_PER_EMAIL_PER_DAY = 5;
  const PWRESET_MAX_PER_IP_PER_DAY = 15;

  function passwordResetDayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  async function passwordResetRateLimited(db, emailKey, ipKey) {
    const checks = [
      {key: emailKey, max: PWRESET_MAX_PER_EMAIL_PER_DAY},
      {key: ipKey, max: PWRESET_MAX_PER_IP_PER_DAY},
    ].filter((c) => c.key);

    const snaps = await Promise.all(
        checks.map((c) =>
          db.collection(PWRESET_RL_COLLECTION).doc(c.key).get().catch(() => null)),
    );
    for (let i = 0; i < checks.length; i += 1) {
      const snap = snaps[i];
      const count = snap && snap.exists ? (snap.data()?.count || 0) : 0;
      if (count >= checks[i].max) return true;
    }
    for (const c of checks) {
      db.collection(PWRESET_RL_COLLECTION).doc(c.key).set({
        day: passwordResetDayKey(),
        count: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true}).catch((err) => {
        console.warn("[sendPasswordResetEmail] rate-limit write failed", err);
      });
    }
    return false;
  }

  const bootstrapUserProfile = onCall(
      {region: "us-central1", timeoutSeconds: 20},
      async (request) => {
        if (!request.auth?.uid) {
          throw new HttpsError("unauthenticated", "Please sign in first.");
        }

        const uid = request.auth.uid;
        const userRef = admin.firestore().doc(`users/${uid}`);
        const existingSnap = await userRef.get();
        if (existingSnap.exists) {
          return {created: false, profile: {id: uid, ...existingSnap.data()}};
        }

        try {
          const authUser = await admin.auth().getUser(uid);
          const profile = buildBootstrappedUserProfile({
            authUser,
            tokenRole: cleanString(request.auth.token?.role || "", 30),
          });

          await userRef.set(profile);

          const repairedSnap = await userRef.get();
          return {created: true, profile: {id: uid, ...repairedSnap.data()}};
        } catch (error) {
          console.error("bootstrapUserProfile:", error);
          throw new HttpsError(
              "internal",
              "We could not restore your profile right now. Please try again.",
          );
        }
      },
  );

  const sendPasswordResetEmail = onCall(
      {secrets: [emailSmtpUser, emailSmtpPassword], region: "us-central1", timeoutSeconds: 30},
      async (request) => {
        const email = cleanString(request.data?.email, 254).toLowerCase();
        if (!email || !email.includes("@")) {
          throw new HttpsError("invalid-argument", "Valid email address is required.");
        }

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
          throw new HttpsError(
              "internal",
              "Failed to send password reset email. Please try again.",
          );
        }
      },
  );

  return {
    bootstrapUserProfile,
    sendPasswordResetEmail,
  };
}

module.exports = {createUserAccessHandlers};
