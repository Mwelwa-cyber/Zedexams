const functions = require("firebase-functions/v1");
const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("node:crypto");
const nodemailer = require("nodemailer");

admin.initializeApp();

const {
  LIMITS,
  assertDailyLimit,
  buildAnthropicChat,
  buildExplainMessages,
  buildImportStructureMessages,
  buildQuizMessages,
  callAnthropic,
  callAnthropicStream,
  cleanString: cleanAiString,
  getAnthropicApiKey,
  getUserRole,
  isStaffRole,
  parseGeneratedQuiz,
  parseStructuredImport,
  stripJsonFences,
  toAnthropicShape,
} = require("./aiService");
const {
  buildMtnConfig,
  DEFAULT_CURRENCY,
  getPlanConfig,
  getRequestToPayStatus,
  nextPollingDelayMs,
  normalizePhoneNumber,
  requestToPay,
  resolveCurrency,
} = require("./momoService");

// Teacher Tools — Lesson Plan Generator (Zambian CBC).
const {
  createGenerateLessonPlan,
  runLessonPlan,
} = require("./teacherTools/generateLessonPlan");
// Teacher Tools — Worksheet Generator.
const {
  createGenerateWorksheet,
  runWorksheet,
} = require("./teacherTools/generateWorksheet");
// Teacher Tools — Flashcard Generator.
const {
  createGenerateFlashcards,
} = require("./teacherTools/generateFlashcards");
// Teacher Tools — Scheme of Work Generator.
const {
  createGenerateSchemeOfWork,
} = require("./teacherTools/generateSchemeOfWork");
// Teacher Tools — Rubric Generator.
const {
  createGenerateRubric,
} = require("./teacherTools/generateRubric");
// Teacher Tools — Notes Studio (teacher delivery notes from a lesson plan).
const {
  createGenerateNotes,
} = require("./teacherTools/generateNotes");
// Teacher Tools — Lesson Plan Studio (vanilla JS studio, free-form prompts).
const {
  createStudioGenerateLessonPlan,
} = require("./teacherTools/studioLessonPlan");
// Teacher Tools — import built-in CBC topics into Firestore (admin-only).
const {
  importBuiltInCbcTopics,
} = require("./teacherTools/importBuiltInCbcTopics");
// CBC knowledge base — used to ground AI quiz questions in the Zambian
// syllabus. resolveCbcContext returns a rendered <cbc_context> block plus
// a human-readable warning if the topic wasn't found in the verified KB.
const {
  resolveCbcContext,
} = require("./teacherTools/cbcKnowledge");
// Daily Exam auto-picker — promotes one short-quiz per grade into the
// day's Daily Exam slot every morning so the admin no longer has to
// click "Daily Exam" by hand for routine rotation.
const {autoPickDailyExams} = require("./dailyExamPicker");

// AI agents — Phase 2 dispatcher (Content department: Aria → Cala → Reva → Pubo).
const {
  createAgentJobsOnCreate,
  createAgentJobsOnApproved,
} = require("./agents/dispatcher");
// AI agents — Phase 3 + Phase 5 cron (QA/Eng: nightly Quill, weekly Cala).
const {
  nightlyQaSmoke: nightlyQaSmokeCron,
  weeklyCbcAlignmentAudit: weeklyCbcAlignmentAuditCron,
} = require("./agents/cron");
// Audit A5.2 — daily streak-reminder push (Africa/Lusaka 16:00).
const {dailyStreakReminders: dailyStreakRemindersCron} = require("./dailyReminders");
// Audit C4 — public marketing-page stats aggregator (every 30 minutes).
const {updatePublicStats: updatePublicStatsCron} = require("./publicStats");
// Audit A10 — teacher classroom roster (invite codes + join + remove + leave + assignments).
const {
  generateClassInvite,
  joinClassByCode,
  removeLearnerFromClass,
  leaveClass,
  createClassAssignment,
  removeClassAssignment,
} = require("./classManagement");
// Audit A10 PR 4 + PR 5 — per-class analytics + per-assignment drill-down.
const {getClassStats, getAssignmentCompletion} = require("./classAnalytics");
// Audit A3 PR 1 — parent portal share-link infrastructure.
const {
  createProgressShare,
  revokeProgressShare,
  getProgressShare,
} = require("./parentPortal");
// Audit A3 PR 2 — weekly digest cron (Sunday 09:00 Africa/Lusaka).
const {weeklyParentDigest} = require("./weeklyParentDigest");

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");
const mtnApiUser = defineSecret("MTN_API_USER");
const mtnApiKey = defineSecret("MTN_API_KEY");
const mtnSubscriptionKey = defineSecret("MTN_SUBSCRIPTION_KEY");
const mtnEnv = defineSecret("MTN_ENV");
const emailSmtpUser = defineSecret("EMAIL_SMTP_USER");
const emailSmtpPassword = defineSecret("EMAIL_SMTP_PASSWORD");
const MAX_LEN = {
  question: 1200,
  correctAnswer: 600,
  studentAnswer: 600,
  subject: 80,
  grade: 20,
};
// Audit D3 — payment functions pull SMTP credentials too so the
// success path can email the receipt. emailSmtp* default to empty
// strings if the secret isn't set; emitInvoice silently skips the
// email step in that case (PDF still saved + Firestore doc still
// written).
const MOMO_PAYMENT_SECRETS = [
  mtnApiUser,
  mtnApiKey,
  mtnSubscriptionKey,
  mtnEnv,
  emailSmtpUser,
  emailSmtpPassword,
];
const MOMO_MAX_STATUS_CHECKS = 8;
const MOMO_MAX_PENDING_MINUTES = 15;
const MARKING_EQUIVALENCES =
  "Accept common school terms and scientific terms as equivalent when they " +
  "refer to the same concept. Examples: alveoli = air sacs; oesophagus = " +
  "food pipe; trachea = windpipe; larynx = voice box; stomata = leaf pores; " +
  "photosynthesis = making food using sunlight. A more precise term should " +
  "not be marked wrong because the expected answer uses a simpler term. " +
  "Do not say alveoli are different from air sacs; in primary science, air " +
  "sacs in the lungs are alveoli. For breathing terms: respiration can be " +
  "another name for breathing; inhaling/inhalation means breathing in only; " +
  "exhaling/exhalation means breathing out only. Mark false only when the student's answer " +
  "contradicts the concept or answers a different question. ";
