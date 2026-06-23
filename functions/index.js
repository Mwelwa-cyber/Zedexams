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
// Gemini REST client — used by the structureImportedQuiz pipeline.
const {callGemini} = require("./geminiClient");
// Scanned-paper OCR import — dual-model (Claude vision + Gemini assist) used
// by the Quiz Editor when a teacher uploads an image-only PDF past paper.
const {runScannedQuizImport} = require("./scannedQuizImport");
// Bulk "suggest answers" — answers a batch of imported MCQs in one Claude call
// so the editor can fill blank answer keys in a single pass.
const {runSuggestQuizAnswers} = require("./suggestQuizAnswers");
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
  createGenerateFullLesson,
} = require("./teacherTools/generateFullLesson");
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
// Teacher Tools — Exam Studio (ECZ Grade 7-style practice questions).
const {
  createGenerateExamPaper,
} = require("./teacherTools/generateExamPaper");
// Teacher Tools — Diagram Generator (Recraft, B&W line art for assessments).
const {
  createGenerateDiagram,
} = require("./teacherTools/generateDiagram");
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
const {createLencoHandlers} = require("./payments/lencoHandlers");
const {createAdminNotificationHandlers} = require("./subscriptions/adminNotificationHandlers");
const {createDemoTrialsHandlers} = require("./subscriptions/demoTrialsHandlers");
const {createNoteAiHandlers} = require("./notes/noteAiHandlers");
const {createShortAnswerHandlers} = require("./ai/shortAnswerHandlers");
const {createZedChatHandlers} = require("./ai/zedChatHandlers");
const {createQuizAuthoringHandlers} = require("./quiz/authoringHandlers");
const {createQuizImportHandlers} = require("./quiz/importHandlers");
const {createUserAccessHandlers} = require("./auth/userAccessHandlers");
const {createDawnHandlers} = require("./agents/dawnHandlers");

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
// still the default for B&W line art (cleaner on photocopiers), but when
// the Recraft account can't serve (out of credits, bad key) line-art
// requests automatically fall back to gpt-image-1 with the same B&W
// prompt. When unset, there is no fallback and the photoreal toggle is
// hidden.
const openaiApiKey = defineSecret("OPENAI_API_KEY");
// Optional. When set, generateDiagram exposes a "colour illustration" style
// that routes through the Kie.ai image API (Nano Banana et al.) for bright,
// friendly worksheet illustrations. When unset, the toggle is hidden and the
// other providers (Recraft line-art / OpenAI photoreal) handle everything.
const kieApiKey = defineSecret("KIE_API_KEY");
// Lenco (lenco.co) automated payments — ZMW mobile money + card
// collections. The webhook signing key is derived from this token
// (SHA256) per Lenco's spec, so no separate webhook secret is needed
// unless you set a custom one (LENCO_WEBHOOK_KEY) on the Lenco
// dashboard.
const lencoApiKey = defineSecret("LENCO_API_KEY");
function cleanString(value, maxLength) {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, maxLength);
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

const userAccessHandlers = createUserAccessHandlers({
  onCall,
  HttpsError,
  admin,
  nodemailer,
  crypto,
  emailSmtpUser,
  emailSmtpPassword,
  cleanString,
  resolveInitialUserRole,
});
exports.bootstrapUserProfile = userAccessHandlers.bootstrapUserProfile;
exports.sendPasswordResetEmail = userAccessHandlers.sendPasswordResetEmail;

// Zed chat model. Tune Zed independently of the shared OPENAI_MODEL default:
// set ZED_CHAT_MODEL (e.g. "gpt-4o") to upgrade just the study assistant
// without touching any other OpenAI call. When unset, callOpenAI/
// callOpenAIStream fall back to OPENAI_MODEL, then "gpt-4o-mini".
const ZED_CHAT_MODEL = process.env.ZED_CHAT_MODEL || undefined;

const zedChatHandlers = createZedChatHandlers({
  onCall,
  HttpsError,
  openaiApiKey,
  appCheckEnforceCallable: APPCHECK_ENFORCE_CALLABLE,
  recordAppCheckCallable,
  cleanAiString,
  LIMITS,
  getUserRole,
  assertDailyLimit,
  buildAnthropicChat,
  callOpenAI,
  getApiKey,
  zedChatModel: ZED_CHAT_MODEL,
});
exports.aiChat = zedChatHandlers.aiChat;

