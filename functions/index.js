const functions = require("firebase-functions/v1");
const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("node:crypto");
const nodemailer = require("nodemailer");

admin.initializeApp();

const {purgeUserData} = require("./accountDeletion");
const {createAssessment} = require("./recaptchaEnterprise");
const {
  ANDROID_SITE_KEY,
  resolveProjectId,
  isAssessableToken,
  interpretAssessment,
} = require("./recaptchaAssessmentCore");

const {
  LIMITS,
  assertDailyLimit,
  buildAnthropicChat,
  buildEditQuestionMessages,
  buildExplainMessages,
  buildImportStructureMessages,
  buildQuizMessages,
  callAnthropic,
  callOpenAI,
  callOpenAIStream,
  cleanString: cleanAiString,
  getAnthropicApiKey,
  getApiKey,
  getUserRole,
  isEditQuestionAction,
  isStaffRole,
  parseEditedQuestion,
  parseGeneratedQuiz,
  parseStructuredImport,
  stripJsonFences,
  toAnthropicShape,
} = require("./aiService");
// Email-verification gate shared by callables + HTTP endpoints (see
// authGuard.js for the exemption list).
const {assertVerifiedAuth, assertDecodedVerified} = require("./authGuard");
// Gemini REST client — used by the structureImportedQuiz pipeline.
const {callGemini} = require("./geminiClient");
// Scanned-paper OCR import — dual-model (Claude vision + Gemini assist) used
// by the Quiz Editor when a teacher uploads an image-only PDF past paper.
const {runScannedQuizImport} = require("./scannedQuizImport");
// Bulk "suggest answers" — answers a batch of imported MCQs in one Claude call
// so the editor can fill blank answer keys in a single pass.
const {runSuggestQuizAnswers} = require("./suggestQuizAnswers");
const {applyCors} = require("./cors");
const {resolveAppCheckEnforcement} = require("./appCheckEnforcement");
const {
  assertHttpRateLimit,
  assertCallableRateLimit,
} = require("./rateLimit");

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
// Teacher Tools — Term module outline (Weekly Forecast module fallback).
const {
  getTermModuleOutline,
} = require("./teacherTools/getTermModuleOutline");
// Teacher Tools — Rubric Generator.
const {
  createGenerateRubric,
} = require("./teacherTools/generateRubric");
// Teacher Tools — Notes Studio (teacher delivery notes from a lesson plan).
const {
  createGenerateNotes,
} = require("./teacherTools/generateNotes");
// Teacher Tools — Visual Slide-Notes (learner-facing illustrated deck).
const {
  createGenerateSlideNotes,
} = require("./teacherTools/generateSlideNotes");
const {
  createGenerateHomework,
} = require("./teacherTools/generateHomework");
const {
  createGenerateLessonActivities,
} = require("./teacherTools/generateLessonActivities");
const {
  createGenerateAssessment,
} = require("./teacherTools/generateAssessment");
// Teacher Tools — SBA Studio (ECZ School Based Assessment task generator).
const {
  createGenerateSbaTask,
} = require("./teacherTools/generateSbaTask");
const {
  createGenerateQuiz,
} = require("./teacherTools/generateQuiz");
// Teacher Tools — Diagram Generator (gpt-image-1, B&W line art for assessments).
const {
  createGenerateDiagram,
} = require("./teacherTools/generateDiagram");
// Test Paper Studio — intelligent photo-import diagram redrawing. Carries out
// a teacher's chosen Diagram Handling Option (keep/clean/redraw/replace/remove),
// reusing the Diagram Library before generating, then saving new figures back.
const {
  createRedrawTestPaperDiagram,
} = require("./teacherTools/testPaperImport/redrawTestPaperDiagram");
// Test Paper Studio — "Rebuild as table": read a cropped table/pictograph with
// Claude vision and return editable tableData (typed table, not an image).
const {
  createRebuildTableFromImage,
} = require("./teacherTools/testPaperImport/rebuildTable");
// Test Paper Studio — layout-first pass: a cheap (Haiku) classifier that
// inventories every object on a page (question/table/pictograph/diagram/…)
// before the expensive structured extraction, driving two-tier routing.
const {
  createAnalyzePaperLayout,
} = require("./teacherTools/testPaperImport/layoutPass");
// Visual Studio — on-demand AI safety/accuracy check for generated images.
const {createCheckVisualSafety} = require("./visualSafety");
// Teacher Tools — Note Pictures (Gemini/OpenAI illustrations for picture blocks).
const {
  createGenerateNotePictures,
} = require("./teacherTools/generateNotePictures");
// Picture bank — admin-only auto-naming of bulk-uploaded teaching figures.
const {runNamePictures, MAX_PICTURES_PER_CALL} = require("./pictureNaming");
// Teacher Tools — Suggest Answer (per-question AI answer hint for the studio).
const {
  createSuggestAnswer,
} = require("./teacherTools/suggestAnswer");
// Teacher Tools — Revise Question (rewrite for grade level / tone).
const {
  createReviseQuestion,
} = require("./teacherTools/reviseQuestion");
// Teacher Tools — AI Lesson Count (lesson-series pacing for the studio).
const {
  createAiLessonCount,
} = require("./teacherTools/lessonCount");
// Teacher Tools — Revise Lesson Section (AI-edit one part of a lesson plan).
const {
  createReviseLessonSection,
} = require("./teacherTools/reviseLessonSection");
// Teacher Tools — Lesson Plan Studio (vanilla JS studio, free-form prompts).
const {
  createStudioGenerateLessonPlan,
} = require("./teacherTools/studioLessonPlan");
// Teacher Tools — import built-in CBC topics into Firestore (admin-only).
const {
  importBuiltInCbcTopics,
} = require("./teacherTools/importBuiltInCbcTopics");
// Teacher Tools — import built-in assessment format profiles (admin-only).
const {
  importBuiltInAssessmentFormats,
} = require("./teacherTools/importBuiltInAssessmentFormats");
// Teacher Tools — extract a format-profile draft from a sample paper.
const {
  createExtractAssessmentFormat,
} = require("./teacherTools/extractAssessmentFormat");
// Teacher Tools — Exam Paper Library: analyse real papers + synthesise a
// consolidated format profile from many of them (admin-only).
const {
  createAnalyzeExamPaper,
  createSynthesizeAssessmentFormat,
} = require("./teacherTools/examPaperLibrary");
// Teacher Tools — bulk import lesson-level curriculum modules (admin-only).
const {
  importCurriculumModules,
} = require("./teacherTools/importCurriculumModules");
// Teacher Tools — admin-only one-click linker that runs the same logic
// as scripts/backfill-kb-source-refs.mjs from the Live AI Monitor, so
// admins can attach approvedSyllabi to lesson modules without a shell.
const {
  backfillKbSourceRefs,
} = require("./teacherTools/backfillKbSourceRefs");
const {
  expandKbLessons,
} = require("./teacherTools/expandKbLessons");
// Teacher Tools — admin-only callables that let the CBC KB editor
// upsert / delete / restore individual rows of the Syllabi Studio
// curriculum data. Edits land in syllabusOverrides/* and are applied
// at read time so the source JSON stays canonical.
const {
  upsertSyllabusRow,
  deleteSyllabusRow,
  restoreSyllabusRow,
} = require("./teacherTools/syllabusOverrides");
// CBC knowledge base — used to ground AI quiz questions in the Zambian
// syllabus. resolveCbcContext returns a rendered <cbc_context> block plus
// a human-readable warning if the topic wasn't found in the verified KB.
const {
  resolveCbcContext,
} = require("./teacherTools/cbcKnowledge");
// Vex — Quiz Verifier runner (synchronous, not part of the agentJobs pipeline).
const {runVex} = require("./agents/runners/vex");
// Learner "AI Summary + Key Points" for a note — generated once per note and
// cached in noteInsights/{noteId}.
const {runNoteInsights} = require("./noteInsights");
// Staff-only AI auto-highlights for a study note — cached in noteSmart/{noteId}.
const {runGenerateNoteSmart} = require("./noteSmart");
// Notes document import — AI structuring (text → study blocks) and OCR (scanned pages → text).
const {runNoteImport, runNoteOcr} = require("./noteImport");
// Daily Exam auto-picker — promotes one exam paper (questionCount >= 50
// or examOnly=true) per grade into the day's Daily Exam slot every
// morning so the admin no longer has to click "Daily Exam" by hand for
// routine rotation.
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
// Central Question Bank — Qix reviews every captured question in the background.
const {createQuestionReviewOnWrite} = require("./agents/questionReview");
// AI agents — Phase 3 + Phase 5 cron (QA/Eng: nightly Quill, weekly Cala).
const {
  nightlyQaSmoke: nightlyQaSmokeCron,
  weeklyCbcAlignmentAudit: weeklyCbcAlignmentAuditCron,
  hourlyMonitor: hourlyMonitorCron,
  hourlyRevenueReconcile: hourlyRevenueReconcileCron,
  supportTriage: supportTriageCron,
  contentAutoPublish: contentAutoPublishCron,
  weeklyProductSignal: weeklyProductSignalCron,
  weeklyRetentionScan: weeklyRetentionScanCron,
  deliverDawnBriefings: deliverDawnBriefingsCron,
  hourlyAgentSupervisor: hourlyAgentSupervisorCron,
  dailyFxRefresh: dailyFxRefreshCron,
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
// Family portal — authenticated parent accounts linking to children via a
// learner-minted family invite code (distinct from the anonymous share links).
const {
  createFamilyInviteCode,
  revokeFamilyInviteCode,
  redeemFamilyInviteCode,
  getChildProgress,
} = require("./familyPortal");
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
const {createGenerateStudyPlan} = require("./studentAgents");

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");
const emailSmtpUser = defineSecret("EMAIL_SMTP_USER");
const emailSmtpPassword = defineSecret("EMAIL_SMTP_PASSWORD");
// RECRAFT_API_KEY intentionally NOT declared/bound. Recraft was decommissioned
// (2026-06) — every "recraft" request is now served by gpt-image-1, and the
// secret + the direct HTTP integration in generateDiagram.js were removed. A
// defineSecret() bound to a function whose value no longer exists makes
// `firebase deploy` hard-fail in CI ("no value for the secret: RECRAFT_API_KEY"),
// blocking every functions deploy. The image consumers below take only the
// OpenAI key now. Re-declare + re-fund the secret and restore a Recraft provider
// branch in generateDiagram.js to bring it back.
// Optional. When set, structureImportedQuiz uses a Gemini → Claude pipeline:
// Gemini 2.5 Flash ingests the full document (1M-context strength) and emits
// rough question candidates; Claude refines them into CBC-aligned output.
// When unset, the callable falls back to the original Claude-only path so
// the feature keeps working without forcing a secret rotation.
const geminiApiKey = defineSecret("GEMINI_API_KEY");
// Required for image generation. Every generateDiagram style selector
// (recraft = B&W line art, openai = photoreal, kie = full colour) renders
// through OpenAI gpt-image-1 now that Recraft and Kie are decommissioned, so
// this is the only image-provider key that stays bound.
const openaiApiKey = defineSecret("OPENAI_API_KEY");
// KIE_API_KEY intentionally NOT declared/bound. Kie was fully decommissioned
// (2026-07) — the owner consolidated all image generation onto OpenAI, so the
// "colour illustration" style now renders via gpt-image-1 and the KIE_API_KEY
// secret + functions/kieClient.js were removed. As with RECRAFT_API_KEY, a
// defineSecret() bound to a function whose value no longer exists hard-fails
// `firebase deploy` in CI. Re-declare + re-fund the secret and restore the Kie
// provider branch in generateDiagram.js to bring it back.
// Lenco (lenco.co) automated payments — ZMW mobile money + card
// collections. The webhook signing key is derived from this token
// (SHA256) per Lenco's spec, so no separate webhook secret is needed
// unless you set a custom one (LENCO_WEBHOOK_KEY) on the Lenco
// dashboard.
const lencoApiKey = defineSecret("LENCO_API_KEY");
// Google Play Developer API service account (JSON key, whole file as the
// secret value) for verifying Android in-app subscription purchases
// (verifyGooglePlayPurchase). Create it from Play Console ▸ Users and
// permissions / API access with "View financial data" + "Manage orders".
// IMPORTANT: fund this secret in Secret Manager BEFORE merging code that
// binds it — `firebase functions:secrets:set GOOGLE_PLAY_SA_JSON` — or every
// CI functions deploy hard-fails ("no value for the secret"), exactly like
// the RECRAFT_API_KEY incident documented above (deadProviderSecrets.test.js).
const googlePlaySaJson = defineSecret("GOOGLE_PLAY_SA_JSON");
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
  const decoded = await admin.auth().verifyIdToken(token);
  return assertDecodedVerified(decoded);
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
  if (shouldEnforceAppCheck(label) && !verified) {
    throw new HttpsError("permission-denied", "App Check verification failed.");
  }
  return verified;
}