const TEACHER_MARKING_SCHEME =
  "When an expected answer is provided, treat it as the teacher's marking " +
  "scheme. If the student's answer matches that expected answer or a clear " +
  "equivalent, mark it correct even when another wording might be more " +
  "scientifically complete. ";
const SUBSCRIPTION_ACTIVATION_PENDING_MESSAGE =
  "Subscription not yet activated. If you have already paid, please " +
  "refresh or contact support.";

function cleanString(value, maxLength) {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, maxLength);
}

function parseMarkerResponse(raw) {
  try {
    const parsed = JSON.parse(stripJsonFences(raw));
    return {
      correct: Boolean(parsed.correct),
      feedback: cleanString(parsed.feedback, 160) ||
        "Answer checked. Review the expected answer.",
    };
  } catch {
    throw new HttpsError(
      "internal",
      "The marker could not read the AI response. Please try again.",
    );
  }
}

function getMtnRuntimeConfig() {
  return buildMtnConfig({
    apiUser: mtnApiUser.value() || process.env.MTN_API_USER,
    apiKey: mtnApiKey.value() || process.env.MTN_API_KEY,
    subscriptionKey:
      mtnSubscriptionKey.value() || process.env.MTN_SUBSCRIPTION_KEY,
    environment: mtnEnv.value() || process.env.MTN_ENV || "sandbox",
  });
}

function setCorsHeaders(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

async function requireHttpAuth(req) {
  const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    throw new HttpsError("unauthenticated", "Please sign in first.");
  }
  return admin.auth().verifyIdToken(token);
}