exports.generateStudyPlan = createGenerateStudyPlan(anthropicApiKey, {
  enforceAppCheck: APPCHECK_ENFORCE_CALLABLE,
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

const adminNotificationHandlers = createAdminNotificationHandlers({
  onCall,
  HttpsError,
  admin,
  emailSmtpUser,
  emailSmtpPassword,
  whatsappSecrets: require("./metaWhatsApp").WHATSAPP_SECRETS,
});
exports.resendInvoiceEmail = adminNotificationHandlers.resendInvoiceEmail;
exports.sendActivationConfirmation = adminNotificationHandlers.sendActivationConfirmation;
exports.sendExpiryReminders = adminNotificationHandlers.sendExpiryReminders;

const dawnHandlers = createDawnHandlers({
  onCall,
  HttpsError,
  admin,
  anthropicApiKey,
});
exports.runDawnBriefing = dawnHandlers.runDawnBriefing;

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

const noteAiHandlers = createNoteAiHandlers({
  onCall,
  HttpsError,
  cleanAiString,
  LIMITS,
  getUserRole,
  assertDailyLimit,
  isStaffRole,
  runNoteInsights,
  runGenerateNoteSmart,
  runNoteImport,
  runNoteOcr,
  getAnthropicApiKey,
  anthropicApiKey,
  appCheckEnforceCallable: APPCHECK_ENFORCE_CALLABLE,
  recordAppCheckCallable,
});
exports.generateNoteInsights = noteAiHandlers.generateNoteInsights;
exports.generateNoteSmart = noteAiHandlers.generateNoteSmart;

const quizAuthoringHandlers = createQuizAuthoringHandlers({
  onCall,
  HttpsError,
  anthropicApiKey,
  appCheckEnforceCallable: APPCHECK_ENFORCE_CALLABLE,
  recordAppCheckCallable,
  cleanAiString,
  LIMITS,
  getUserRole,
  assertDailyLimit,
  isStaffRole,
  isEditQuestionAction,
  buildExplainMessages,
  buildEditQuestionMessages,
  buildQuizMessages,
  toAnthropicShape,
  callAnthropic,
  getAnthropicApiKey,
  parseEditedQuestion,
  parseGeneratedQuiz,
  resolveCbcContext,
});
exports.explainAnswer = quizAuthoringHandlers.explainAnswer;
exports.editQuizQuestion = quizAuthoringHandlers.editQuizQuestion;
exports.generateQuizQuestions = quizAuthoringHandlers.generateQuizQuestions;

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

const quizImportHandlers = createQuizImportHandlers({
  onCall,
  HttpsError,
  anthropicApiKey,
  geminiApiKey,
  appCheckEnforceCallable: APPCHECK_ENFORCE_CALLABLE,
  recordAppCheckCallable,
  getUserRole,
  isStaffRole,
  assertDailyLimit,
  cleanAiString,
  LIMITS,
  callGemini,
  buildImportStructureMessages,
  toAnthropicShape,
  callAnthropic,
  getAnthropicApiKey,
  parseStructuredImport,
  runScannedQuizImport,
  runSuggestQuizAnswers,
});
exports.structureImportedQuiz = quizImportHandlers.structureImportedQuiz;
exports.structureScannedQuiz = quizImportHandlers.structureScannedQuiz;

exports.structureImportedNote = noteAiHandlers.structureImportedNote;
exports.ocrNotePages = noteAiHandlers.ocrNotePages;

exports.suggestQuizAnswers = quizImportHandlers.suggestQuizAnswers;

const shortAnswerHandlers = createShortAnswerHandlers({
  onCall,
  HttpsError,
  cleanString,
  stripJsonFences,
  callAnthropic,
  getAnthropicApiKey,
  anthropicApiKey,
  appCheckEnforceCallable: APPCHECK_ENFORCE_CALLABLE,
  recordAppCheckCallable,
});
exports.checkShortAnswer = shortAnswerHandlers.checkShortAnswer;

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
exports.getTermModuleOutline = getTermModuleOutline;

// Teacher Tools — Zambian CBC Rubric Generator.
exports.generateRubric = createGenerateRubric(anthropicApiKey);

// Teacher Tools — Notes Studio (teacher delivery notes).
exports.generateNotes = createGenerateNotes(anthropicApiKey);

// Teacher Tools — Visual Slide-Notes (learner-facing illustrated deck).
// Two-pass: Claude emits the deck + image prompts, then images are drawn one
// per prompt. Prefers ChatGPT/gpt-image-1 (colour) when the OpenAI key is set,
// falling back to Recraft line-art. Needs the Anthropic + (OpenAI/Recraft) keys.
exports.generateVisualNotes =
  createGenerateSlideNotes(anthropicApiKey, recraftApiKey, openaiApiKey);

// Teacher Tools — Full Lesson (complete, ready-to-deliver CBC lesson).
exports.generateFullLesson = createGenerateFullLesson(anthropicApiKey);

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

// Teacher Tools — Exam Studio (ECZ Grade 7 PSLE-style practice questions).
exports.generateExamPaper = createGenerateExamPaper(anthropicApiKey);

// Teacher Tools — Diagram Generator (Recraft, B&W line art for assessments).
// When OPENAI_API_KEY is set, generateDiagram exposes a photoreal style
// toggle that routes through gpt-image-1, and line-art requests fall back
// to gpt-image-1 automatically when Recraft can't serve (out of credits,
// bad key). The factory takes all three secrets so the handler can route
// per-request at runtime.
exports.generateDiagram = createGenerateDiagram(recraftApiKey, openaiApiKey, kieApiKey);
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
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }
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
const lencoHandlers = createLencoHandlers({
  onCall,
  onRequest,
  HttpsError,
  admin,
  cleanString,
  lencoApiKey,
  emailSmtpUser,
  emailSmtpPassword,
});
exports.initiateLencoPayment = lencoHandlers.initiateLencoPayment;
exports.submitLencoOtp = lencoHandlers.submitLencoOtp;
exports.getLencoPaymentStatus = lencoHandlers.getLencoPaymentStatus;
exports.recoverMyPendingPayments = lencoHandlers.recoverMyPendingPayments;
exports.lencoWebhook = lencoHandlers.lencoWebhook;

exports.apiTextToSpeech = require('./tts').apiTextToSpeech;

// Server-generated library downloads: regenerate a saved document on the server
// and stream it from zedexams.com with the correct filename — no upload, no
// Firebase Storage, works on every browser. See functions/libraryDownload.js.
const libraryDownload = require('./libraryDownload');
exports.createLibraryDownloadTicket = libraryDownload.createLibraryDownloadTicket;
exports.apiLibraryDownload = libraryDownload.apiLibraryDownload;
exports.reapDownloadTickets = libraryDownload.reapDownloadTickets;

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

const demoTrialsHandlers = createDemoTrialsHandlers({
  onCall,
  HttpsError,
  admin,
  cleanString,
});
exports.bulkGrantDemoTrials = demoTrialsHandlers.bulkGrantDemoTrials;