// Audit B3 follow-up — App Check coverage on AI callables.
//
// Enforcement is resolved once at module load from env, and is GRADUATED so
// the rollout doesn't have to be all-or-nothing (a single global flip would
// 401 every AI endpoint at once, locking out any client whose attestation
// isn't propagating yet — Safari, stale bundles, WebViews, Play Integrity):
//
//   APPCHECK_ENFORCE=1                              → enforce every endpoint
//   APPCHECK_ENFORCE_LABELS="generateQuizQuestions,…" → enforce only those
//   (neither)                                       → observe-only (default)
//
// So the safe path is: pick one low-legit-traffic / high-cost endpoint, add
// its label to APPCHECK_ENFORCE_LABELS, redeploy, watch appCheckHealth/{date}
// for that label's valid/missing ratio, then widen. shouldEnforceAppCheck()
// is passed the SAME label already used for the health counters, so the
// telemetry and the enforcement decision always line up. No code change to
// flip — only the env var. See functions/appCheckEnforcement.js.
//
// NOTE: none of the callables set `consumeAppCheckToken: true` any more
// (removed 2026-07). Consuming requires every client call site to opt in
// with `httpsCallable(fns, name, {limitedUseAppCheckTokens: true})` so a
// fresh single-use token is minted per call; no ZedExams client does that,
// so the runtime consumed the SDK's ~1h cached token on the first call and
// every later call in the window verified as already-consumed → recorded
// "missing" on /admin/app-check even for perfectly-attesting clients.
// Reintroduce replay protection together with client-side limited-use
// support when flipping to broad enforcement.
const APPCHECK_ENFORCEMENT = resolveAppCheckEnforcement(process.env);
function shouldEnforceAppCheck(label) {
  return APPCHECK_ENFORCEMENT.enforces(label);
}

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

// Diagnostic ping for the /admin/app-check "this device" self-test. Returns
// whether THIS request carried a valid App Check token — request.app is only
// populated when the runtime verified one, which is exactly the signal the
// per-endpoint counters can't attribute to a specific client. enforceAppCheck
// stays hard-off so the diagnostic keeps answering even after
// APPCHECK_ENFORCE=1 (its whole job is to explain a rejection). Deliberately
// NOT recorded in appCheckHealth: self-tests would inflate the readiness
// sample the dashboard judges against.
exports.appCheckPing = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 10,
    enforceAppCheck: false,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }
    return {attested: Boolean(request.app)};
  },
);

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
    // Display-only mirror of the Auth record's verification state (the
    // token claim stays the enforcement source of truth).
    emailVerified: authUser?.emailVerified === true,
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

// ── Self-service account deletion (Google Play data-deletion policy) ──
// A signed-in user can permanently delete their own account and personal
// data. This is the in-app half of the Play requirement; the Privacy
// Policy hosts the web-facing deletion instructions Play's Data Safety
// form links to. Uses the Admin SDK (no re-auth round-trip needed — the
// callable already proves identity via request.auth), purges Firestore
// first (functions/accountDeletion.js), then removes the Auth user so the
// session can no longer sign in.
exports.deleteMyAccount = onCall(
  {region: "us-central1", timeoutSeconds: 300},
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }
    const uid = request.auth.uid;

    let summary;
    try {
      summary = await purgeUserData(admin.firestore(), uid, {
        FieldValue: admin.firestore.FieldValue,
      });
    } catch (error) {
      console.error("deleteMyAccount purge failed:", error);
      throw new HttpsError(
        "internal",
        "We could not delete your data right now. Please try again, or contact support.",
      );
    }

    try {
      await admin.auth().deleteUser(uid);
    } catch (error) {
      // Already gone is fine (idempotent). Anything else: the data is gone
      // but the login isn't — surface it so support can finish the job.
      if (error?.code !== "auth/user-not-found") {
        console.error("deleteMyAccount auth deletion failed:", error);
        throw new HttpsError(
          "internal",
          "Your data was removed but your sign-in could not be deleted. Please contact support.",
        );
      }
    }

    console.log(
      `deleteMyAccount uid=${uid} summary=${JSON.stringify(summary)}`,
    );
    return {success: true, summary};
  },
);