// Audit B3 — soft App Check verification for HTTP endpoints.
//
// In rollout mode (the default while clients are propagating the
// App Check SDK init), missing or invalid tokens are logged to a
// per-day counter doc but the call is NOT rejected. The
// /admin/ai-costs surface (or a future App Check dashboard) reads
// these counters to gauge readiness for hard enforcement.
//
// To flip to hard enforcement: set process.env.APPCHECK_ENFORCE=1
// on the Cloud Functions deploy. The function then 401s any HTTP
// request without a verified App Check token. No code change
// needed.
async function softVerifyAppCheckHttp(req, label) {
  const token = req.get("X-Firebase-AppCheck") || "";
  let verified = null;
  if (token) {
    try {
      verified = await admin.appCheck().verifyToken(token);
    } catch (err) {
      console.warn(`[appCheck:${label}] verifyToken failed`, err?.message || err);
    }
  }
  // Best-effort observability — counts attempts vs. valid tokens by day.
  try {
    const date = new Date().toISOString().slice(0, 10);
    const ref = admin.firestore().collection("appCheckHealth").doc(date);
    const inc = (n) => admin.firestore.FieldValue.increment(n);
    await ref.set({
      date,
      [`${label}_attempts`]: inc(1),
      [`${label}_valid`]: inc(verified ? 1 : 0),
      [`${label}_missing`]: inc(token ? 0 : 1),
      [`${label}_invalid`]: inc(token && !verified ? 1 : 0),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  } catch (err) {
    console.warn(`[appCheck:${label}] health write failed`, err?.message || err);
  }
  if (process.env.APPCHECK_ENFORCE === "1" && !verified) {
    throw new HttpsError("permission-denied", "App Check verification failed.");
  }
  return verified;
}

async function getUserProfileOrThrow(uid) {
  const snap = await admin.firestore().doc(`users/${uid}`).get();
  if (!snap.exists) {
    throw new HttpsError(
      "failed-precondition",
      "Your user profile is missing. Please sign in again.",
    );
  }
  return snap.data();
}

function getAdminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function resolveInitialUserRole(email) {
  const normalizedEmail = cleanString(email, 254).toLowerCase();
  return getAdminEmails().includes(normalizedEmail) ? "admin" : "learner";
}

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
  const role = tokenRole === "admin" ?
    "admin" :
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

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") {
    return value.toDate();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

exports.setUserRole = functions.auth.user().onCreate(async (user) => {
  const role = resolveInitialUserRole(user.email || "");

  await admin.auth().setCustomUserClaims(user.uid, {role});

  return null;
});

exports.bootstrapUserProfile = onCall(
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

exports.sendPasswordResetEmail = onCall(
  {secrets: [emailSmtpUser, emailSmtpPassword], region: "us-central1", timeoutSeconds: 30},
  async (request) => {
    const email = cleanString(request.data?.email, 254).toLowerCase();
    if (!email || !email.includes("@")) {
      throw new HttpsError("invalid-argument", "Valid email address is required.");
    }

    try {
      await admin.auth().getUserByEmail(email);

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

      return {success: true, message: "Password reset email sent successfully."};
    } catch (error) {
      console.error("sendPasswordResetEmail error:", error);
      if (error.code === "auth/user-not-found") {
        throw new HttpsError("not-found", "No account found with this email address.");
      }
      throw new HttpsError(
        "internal",
        "Failed to send password reset email. Please try again.",
      );
    }
  },
);

exports.aiChat = onCall(
  {secrets: [anthropicApiKey], region: "us-central1", timeoutSeconds: 30},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }

    const message = cleanAiString(request.data?.message, LIMITS.message);
    if (!message) {
      throw new HttpsError(
        "invalid-argument",
        "Please enter a question for Zed.",
      );
    }

    const role = await getUserRole(request.auth.uid);
    await assertDailyLimit(request.auth.uid, role, "chat");

    const {systemPrompt, messages} = buildAnthropicChat({
      message,
      context: request.data?.context || {},
      history: request.data?.history || [],
      role,
      customSystemPrompt: request.data?.systemPrompt,
    });
    const reply = await callAnthropic(getAnthropicApiKey(anthropicApiKey), {
      systemPrompt,
      messages,
      maxTokens: 1000,
      temperature: 0.35,
      track: {uid: request.auth.uid, tool: "aiChat"},
    });

    return {reply};
  },
);

function httpStatusForError(error) {
  const map = {
    "unauthenticated": 401,
    "permission-denied": 403,
    "invalid-argument": 400,
    "not-found": 404,
    "resource-exhausted": 429,
    "failed-precondition": 503,
    "unavailable": 503,
  };
  return map[error?.code] || 500;
}

function shouldHidePaymentInfraError(message) {
  return /subscription key|api key|access denied|authenticate with MTN/i
    .test(String(message || ""));
}

function sanitizePaymentReason(reason) {
  const cleaned = cleanString(reason, 220);
  if (!cleaned) return null;
  return shouldHidePaymentInfraError(cleaned) ?
    SUBSCRIPTION_ACTIVATION_PENDING_MESSAGE :
    cleaned;
}

function userFacingPaymentErrorMessage(error, fallbackMessage) {
  return sanitizePaymentReason(error?.message) || fallbackMessage;
}

function buildActiveSubscriptionData({
  plan,
  paymentId = null,
  phoneNumber = null,
  activatedBy,
  provider,
  expiryDate,
}) {
  return {
    plan: "premium",
    premium: true,
    paymentStatus: "active",
    subscriptionStatus: "active",
    premiumActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
    isPremium: true,
    subscriptionPlan: plan.id,
    subscriptionProvider: provider,
    subscriptionPhoneNumber: phoneNumber,
    subscriptionPaymentId: paymentId,
    subscriptionActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
    subscriptionActivatedBy: activatedBy,
    subscriptionExpiry: admin.firestore.Timestamp.fromDate(expiryDate),
  };
}

// When a TEACHER buys a learner-portal subscription, write to a separate set
// of fields so it does not collide with their (future) teacher-portal premium.
function buildLearnerPortalAccessData({
  plan,
  paymentId = null,
  phoneNumber = null,
  provider,
  expiryDate,
}) {
  return {
    learnerPortalActive: true,
    learnerPortalPlan: plan.id,
    learnerPortalProvider: provider,
    learnerPortalPhoneNumber: phoneNumber,
    learnerPortalPaymentId: paymentId,
    learnerPortalActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
    learnerPortalExpiry: admin.firestore.Timestamp.fromDate(expiryDate),
  };
}

function paymentClientMessage(status) {
  if (status === "successful") {
    return "Payment received. Your subscription is now active.";
  }
  if (status === "failed") {
    return "Payment failed or was declined. Please try again.";
  }
  if (status === "timeout") {
    return "The payment took too long to finish. Please try again.";
  }
  return "Waiting for you to approve the MTN prompt on your phone.";
}

function buildPaymentResponse(paymentId, data) {
  return {
    paymentId,
    status: data.status,
    mtnStatus: data.mtnStatus || null,
    reason: sanitizePaymentReason(data.reason),
    amountZMW: data.amountZMW,
    currency: data.currency || DEFAULT_CURRENCY,
    planId: data.planId,
    nextCheckInMs: data.status === "pending" ?
      nextPollingDelayMs(Number(data.statusChecks) || 0) :
      0,
    message: paymentClientMessage(data.status),
    lastCheckedAt: data.lastCheckedAt?.toDate?.()?.toISOString?.() || null,
  };
}

// Audit D3 follow-up — admin / owner-gated invoice resend. Runs
// the email-only step against the existing PDF in Storage so the
// receipt the parent receives matches the original invoice number
// and total exactly.
exports.resendInvoiceEmail = onCall({
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
  const isAdmin = callerRole === "admin";

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
});

async function emitInvoiceIfMissing(paymentRef, paymentData) {
  // Audit D3 — fire-and-forget invoice generation. Runs after the
  // success transaction has committed so accounting failures (PDF
  // build, Storage hiccup, SMTP outage) NEVER block subscription
  // activation. The invoices/{paymentId} doc gates double-emission
  // — a re-entered markPaymentSuccessful (cron retry) is a no-op
  // if the invoice already exists.
  try {
    const invoiceSnap = await admin.firestore()
        .collection("invoices")
        .doc(paymentRef.id)
        .get();
    if (invoiceSnap.exists) return;
    const {emitInvoice} = require("./invoiceGenerator");
    const plan = getPlanConfig(paymentData.planId);
    await emitInvoice({
      payment: {
        id: paymentRef.id,
        userId: paymentData.userId,
        amount: Number(paymentData.amountZMW || plan.amountZMW || 0),
        currency: paymentData.currency || "ZMW",
        planId: paymentData.planId,
        phoneNumber: paymentData.phoneNumber || null,
        provider: "mtn_momo",
      },
      plan,
      senderEmail: emailSmtpUser.value() || process.env.EMAIL_SMTP_USER || "",
      senderPassword: emailSmtpPassword.value() || process.env.EMAIL_SMTP_PASSWORD || "",
    });
  } catch (err) {
    console.warn("[index] emitInvoiceIfMissing failed", err);
  }
}

async function markPaymentSuccessful(paymentRef, paymentData, statusResult) {
  const plan = getPlanConfig(paymentData.planId);
  await admin.firestore().runTransaction(async (tx) => {
    const [paymentSnap, userSnap] = await Promise.all([
      tx.get(paymentRef),
      tx.get(admin.firestore().doc(`users/${paymentData.userId}`)),
    ]);
    if (!paymentSnap.exists) return;

    const latestPayment = paymentSnap.data();
    if (latestPayment.status === "successful") {
      return;
    }

    const userData = userSnap.exists ? userSnap.data() : {};
    const isTeacherLearnerPortal =
      paymentData.portal === "learner" && userData.role === "teacher";
    const currentExpiry = isTeacherLearnerPortal ?
      toDate(userData.learnerPortalExpiry) :
      toDate(userData.subscriptionExpiry);
    const baseDate = currentExpiry && currentExpiry > new Date() ?
      currentExpiry :
      new Date();
    const nextExpiry = new Date(baseDate);
    nextExpiry.setDate(nextExpiry.getDate() + plan.durationDays);

    tx.set(paymentRef, {
      status: "successful",
      mtnStatus: statusResult.mtnStatus,
      reason: sanitizePaymentReason(statusResult.reason),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
      statusChecks: Number(latestPayment.statusChecks || 0) + 1,
      financialTransactionId:
        statusResult.raw?.financialTransactionId || null,
      rawStatusResponse: statusResult.raw || null,
    }, {merge: true});

    const userUpdate = isTeacherLearnerPortal ?
      buildLearnerPortalAccessData({
        plan,
        paymentId: paymentRef.id,
        phoneNumber: paymentData.phoneNumber,
        provider: "mtn_momo",
        expiryDate: nextExpiry,
      }) :
      buildActiveSubscriptionData({
        plan,
        paymentId: paymentRef.id,
        phoneNumber: paymentData.phoneNumber,
        activatedBy: "mtn_momo",
        provider: "mtn_momo",
        expiryDate: nextExpiry,
      });

    tx.set(
      admin.firestore().doc(`users/${paymentData.userId}`),
      userUpdate,
      {merge: true},
    );
  });

  // Audit D3 — invoice + receipt email. Fire-and-forget; never
  // blocks the user-facing success path. The transaction above
  // already committed the activation by the time we get here.
  emitInvoiceIfMissing(paymentRef, paymentData).catch(() => {});
}

async function markPaymentFinal(
  paymentRef,
  paymentData,
  status,
  reason,
  raw,
  mtnStatus = null,
) {
  await paymentRef.set({
    status,
    mtnStatus: mtnStatus || (status === "timeout" ? "TIMEOUT" : paymentData.mtnStatus || null),
    reason: sanitizePaymentReason(reason),
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
    statusChecks: Number(paymentData.statusChecks || 0) + 1,
    rawStatusResponse: raw || null,
  }, {merge: true});
}

async function refreshPaymentStatus(paymentId, {skipIfNotDue = false} = {}) {
  const paymentRef = admin.firestore().doc(`payments/${paymentId}`);
  const paymentSnap = await paymentRef.get();
  if (!paymentSnap.exists) {
    throw new HttpsError("not-found", "Payment record not found.");
  }

  const paymentData = paymentSnap.data();
  if (paymentData.status !== "pending") {
    return {paymentId, ...paymentData};
  }

  const nextCheckAt = toDate(paymentData.nextCheckAt);
  if (skipIfNotDue && nextCheckAt && nextCheckAt > new Date()) {
    return {paymentId, ...paymentData};
  }

  const createdAt = toDate(paymentData.createdAt) || new Date();
  const ageMinutes = (Date.now() - createdAt.getTime()) / (60 * 1000);
  const checksSoFar = Number(paymentData.statusChecks || 0);
  if (
    checksSoFar >= MOMO_MAX_STATUS_CHECKS ||
    ageMinutes >= MOMO_MAX_PENDING_MINUTES
  ) {
    await markPaymentFinal(
      paymentRef,
      paymentData,
      "timeout",
      "The MTN approval window expired before the payment completed.",
      paymentData.rawStatusResponse || null,
      "TIMEOUT",
    );
    const updated = await paymentRef.get();
    return {paymentId, ...updated.data()};
  }

  const statusResult = await getRequestToPayStatus(getMtnRuntimeConfig(), paymentId);
  console.log("MTN payment status", {
    paymentId,
    status: statusResult.status,
    mtnStatus: statusResult.mtnStatus,
  });

  if (statusResult.status === "successful") {
    await markPaymentSuccessful(paymentRef, paymentData, statusResult);
    const updated = await paymentRef.get();
    return {paymentId, ...updated.data()};
  }

  if (statusResult.isFinal) {
    await markPaymentFinal(
      paymentRef,
      paymentData,
      statusResult.status,
      statusResult.reason || "MTN reported that the payment did not complete.",
      statusResult.raw,
      statusResult.mtnStatus,
    );
    const updated = await paymentRef.get();
    return {paymentId, ...updated.data()};
  }

  const nextDelayMs = nextPollingDelayMs(checksSoFar + 1);
  await paymentRef.set({
    mtnStatus: statusResult.mtnStatus,
    reason: sanitizePaymentReason(statusResult.reason),
    rawStatusResponse: statusResult.raw || null,
    lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    statusChecks: checksSoFar + 1,
    nextCheckAt: admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + nextDelayMs),
    ),
  }, {merge: true});

  const updated = await paymentRef.get();
  return {paymentId, ...updated.data()};
}

