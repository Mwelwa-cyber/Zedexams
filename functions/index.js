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
// Gemini REST client — used by the structureImportedQuiz pipeline.
const {callGemini} = require("./geminiClient");
const {applyCors} = require("./cors");

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
// Past Paper Studio — AI question importer (vision over scanned pages).
const {
  createImportPastPaperQuestions,
} = require("./teacherTools/pastPaperImport");
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
const {
  createGenerateFullLesson,
} = require("./teacherTools/generateFullLesson");
const {
  createGenerateHomework,
} = require("./teacherTools/generateHomework");
const {
  createGenerateAssessment,
} = require("./teacherTools/generateAssessment");
const {
  createGenerateQuiz,
} = require("./teacherTools/generateQuiz");
// Teacher Tools — Diagram Generator (Recraft, B&W line art for assessments).
const {
  createGenerateDiagram,
} = require("./teacherTools/generateDiagram");
// Teacher Tools — Suggest Answer (per-question AI answer hint for the studio).
const {
  createSuggestAnswer,
} = require("./teacherTools/suggestAnswer");
// Teacher Tools — Revise Question (rewrite for grade level / tone).
const {
  createReviseQuestion,
} = require("./teacherTools/reviseQuestion");
// Teacher Tools — Lesson Plan Studio (vanilla JS studio, free-form prompts).
const {
  createStudioGenerateLessonPlan,
} = require("./teacherTools/studioLessonPlan");
// Teacher Tools — import built-in CBC topics into Firestore (admin-only).
const {
  importBuiltInCbcTopics,
} = require("./teacherTools/importBuiltInCbcTopics");
// Teacher Tools — bulk import lesson-level curriculum modules (admin-only).
const {
  importCurriculumModules,
} = require("./teacherTools/importCurriculumModules");
// Teacher Tools — admin-only callables that surface modules staged by
// the curriculumWatcher ingester and promote them into cbcKnowledgeBase.
const {
  listStagedCurriculumModules,
  promoteIngestedCurriculumModule,
  promoteIngestedCurriculumModuleWithAi,
  rejectIngestedCurriculumModule,
  runCurriculumWatcherNow,
} = require("./teacherTools/promoteIngestedCurriculumModule");
// Teacher Tools — admin-only preflight that asks the strict learner-AI
// resolver whether a given grade/subject/topic/subtopic/term would be
// accepted before the admin queues a task in the Live AI Monitor.
const {
  preflightCurriculumRef,
} = require("./teacherTools/preflightCurriculumRef");
// Teacher Tools — admin-only one-click linker that runs the same logic
// as scripts/backfill-kb-source-refs.mjs from the Live AI Monitor, so
// admins can attach approvedSyllabi to lesson modules without a shell.
const {
  backfillKbSourceRefs,
} = require("./teacherTools/backfillKbSourceRefs");
// CBC knowledge base — used to ground AI quiz questions in the Zambian
// syllabus. resolveCbcContext returns a rendered <cbc_context> block plus
// a human-readable warning if the topic wasn't found in the verified KB.
const {
  resolveCbcContext,
} = require("./teacherTools/cbcKnowledge");
// Vex — Quiz Verifier runner (synchronous, not part of the agentJobs pipeline).
const {runVex} = require("./agents/runners/vex");
// Daily Exam auto-picker — promotes one short-quiz per grade into the
// day's Daily Exam slot every morning so the admin no longer has to
// click "Daily Exam" by hand for routine rotation.
const {autoPickDailyExams} = require("./dailyExamPicker");
const {
  getExamQuestions: getExamQuestionsFn,
  submitDailyExam: submitDailyExamFn,
} = require("./dailyExamGradingFns");