// ── reCAPTCHA Enterprise assessment (bot scoring for sensitive actions) ──
// The native Android app mints a per-action reCAPTCHA Enterprise token (login
// / signup / …) via the device SDK and sends it here; we trade it with Google
// for a risk score. This is SEPARATE from App Check: App Check attests "real
// ZedExams client", this scores "does this specific attempt look like a bot".
// The assessment MUST be server-side — a compromised client could otherwise
// fake a passing result.
//
// PUBLIC by necessity: login/signup happen while logged out, so no request.auth
// and (for now) no App Check enforcement. The design is fail-open end to end —
// this only ever returns verdict 'block' on a genuine, valid low score; every
// error / ambiguity resolves to 'skip' so a misconfiguration can't lock real
// users out. The client (src/utils/recaptcha.js) blocks iff verdict==='block'.
// Cheap abuse guard: a token too short to be real is rejected before any paid
// Assessment API call. GCP setup: docs/RECAPTCHA-ENTERPRISE-SETUP.md.
exports.assessRecaptcha = onCall(
  {region: "us-central1", timeoutSeconds: 20},
  async (request) => {
    const token = cleanString(request.data?.token, 4000);
    const action = cleanString(request.data?.action, 50);

    if (!isAssessableToken(token)) {
      return {verdict: "skip", reason: "no-token"};
    }

    try {
      const assessment = await createAssessment({
        token,
        action: action || undefined,
        siteKey: ANDROID_SITE_KEY,
        projectId: resolveProjectId(),
      });
      const result = interpretAssessment(assessment, {expectedAction: action});
      // Operator breadcrumb — score distribution informs threshold tuning.
      // Never log the token itself.
      console.log(
        `assessRecaptcha action=${action || "(none)"} verdict=${result.verdict} ` +
        `score=${result.score} valid=${result.valid}` +
        (result.invalidReason ? ` invalidReason=${result.invalidReason}` : "") +
        (result.actionMismatch ? " actionMismatch=true" : ""),
      );
      return result;
    } catch (err) {
      // Fail open: a broken/unconfigured assessment must never block sign-in.
      console.error("assessRecaptcha failed:", err?.message || err);
      return {verdict: "skip", reason: "assessment-error"};
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

// Zed chat model. Tune Zed independently of the shared OPENAI_MODEL default:
// set ZED_CHAT_MODEL (e.g. "gpt-4o") to upgrade just the study assistant
// without touching any other OpenAI call. When unset, callOpenAI/
// callOpenAIStream fall back to OPENAI_MODEL, then "gpt-4o-mini".
const ZED_CHAT_MODEL = process.env.ZED_CHAT_MODEL || undefined;

// Zed study assistant — runs on OpenAI (gpt-4o-mini by default; override with
// ZED_CHAT_MODEL). buildAnthropicChat returns a provider-neutral
// {systemPrompt, messages[]} shape that callOpenAI folds into the OpenAI
// system role.
exports.aiChat = onCall(
  {
    secrets: [openaiApiKey],
    region: "us-central1",
    timeoutSeconds: 30,
    enforceAppCheck: shouldEnforceAppCheck("aiChat"),
  },
  async (request) => {
    await assertVerifiedAuth(request);
    recordAppCheckCallable(request, "aiChat");

    const message = cleanAiString(request.data?.message, LIMITS.message);
    if (!message) {
      throw new HttpsError(
        "invalid-argument",
        "Please enter a question for Zed.",
      );
    }

    // Per-user + per-IP burst cap (fail-open), mirroring apiAiChat so the
    // callable path is throttled the same as the SSE HTTP path.
    await assertCallableRateLimit(request, {action: "aiChat"});

    const role = await getUserRole(request.auth.uid);
    await assertDailyLimit(request.auth.uid, role, "chat");

    const {systemPrompt, messages} = buildAnthropicChat({
      message,
      context: request.data?.context || {},
      history: request.data?.history || [],
      role,
      customSystemPrompt: request.data?.systemPrompt,
    });
    const reply = await callOpenAI(getApiKey(openaiApiKey), {
      systemPrompt,
      messages,
      model: ZED_CHAT_MODEL,
      maxTokens: 1000,
      temperature: 0.35,
      track: {uid: request.auth.uid, tool: "aiChat"},
    });

    return {reply};
  },
);

exports.generateStudyPlan = createGenerateStudyPlan(anthropicApiKey, {
  enforceAppCheck: shouldEnforceAppCheck("generateStudyPlan"),
  recordAppCheckCallable,
});

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
});

// Dawn — launch the on-demand "morning briefing" Managed Agent from the admin
// UI instead of a laptop script. This callable only STARTS the run (a couple of
// fast API calls) and returns the session id; the deliverDawnBriefings poller
// (functions/agents/cron.js) collects the briefing ~10 min later, emails it, and
// saves it onto dawnRuns/{sessionId} for the panel to render. The Anthropic key
// stays a server secret — it never reaches the browser. Config (the agent /
// environment / vault ids + the recipient email) lives in dawnConfig/default,
// set once from the same panel; we never put those in client code.
exports.runDawnBriefing = onCall({
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
  secrets: [anthropicApiKey],
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");

  const db = admin.firestore();
  const callerSnap = await db.collection("users").doc(uid).get();
  const role = callerSnap.exists ? (callerSnap.data()?.role || "") : "";
  if (role !== "admin" && role !== "superAdmin") {
    throw new HttpsError("permission-denied", "Admin only.");
  }

  // One in-flight run at a time — a second "Run Dawn now" while one is still
  // working would just burn agent budget on a duplicate briefing.
  const inFlight = await db.collection("dawnRuns")
      .where("status", "==", "running")
      .limit(1)
      .get();
  if (!inFlight.empty) {
    throw new HttpsError(
        "already-exists",
        "Dawn is already working on a briefing — it'll arrive shortly.",
    );
  }

  const cfgSnap = await db.collection("dawnConfig").doc("default").get();
  const cfg = cfgSnap.exists ? (cfgSnap.data() || {}) : {};
  const agentId = String(cfg.agentId || "").trim();
  const envId = String(cfg.envId || "").trim();
  const vaultId = String(cfg.vaultId || "").trim();
  const toEmail = String(cfg.toEmail || "").trim();
  if (!agentId || !envId) {
    throw new HttpsError(
        "failed-precondition",
        "Dawn isn't configured yet. Add the agent and environment ids " +
        "(from your launch) in the Dawn panel first.",
    );
  }

  const apiKey = (anthropicApiKey.value() || process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "Anthropic API key is not configured.");
  }

  const {startBriefingRun} = require("./agents/runners/dawn");
  let sessionId;
  try {
    sessionId = await startBriefingRun({fetchImpl: fetch, apiKey, agentId, envId, vaultId});
  } catch (err) {
    throw new HttpsError(
        "internal",
        `Couldn't start Dawn: ${String(err && err.message || err).slice(0, 300)}`,
    );
  }

  await db.collection("dawnRuns").doc(sessionId).set({
    sessionId,
    status: "running",
    requestedBy: uid,
    requestedByEmail: callerSnap.data()?.email || null,
    toEmail: toEmail || null,
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {sessionId, status: "running", toEmail: toEmail || null};
});

// Zed chat SSE transport — OpenAI-backed (see aiChat above for the model note).
exports.apiAiChat = onRequest(
  {secrets: [openaiApiKey], region: "us-central1", timeoutSeconds: 60},
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
      await assertDecodedVerified(decoded);
      // Audit B3 — observability + opt-in enforcement gate. Throws
      // permission-denied only when APPCHECK_ENFORCE=1 is set.
      await softVerifyAppCheckHttp(req, "apiAiChat");
      // Per-user + per-IP burst cap (fail-open). Sits in front of the daily
      // quota so a hammering client is rejected cheaply before we build the
      // prompt or touch the model.
      await assertHttpRateLimit(req, res, {action: "aiChat", uid: decoded.uid});

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
      apiKey = getApiKey(openaiApiKey);
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
      await callOpenAIStream(
        apiKey,
        {
          systemPrompt,
          messages,
          model: ZED_CHAT_MODEL,
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
    enforceAppCheck: shouldEnforceAppCheck("explainAnswer"),
  },
  async (request) => {
    await assertVerifiedAuth(request);
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

// Learner-facing "AI Summary + Key Points" for a published note. Cached per
// note (noteInsights/{noteId}), so a cache hit costs nothing and the daily
// limit only bites on first-generation spam. Any signed-in user may call it;
// the runner enforces that the note is published.
exports.generateNoteInsights = onCall(
  {
    secrets: [anthropicApiKey],
    region: "us-central1",
    timeoutSeconds: 45,
    memory: "256MiB",
    enforceAppCheck: shouldEnforceAppCheck("generateNoteInsights"),
  },
  async (request) => {
    await assertVerifiedAuth(request);
    recordAppCheckCallable(request, "generateNoteInsights");

    const noteId = cleanAiString(request.data?.noteId, 80);
    if (!noteId) {
      throw new HttpsError("invalid-argument", "A note id is required.");
    }

    const role = await getUserRole(request.auth.uid);
    await assertDailyLimit(request.auth.uid, role, "noteInsights");

    return await runNoteInsights({
      noteId,
      uid: request.auth.uid,
      apiKey: getAnthropicApiKey(anthropicApiKey),
    });
  },
);

// Staff-only: generate AI auto-highlights for a study note and cache them in
// noteSmart/{noteId}. Mirrors generateNoteInsights but restricted to staff
// (teachers/admins) because highlight generation is admin-triggered, not
// lazy-on-first-view.
exports.generateNoteSmart = onCall(
  {
    secrets: [anthropicApiKey],
    region: "us-central1",
    timeoutSeconds: 90,
    memory: "256MiB",
    enforceAppCheck: shouldEnforceAppCheck("generateNoteSmart"),
  },
  async (request) => {
    await assertVerifiedAuth(request);
    recordAppCheckCallable(request, "generateNoteSmart");
    const role = await getUserRole(request.auth.uid);
    if (!isStaffRole(role)) {
      throw new HttpsError("permission-denied", "Only teachers and admins can generate highlights.");
    }
    const noteId = cleanAiString(request.data?.noteId, 200);
    if (!noteId) {
      throw new HttpsError("invalid-argument", "noteId is required.");
    }
    await assertDailyLimit(request.auth.uid, role, "noteSmart");
    try {
      return await runGenerateNoteSmart({
        noteId,
        uid: request.auth.uid,
        apiKey: getAnthropicApiKey(anthropicApiKey),
      });
    } catch (e) {
      if (e.code === "not-found") throw new HttpsError("not-found", e.message);
      if (e.code === "failed-precondition") throw new HttpsError("failed-precondition", e.message);
      throw new HttpsError("internal", "Could not generate highlights. Please try again.");
    }
  },
);

// Per-question AI edit — powers the "✨ AI" button on every question in the
// quiz editor (Simplify / Easier / Harder / Rephrase / Suggest answer /
// Write explanation). Staff-only; returns a patch the editor previews before
// applying. Maths in the patch comes back as import markup so the same
// importRichText converter renders fractions, column sums, and tables.
exports.editQuizQuestion = onCall(
  {
    secrets: [anthropicApiKey],
    region: "us-central1",
    timeoutSeconds: 45,
    enforceAppCheck: shouldEnforceAppCheck("editQuizQuestion"),
  },
  async (request) => {
    await assertVerifiedAuth(request);
    recordAppCheckCallable(request, "editQuizQuestion");

    const action = cleanAiString(request.data?.action, 30);
    if (!isEditQuestionAction(action)) {
      throw new HttpsError("invalid-argument", "Unknown AI edit action.");
    }
    const question = cleanAiString(request.data?.question, LIMITS.question);
    if (!question) {
      throw new HttpsError(
        "invalid-argument",
        "There is no question text to work with yet.",
      );
    }

    const role = await getUserRole(request.auth.uid);
    if (!isStaffRole(role)) {
      throw new HttpsError(
        "permission-denied",
        "Only teachers and admins can use the AI question editor.",
      );
    }
    await assertDailyLimit(request.auth.uid, role, "editQuestion");

    const options = Array.isArray(request.data?.options) ?
      request.data.options.slice(0, 6).map((opt) => cleanAiString(opt, 300)) :
      [];

    const {systemPrompt, messages} = toAnthropicShape(
      buildEditQuestionMessages({
        action,
        question,
        options,
        correctAnswer: cleanAiString(request.data?.correctAnswer, 40),
        subject: request.data?.subject,
        grade: request.data?.grade,
        topic: request.data?.topic,
        // Picture(s) so the model can SEE the diagram instead of guessing.
        // buildQuestionImageBlocks drops anything that isn't an https URL.
        imageUrl: request.data?.imageUrl,
        optionImages: Array.isArray(request.data?.optionImages) ?
          request.data.optionImages.slice(0, 6) : [],
        passageImageUrl: request.data?.passageImageUrl,
      }),
    );
    const raw = await callAnthropic(getAnthropicApiKey(anthropicApiKey), {
      systemPrompt,
      messages,
      maxTokens: 900,
      temperature: action === "suggest_answer" ? 0.1 : 0.4,
      json: true,
      track: {uid: request.auth.uid, tool: "editQuizQuestion"},
    });

    return {action, patch: parseEditedQuestion(raw)};
  },
);

exports.generateQuizQuestions = onCall(
  {
    secrets: [anthropicApiKey],
    region: "us-central1",
    timeoutSeconds: 45,
    enforceAppCheck: shouldEnforceAppCheck("generateQuizQuestions"),
  },
  async (request) => {
    await assertVerifiedAuth(request);
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
    // Curriculum framework the studio chose — "2013" grounds on the old
    // syllabus data file; anything else resolves to the 2023 CBC default.
    const framework = String(request.data?.framework) === "2013" ?
      "2013" : "2023";
    const {contextBlock, kbWarning} = await resolveCbcContext({
      grade,
      subject,
      topic,
      subtopic,
      framework,
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
      // Sized for the top of the count range (LIMITS.quizCount = 25
      // questions with options + explanations); billed only as used.
      maxTokens: 6000,
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
    await assertVerifiedAuth(request);
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
    enforceAppCheck: shouldEnforceAppCheck("structureImportedQuiz"),
  },
  async (request) => {
    await assertVerifiedAuth(request);
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
            "Preserve mathematics and tables with this markup (do not flatten",
            "them to prose or placeholders): fractions as \\frac{3}{4} (mixed:",
            "1\\frac{1}{3}); other inline maths wrapped in $...$ e.g. $\\sqrt{49}$,",
            "$x^2$; vertical/column arithmetic as one token on its own line",
            "[[vmath op=- lines=954751,362948 answer=]] (op = + - * /, lines are",
            "the operands top-to-bottom); and any table as a GitHub-style",
            "Markdown table (header row, |---| separator, then data rows).",
            "Do NOT invent questions or answers. If any text is unreadable,",
            "put the literal token [UNCLEAR] in its place — never guess. Return",
            "only the JSON object described below — no markdown fences, no preamble.",
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
      // 8000 tokens (~30K chars) comfortably fits a 16-question past paper
      // with options, passages, and per-question explanations. 4000 used to
      // truncate the JSON mid-array, which is why parseStructuredImport
      // failed with "The smart import response could not be read."
      maxTokens: 8000,
      temperature: 0.2,
      json: true,
      track: {uid: request.auth.uid, tool: "structureImportedQuiz"},
    });

    return parseStructuredImport(raw);
  },
);

// Scanned past-paper import for the Quiz Editor. The client rasterises an
// image-only PDF into page images and sends them here in batches; each call
// runs the dual-model OCR pipeline (Claude vision primary + Gemini assist)
// and returns blank-answer MCQs flagged for review. Higher memory + timeout
// than structureImportedQuiz because page images are large and vision is slow.
exports.structureScannedQuiz = onCall(
  {
    secrets: [anthropicApiKey, geminiApiKey],
    region: "us-central1",
    // 300s: a dense page batch (big vision call + Gemini assist + re-ask
    // rounds) can run long. The orchestrator also time-budgets its re-ask
    // loop so it returns PARTIAL results before this deadline instead of
    // dying with nothing; the client's timeout is 310s so the server's own
    // error surfaces rather than the client giving up first.
    timeoutSeconds: 300,
    memory: "1GiB",
    enforceAppCheck: shouldEnforceAppCheck("structureScannedQuiz"),
  },
  async (request) => {
    await assertVerifiedAuth(request);
    recordAppCheckCallable(request, "structureScannedQuiz");

    const role = await getUserRole(request.auth.uid);
    if (!isStaffRole(role)) {
      throw new HttpsError(
        "permission-denied",
        "Only teachers and admins can import scanned papers.",
      );
    }

    const pages = Array.isArray(request.data?.pages) ? request.data.pages : [];
    if (!pages.length) {
      throw new HttpsError(
        "invalid-argument",
        "No page images were supplied for scanned import.",
      );
    }

    // Counts as one AI action per page batch (same meter as smart import).
    // Metering stays fully server-authoritative — never gate it on a
    // client-supplied flag, or a modified client could send the flag to skip
    // its own daily cap. A single scanned paper maxes at ~40 batches (the
    // 120-page ceiling), comfortably under the 150/day staff limit, so one
    // import never caps out on its own; the client-side per-batch resilience
    // is what stops a mid-import failure from discarding the whole upload.
    await assertDailyLimit(request.auth.uid, role, "scannedImport");

    return runScannedQuizImport({
      pages,
      fileName: cleanAiString(request.data?.fileName, LIMITS.importFileName),
      subjectHint: cleanAiString(request.data?.subjectHint, 80),
      gradeHint: cleanAiString(request.data?.gradeHint, 20),
      anthropicKey: getAnthropicApiKey(anthropicApiKey),
      geminiKey: geminiApiKey.value() || process.env.GEMINI_API_KEY || "",
      uid: request.auth.uid,
    });
  },
);

// Notes document import — converts raw document text into structured `study`
// note blocks via Claude. Staff-only, app-check enforced, daily-capped.
exports.structureImportedNote = onCall(
  {
    secrets: [anthropicApiKey],
    region: "us-central1",
    timeoutSeconds: 120,
    enforceAppCheck: shouldEnforceAppCheck("structureImportedNote"),
  },
  async (request) => {
    await assertVerifiedAuth(request);
    recordAppCheckCallable(request, "structureImportedNote");
    const role = await getUserRole(request.auth.uid);
    if (!isStaffRole(role)) {
      throw new HttpsError(
        "permission-denied",
        "Only teachers and admins can import notes.",
      );
    }
    const fileName = cleanAiString(request.data?.fileName, LIMITS.importFileName);
    const documentText = cleanAiString(
      request.data?.documentText,
      LIMITS.importDocumentText,
    );
    if (!documentText || documentText.length < 80) {
      throw new HttpsError(
        "invalid-argument",
        "Not enough document text was available to build a note.",
      );
    }
    await assertDailyLimit(request.auth.uid, role, "importNote");
    return runNoteImport({
      documentText,
      fileName,
      apiKey: getAnthropicApiKey(anthropicApiKey),
      uid: request.auth.uid,
    });
  },
);

// Notes scanned-PDF OCR — client batches rendered page images here; each call
// returns a plain-text transcription that the structureImportedNote callable
// then converts into study blocks. Staff-only, app-check enforced, daily-capped.
exports.ocrNotePages = onCall(
  {
    secrets: [anthropicApiKey],
    region: "us-central1",
    timeoutSeconds: 240,
    memory: "1GiB",
    enforceAppCheck: shouldEnforceAppCheck("ocrNotePages"),
  },
  async (request) => {
    await assertVerifiedAuth(request);
    recordAppCheckCallable(request, "ocrNotePages");
    const role = await getUserRole(request.auth.uid);
    if (!isStaffRole(role)) {
      throw new HttpsError(
        "permission-denied",
        "Only teachers and admins can import notes.",
      );
    }
    const pages = Array.isArray(request.data?.pages) ? request.data.pages : [];
    if (!pages.length) {
      throw new HttpsError("invalid-argument", "No page images were supplied.");
    }
    if (pages.length > 8) {
      throw new HttpsError(
        "invalid-argument",
        "Too many pages in one OCR call (max 8).",
      );
    }
    await assertDailyLimit(request.auth.uid, role, "importNote");
    return runNoteOcr({
      pages,
      apiKey: getAnthropicApiKey(anthropicApiKey),
      uid: request.auth.uid,
    });
  },
);

// Bulk "suggest answers" for the Quiz Editor's answer-key tools. Answers a
// batch of MCQs in one Claude call; the admin verifies before publishing.
exports.suggestQuizAnswers = onCall(
  {
    secrets: [anthropicApiKey],
    region: "us-central1",
    timeoutSeconds: 120,
    enforceAppCheck: shouldEnforceAppCheck("suggestQuizAnswers"),
  },
  async (request) => {
    await assertVerifiedAuth(request);
    recordAppCheckCallable(request, "suggestQuizAnswers");

    const role = await getUserRole(request.auth.uid);
    if (!isStaffRole(role)) {
      throw new HttpsError(
        "permission-denied",
        "Only teachers and admins can suggest answers.",
      );
    }

    const questions = Array.isArray(request.data?.questions) ?
      request.data.questions : [];
    if (!questions.length) {
      throw new HttpsError(
        "invalid-argument",
        "No questions were supplied for answer suggestion.",
      );
    }

    // One AI action for the whole batch.
    await assertDailyLimit(request.auth.uid, role, "suggestAnswers");

    return runSuggestQuizAnswers({
      questions,
      subject: cleanAiString(request.data?.subject, 80),
      grade: cleanAiString(request.data?.grade, 20),
      anthropicKey: getAnthropicApiKey(anthropicApiKey),
      uid: request.auth.uid,
    });
  },
);

exports.checkShortAnswer = onCall(
  {
    secrets: [anthropicApiKey],
    region: "us-central1",
    timeoutSeconds: 30,
    enforceAppCheck: shouldEnforceAppCheck("checkShortAnswer"),
  },
  async (request) => {
    await assertVerifiedAuth(request);
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
        await assertDecodedVerified(decoded);
        uid = decoded.uid;
        // App Check observability + opt-in enforcement gate (throws
        // permission-denied only when APPCHECK_ENFORCE=1). Mirrors apiAiChat so
        // the teacher streams show up in appCheckHealth alongside it.
        await softVerifyAppCheckHttp(req, `api${tool}`);
        // Per-user + per-IP burst cap (fail-open), before the role check and
        // any model work.
        await assertHttpRateLimit(req, res, {action: `stream_${tool}`, uid});
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
exports.getTermModuleOutline = getTermModuleOutline;

// Teacher Tools — Zambian CBC Rubric Generator.
exports.generateRubric = createGenerateRubric(anthropicApiKey);

// Teacher Tools — Notes Studio (teacher delivery notes).
exports.generateNotes = createGenerateNotes(anthropicApiKey);

// Teacher Tools — Visual Slide-Notes (learner-facing illustrated deck).
// Two-pass: Claude emits the deck + image prompts, then images are drawn one
// per prompt via OpenAI gpt-image-1. Needs the Anthropic + OpenAI keys.
exports.generateVisualNotes =
  createGenerateSlideNotes(anthropicApiKey, openaiApiKey);

// Teacher Tools — Homework (short curriculum-grounded take-home practice).
exports.generateHomework = createGenerateHomework(anthropicApiKey);

// Teacher Tools — Lesson Activities (class exercise + homework generated
// straight from a lesson in the Lesson Plan Studio).
exports.generateLessonActivities =
  createGenerateLessonActivities(anthropicApiKey);

// Teacher Tools — Assessment (formal curriculum-grounded graded test).
exports.generateAssessment = createGenerateAssessment(anthropicApiKey);

// Teacher Tools — SBA Studio (ECZ School Based Assessment task, Grades 5–7).
exports.generateSbaTask = createGenerateSbaTask(anthropicApiKey);

// Teacher Tools — Quiz (short curriculum-grounded formative quiz).
exports.generateQuiz = createGenerateQuiz(anthropicApiKey);

// The generateExamPaper callable was retired 2026-07: no frontend ever called
// it — the Exam Studio generates through generateAssessment with
// assessmentType 'mock_exam'. Legacy `tool:'exam_paper'` aiGenerations docs
// still render in the library via src/utils/aiPaperToSections.js.

// Teacher Tools — Diagram Generator. All three styles (line-art, photoreal,
// colour illustration) render via gpt-image-1: Recraft and Kie were both
// decommissioned, so only the OpenAI key is bound.
exports.generateDiagram = createGenerateDiagram(openaiApiKey);

// Test Paper Studio — photo-import diagram redrawing. Library-first reuse, then
// generation via the same gpt-image-1 pipeline as generateDiagram.
exports.redrawTestPaperDiagram = createRedrawTestPaperDiagram(openaiApiKey);

// Test Paper Studio — reconstruct a photographed table/pictograph as an editable
// typed table (Claude vision → tableData), the "Rebuild as table" option.
exports.rebuildTableFromImage = createRebuildTableFromImage(anthropicApiKey);

// Test Paper Studio — cheap layout-first classifier (Haiku). Advisory pass that
// inventories a page's objects before extraction so the client can route
// complex objects to reconstruction and reconcile against what was extracted.
exports.analyzePaperLayout = createAnalyzePaperLayout(anthropicApiKey);

exports.checkVisualSafety = createCheckVisualSafety(anthropicApiKey);

// Picture bank — admin-only: auto-name bulk-uploaded teaching figures.
// Reads staged pictureBank docs, downloads each image from Storage, asks
// Claude vision for a name + keywords + subject, and writes the suggestions
// back as aiSuggested* fields. The pictures stay status:'staged' so an admin
// still reviews/approves before teachers can find them.
exports.nameBankPictures = onCall(
  {secrets: [anthropicApiKey], region: "us-central1", timeoutSeconds: 300,
    memory: "1GiB"},
  async (request) => {
    await assertVerifiedAuth(request);
    const role = await getUserRole(request.auth.uid);
    if (role !== "admin" && role !== "superAdmin") {
      throw new HttpsError(
        "permission-denied",
        "Only admins can auto-name picture-bank images.",
      );
    }

    const data = request.data || {};
    const ids = Array.isArray(data.pictureIds) ?
      data.pictureIds.map((x) => String(x || "").trim()).filter(Boolean) : [];
    if (!ids.length) {
      throw new HttpsError("invalid-argument", "No pictures to name.");
    }
    if (ids.length > 40) {
      throw new HttpsError(
        "invalid-argument",
        "Too many pictures at once — name 40 or fewer per run.",
      );
    }

    const db = admin.firestore();
    const bucket = admin.storage().bucket();

    // Load docs + download bytes. Best-effort per picture: a missing blob or
    // an oversized file is skipped with a warning rather than failing the run.
    const pictures = [];
    const warnings = [];
    await Promise.all(ids.map(async (id) => {
      try {
        const snap = await db.collection("pictureBank").doc(id).get();
        if (!snap.exists) {
          warnings.push(`Picture ${id} no longer exists.`);
          return;
        }
        const pic = snap.data() || {};
        if (!pic.storagePath) {
          warnings.push(`"${pic.name || id}" has no stored file to read.`);
          return;
        }
        const [buf] = await bucket.file(pic.storagePath).download();
        if (!buf || buf.length === 0 || buf.length > 10 * 1024 * 1024) {
          warnings.push(`"${pic.name || id}" is empty or too large to read.`);
          return;
        }
        pictures.push({
          id,
          mediaType: pic.contentType || "image/png",
          data: buf.toString("base64"),
          subjectHint: pic.subject || "",
          gradeBand: pic.gradeBand || "",
        });
      } catch (err) {
        warnings.push(`Could not read picture ${id} (${err?.message || "error"}).`);
      }
    }));

    if (!pictures.length) {
      throw new HttpsError(
        "failed-precondition",
        warnings[0] || "None of the selected pictures could be read.",
      );
    }

    const {results, warnings: aiWarnings} = await runNamePictures({
      pictures,
      anthropicKey: anthropicApiKey.value(),
    });
    warnings.push(...aiWarnings);

    // Write suggestions back. Keep status:'staged' — the admin reviews and
    // activates. aiNamedAt lets the UI badge freshly-named cards.
    let named = 0;
    await Promise.all(results.map(async (r) => {
      if (!r.ok || !r.name) return;
      try {
        await db.collection("pictureBank").doc(r.id).update({
          aiSuggestedName: r.name,
          aiSuggestedKeywords: r.keywords,
          aiSuggestedSubject: r.subject,
          aiNamedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        named += 1;
      } catch (err) {
        warnings.push(`Could not save the name for ${r.id} (${err?.message || "error"}).`);
      }
    }));

    return {
      named,
      total: pictures.length,
      perCall: MAX_PICTURES_PER_CALL,
      results: results.map((r) => ({
        id: r.id, name: r.name, keywords: r.keywords,
        subject: r.subject, ok: r.ok,
      })),
      warnings,
    };
  },
);

// Teacher Tools — Note Pictures (admin-only). Generates a flat illustration
// for each `picture` block in a published study note. Tries Gemini 2.5 Flash
// Image first; falls back to OpenAI gpt-image-1 per block on Gemini failure.
// Needs at least one of GEMINI_API_KEY or OPENAI_API_KEY.
exports.generateNotePictures = createGenerateNotePictures(geminiApiKey, openaiApiKey);

// Teacher Tools — Suggest Answer (per-question AI answer hint, Haiku).
// When GEMINI_API_KEY is set, suggestAnswer routes image-bearing questions
// to Gemini Vision so the model can actually *see* the diagram/map/table
// it's being asked about. Without the secret it falls back to Claude
// text-only (the existing behaviour).
exports.suggestAnswer = createSuggestAnswer(anthropicApiKey, geminiApiKey);

// Teacher Tools — Revise Question (rewrite for grade level / tone, Haiku).
exports.reviseQuestion = createReviseQuestion(anthropicApiKey);

// Teacher Tools — AI Lesson Count: recommends how many lessons a CBC
// sub-topic needs plus a per-lesson breakdown, for the Lesson Plan Studio's
// Lesson Series builder (Haiku micro-tool, daily-cap gated).
exports.aiLessonCount = createAiLessonCount(anthropicApiKey);

// Teacher Tools — Revise Lesson Section: AI-edit one part of a generated
// lesson plan in the Lesson Plan Studio (Haiku micro-tool).
exports.reviseLessonSection = createReviseLessonSection(anthropicApiKey);

// Teacher Tools — admin-only: import the built-in G1-9 topics into Firestore.
exports.importBuiltInCbcTopics = importBuiltInCbcTopics;

// Teacher Tools — admin-only: import the built-in Zambian assessment format
// profiles into Firestore so they become editable from the CBC KB page.
exports.importBuiltInAssessmentFormats = importBuiltInAssessmentFormats;

// Teacher Tools — admin-only: distil a format-profile draft from a sample
// Zambian paper (past paper or direct .pdf/.docx upload). Drafts await
// admin review on the CBC KB page before going live.
exports.extractAssessmentFormat =
  createExtractAssessmentFormat(anthropicApiKey);

// Teacher Tools — admin-only: Exam Paper Library. analyzeExamPaper distils
// one real paper into a stored per-paper analysis; synthesizeAssessmentFormat
// merges many analysed papers for a (type, band, subject) into a single
// format-profile draft that awaits the same CBC KB review gate.
exports.analyzeExamPaper = createAnalyzeExamPaper(anthropicApiKey);
exports.synthesizeAssessmentFormat =
  createSynthesizeAssessmentFormat(anthropicApiKey);

// Teacher Tools — admin-only: bulk import lesson-level curriculum modules.
exports.importCurriculumModules = importCurriculumModules;


// Teacher Tools — admin-only: backfill sourceDocId on every lesson
// module under the active KB version by matching against approvedSyllabi
// rows. Surfaced as the "Backfill syllabus links" button on the Live
// AI Monitor when the preflight grid is dominated by no_source_doc_ref.
exports.backfillKbSourceRefs = backfillKbSourceRefs;

// Teacher Tools — admin-only: expand subtopics[] on every live KB topic
// into individual lessons/{slug}-t{1|2|3} subcollection docs so the
// strict curriculum resolver gets subtopic_exact hits. Run this once
// after activating a syllabus version uploaded before lesson expansion
// was added to activateSyllabusVersion. Surfaced as the "Expand lessons"
// button in Syllabi Studio → Versions & audit.
exports.expandKbLessons = expandKbLessons;

// Syllabi Studio edit pipeline — admin-only row-level CRUD over the
// curriculum-data.json the CBC KB editor renders. Edits land as
// override docs and are applied at read time both for the admin UI
// and the server-side prompt resolver, so a save instantly affects
// every AI generator without redeploying or touching git.
exports.upsertSyllabusRow = upsertSyllabusRow;
exports.deleteSyllabusRow = deleteSyllabusRow;
exports.restoreSyllabusRow = restoreSyllabusRow;

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

// Template Bank — reusable, anonymised lesson-plan templates. The Firestore
// trigger (africa-south1) auto-builds + merges templates whenever a teacher
// saves a lesson plan; the callable records "Use Template" + ratings.
const {
  createLessonPlanTemplateOnWrite,
  createRecordTemplateInteraction,
} = require("./teacherTools/templateBankFunctions");
exports.lessonPlanTemplateOnWrite = createLessonPlanTemplateOnWrite(anthropicApiKey);
exports.recordTemplateInteraction = createRecordTemplateInteraction();

// AI agents — runs the Content pipeline whenever a queued agentJobs doc
// lands (Aria → Cala → Reva → awaiting_approval), and runs Pubo when an
// admin flips status to "approved".
exports.agentJobsOnCreate = createAgentJobsOnCreate(
    anthropicApiKey, [emailSmtpUser, emailSmtpPassword]);
exports.agentJobsOnApproved = createAgentJobsOnApproved(
    [emailSmtpUser, emailSmtpPassword]);

// Central Question Bank — Qix reviews each captured question (questionBank/{id})
// in the background and writes a verdict back onto the doc (africa-south1).
// OpenAI key powers the embedding-based semantic duplicate check (optional —
// review degrades gracefully without it).
exports.questionReviewOnWrite = createQuestionReviewOnWrite(anthropicApiKey, openaiApiKey);

// Central Question Bank — admin-only grade classifier for the one-click
// "Import existing questions" backfill (/admin/import-questions). Given a batch
// of questions whose syllabus topic didn't map to one grade, returns the CBC
// grade (4-7) for each via the shared gradeReclassifier (Haiku).
exports.classifyQuestionGrades = onCall(
    {secrets: [anthropicApiKey], timeoutSeconds: 120, memory: "256MiB"},
    async (request) => {
      const uid = await assertVerifiedAuth(request, "Please sign in.");
      const role = await getUserRole(uid);
      if (role !== "admin" && role !== "superAdmin") {
        throw new HttpsError("permission-denied", "Admin only.");
      }
      const items = Array.isArray(request.data && request.data.questions) ?
        request.data.questions.slice(0, 25) : [];
      const {classifyGrade} = require("./teacherTools/gradeReclassifier");
      const anthropicKey = anthropicApiKey.value() || process.env.ANTHROPIC_API_KEY || "";
      const emptyIndex = new Map(); // force the AI path
      const grades = await Promise.all(items.map(async (q) => {
        try {
          const r = await classifyGrade({
            subject: String(q && q.subject || ""),
            topic: String(q && q.topic || ""),
            text: String(q && q.text || ""),
            options: Array.isArray(q && q.options) ? q.options : [],
            storedGrade: String(q && q.storedGrade || ""),
          }, {index: emptyIndex, anthropicKey});
          return r && r.grade ? String(r.grade) : "";
        } catch {
          return "";
        }
      }));
      return {grades};
    },
);

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

// Admin-only curriculum module upload. Accepts DOCX / PDF / XLSX, parses,
// chunks, embeds, and writes straight into the curriculum/ + rag_chunks/
// collections so the teacher tools pick them up immediately (no review
// queue). Pairs with deleteCurriculumUpload for the admin UI's tear-down
// button. Lives at /admin/curriculum-upload.
const {
  createUploadCurriculumModule,
  createDeleteCurriculumUpload,
} = require("./teacherTools/uploadCurriculumModule");
exports.uploadCurriculumModule = createUploadCurriculumModule(openaiApiKey);
exports.deleteCurriculumUpload = createDeleteCurriculumUpload();

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
    enforceAppCheck: shouldEnforceAppCheck("retryAgentJob"),
  },
  async (request) => {
    await assertVerifiedAuth(request);
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
exports.tmpDownloadReaper = storageCleanup.tmpDownloadReaper;

// Quiz library mirror. Keeps quizSummaries/{id} (quiz doc minus the heavy
// passages[]/parts[]/description) in sync on every write to quizzes/{id}, so
// the learner library can list metadata without downloading dead weight.
// See functions/quizSummary/index.js.
const quizSummary = require("./quizSummary");
exports.onQuizWritten = quizSummary.onQuizWritten;

// Past-papers published-list index. Maintains pastPapersIndex/published —
// a single lightweight doc the /papers hub reads instead of fetching the
// whole archive (heavy assets[] arrays and all) on every visit.
const pastPapersIndex = require("./pastPapersIndex");
exports.pastPapersIndexOnWrite = pastPapersIndex.pastPapersIndexOnWrite;
exports.rebuildPastPapersIndexCron = pastPapersIndex.rebuildPastPapersIndexCron;

// Quill — nightly QA smoke (Africa/Lusaka 02:00). Writes a summary
// agentJobs doc the /admin/agents dashboard surfaces in QA / Eng.
exports.nightlyQaSmoke = nightlyQaSmokeCron;

// Cala — weekly CBC-alignment audit (Africa/Lusaka Sunday 03:00).
// Re-runs Cala over a sample of recent aiGenerations to catch drift.
exports.weeklyCbcAlignmentAudit = weeklyCbcAlignmentAuditCron;

// Vigil — hourly site monitor. Checks pages, Firebase, images, and quizzes;
// on failure suggests fixes (Haiku) and escalates via email + GitHub bug
// issue (which Mendi can pick up). Writes an agentJobs rollup each run.
exports.hourlyMonitor = hourlyMonitorCron;

// Till — hourly payment reconciliation. Re-queries Lenco for stale
// "pending" payments and activates paid-but-stuck buyers a dropped webhook
// left behind (via the existing idempotent activation path). Writes an
// agentJobs rollup the /admin/agents dashboard surfaces under "revenue".
exports.hourlyRevenueReconcile = hourlyRevenueReconcileCron;

// Echo — support triage every 2 hours. Sweeps new feedback + the otherwise
// invisible public contactMessages, classifies + prioritises, and drafts a
// reply (drafts only, never sends). Writes the triage onto each doc and an
// agentJobs rollup under "support".
exports.supportTriage = supportTriageCron;

// Content auto-publish gate — every 30 min. Auto-approves content jobs stuck
// at awaiting_approval that pass a strict Cala+Reva bar (which fires the
// existing Pubo publish trigger). OFF unless agentControl/content.autoPublish
// is true — shipping it changes nothing until you opt in.
exports.contentAutoPublish = contentAutoPublishCron;

// Compass — weekly product signal (Mondays 06:00). Aggregates recent quiz/exam
// attempts into a ranked "what to build next" backlog (grade/subject areas with
// demand but weak mastery). Deterministic, no LLM. Writes an agentJobs rollup.
exports.weeklyProductSignal = weeklyProductSignalCron;

// Anchor — weekly retention scan (Mondays 07:00). Surfaces engaged learners
// who went quiet 14–45 days ago, ranked by win-back value, with a drafted
// nudge. Read-only — does not message learners. Writes an agentJobs rollup.
exports.weeklyRetentionScan = weeklyRetentionScanCron;

// Dawn — delivery poller for on-demand morning briefings (every 5 min). When a
// run started by the runDawnBriefing callable finishes, this pulls the briefing
// Dawn wrote, emails it, and saves it onto dawnRuns/{id} for the admin panel.
exports.deliverDawnBriefings = deliverDawnBriefingsCron;

// Marshal — operations supervisor (every hour). Confirms every scheduled agent
// ran within its window and surfaces stuck jobs, tripped breakers and recent
// failures into one company-health verdict. Deterministic; writes an agentJobs
// rollup the /admin/company HQ surfaces.
exports.hourlyAgentSupervisor = hourlyAgentSupervisorCron;

// Daily FX refresh (treasury). Fetches the ZMW/USD rate once a day and writes
// settings/fxRate so the budget governor + /admin/company read a fresh, cached
// rate without a live network call. Range-checked; fails to the env fallback.
exports.dailyFxRefresh = dailyFxRefreshCron;

// Audit A5.2 — daily streak-reminder push (Africa/Lusaka 16:00).
// Targets learners who practised yesterday but not today, sends a friendly
// "keep your streak alive" FCM push, and prunes dead tokens in-flight.
// Reads users.fcmTokens populated by A5.1's client-side registerToken.
exports.dailyStreakReminders = dailyStreakRemindersCron;

// ── Smart Notification System ──────────────────────────────────────────────
// Streak-milestone notifications (7/30/100 days). Firestore trigger on
// learnerStats/{uid}, pinned to africa-south1 (server-authored so a tampered
// client can't forge a milestone into its own feed).
const {onLearnerStatsWritten} = require("./notifications/onLearnerStatsWritten");
exports.onLearnerStatsWritten = onLearnerStatsWritten;

// Announcement fan-out — when an admin publishes an active announcement, deliver
// it into each targeted user's notification feed (africa-south1, idempotent).
const {onAnnouncementWritten} = require("./notifications/onAnnouncementWritten");
exports.onAnnouncementWritten = onAnnouncementWritten;

// Admin in-app alerts — new registrations + new feedback/bug reports fan out to
// every admin's notification centre (africa-south1 triggers, best-effort).
const {
  onUserCreatedNotifyAdmins,
  onFeedbackCreatedNotifyAdmins,
} = require("./notifications/adminNotificationTriggers");
exports.onUserCreatedNotifyAdmins = onUserCreatedNotifyAdmins;
exports.onFeedbackCreatedNotifyAdmins = onFeedbackCreatedNotifyAdmins;

// Reminder + housekeeping crons (us-central1, Africa/Lusaka): daily practice
// nudge, weekly revision, inactive-learner win-back, subscription-expiry
// reminder, and the 90-day archival sweep.
const {
  dailyPracticeReminders,
  weeklyRevisionReminder,
  inactiveLearnerReminder,
  subscriptionExpiryReminders,
  archiveOldNotifications,
} = require("./notifications/reminderCrons");
exports.dailyPracticeReminders = dailyPracticeReminders;
exports.weeklyRevisionReminder = weeklyRevisionReminder;
exports.inactiveLearnerReminder = inactiveLearnerReminder;
exports.subscriptionExpiryReminders = subscriptionExpiryReminders;
exports.archiveOldNotifications = archiveOldNotifications;

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
// Family portal — authenticated parent↔child linking.
exports.createFamilyInviteCode = createFamilyInviteCode;
exports.revokeFamilyInviteCode = revokeFamilyInviteCode;
exports.redeemFamilyInviteCode = redeemFamilyInviteCode;
exports.getChildProgress = getChildProgress;

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

// ── Lenco automated payments ────────────────────────────────────────
// User-facing checkout: the SPA calls initiateLencoPayment (Mobile Money),
// optionally submitLencoOtp, then polls getLencoPaymentStatus. The authoritative
// activation signal is the signed lencoWebhook; the poll is a fallback
// so the buyer sees "success" even if the webhook is delayed. All three
// activation paths funnel through the idempotent
// activateSubscriptionFromPayment, so whoever wins, the rest no-op.
//
// Amounts are resolved server-side from functions/plans.js — a client
// can pick a plan id but never dictate the price charged.

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

exports.initiateLencoPayment = onCall({
  secrets: [lencoApiKey, emailSmtpUser, emailSmtpPassword],
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Please sign in first.");

  const lenco = require("./lencoService");
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

  // Pro → Max upgrade: charge ONLY the prorated daily-rate difference for the
  // days the teacher has left, and keep their existing renewal date (the
  // activation step preserves the expiry when isUpgrade is set). Recomputed
  // server-side from the user record so the client can never dictate the
  // prorated amount.
  const {quoteUpgradeForUser} = require("./subscriptionUpgrade");
  const quote = quoteUpgradeForUser(user, planId);
  const amount = quote.isUpgrade ? quote.amountZMW : Number(plan.priceZMW);
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
    let resp;
    let phoneNumber = null;
    let operator = null;

    const rawPhone = cleanString(request.data?.phone, 20);
    phoneNumber = lenco.normalizePhone(rawPhone);
    if (!phoneNumber) {
      throw new HttpsError("invalid-argument", "Enter a valid Zambian mobile number, e.g. 0977 740 465.");
    }
    operator = cleanString(request.data?.operator, 12).toLowerCase() || lenco.detectOperator(rawPhone);
    if (!operator) {
      throw new HttpsError("invalid-argument", "Could not detect your mobile money operator — please choose one.");
    }
    resp = await lenco.initiateMobileMoneyCollection({apiKey, operator, phone: phoneNumber, amount, reference, bearer});

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

exports.submitLencoOtp = onCall({
  secrets: [lencoApiKey, emailSmtpUser, emailSmtpPassword],
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
}, async (request) => {
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

  const lenco = require("./lencoService");
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
});

exports.getLencoPaymentStatus = onCall({
  secrets: [lencoApiKey, emailSmtpUser, emailSmtpPassword],
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
}, async (request) => {
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

  const lenco = require("./lencoService");
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
});

// On-demand "I paid but didn't get my credit" recovery. The live checkout
// poll only runs while the modal is open; if the buyer approves on their
// phone after it closes AND the webhook is delayed/dropped, the credit is
// stuck until the hourly Till sweep. This lets the buyer (or anyone hitting
// the dashboard "Already paid? Restore it" affordance) trigger that same
// reconciliation immediately for THEIR OWN pending payments. Reuses the
// idempotent activation path, so it can never double-grant — re-runs are safe.
exports.recoverMyPendingPayments = onCall({
  secrets: [lencoApiKey, emailSmtpUser, emailSmtpPassword],
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Please sign in first.");

  const apiKey = lencoApiKeyValue();
  if (!apiKey) throw new HttpsError("failed-precondition", "Payments are not configured.");

  const lenco = require("./lencoService");
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
});

// ── Google Play Billing (Android app) ─────────────────────────────────
// The Android build sells subscriptions through Google Play Billing only
// (Play policy — no Lenco/mobile-money inside the app). After a purchase
// (and on every app open, as a restore), the app sends the purchase
// token(s) here; we verify against the Google Play Developer API and grant
// through the same idempotent activation path as Lenco. See
// functions/googlePlayBilling.js + docs/GOOGLE-PLAY-BILLING.md.

// A Play *config* error during verification means a customer has PAID and we
// can't grant — revenue-blocking, needs a human now, not a log dive. Email
// ADMIN_EMAILS (throttled per-instance like the Lenco webhook alert so a
// retry loop can't flood the inbox), then throw failed-precondition with the
// stage in `details.reason` so client analytics can tell the stages apart.
// Best-effort: an alerting failure never changes what the caller sees.
const PLAY_CONFIG_ALERT_THROTTLE_MS = 15 * 60 * 1000;
let lastPlayConfigAlertAt = 0;
async function raisePlayConfigError({uid, reason, message}) {
  const now = Date.now();
  if (now - lastPlayConfigAlertAt >= PLAY_CONFIG_ALERT_THROTTLE_MS) {
    lastPlayConfigAlertAt = now;
    const {sendOpsAlert} = require("./opsAlert");
    const {senderEmail, senderPassword} = lencoEmailSecrets();
    await sendOpsAlert({
      title: "Google Play purchase verification is broken (config)",
      severity: "critical",
      smtpUser: senderEmail,
      smtpPassword: senderPassword,
      adminEmails: process.env.ADMIN_EMAILS || senderEmail,
      lines: [
        "A Google Play purchase could not be verified because of a configuration",
        "problem — the buyer has PAID and is not getting access. Google auto-refunds",
        "unacknowledged purchases after 3 days, so this loses the sale if not fixed.",
        "",
        `Stage: ${reason}`,
        `Detail: ${message}`,
        `Buyer uid: ${uid}`,
        "",
        "Runbook: docs/GOOGLE-PLAY-BILLING.md — step 1 (GOOGLE_PLAY_SA_JSON secret,",
        "SA invited in Play Console with View financial data + Manage orders,",
        "Google Play Android Developer API enabled on the Cloud project).",
      ],
    });
  }
  throw new HttpsError("failed-precondition",
      "Purchase verification is not configured yet.", {reason});
}

exports.verifyGooglePlayPurchase = onCall({
  secrets: [googlePlaySaJson, emailSmtpUser, emailSmtpPassword],
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
  enforceAppCheck: shouldEnforceAppCheck("verifyGooglePlayPurchase"),
}, async (request) => {
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
});

// Throttle the Lenco-webhook ops alert so a retry storm (Lenco re-delivers a
// failing event repeatedly) can't flood the admin inbox. Per-instance — a cold
// start resets it, which is acceptable for a "something is broken" page.
const WEBHOOK_ALERT_THROTTLE_MS = 15 * 60 * 1000;
let lastWebhookAlertAt = 0;
function shouldSendWebhookAlert(now) {
  if (now - lastWebhookAlertAt < WEBHOOK_ALERT_THROTTLE_MS) return false;
  lastWebhookAlertAt = now;
  return true;
}

// Server-to-server webhook. No CORS / App Check — security is the
// x-lenco-signature HMAC over the raw body. We process fully (the
// activation transaction is fast and the receipt is best-effort) and
// only then respond: a non-200 makes Lenco retry, and our activation is
// idempotent, so a retry can never double-grant.
exports.lencoWebhook = onRequest({
  secrets: [lencoApiKey, emailSmtpUser, emailSmtpPassword],
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
}, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Use POST.");
    return;
  }

  const lenco = require("./lencoService");
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
});

// Bonga — inbound WhatsApp reply agent. Meta calls this webhook on every
// message to the ZedExams WhatsApp number. GET is the one-time subscription
// handshake; POST delivers messages. Bonga classifies (study / support /
// sales), drafts a reply with Claude Haiku, and AUTO-SENDS it inside WhatsApp's
// 24-hour customer-service window (the inbound message opens that window).
//
// Safety: the X-Hub-Signature-256 HMAC is validated against META_WHATSAPP_APP_
// SECRET (fail-closed once that secret is set) so only Meta can trigger a send;
// an agentControl/bonga.paused flag is an instant kill-switch; replies are
// deduped per Meta message id; and the model is told it has no account/payment
// powers so it can't fabricate state. See functions/agents/runners/bonga.js.
exports.apiWhatsAppWebhook = onRequest({
  secrets: [...require("./metaWhatsApp").WHATSAPP_WEBHOOK_SECRETS, anthropicApiKey],
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
}, async (req, res) => {
  const meta = require("./metaWhatsApp");

  // GET — Meta subscription verification handshake.
  if (req.method === "GET") {
    const result = meta.verifyWebhookSubscription(req.query || {});
    if (result.ok) {
      res.status(200).send(result.challenge);
    } else {
      console.warn("[whatsappWebhook] verify handshake rejected", result.reason);
      res.status(403).send("verification failed");
    }
    return;
  }
  if (req.method !== "POST") {
    res.status(405).send("Use POST.");
    return;
  }

  // Authenticate the payload. Fail-closed in both directions:
  //   • secret set + bad signature   → 403
  //   • secret unset (cannot verify) → 403, unconditionally
  // An unset META_WHATSAPP_APP_SECRET would otherwise let any caller forge a
  // payload that triggers Anthropic spend, auto-sent WhatsApp replies, and
  // Firestore writes — the public webhook must never accept unverified data.
  // (The WHATSAPP_ALLOW_UNVERIFIED staged-rollout escape hatch was removed: the
  // secret is bound in production, and a "trust everyone" mode on a webhook
  // that can emit outbound sends should not exist to be left on by accident.)
  const auth = meta.verifyInboundSignature({
    rawBody: req.rawBody,
    signature: req.get("x-hub-signature-256") || req.get("X-Hub-Signature-256"),
  });
  if (auth.configured && !auth.ok) {
    console.warn("[whatsappWebhook] rejected: bad X-Hub-Signature-256");
    res.status(403).send("invalid signature");
    return;
  }
  if (!auth.configured) {
    console.error("[whatsappWebhook] rejected: META_WHATSAPP_APP_SECRET unset — refusing unverified payload");
    res.status(403).send("signature verification not configured");
    return;
  }

  // Always ack Meta with 200 at the end so it doesn't retry a payload we've
  // already accepted; processing errors are logged, not surfaced as non-200.
  try {
    const inbound = meta.parseInboundMessages(req.body || {});
    if (!inbound.length) {
      // Status callbacks (delivered/read) and non-text messages land here.
      res.status(200).send("ok");
      return;
    }

    const db = admin.firestore();

    // Kill-switch — if an admin paused Bonga, log the inbound but don't reply.
    let paused = false;
    try {
      const ctrl = await db.collection("agentControl").doc("bonga").get();
      paused = Boolean(ctrl.exists && ctrl.data() && ctrl.data().paused);
    } catch (_e) { /* default to active */ }

    // Resolve the Anthropic key once; degrade to the templated reply if unbound.
    let apiKey = "";
    try {
      apiKey = getAnthropicApiKey(anthropicApiKey) || "";
    } catch (_e) { apiKey = ""; }

    const draftReply = async ({systemPrompt, messages}) => {
      if (!apiKey || paused) return "";
      return await callAnthropic(apiKey, {
        systemPrompt,
        messages,
        model: "claude-haiku-4-5-20251001",
        maxTokens: 600,
        temperature: 0.4,
        track: {tool: "bonga-whatsapp"},
      });
    };

    const {runBongaReply} = require("./agents/runners/bonga");
    const {normalizeToWhatsApp, sendWhatsAppText} = meta;

    // Process at most a handful per delivery (Meta batches; abuse-bound).
    for (const msg of inbound.slice(0, 5)) {
      const convRef = db.collection("whatsappConversations").doc(msg.from);
      let conv = {};
      try {
        const snap = await convRef.get();
        conv = (snap.exists && snap.data()) || {};
      } catch (_e) { conv = {}; }

      // Dedupe Meta redeliveries of the same inbound message id.
      if (msg.messageId && conv.lastInboundId === msg.messageId) continue;

      const history = Array.isArray(conv.history) ? conv.history : [];
      const {kind, reply, usedFallback} = await runBongaReply({
        inbound: msg,
        history,
        draftReply,
      });

      const to = normalizeToWhatsApp(msg.from);
      let sendResult = {status: "skipped", reason: paused ? "agent-paused" : "no-recipient"};
      if (to && !paused) {
        sendResult = await sendWhatsAppText({to, body: reply});
      }

      // Append both turns, trimmed, so the next message has context.
      const nextHistory = [
        ...history,
        {role: "user", text: msg.text, at: msg.timestamp || Date.now()},
        {role: "assistant", text: reply, at: Date.now()},
      ].slice(-16);

      try {
        await convRef.set({
          phone: msg.from,
          name: msg.name || conv.name || null,
          lastInboundId: msg.messageId || null,
          lastInboundText: msg.text.slice(0, 500),
          lastInboundAt: admin.firestore.FieldValue.serverTimestamp(),
          lastKind: kind,
          lastReplyText: reply.slice(0, 1000),
          lastReplyStatus: sendResult.status,
          lastReplyError: sendResult.error || null,
          lastReplyUsedFallback: Boolean(usedFallback),
          lastReplyAt: admin.firestore.FieldValue.serverTimestamp(),
          messageCount: admin.firestore.FieldValue.increment(1),
          history: nextHistory,
        }, {merge: true});
      } catch (err) {
        console.error("[whatsappWebhook] conversation write failed", err);
      }

      console.log("[whatsappWebhook] replied", {
        from: msg.from, kind, status: sendResult.status, usedFallback,
      });
    }

    res.status(200).send("ok");
  } catch (err) {
    console.error("[whatsappWebhook] processing error", err);
    // 200 so Meta doesn't hammer us with retries for an already-read payload.
    res.status(200).send("ok");
  }
});

exports.apiTextToSpeech = require('./tts').apiTextToSpeech;

// Website visitor tracker — unauthenticated beacon the SPA POSTs on each
// route change. Records page-view docs + daily rollups for /admin/visitors.
// See functions/visitorTracking.js (privacy posture + Firestore shape).
exports.apiTrackVisit = require('./visitorTracking').apiTrackVisit;
// Scheduled rollup: sums the sharded per-pageview counters into the day doc the
// /admin/visitors dashboard reads (every 5 min, Lusaka today + yesterday).
exports.aggregateVisitorStats = require('./visitorTracking').aggregateVisitorStats;

// Server-generated library downloads: regenerate a saved document on the server
// and stream it from zedexams.com with the correct filename — no upload, no
// Firebase Storage, works on every browser. See functions/libraryDownload.js.
const libraryDownload = require('./libraryDownload');
exports.createLibraryDownloadTicket = libraryDownload.createLibraryDownloadTicket;
exports.apiLibraryDownload = libraryDownload.apiLibraryDownload;
exports.reapDownloadTickets = libraryDownload.reapDownloadTickets;

// Same-origin image proxy: fetches a Storage image's bytes server-side (where
// CORS doesn't apply) so the Word/PDF exporters can embed diagrams even when the
// bucket's CORS config is missing/misapplied. See functions/imageProxy.js.
const imageProxy = require('./imageProxy');
exports.apiImageProxy = imageProxy.apiImageProxy;

// Admin dashboard overhaul — user lifecycle callables.
//
// These write the server-stamped audit-log entries (adminAuditLogs →
// the /admin/activity page) for role changes and suspend/delete. They
// were temporarily disabled after PR #417 because the Deploy Firebase
// workflow false-failed on the cosmetic "HTTP Error: 409, unable to
// queue the operation" race — setUserRole surfaced it as a bare gen1
// failure with no 409 detail line, so the parser treated it as fatal.
// deploy-firebase.yml now classifies exactly that case (a bare failure
// during a demonstrable 409 race) as cosmetic/non-fatal, so re-enabling
// no longer blocks the deploy. src/utils/adminUsersService.js still
// falls back to a direct write if a callable is momentarily undeployed.
exports.adminSetUserStatus = require("./adminUsers").adminSetUserStatus;
exports.adminSetUserRole = require("./adminUsers").adminSetUserRole;

// Admin payment/subscription callables — audited server-side confirm /
// reject / grant / revoke. Mirror the client writes they replace (see
// functions/adminPayments.js) so dashboards keep working, and land an
// adminAuditLogs entry for each money action.
const adminPayments = require("./adminPayments");
exports.adminConfirmPayment = adminPayments.adminConfirmPayment;
exports.adminRejectPayment = adminPayments.adminRejectPayment;
exports.adminGrantPremium = adminPayments.adminGrantPremium;
exports.adminRevokePremium = adminPayments.adminRevokePremium;

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
  const callerUid = await assertVerifiedAuth(request, "Sign in required.");

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
});