exports.apiAiChat = onRequest(
  {secrets: [anthropicApiKey], region: "us-central1", timeoutSeconds: 60},
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    // Audit B3 — accept the App Check token header alongside the
    // existing Authorization bearer + content-type list.
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Firebase-AppCheck");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({error: "Use POST for Zed chat."});
      return;
    }

    // ── Auth + validation (before any headers are sent) ─────────────
    let decoded;
    let systemPrompt;
    let messages;
    let apiKey;
    try {
      const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (!token) {
        throw new HttpsError("unauthenticated", "Please sign in first.");
      }
      decoded = await admin.auth().verifyIdToken(token);
      // Audit B3 — observability + opt-in enforcement gate. Throws
      // permission-denied only when APPCHECK_ENFORCE=1 is set.
      await softVerifyAppCheckHttp(req, "apiAiChat");

      const message = cleanAiString(req.body?.message, LIMITS.message);
      if (!message) {
        throw new HttpsError("invalid-argument", "Please enter a question for Zed.");
      }

      const role = await getUserRole(decoded.uid);
      await assertDailyLimit(decoded.uid, role, "chat");

      ({systemPrompt, messages} = buildAnthropicChat({
        message,
        context: req.body?.context || {},
        history: req.body?.history || [],
        role,
        customSystemPrompt: req.body?.systemPrompt,
      }));
      apiKey = getAnthropicApiKey(anthropicApiKey);
    } catch (error) {
      console.error("apiAiChat auth/validation error", {
        code: error?.code,
        message: error?.message,
      });
      res.status(httpStatusForError(error)).json({
        error: error?.message || "Zed is unavailable right now.",
      });
      return;
    }

    // ── Stream SSE to the client ──────────────────────────────────────
    res.set("Content-Type", "text/event-stream; charset=utf-8");
    res.set("Cache-Control", "no-cache");
    res.set("Connection", "keep-alive");
    res.set("X-Accel-Buffering", "no"); // disable Nginx buffering if present
    res.status(200);
    // Flush an initial keep-alive comment so the client knows the connection opened.
    res.write(": connected\n\n");

    try {
      await callAnthropicStream(
        apiKey,
        {
          systemPrompt,
          messages,
          maxTokens: 1000,
          temperature: 0.35,
          track: {uid: decoded.uid, tool: "apiAiChat"},
        },
        (token) => {
          res.write(`data: ${JSON.stringify({text: token})}\n\n`);
        },
      );
      res.write("data: [DONE]\n\n");
    } catch (error) {
      console.error("apiAiChat stream error", {
        code: error?.code,
        message: error?.message,
      });
      // Best-effort: send error event then close. The client uses [ERROR] to
      // surface a user-facing message and fall back gracefully.
      res.write(`data: [ERROR] ${JSON.stringify({error: error?.message || "Zed is unavailable right now."})}\n\n`);
    } finally {
      res.end();
    }
  },
);