// AI agents — Phase 2 dispatcher (Content department: Aria → Cala → Reva → Pubo).
const {
  createAgentJobsOnCreate,
  createAgentJobsOnApproved,
  runFromCala,
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
// Audit B4 follow-up — daily AI-cost summary cron (Africa/Lusaka 02:00).
const {aiCostDailySummary} = require("./aiCostDailySummary");
// Audit A10 — teacher classroom roster (invite codes + join + remove + leave + assignments).
const {
  generateClassInvite,
  joinClassByCode,
  approveLearner,
  declineLearner,
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
// Audit A3 PR 3 — admin-only manual trigger to verify Meta WhatsApp
// wiring without waiting for the Sunday tick.
const {
  weeklyParentDigest,
  triggerWeeklyParentDigest,
} = require("./weeklyParentDigest");
// Audit C7 PR 1 follow-up — admin-only backfill for users who signed
// up before referralCode minting shipped. Runnable from the Firebase
// Console "test function" panel; iterates in 500-user batches and is
// idempotent so the operator can run it repeatedly until drained.
const {backfillReferralCodes} = require("./referralBackfill");
// Audit C6 — public newsletter signup. List builder; export to a real
// sending platform (Buttondown / Mailchimp / Beehiiv) when ready.
const {subscribeToNewsletter} = require("./newsletter");

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");
const emailSmtpUser = defineSecret("EMAIL_SMTP_USER");
const emailSmtpPassword = defineSecret("EMAIL_SMTP_PASSWORD");
const recraftApiKey = defineSecret("RECRAFT_API_KEY");
// Optional. When set, structureImportedQuiz uses a Gemini → Claude pipeline:
// Gemini 2.5 Flash ingests the full document (1M-context strength) and emits
// rough question candidates; Claude refines them into CBC-aligned output.
// When unset, the callable falls back to the original Claude-only path so
// the feature keeps working without forcing a secret rotation.
const geminiApiKey = defineSecret("GEMINI_API_KEY");
// Optional. When set, generateDiagram exposes a "photoreal" style toggle
// that routes through OpenAI gpt-image-1 instead of Recraft. Recraft is
// still the default for B&W line art (cleaner on photocopiers). When
// unset, the photoreal toggle is hidden and Recraft handles everything.
const openaiApiKey = defineSecret("OPENAI_API_KEY");
const MAX_LEN = {
  question: 1200,
  correctAnswer: 600,
  studentAnswer: 600,
  subject: 80,
  grade: 20,
};
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

// Browser CORS via the shared origin allow-list (functions/cors.js).
// req is needed to read the Origin header — pass it at every call site.
function setCorsHeaders(res, req) {
  applyCors(req, res);
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

// Audit B3 follow-up — App Check coverage on AI callables.
//
// Read once at module load. Toggling enforcement is a redeploy with
// APPCHECK_ENFORCE=1 set; no code change needed. Defaults OFF so the
// next deploy doesn't break existing clients before they propagate
// the App Check init from #317.
const APPCHECK_ENFORCE_CALLABLE = process.env.APPCHECK_ENFORCE === "1";

/**
 * Mirror of softVerifyAppCheckHttp for v2 onCall handlers — bumps
 * appCheckHealth/{date}.{label}_* counters so /admin gets per-
 * callable telemetry, not just apiAiChat.
 *
 * v2 onCall populates `request.app` with the verified token claims
 * when a token was sent; absent when not. We don't re-verify here
 * (that's already done by the runtime); we just record the outcome.
 *
 * Always best-effort. Never throws — accounting must not block the
 * AI flow.
 */
async function recordAppCheckCallable(request, label) {
  const verified = !!request.app;
  // The runtime already rejected unverified calls when
  // enforceAppCheck is on, so a missing request.app on an
  // enforce-on callable means we're in observability-only mode.
  // Treat absent token as "missing" rather than "invalid" — there's
  // no way to distinguish the two at this layer.
  try {
    const date = new Date().toISOString().slice(0, 10);
    const ref = admin.firestore().collection("appCheckHealth").doc(date);
    const inc = (n) => admin.firestore.FieldValue.increment(n);
    await ref.set({
      date,
      [`${label}_attempts`]: inc(1),
      [`${label}_valid`]: inc(verified ? 1 : 0),
      [`${label}_missing`]: inc(verified ? 0 : 1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  } catch (err) {
    console.warn(`[appCheck:${label}] callable health write failed`, err?.message || err);
  }
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

// ── Password-reset abuse controls ────────────────────────────────────
// This endpoint is public (must work while logged out). Two daily caps,
// mirroring subscribeToNewsletter's best-effort counter pattern:
//   - per email  → stops bombing one victim's inbox with reset mails
//   - per IP     → stops one source spraying / enumerating many addresses
const PWRESET_RL_COLLECTION = "passwordResetRateLimit";
const PWRESET_MAX_PER_EMAIL_PER_DAY = 5;
const PWRESET_MAX_PER_IP_PER_DAY = 15;

function passwordResetDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10); // UTC civil day
}

// Returns true if either the email or IP bucket is already at its cap.
// Best-effort: a counter read/write failure never blocks a real reset.
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

exports.sendPasswordResetEmail = onCall(
  {secrets: [emailSmtpUser, emailSmtpPassword], region: "us-central1", timeoutSeconds: 30},
  async (request) => {
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
);

exports.aiChat = onCall(
  {
    secrets: [anthropicApiKey],
    region: "us-central1",
    timeoutSeconds: 30,
    enforceAppCheck: APPCHECK_ENFORCE_CALLABLE,
    consumeAppCheckToken: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }
    recordAppCheckCallable(request, "aiChat");

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
});

// Admin-only — sends an activation confirmation to the customer's
// WhatsApp via the Meta Cloud API helper that's already wired for the
// parent digest (functions/metaWhatsApp.js). Soft-fails when the Meta
// secrets aren't bound so local dev still works; the admin UI falls
// back to the copy-paste WhatsApp deep link in that case.
exports.sendActivationConfirmation = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
  secrets: [...require("./metaWhatsApp").WHATSAPP_SECRETS],
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
});

// Admin-only — sends renewal nudges via WhatsApp to learners whose
// subscription expires soon (next 3 days) or recently lapsed (last 14
// days). Idempotent on a 20-hour cooldown: each user gets at most one
// reminder per day even if the button is clicked repeatedly.
//
// Returns a summary so the admin can see how many sends fired vs.
// were skipped (no phone on file, cooldown, Meta-not-configured).
exports.sendExpiryReminders = onCall({
  region: "us-central1",
  timeoutSeconds: 120,
  memory: "256MiB",
  secrets: [...require("./metaWhatsApp").WHATSAPP_SECRETS],
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
});

exports.apiAiChat = onRequest(
  {secrets: [anthropicApiKey], region: "us-central1", timeoutSeconds: 60},
  async (req, res) => {
    // Browser CORS via the shared origin allow-list. The default header
    // set already includes X-Firebase-AppCheck (Audit B3).
    applyCors(req, res);

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

exports.autoPickDailyExams = autoPickDailyExams;
exports.getExamQuestions = getExamQuestionsFn;
exports.submitDailyExam = submitDailyExamFn;

exports.explainAnswer = onCall(
  {
    secrets: [anthropicApiKey],
    region: "us-central1",
    timeoutSeconds: 30,
    enforceAppCheck: APPCHECK_ENFORCE_CALLABLE,
    consumeAppCheckToken: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }
    recordAppCheckCallable(request, "explainAnswer");

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
  {
    secrets: [anthropicApiKey],
    region: "us-central1",
    timeoutSeconds: 45,
    enforceAppCheck: APPCHECK_ENFORCE_CALLABLE,
    consumeAppCheckToken: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }
    recordAppCheckCallable(request, "generateQuizQuestions");

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

// Vex — pre-publish quiz verifier. Synchronous: the editor calls this and
// blocks the publish flow on its result. No agentJobs / aiGenerations writes.
exports.verifyQuiz = onCall(
  {secrets: [anthropicApiKey], region: "us-central1", timeoutSeconds: 60,
    memory: "512MiB"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }
    const role = await getUserRole(request.auth.uid);
    if (!isStaffRole(role)) {
      throw new HttpsError(
        "permission-denied",
        "Only teachers and admins can verify quizzes.",
      );
    }
    await assertDailyLimit(request.auth.uid, role, "verifyQuiz");

    const data = request.data || {};
    const questions = Array.isArray(data.questions) ? data.questions : [];
    const passages = Array.isArray(data.passages) ? data.passages : [];
    if (!questions.length) {
      throw new HttpsError(
        "invalid-argument",
        "No questions to verify.",
      );
    }
    if (questions.length > 50) {
      throw new HttpsError(
        "invalid-argument",
        "Quiz too large to verify (max 50 questions).",
      );
    }
    let payloadSize;
    try {
      payloadSize = JSON.stringify(questions).length +
        JSON.stringify(passages).length;
    } catch {
      throw new HttpsError("invalid-argument", "Quiz payload is not serialisable.");
    }
    if (payloadSize > 60_000) {
      throw new HttpsError(
        "invalid-argument",
        "Quiz payload too large — trim long questions before verifying.",
      );
    }

    // Sanitise passages. Image URLs must be https — Anthropic fetches them
    // server-side, and any non-https reference is ignored. We deliberately
    // do not download images here; passing the URL keeps the payload small.
    const cleanedPassages = passages.slice(0, 20).map((p) => {
      const rawUrl = typeof p?.imageUrl === "string" ? p.imageUrl.trim() : "";
      const imageUrl = /^https:\/\//i.test(rawUrl) ? rawUrl : null;
      return {
        id: cleanAiString(p?.id, 80),
        title: cleanAiString(p?.title, 200),
        passageKind: p?.passageKind === "map" ? "map" : "comprehension",
        instructions: cleanAiString(p?.instructions, 1500),
        passageText: cleanAiString(p?.passageText, 4000),
        imageUrl,
      };
    }).filter((p) => p.id);

    const meta = data.meta || {};
    const grade = cleanAiString(meta.grade, LIMITS.grade);
    const subject = cleanAiString(meta.subject, LIMITS.subject);
    const topic = cleanAiString(meta.topic, LIMITS.topic);
    const subtopic = cleanAiString(meta.subtopic, LIMITS.topic);
    const difficulty = cleanAiString(meta.difficulty, 24);

    let cbcContextBlock = "";
    try {
      const cbc = await resolveCbcContext({grade, subject, topic, subtopic});
      cbcContextBlock = cbc?.contextBlock || "";
    } catch (err) {
      console.warn("verifyQuiz: CBC context unavailable", err?.message);
    }

    return await runVex({
      input: {
        quizId: cleanAiString(data.quizId, 80),
        questions,
        passages: cleanedPassages,
        meta: {grade, subject, topic, subtopic, difficulty},
        cbcContextBlock,
      },
      anthropicApiKeySecret: anthropicApiKey,
    });
  },
);

exports.structureImportedQuiz = onCall(
  {
    secrets: [anthropicApiKey, geminiApiKey],
    region: "us-central1",
    timeoutSeconds: 90, // pipeline calls two models; allow extra headroom
    enforceAppCheck: APPCHECK_ENFORCE_CALLABLE,
    consumeAppCheckToken: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }
    recordAppCheckCallable(request, "structureImportedQuiz");

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

    // Pipeline (when GEMINI_API_KEY is present):
    //   Step 1 — Gemini 2.5 Flash ingests the full document (1M context)
    //            and emits rough question candidates as JSON.
    //   Step 2 — Claude refines those candidates into the final CBC-
    //            aligned shape using the existing system prompt.
    //
    // Fallback (when GEMINI_API_KEY is missing):
    //   Skip step 1 entirely; Claude reads the raw document directly
    //   exactly as it always has. This means the feature keeps working
    //   without the new secret being rotated in.
    const geminiKey = geminiApiKey.value() || process.env.GEMINI_API_KEY || "";
    let claudeInputDocument = documentText;
    let claudeInputHint = localDraft;
    if (geminiKey) {
      try {
        const geminiText = await callGemini(geminiKey, {
          systemPrompt: [
            "You are a document scanner for the ZedExams smart-import pipeline.",
            "Read the raw exam document below and emit a STRUCTURED JSON list",
            "of every question you can find, in the order they appear.",
            "Prefer recall over precision — include any uncertain candidates;",
            "a downstream CBC reviewer will refine and drop bad ones.",
            "For each question, group passages with their child questions.",
            "Do NOT invent questions or answers. Return only the JSON object",
            "described below — no markdown, no preamble.",
          ].join(" "),
          userPrompt: [
            fileName ? `File name: ${fileName}` : "",
            "",
            "Raw document text:",
            documentText,
            "",
            "Return JSON in this shape:",
            "{\"candidates\":[",
            "  {\"sourceQuestionNumber\":1,\"text\":\"...\",\"options\":[\"\",\"\",\"\",\"\"],",
            "   \"correctAnswer\":\"\",\"explanation\":\"\",\"passageTitle\":\"\",",
            "   \"passageText\":\"\"}",
            "]}",
          ].filter(Boolean).join("\n"),
          maxTokens: 6000,
          temperature: 0.1,
          responseJson: true,
        });
        // Pass Gemini's structured extraction to Claude as the
        // localDraft hint, alongside the original raw text. Claude sees
        // both and can correct any mistakes the first pass made.
        claudeInputHint = `Pre-structured extraction (use to anchor question grouping, but verify against the raw document above): ${geminiText.slice(0, 60000)}`;
        // Defensive: if Gemini's output is empty/blank we keep the
        // hint as the original localDraft.
        if (!geminiText.trim()) claudeInputHint = localDraft;
      } catch (geminiErr) {
        // Pipeline failure: fall back to single-pass Claude rather
        // than failing the whole import. Log so we notice if Gemini
        // is consistently misbehaving.
        console.warn("structureImportedQuiz: Gemini step failed, falling back to Claude-only", {
          message: geminiErr?.message?.slice(0, 200),
        });
      }
    }

    const {systemPrompt, messages} = toAnthropicShape(buildImportStructureMessages({
      fileName,
      documentText: claudeInputDocument,
      localDraft: claudeInputHint,
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
  {
    secrets: [anthropicApiKey],
    region: "us-central1",
    timeoutSeconds: 30,
    enforceAppCheck: APPCHECK_ENFORCE_CALLABLE,
    consumeAppCheckToken: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }
    recordAppCheckCallable(request, "checkShortAnswer");

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
      // Browser CORS via the shared origin allow-list (functions/cors.js).
      applyCors(req, res);

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

// Past Paper Studio — AI MCQ importer (vision over scanned pages).
exports.importPastPaperQuestions =
  createImportPastPaperQuestions(anthropicApiKey);

// Teacher Tools — Zambian CBC Scheme of Work Generator.
exports.generateSchemeOfWork = createGenerateSchemeOfWork(anthropicApiKey);

// Teacher Tools — Zambian CBC Rubric Generator.
exports.generateRubric = createGenerateRubric(anthropicApiKey);

// Teacher Tools — Notes Studio (teacher delivery notes).
exports.generateNotes = createGenerateNotes(anthropicApiKey);

// Teacher Tools — Full Lesson (complete, ready-to-deliver CBC lesson).
exports.generateFullLesson = createGenerateFullLesson(anthropicApiKey);

// Teacher Tools — Homework (short curriculum-grounded take-home practice).
exports.generateHomework = createGenerateHomework(anthropicApiKey);

// Teacher Tools — Assessment (formal curriculum-grounded graded test).
exports.generateAssessment = createGenerateAssessment(anthropicApiKey);

// Teacher Tools — Quiz (short curriculum-grounded formative quiz).
exports.generateQuiz = createGenerateQuiz(anthropicApiKey);

// Teacher Tools — Diagram Generator (Recraft, B&W line art for assessments).
// When OPENAI_API_KEY is set, generateDiagram exposes a photoreal style
// toggle that routes through gpt-image-1. Recraft remains the default
// for line-art. The factory takes both secrets so the handler can route
// per-request at runtime.
exports.generateDiagram = createGenerateDiagram(recraftApiKey, openaiApiKey);

// Teacher Tools — Suggest Answer (per-question AI answer hint, Haiku).
// When GEMINI_API_KEY is set, suggestAnswer routes image-bearing questions
// to Gemini Vision so the model can actually *see* the diagram/map/table
// it's being asked about. Without the secret it falls back to Claude
// text-only (the existing behaviour).
exports.suggestAnswer = createSuggestAnswer(anthropicApiKey, geminiApiKey);

// Teacher Tools — Revise Question (rewrite for grade level / tone, Haiku).
exports.reviseQuestion = createReviseQuestion(anthropicApiKey);

// Teacher Tools — admin-only: import the built-in G1-9 topics into Firestore.
exports.importBuiltInCbcTopics = importBuiltInCbcTopics;

// Teacher Tools — admin-only: bulk import lesson-level curriculum modules.
exports.importCurriculumModules = importCurriculumModules;

// Teacher Tools — admin-only: surface modules staged by curriculumWatcher
// and promote them (one click) into cbcKnowledgeBase. See
// teacherTools/promoteIngestedCurriculumModule.js for the doc rules.
exports.listStagedCurriculumModules = listStagedCurriculumModules;
exports.promoteIngestedCurriculumModule = promoteIngestedCurriculumModule;
exports.promoteIngestedCurriculumModuleWithAi = promoteIngestedCurriculumModuleWithAi;
exports.rejectIngestedCurriculumModule = rejectIngestedCurriculumModule;
// Manual trigger so admins can verify ingestion without waiting for
// curriculumUpdateCheckerScheduled's 02:00 UTC cron.
exports.runCurriculumWatcherNow = runCurriculumWatcherNow;

// Teacher Tools — admin-only: preflight a (grade, subject, topic,
// subtopic, term) tuple against the strict learner-AI curriculum
// resolver. Used by the Live AI Monitor's batch-generate form to
// disable subtopics that would fail the no_source_doc_ref / no
// _curriculum_match gate before the admin presses Queue.
exports.preflightCurriculumRef = preflightCurriculumRef;

// Teacher Tools — admin-only: backfill sourceDocId on every lesson
// module under the active KB version by matching against approvedSyllabi
// rows. Surfaced as the "Backfill syllabus links" button on the Live
// AI Monitor when the preflight grid is dominated by no_source_doc_ref.
exports.backfillKbSourceRefs = backfillKbSourceRefs;

// Syllabus replacement — Phase A. Storage onFinalize parser. Watches
// syllabus-uploads/{version}/{filename}.xlsx and writes enriched draft
// topics + scheme-of-work pacing to cbcKnowledgeBase/{version}/draftTopics
// and /pacing. Drafts are intentionally separate from the live topics/*
// subcollection — Phase C will add the approve-and-activate flow.
const {
  parseSyllabusUpload,
} = require("./teacherTools/parseSyllabusUpload");
exports.parseSyllabusUpload = parseSyllabusUpload;

// Syllabus replacement — Phase B. Admin-only callable that bumps
// cbcKnowledgeBase/_meta.cacheBust so every warm container refreshes its
// CBC topic + active-version + RAG caches. Used after a Phase C activate
// or a Phase D rollback to make the switch observable in seconds.
const {
  invalidateKbCacheCallable,
} = require("./teacherTools/invalidateKbCache");
exports.invalidateKbCache = invalidateKbCacheCallable;

// Syllabus replacement — Phase C. Atomic promote-and-activate. Promotes
// cbcKnowledgeBase/{version}/draftTopics → topics (merge:true) and flips
// cbcKnowledgeBase/_meta to the new version with usePrivateCurriculum=false
// so studios cut over fully to the new editable KB. Old version's topics
// remain in place as a one-click Phase D rollback target.
const {
  activateSyllabusVersion,
} = require("./teacherTools/activateSyllabusVersion");
exports.activateSyllabusVersion = activateSyllabusVersion;

// Syllabus replacement — Phase D. One-click rollback. Flips
// cbcKnowledgeBase/_meta back to the previousVersion captured during
// the most recent activate, restores usePrivateCurriculum=true, and
// bumps cacheBust. No data movement — the previous version's topics
// were left in place by activateSyllabusVersion exactly for this case.
const {
  rollbackSyllabusVersion,
} = require("./teacherTools/rollbackSyllabusVersion");
exports.rollbackSyllabusVersion = rollbackSyllabusVersion;

// Syllabus replacement — Phase E. Admin-only cleanup of leftover data
// the migration archived. Three modes: "audit" (read-only counts),
// "delete-rag" (curriculum/* + rag_chunks/*), and "delete-version"
// (a single old cbcKnowledgeBase/{v}/topics/* tree). Safety checks
// refuse destructive ops while the system still needs the data —
// see the file header for details.
const {
  cleanupArchivedSyllabusData,
} = require("./teacherTools/cleanupArchivedSyllabusData");
exports.cleanupArchivedSyllabusData = cleanupArchivedSyllabusData;

// Teacher Tools — Lesson Plan Studio (vanilla JS studio endpoint).
exports.studioGenerateLessonPlan = createStudioGenerateLessonPlan(anthropicApiKey);

// AI agents — runs the Content pipeline whenever a queued agentJobs doc
// lands (Aria → Cala → Reva → awaiting_approval), and runs Pubo when an
// admin flips status to "approved".
exports.agentJobsOnCreate = createAgentJobsOnCreate(anthropicApiKey);
exports.agentJobsOnApproved = createAgentJobsOnApproved();

// Platform Health — admin diagnostics for the agent pipeline.
const {
  createGetPlatformHealth,
  createInitializeAgentPipeline,
  createRunSampleAgentJob,
} = require("./agents/platformHealth");
exports.getPlatformHealth = createGetPlatformHealth(anthropicApiKey);
exports.initializeAgentPipeline = createInitializeAgentPipeline();
exports.runSampleAgentJob = createRunSampleAgentJob();

// CBC KB — extract topics from an admin-uploaded syllabus PDF via Claude.
// Complements parseSyllabusUpload (XLSX-only Storage trigger) for the
// PDF source files most CDC syllabi ship as.
const {
  createExtractTopicsFromPdf,
} = require("./teacherTools/extractTopicsFromPdf");
exports.extractTopicsFromPdf = createExtractTopicsFromPdf(anthropicApiKey);

/**
 * Admin-only callable: re-runs Cala (and Reva) on a job that previously
 * failed at the Cala step. Safe because Cala is deterministic and costs
 * nothing — there is no Anthropic call on the Cala path, so re-running
 * doesn't burn budget. Reva DOES re-run if Cala succeeds, so the daily
 * cap is re-checked against the job owner (not the admin) to keep cost
 * accounting consistent.
 *
 * Preconditions enforced server-side:
 *   - caller is admin
 *   - job exists and status === "failed"
 *   - job.output.aria.draft is present (Aria must have completed)
 *
 * Failures land in agentJobs.error as before; success leaves the job
 * in awaiting_approval for admin review.
 */
exports.retryAgentJob = onCall(
  {
    secrets: [anthropicApiKey],
    region: "us-central1",
    timeoutSeconds: 300,
    memory: "512MiB",
    enforceAppCheck: APPCHECK_ENFORCE_CALLABLE,
    consumeAppCheckToken: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }
    recordAppCheckCallable(request, "retryAgentJob");

    const role = await getUserRole(request.auth.uid);
    if (role !== "admin") {
      throw new HttpsError("permission-denied", "Admins only.");
    }

    const jobId = typeof request.data?.jobId === "string" ?
      request.data.jobId.trim() : "";
    if (!jobId) {
      throw new HttpsError("invalid-argument", "jobId is required.");
    }

    const ownerUid = request.auth.uid;
    const db = admin.firestore();
    const ref = db.collection("agentJobs").doc(jobId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", `agentJobs/${jobId} not found.`);
    }
    const job = {id: jobId, ...(snap.data() || {})};

    if (job.status !== "failed") {
      throw new HttpsError(
        "failed-precondition",
        `Retry only allowed on failed jobs; status is ${job.status}.`,
      );
    }
    const draft = job.output && job.output.aria && job.output.aria.draft;
    if (!draft) {
      throw new HttpsError(
        "failed-precondition",
        "Aria has not produced a draft yet — there is nothing for Cala to check.",
      );
    }

    // Clear the failure marker before the resume, otherwise the UI keeps
    // showing the stale Cala/Reva error while the new run is in flight.
    await ref.set({
      status: "running",
      agentId: "cala",
      error: admin.firestore.FieldValue.delete(),
      retryRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
      retryRequestedBy: ownerUid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});

    try {
      await runFromCala({jobId, anthropicApiKeySecret: anthropicApiKey});
    } catch (err) {
      // runFromCala already writes status='failed' on its own catch
      // branches; this catches a true unexpected throw (firestore down,
      // etc). Re-stamp the error so the admin sees something.
      console.error("retryAgentJob: unexpected throw", err);
      throw new HttpsError(
        "internal",
        `Retry failed unexpectedly: ${String(err && err.message || err).slice(0, 300)}`,
      );
    }

    return {ok: true};
  },
);

// Learner-AI agents — a parallel pipeline for learner-facing artifacts
// (practice quizzes, exam drafts, notes, study tips, weakness reports,
// feedback). Runs off the `aiAgentTasks` collection, never writes to
// the existing `quizzes` collection, requires admin approval before
// any artifact's visibility flips to published. The two reference
// agents (Supervisor + Curriculum Reader) are fully implemented; the
// other nine ship as wired stubs that produce real artifacts so the
// pipeline is observable end-to-end today.
const {
  createAiAgentTasksOnCreate,
  createAiAgentTasksOnApproved,
} = require("./agents/learnerAi/dispatcher");
const {
  createAiAgentHealthCheckScheduled,
  createCurriculumUpdateCheckerScheduled,
} = require("./agents/learnerAi/healthCheck");
const {
  createCurriculumUpdateReportsOnApproved,
} = require("./agents/learnerAi/curriculumApprover");
exports.aiAgentTasksOnCreate = createAiAgentTasksOnCreate();
exports.aiAgentTasksOnApproved = createAiAgentTasksOnApproved();
exports.aiAgentHealthCheckScheduled = createAiAgentHealthCheckScheduled();
exports.curriculumUpdateCheckerScheduled = createCurriculumUpdateCheckerScheduled();
exports.curriculumUpdateReportsOnApproved = createCurriculumUpdateReportsOnApproved();

// Storage cleanup — cascade-deletes Storage blobs when their parent
// Firestore docs are deleted, removes orphans left by image/file swaps,
// wipes a deleted user's storage tree, and runs a daily orphan sweep.
// See functions/storageCleanup/index.js.
const storageCleanup = require("./storageCleanup");
exports.onLessonDeleted = storageCleanup.onLessonDeleted;
exports.onLessonUpdated = storageCleanup.onLessonUpdated;
exports.onQuizQuestionDeleted = storageCleanup.onQuizQuestionDeleted;
exports.onQuizQuestionUpdated = storageCleanup.onQuizQuestionUpdated;
exports.onAssessmentQuestionDeleted = storageCleanup.onAssessmentQuestionDeleted;
exports.onAssessmentQuestionUpdated = storageCleanup.onAssessmentQuestionUpdated;
exports.onUserDeleted = storageCleanup.onUserDeleted;
exports.orphanStorageReaper = storageCleanup.orphanStorageReaper;

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
// joinClassByCode adds the calling learner to classes/{classId}.pendingLearners
// after validating the code; teacher then promotes via approveLearner /
// rejects via declineLearner. Bypasses the teacher-owner-only update rule.
// removeLearnerFromClass is the teacher-side counterpart for kicking.
exports.generateClassInvite = generateClassInvite;
exports.joinClassByCode = joinClassByCode;
exports.approveLearner = approveLearner;
exports.declineLearner = declineLearner;
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

// B4 follow-up — daily AI cost summary. Runs 02:00 Africa/Lusaka,
// summarises yesterday's spend, and emails ADMIN_EMAILS when
// yesterday > 2× the 7-day median. Always writes an agentJobs
// rollup so /admin/agents shows the run alongside the other crons.
exports.aiCostDailySummary = aiCostDailySummary;

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
// in parentDigestEvents/{eventId}. PR 3 also runs a parallel WhatsApp
// channel via Meta WhatsApp Cloud API (soft-fails when META_WHATSAPP_*
// secrets aren't set).
exports.weeklyParentDigest = weeklyParentDigest;

// A3 PR 3 — admin-only callable that runs the same digest body on
// demand. Useful for verifying Meta WhatsApp wiring without waiting
// for the Sunday cron. Accepts { force, targetTokens } so an admin
// can target a specific test share and bypass the 5-day idempotency
// stamp. Returns the summary so the caller can see exactly what
// happened.
exports.triggerWeeklyParentDigest = triggerWeeklyParentDigest;

// C6 — public newsletter signup. Validated + deduped + rate-limited
// + honeypot-protected. Public (no auth) so the marketing-page form
// can call it; abuse vectors mitigated server-side.
exports.subscribeToNewsletter = subscribeToNewsletter;

// C7 PR 1 follow-up — admin-only one-shot backfill. Mints
// referralCode + writes referralCodes/{code} for every user signed
// up before PR #354. Idempotent: skips users that already have a
// code. Operator runs repeatedly (Firebase Console test panel)
// until summary.scanned === summary.skipped.
exports.backfillReferralCodes = backfillReferralCodes;

// Audit D4 — self-serve subscription cancellation. Toggles
// users.{uid}.cancelAtPeriodEnd via admin SDK so the field stays
// server-only (firestore rules block self-update on subscription
// fields). Used by the Cancel/Reactivate buttons on ProfilePage.
exports.setSubscriptionCancellation = require("./subscriptionLifecycle").setSubscriptionCancellation;

exports.apiTextToSpeech = require('./tts').apiTextToSpeech;

// Admin dashboard overhaul — user lifecycle callables.
//
// TEMPORARILY DISABLED to unblock the Deploy Firebase workflow that
// failed after PR #417 merged (run #118). The admin UI keeps working
// because src/utils/adminUsersService.js already falls back to a
// direct Firestore write when the callable is unavailable — only the
// server-stamped audit-log entries from these two callables are
// missed in the meantime. The agent dispatcher audit hook is
// independent and stays enabled.
//
// Re-enable in a follow-up once we've inspected the deploy log tail
// and confirmed which side (project IAM vs. these specific callables)
// owns the failure.
//
// exports.adminSetUserStatus = require("./adminUsers").adminSetUserStatus;
// exports.adminSetUserRole = require("./adminUsers").adminSetUserRole;

// Admin-only callable that bulk-creates demo learner accounts with a
// trial Premium subscription. Mirrors the layout the admin UI's
// "Grant Premium Manually" button writes (see grantPremium in
// useFirestore.js), so the resulting docs are indistinguishable from
// any other manually-granted subscription. Marks each user with
// demo: true so the cohort can be queried/cleaned up later.
exports.bulkGrantDemoTrials = onCall({
  region: "us-central1",
  timeoutSeconds: 120,
  memory: "256MiB",
}, async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }

  const db = admin.firestore();
  const callerSnap = await db.collection("users").doc(callerUid).get();
  const callerRole = callerSnap.exists ? (callerSnap.data() || {}).role : null;
  if (callerRole !== "admin" && callerRole !== "superAdmin") {
    throw new HttpsError("permission-denied", "Admin access required.");
  }

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
  const allowedPlans = new Set(["monthly", "termly", "yearly"]);
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
});