exports.apiCreateMomoPayment = onRequest(
  {region: "us-central1", timeoutSeconds: 60, secrets: MOMO_PAYMENT_SECRETS},
  async (req, res) => {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({error: "Use POST to start a payment."});
      return;
    }

    try {
      const decoded = await requireHttpAuth(req);
      const userProfile = await getUserProfileOrThrow(decoded.uid);
      const plan = getPlanConfig(req.body?.planId);
      const config = getMtnRuntimeConfig();
      const currency = config.currency || resolveCurrency(config.targetEnvironment);
      const phoneNumber = normalizePhoneNumber(
        req.body?.phoneNumber,
        config.targetEnvironment,
      );
      // `portal` lets teachers buy a learner-portal subscription independently
      // of any future teacher-portal subscription. Learner-role users always
      // get the legacy premium activation regardless of this field.
      const requestedPortal = cleanString(req.body?.portal || "", 20)
        .toLowerCase();
      const portal = requestedPortal === "learner" ? "learner" : "default";
      const paymentId = crypto.randomUUID();
      const externalId = `${decoded.uid}-${Date.now()}`;

      await requestToPay(config, {
        requestId: paymentId,
        externalId,
        phoneNumber,
        plan,
        payerMessage: `${plan.name} premium subscription`,
        payeeNote: `${userProfile.displayName || decoded.email || decoded.uid}`,
      });

      await admin.firestore().doc(`payments/${paymentId}`).set({
        userId: decoded.uid,
        displayName: userProfile.displayName || "",
        email: userProfile.email || decoded.email || "",
        userRole: userProfile.role || "learner",
        portal,
        planId: plan.id,
        planName: plan.name,
        amountZMW: plan.amountZMW,
        currency,
        provider: "mtn_momo",
        phoneNumber,
        externalId,
        status: "pending",
        mtnStatus: "PENDING",
        reason: null,
        environment: config.targetEnvironment,
        statusChecks: 0,
        nextCheckAt: admin.firestore.Timestamp.fromDate(
          new Date(Date.now() + nextPollingDelayMs(0)),
        ),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastCheckedAt: null,
        completedAt: null,
      });

      res.status(202).json({
        paymentId,
        status: "pending",
        planId: plan.id,
        amountZMW: plan.amountZMW,
        currency,
        phoneNumber,
        nextCheckInMs: nextPollingDelayMs(0),
        message: "Payment request sent. Approve it on your phone.",
      });
    } catch (error) {
      console.error("apiCreateMomoPayment error", {
        code: error?.code,
        message: error?.message,
      });
      res.status(httpStatusForError(error)).json({
        error: userFacingPaymentErrorMessage(
          error,
          "Could not start the MTN payment.",
        ),
      });
    }
  },
);

exports.apiMomoPaymentStatus = onRequest(
  {region: "us-central1", timeoutSeconds: 60, secrets: MOMO_PAYMENT_SECRETS},
  async (req, res) => {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({error: "Use GET to read payment status."});
      return;
    }

    try {
      const decoded = await requireHttpAuth(req);
      const paymentId = String(req.query?.paymentId || "").trim();
      if (!paymentId) {
        throw new HttpsError(
          "invalid-argument",
          "paymentId is required.",
        );
      }

      const paymentSnap = await admin.firestore().doc(`payments/${paymentId}`).get();
      if (!paymentSnap.exists) {
        throw new HttpsError("not-found", "Payment record not found.");
      }

      const paymentData = paymentSnap.data();
      if (paymentData.userId !== decoded.uid) {
        const requester = await getUserProfileOrThrow(decoded.uid);
        if (requester.role !== "admin") {
          throw new HttpsError(
            "permission-denied",
            "You can only view your own payment.",
          );
        }
      }

      const refreshed = await refreshPaymentStatus(paymentId, {skipIfNotDue: true});
      res.status(200).json(buildPaymentResponse(paymentId, refreshed));
    } catch (error) {
      console.error("apiMomoPaymentStatus error", {
        code: error?.code,
        message: error?.message,
      });
      res.status(httpStatusForError(error)).json({
        error: userFacingPaymentErrorMessage(
          error,
          "Could not read the payment status.",
        ),
      });
    }
  },
);

exports.autoPickDailyExams = autoPickDailyExams;

exports.pollPendingMomoPayments = onSchedule(
  {
    schedule: "every 5 minutes",
    region: "us-central1",
    timeoutSeconds: 540,
    secrets: MOMO_PAYMENT_SECRETS,
  },
  async () => {
    const pendingSnap = await admin.firestore()
      .collection("payments")
      .where("status", "==", "pending")
      .limit(25)
      .get();

    if (pendingSnap.empty) {
      console.log("pollPendingMomoPayments: no pending payments");
      return;
    }

    for (const doc of pendingSnap.docs) {
      try {
        const payment = doc.data();
        const nextCheckAt = toDate(payment.nextCheckAt);
        if (nextCheckAt && nextCheckAt > new Date()) {
          continue;
        }
        await refreshPaymentStatus(doc.id);
      } catch (error) {
        console.error("pollPendingMomoPayments item error", {
          paymentId: doc.id,
          code: error?.code,
          message: error?.message,
        });
      }
    }
  },
);

exports.explainAnswer = onCall(
  {secrets: [anthropicApiKey], region: "us-central1", timeoutSeconds: 30},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }

    const question = cleanAiString(request.data?.question, LIMITS.question);
    const correctAnswer = cleanAiString(
      request.data?.correctAnswer,
      LIMITS.answer,
    );
    if (!question || !correctAnswer) {
      throw new HttpsError(
        "invalid-argument",
        "Question and correct answer are required.",
      );
    }

    const role = await getUserRole(request.auth.uid);
    await assertDailyLimit(request.auth.uid, role, "explain");

    const {systemPrompt, messages} = toAnthropicShape(buildExplainMessages({
      ...request.data,
      question,
      correctAnswer,
    }));
    const explanation = await callAnthropic(getAnthropicApiKey(anthropicApiKey), {
      systemPrompt,
      messages,
      maxTokens: 400,
      temperature: 0.25,
      track: {uid: request.auth.uid, tool: "explainAnswer"},
    });

    return {explanation};
  },
);

exports.generateQuizQuestions = onCall(
  {secrets: [anthropicApiKey], region: "us-central1", timeoutSeconds: 45},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }

    const role = await getUserRole(request.auth.uid);
    if (!isStaffRole(role)) {
      throw new HttpsError(
        "permission-denied",
        "Only teachers and admins can generate quiz questions.",
      );
    }

    const subject = cleanAiString(request.data?.subject, LIMITS.subject);
    const grade = cleanAiString(request.data?.grade, LIMITS.grade);
    const topic = cleanAiString(request.data?.topic, LIMITS.topic);
    if (!subject || !grade || !topic) {
      throw new HttpsError(
        "invalid-argument",
        "Subject, grade, and topic are required.",
      );
    }

    await assertDailyLimit(request.auth.uid, role, "generateQuiz");

    // Resolve the authoritative CBC context for this (grade, subject, topic).
    // Matches the pipeline the other teacher tools use — pulls verified
    // sub-topics, Specific Outcomes, Key Competencies and Values from the
    // Firestore KB and in-code seed. Falls back to a grounded "use your CBC
    // knowledge" note if the topic isn't catalogued yet. kbWarning is a
    // human-readable heads-up (e.g. "Nearest verified topics: X, Y") that
    // the UI can surface to the teacher.
    const subtopic = cleanAiString(request.data?.subtopic, LIMITS.topic);
    const {contextBlock, kbWarning} = await resolveCbcContext({
      grade,
      subject,
      topic,
      subtopic,
    });

    const {messages: rawMessages} = buildQuizMessages({
      ...request.data,
      subject,
      grade,
      topic,
      subtopic,
      cbcContextBlock: contextBlock,
    });
    const {systemPrompt, messages} = toAnthropicShape(rawMessages);
    const raw = await callAnthropic(getAnthropicApiKey(anthropicApiKey), {
      systemPrompt,
      messages,
      maxTokens: 2000,
      temperature: 0.3,
      json: true,
      track: {uid: request.auth.uid, tool: "generateQuizQuestions"},
    });

    return {
      questions: parseGeneratedQuiz(raw, topic, {
        topic,
        subject,
        grade,
        subtopic,
      }),
      warning: kbWarning || null,
    };
  },
);

exports.structureImportedQuiz = onCall(
  {secrets: [anthropicApiKey], region: "us-central1", timeoutSeconds: 60},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }

    const role = await getUserRole(request.auth.uid);
    if (!isStaffRole(role)) {
      throw new HttpsError(
        "permission-denied",
        "Only teachers and admins can use smart quiz import.",
      );
    }

    const fileName = cleanAiString(
      request.data?.fileName,
      LIMITS.importFileName,
    );
    const documentText = cleanAiString(
      request.data?.documentText,
      LIMITS.importDocumentText,
    );
    const localDraft = cleanAiString(
      request.data?.localDraft,
      LIMITS.importLocalDraft,
    );

    if (!documentText || documentText.length < 120) {
      throw new HttpsError(
        "invalid-argument",
        "Not enough document text was available for smart import.",
      );
    }

    await assertDailyLimit(request.auth.uid, role, "smartImport");
    const {systemPrompt, messages} = toAnthropicShape(buildImportStructureMessages({
      fileName,
      documentText,
      localDraft,
    }));
    const raw = await callAnthropic(getAnthropicApiKey(anthropicApiKey), {
      systemPrompt,
      messages,
      maxTokens: 4000,
      temperature: 0.2,
      json: true,
      track: {uid: request.auth.uid, tool: "structureImportedQuiz"},
    });

    return parseStructuredImport(raw);
  },
);

exports.checkShortAnswer = onCall(
  {secrets: [anthropicApiKey], region: "us-central1", timeoutSeconds: 30},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }

    const question = cleanString(request.data?.question, MAX_LEN.question);
    const correctAnswer = cleanString(
      request.data?.correctAnswer,
      MAX_LEN.correctAnswer,
    );
    const studentAnswer = cleanString(
      request.data?.studentAnswer,
      MAX_LEN.studentAnswer,
    );
    const subject = cleanString(request.data?.subject, MAX_LEN.subject);
    const grade = cleanString(request.data?.grade, MAX_LEN.grade);

    if (!question || !studentAnswer) {
      throw new HttpsError(
        "invalid-argument",
        "Question and student answer are required.",
      );
    }

    const context = [grade ? `Grade ${grade}` : "", subject]
      .filter(Boolean)
      .join(", ");
    const systemPrompt =
      "You are a helpful exam marker for Zambian primary school students" +
      `${context ? ` (${context})` : ""}. ` +
      (correctAnswer
        ? "Mark answers as correct if they match the expected answer, including " +
          "minor spelling mistakes, synonyms, equivalent phrasing, or valid " +
          "abbreviations. " +
          TEACHER_MARKING_SCHEME
        : "No expected answer was provided. Use the question, grade, subject, " +
          "and standard primary-school knowledge to judge whether the student's " +
          "answer is factually correct. If the question is ambiguous, mark it " +
          "incorrect and tell the learner to review the question. ") +
      MARKING_EQUIVALENCES +
      "Always respond with only valid JSON. No prose, no code fences, just the JSON object.";

    const userPrompt = `Question: "${question}"
Expected answer: "${correctAnswer || "Not provided"}"
Student's answer: "${studentAnswer}"

Respond in this exact JSON format:
{"correct": true, "feedback": "Short encouraging message (max 15 words)"}
or
{"correct": false, "feedback": "Short explanation of correct answer (max 15 words)"}`;

    const raw = await callAnthropic(getAnthropicApiKey(anthropicApiKey), {
      systemPrompt,
      messages: [{role: "user", content: userPrompt}],
      maxTokens: 200,
      temperature: 0.1,
      json: true,
      track: {uid: request.auth.uid, tool: "markAnswer"},
    });
    return parseMarkerResponse(raw);
  },
);

// Teacher Tools — Zambian CBC Lesson Plan Generator.
exports.generateLessonPlan = createGenerateLessonPlan(anthropicApiKey);

// Teacher Tools — Zambian CBC Worksheet Generator.
exports.generateWorksheet = createGenerateWorksheet(anthropicApiKey);

// SSE-streaming variants of the two heaviest generators. The non-streaming
// callables (above) are kept as the fallback path — Capacitor and DEV use
// them. Browsers on web hit these instead so the user sees live progress
// instead of staring at a 15-30s spinner. Both endpoints emit:
//   data: {"type":"progress","phase":"queued|claude_started|token|claude_done","approxOutputTokens":N,"elapsedMs":N}
//   data: {"type":"result","lessonPlan|worksheet":{...},"generationId":"...","usage":{...},"warning":null,"kbGrounded":true}
//   data: [DONE]
// On error, before [DONE]:
//   data: [ERROR] {"error":"..."}
function makeStreamingEndpoint({tool, runCore}) {
  return onRequest(
    {secrets: [anthropicApiKey], region: "us-central1", timeoutSeconds: 120},
    async (req, res) => {
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");

      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }
      if (req.method !== "POST") {
        res.status(405).json({error: `Use POST for ${tool} streaming.`});
        return;
      }

      // Auth + role check before any SSE headers go out, so we can still
      // return a clean JSON error response.
      let uid;
      let apiKey;
      try {
        const token = (req.get("authorization") || "")
          .replace(/^Bearer\s+/i, "");
        if (!token) {
          throw new HttpsError("unauthenticated", "Please sign in first.");
        }
        const decoded = await admin.auth().verifyIdToken(token);
        uid = decoded.uid;
        const {getUserRole, isStaffRole} = require("./aiService");
        const role = await getUserRole(uid);
        if (!isStaffRole(role)) {
          throw new HttpsError(
            "permission-denied",
            "Teacher tools are available to approved teachers only.",
          );
        }
        const {getAnthropicApiKey} = require("./aiService");
        apiKey = getAnthropicApiKey(anthropicApiKey);
      } catch (error) {
        console.error(`api${tool} auth error`, {
          code: error?.code,
          message: error?.message,
        });
        res.status(httpStatusForError(error)).json({
          error: error?.message || "Sign-in required.",
        });
        return;
      }

      // Open the SSE stream.
      res.set("Content-Type", "text/event-stream; charset=utf-8");
      res.set("Cache-Control", "no-cache");
      res.set("Connection", "keep-alive");
      res.set("X-Accel-Buffering", "no");
      res.status(200);
      res.write(": connected\n\n");

      const startTime = Date.now();
      const writeEvent = (payload) => {
        try {
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        } catch (err) {
          console.warn(`api${tool} write failed`, err?.message);
        }
      };
      const onProgress = (p) => {
        writeEvent({
          type: "progress",
          ...p,
          elapsedMs: Date.now() - startTime,
        });
      };

      // Heartbeat every 5s — covers the gap between phase transitions
      // (especially "claude_started" → first "token" event, which can be
      // 2-3s on a cold cache) so proxies don't close idle connections.
      const heartbeat = setInterval(() => {
        try {
          res.write(": heartbeat\n\n");
        } catch (err) {
          // Connection already closed — clearInterval below handles it.
        }
      }, 5000);

      // Detect client disconnect so we don't keep doing work for a closed
      // connection. (The actual Anthropic call will still complete, but
      // we'll skip writes.)
      let clientGone = false;
      req.on("close", () => {
        clientGone = true;
      });

      try {
        const result = await runCore({
          uid,
          rawInputs: req.body || {},
          apiKey,
          onProgress: clientGone ? null : onProgress,
        });
        clearInterval(heartbeat);
        if (!clientGone) {
          writeEvent({type: "result", ...result});
          res.write("data: [DONE]\n\n");
        }
      } catch (error) {
        clearInterval(heartbeat);
        console.error(`api${tool} run error`, {
          code: error?.code,
          message: error?.message,
        });
        if (!clientGone) {
          res.write(`data: [ERROR] ${JSON.stringify({
            error: error?.message || "Generation failed. Please try again.",
            code: error?.code || "internal",
          })}\n\n`);
        }
      } finally {
        clearInterval(heartbeat);
        try {
          res.end();
        } catch {
          // already ended
        }
      }
    },
  );
}

exports.apiGenerateLessonPlan = makeStreamingEndpoint({
  tool: "GenerateLessonPlan",
  runCore: runLessonPlan,
});

exports.apiGenerateWorksheet = makeStreamingEndpoint({
  tool: "GenerateWorksheet",
  runCore: runWorksheet,
});

// Teacher Tools — Zambian CBC Flashcard Generator.
exports.generateFlashcards = createGenerateFlashcards(anthropicApiKey);

// Teacher Tools — Zambian CBC Scheme of Work Generator.
exports.generateSchemeOfWork = createGenerateSchemeOfWork(anthropicApiKey);

// Teacher Tools — Zambian CBC Rubric Generator.
exports.generateRubric = createGenerateRubric(anthropicApiKey);

// Teacher Tools — Notes Studio (teacher delivery notes).
exports.generateNotes = createGenerateNotes(anthropicApiKey);

// Teacher Tools — admin-only: import the built-in G1-9 topics into Firestore.
exports.importBuiltInCbcTopics = importBuiltInCbcTopics;

// Teacher Tools — Lesson Plan Studio (vanilla JS studio endpoint).
exports.studioGenerateLessonPlan = createStudioGenerateLessonPlan(anthropicApiKey);

// AI agents — runs the Content pipeline whenever a queued agentJobs doc
// lands (Aria → Cala → Reva → awaiting_approval), and runs Pubo when an
// admin flips status to "approved".
exports.agentJobsOnCreate = createAgentJobsOnCreate(anthropicApiKey);
exports.agentJobsOnApproved = createAgentJobsOnApproved();

// Quill — nightly QA smoke (Africa/Lusaka 02:00). Writes a summary
// agentJobs doc the /admin/agents dashboard surfaces in QA / Eng.
exports.nightlyQaSmoke = nightlyQaSmokeCron;

// Cala — weekly CBC-alignment audit (Africa/Lusaka Sunday 03:00).
// Re-runs Cala over a sample of recent aiGenerations to catch drift.
exports.weeklyCbcAlignmentAudit = weeklyCbcAlignmentAuditCron;

// Audit A5.2 — daily streak-reminder push (Africa/Lusaka 16:00).
// Targets learners who practised yesterday but not today, sends a friendly
// "keep your streak alive" FCM push, and prunes dead tokens in-flight.
// Reads users.fcmTokens populated by A5.1's client-side registerToken.
exports.dailyStreakReminders = dailyStreakRemindersCron;

// Audit C4 — refresh publicStats/global every 30 minutes so the
// marketing page can render real numbers (learners, quizzes taken,
// games played this week) to anonymous visitors. Aggregate counts via
// admin SDK; rules expose the resulting doc as public-read.
exports.updatePublicStats = updatePublicStatsCron;

// Audit A10 — teacher classroom roster.
// generateClassInvite mints + rotates an 8-char join code (admin SDK).
// joinClassByCode adds the calling learner to classes/{classId}.learners
// after validating the code; bypasses the teacher-owner-only update rule.
// removeLearnerFromClass is the teacher-side counterpart for kicking.
exports.generateClassInvite = generateClassInvite;
exports.joinClassByCode = joinClassByCode;
exports.removeLearnerFromClass = removeLearnerFromClass;
exports.leaveClass = leaveClass;
// A10 PR 3 — assignments. Validate caller owns the class, denormalise
// resource title / subject onto the assignment doc so the learner-side
// "From your teacher" card renders without a second read per row.
exports.createClassAssignment = createClassAssignment;
exports.removeClassAssignment = removeClassAssignment;
// A10 PR 4 — per-class stats for the teacher dashboard. Bounded reads
// (30-day window, first 200 learners, 25 most-recent assignments) with
// graceful index-fallback so the first deploy still renders something.
exports.getClassStats = getClassStats;

// A10 PR 5 — per-assignment drill-down. Returns a roster with each
// learner's completion status + best score for one specific
// assignment. Owner-gated; admin SDK bypasses results-read + user-doc
// rules so a teacher can see who hasn't started a published quiz
// they didn't author.
exports.getAssignmentCompletion = getAssignmentCompletion;

// A3 PR 1 — parent portal. Learner self-issues a share link that
// renders a 30-day progress summary at /parent/:token (no parent
// account required). getProgressShare is intentionally PUBLIC —
// the token IS the permission, mirroring the existing /shares
// pattern.
exports.createProgressShare = createProgressShare;
exports.revokeProgressShare = revokeProgressShare;
exports.getProgressShare = getProgressShare;

// A3 PR 2 — weekly digest cron. Sunday 09:00 Africa/Lusaka. Fans out
// a 7-day email summary to every progressShare with parentEmail set,
// skips revoked / expired / already-sent-this-week, and skips empty
// weeks (no point training parents to ignore us). Audit ledger lives
// in parentDigestEvents/{eventId}.
exports.weeklyParentDigest = weeklyParentDigest;

// Audit D4 — self-serve subscription cancellation. Toggles
// users.{uid}.cancelAtPeriodEnd via admin SDK so the field stays
// server-only (firestore rules block self-update on subscription
// fields). Used by the Cancel/Reactivate buttons on ProfilePage.
exports.setSubscriptionCancellation = require("./subscriptionLifecycle").setSubscriptionCancellation;

exports.apiTextToSpeech = require('./tts').apiTextToSpeech;
