const functions = require("firebase-functions/v1");
const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("node:crypto");

admin.initializeApp();

const {purgeUserData, evaluateDeletionAuth} = require("./accountDeletion");
const {passwordResetRateLimitKeys} = require("./passwordResetRateLimitCore");
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
  isAdminRole,
  isEditQuestionAction,
  isStaffRole,
  parseEditedQuestion,
  parseGeneratedQuiz,
  parseStructuredImport,
  stripJsonFences,
  toAnthropicShape,
} = require("./aiService");
const {UNTRUSTED_DATA_NOTICE, fenceUntrusted} = require("./promptInjectionGuard");
const {checkLearnerText, checkLearnerTextWindowed, LEARNER_BLOCK_MESSAGE} = require("./contentModeration");
const {screenLearnerMessage, redactForLogs} = require("./learnerSafety/learnerSafetyCore");
// Email-verification gate shared by callables + HTTP endpoints (see
// authGuard.js for the exemption list).
const {assertVerifiedAuth, assertDecodedVerified} = require("./authGuard");
const {assertLearnerCapability} = require("./consentGuard");
// Capability names, duplicated as plain strings ONLY because the shared
// consent package is ESM and this file is CommonJS — importing it at module
// scope is not possible (see functions/shared/README.md). The values are
// pinned to guardianConsentCore's CAPABILITY by test:consent-guard, so a
// rename there fails CI rather than silently disabling a gate here.
const CAPABILITY_AI_CHAT = "aiChat";
const CAPABILITY_SOCIAL = "social";
const CAPABILITY_PURCHASE = "purchase";
const CAPABILITY_LEADERBOARD = "leaderboard";
// MFA second-factor gate for admin callables that already confirm admin their
// own way (bulk grants, global content publishing). See functions/security/.
const {assertAdminSecondFactor} = require("./security/requireAdminMfa");
// Gemini REST client — used by the structureImportedQuiz pipeline.
const {callGemini} = require("./geminiClient");
// Scanned-paper OCR import — dual-model (Claude vision + Gemini assist) used
// by the Quiz Editor when a teacher uploads an image-only PDF past paper.
const {runScannedQuizImport} = require("./scannedQuizImport");
// Bulk "suggest answers" — answers a batch of imported MCQs in one Claude call
// so the editor can fill blank answer keys in a single pass.
const {runSuggestQuizAnswers} = require("./suggestQuizAnswers");
const {applyCors} = require("./cors");
// The App Check enforcement resolver and the appCheckHealthCore helpers are no
// longer required HERE: their only consumers in this file were
// softVerifyAppCheckHttp and recordAppCheckHealth, which moved to
// functions/appCheckHttp.js and require them there.
const {
  assertHttpRateLimit,
  assertCallableRateLimit,
  enforceRateLimit,
  standardBuckets,
  resolveClientIp,
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
// Past Paper Studio — staff-only tokened download URL for a paper's own
// files (the Quiz Editor's "Crop from page" fallback when a direct
// client-side Storage read is denied by rules).
const {
  createResolvePaperAssetUrl,
} = require("./teacherTools/paperAssetUrl");
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
const {createPlanAssessment} = require("./teacherTools/planAssessment");
const {createRegenerateAssessmentQuestion} =
  require("./teacherTools/regenerateAssessmentQuestion");
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
// Visual Studio v2 — AI auto-labelling of diagram art (vision → proposed labels).
const {runAutoLabelDiagram} = require("./teacherTools/autoLabelDiagram");
const {
  runClassListExtraction,
  MAX_PAGES_PER_CALL: MAX_CLASS_LIST_PAGES,
} = require("./classList/extractClassList");
// The Daily Quiz — five questions a day per grade, built from the approved
// question bank. This REPLACED the Daily Exam rotation (autoPickDailyExams,
// which pinned one whole 50+ question paper per grade per day) in 2026-08:
// two daily systems is exactly the duplication the one-read-path rule
// exists to prevent. `getExamQuestions` / `submitDailyExam` stay so the
// historical exam_attempts a learner already holds remain readable.
const dailyQuizFns = require("./dailyQuiz/dailyQuizFns");
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
// Platform metrics rollup — DAU / WAU / D1-D7-D30 retention (Africa/Lusaka 00:30).
const {rollUpPlatformMetrics: rollUpPlatformMetricsCron} = require("./platformMetrics");
// Audit B4 follow-up — daily AI-cost summary cron (Africa/Lusaka 02:00).
const {aiCostDailySummary} = require("./aiCostDailySummary");
// Hourly sweep of expired AI-budget reservations (issue #1755).
const {reclaimAiBudgetReservations} = require("./aiBudgetReclaim");
// Admin read model for the /admin/ai-costs budget-enforcement panel.
const {getAiBudgetEnforcement} = require("./aiBudgetEnforcement");
// Class Register Studio — the single authoritative attendance mutation
// (term-from-date + lock + roster eligibility + per-record validation +
// server-recomputed counts). Direct client writes to attendance days are
// denied by rules; everything goes through this callable.
const {saveClassAttendance} = require("./attendance/saveClassAttendance");
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
  respondToFamilyLink,
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
// Wraps the `secrets: [...]` list of every function that raises an ops alert so
// the Slack/Discord webhook URL is bound too. Unconditional: the binding is
// decided during deploy-time source analysis, which cannot see
// functions/.env.<project> — see functions/opsAlertSecrets.js.
const {opsAlertSecrets} = require("./opsAlertSecrets");
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

// softVerifyAppCheckHttp moved to functions/appCheckHttp.js (imported below)
// so functions/tts.js can use it too — see the note at the import.

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
// The enforcement resolver, the HTTP soft-verify gate and the health-telemetry
// writer now live in functions/appCheckHttp.js so a handler in ANOTHER module
// can use them: apiTextToSpeech (functions/tts.js) could not previously join
// the graduated-enforcement set at all, because all three were local to this
// file. Copying them there would have meant a second sampling decision and a
// second shard-picking rule for the same counters, so they moved instead.
const {
  shouldEnforceAppCheck,
  recordAppCheckHealth,
  softVerifyAppCheckHttp,
} = require("./appCheckHttp");

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
  // A callable can't tell "no token" from "invalid token", so an
  // unverified call folds into "missing" (canDistinguishInvalid: false).
  await recordAppCheckHealth({
    label,
    tokenPresent: verified, // callables only surface a token when it verified
    verified,
    canDistinguishInvalid: false,
  });
}

// recordAppCheckHealth moved to functions/appCheckHttp.js (imported below),
// alongside the soft-verify gate that is its only HTTP caller. It stays ONE
// writer because it is sampled and sharded — a copy would be a second sampling
// decision and a second shard-picking rule for the same counters.

// Diagnostic ping for the /admin/app-check "this device" self-test. Returns
// whether THIS request carried a valid App Check token — request.app is only
// populated when the runtime verified one, which is exactly the signal the
// per-endpoint counters can't attribute to a specific client. enforceAppCheck
// stays hard-off so the diagnostic keeps answering even after
// APPCHECK_ENFORCE=1 (its whole job is to explain a rejection). Deliberately
// NOT recorded in appCheckHealth: self-tests would inflate the readiness
// sample the dashboard judges against.
// Phase 5 batch 1b: these four callable BODIES live in
// account/accountCallableHandlers.js; the builders and their frozen options
// stay here, where the manifest guard reads them (docs/phase5-plan.md).
const accountCallableHandlers = require("./account/accountCallableHandlers")
    .buildAccountCallableHandlers({cleanString, buildBootstrappedUserProfile});

// Hoisted from further down the file: this `const` is read by the deps
// object below, and a `const` read before its declaration is a TDZ
// ReferenceError at module load — which fails EVERY function in the
// deployment, not just its own.
const ZED_CHAT_MODEL = process.env.ZED_CHAT_MODEL || undefined;

// Hoisted from further down the file: this `const` is read by the deps
// object below, and a `const` read before its declaration is a TDZ
// ReferenceError at module load — which fails EVERY function in the
// deployment, not just its own.
const {runFunctionErrorWatch} = require("./monitoring/functionErrorWatch");

// Hoisted from further down the file for the same reason: apiAiChat closes
// over this, and batch 3's deps object below reads it.
// SSE keep-alive interval while apiAiChat buffers + moderates. Comfortably under
// the client's 30s stall watchdog (src/utils/aiAssistant.js AI_CHAT_STREAM_STALL_MS).
const CHAT_HEARTBEAT_MS = 10000;

// ── Phase 5 batch 2: the 24 secrets-bound handler bodies ────────────────
// The bodies moved to the modules required below; the builders and their
// frozen options stay in this file, where the frozen-surface guard reads
// them (scripts/functions-manifest.json, test:functions-manifest).
//
// One shared deps object rather than a require graph inside each module: the
// secret params must be the SAME defineSecret instances the builders bind, and
// index.js-local helpers (recordAppCheckCallable, cleanString, the
// password-reset helpers) have no other home. A module destructures only the
// names it uses; the extra keys cost nothing.
const batch2HandlerDeps = {
  CAPABILITY_AI_CHAT,
  HttpsError,
  LEARNER_BLOCK_MESSAGE,
  LIMITS,
  MARKING_EQUIVALENCES,
  MAX_CLASS_LIST_PAGES,
  MAX_LEN,
  MAX_PICTURES_PER_CALL,
  TEACHER_MARKING_SCHEME,
  UNTRUSTED_DATA_NOTICE,
  ZED_CHAT_MODEL,
  admin,
  anthropicApiKey,
  assertAdminSecondFactor,
  assertCallableRateLimit,
  assertDailyLimit,
  assertLearnerCapability,
  assertVerifiedAuth,
  buildAnthropicChat,
  buildEditQuestionMessages,
  buildExplainMessages,
  buildImportStructureMessages,
  buildPasswordResetEmailHtml,
  buildPasswordResetEmailText,
  buildQuizMessages,
  callAnthropic,
  callGemini,
  callOpenAI,
  checkLearnerText,
  cleanAiString,
  cleanString,
  crypto,
  emailSmtpPassword,
  emailSmtpUser,
  fenceUntrusted,
  geminiApiKey,
  getAnthropicApiKey,
  getApiKey,
  getUserRole,
  isAdminRole,
  isEditQuestionAction,
  isStaffRole,
  openaiApiKey,
  parseEditedQuestion,
  parseGeneratedQuiz,
  parseMarkerResponse,
  parseStructuredImport,
  passwordResetDayKey,
  passwordResetRateLimitKeys,
  passwordResetRateLimited,
  recordAppCheckCallable,
  refundPasswordResetAttempt,
  redactForLogs,
  resolveCbcContext,
  resolvePasswordResetContinueUrl,
  runAutoLabelDiagram,
  runClassListExtraction,
  runFromCala,
  runFunctionErrorWatch,
  runGenerateNoteSmart,
  runNamePictures,
  runNoteImport,
  runNoteInsights,
  runNoteOcr,
  runScannedQuizImport,
  runSuggestQuizAnswers,
  runVex,
  screenLearnerMessage,
  toAnthropicShape,
};

const quizAiHandlers = require("./quizAiHandlers").buildQuizAiHandlers(batch2HandlerDeps);
const noteAiHandlers = require("./noteAiHandlers").buildNoteAiHandlers(batch2HandlerDeps);
const visualAiHandlers = require("./visualAiHandlers").buildVisualAiHandlers(batch2HandlerDeps);
const chatHandlers = require("./chatHandlers").buildChatHandlers(batch2HandlerDeps);
const messagingHandlers = require("./messagingHandlers").buildMessagingHandlers(batch2HandlerDeps);
const agentOpsHandlers = require("./agentOpsHandlers").buildAgentOpsHandlers(batch2HandlerDeps);
const scheduledOpsHandlers = require("./scheduledOpsHandlers").buildScheduledOpsHandlers(batch2HandlerDeps);

// ── Phase 5 batch 3: payment/webhook + audit-surface bodies ─────────────
// The 11 highest-risk handlers — everything that moves money, grants paid
// access, or answers on an unauthenticated HTTP surface — moved to
// functions/paymentHandlers.js and functions/httpSurfaceHandlers.js. Their
// builders and every frozen option (region, timeout, memory, secrets, App
// Check) stay in this file, where the frozen-surface guard reads them.
//
// This sits AHEAD OF EVERY EXPORT deliberately, and batch 2 learned why the
// hard way: aiEndpointDiscovery attributes each line to the nearest preceding
// `exports.X`, so a deps object naming anthropicApiKey/openaiApiKey placed
// mid-file makes an unrelated export look provider-backed. Ahead of the first
// export it belongs to no span. The consts it reads are hoisted above for the
// same TDZ reason batch 2 documents there.
const batch3HandlerDeps = {
  CAPABILITY_AI_CHAT,
  CAPABILITY_PURCHASE,
  CHAT_HEARTBEAT_MS,
  HttpsError,
  LEARNER_BLOCK_MESSAGE,
  LIMITS,
  ZED_CHAT_MODEL,
  admin,
  anthropicApiKey,
  applyCors,
  assertAdminSecondFactor,
  assertDailyLimit,
  assertDecodedVerified,
  assertHttpRateLimit,
  assertLearnerCapability,
  assertVerifiedAuth,
  buildAnthropicChat,
  callAnthropic,
  callOpenAIStream,
  checkLearnerText,
  checkLearnerTextWindowed,
  cleanAiString,
  cleanString,
  crypto,
  emailSmtpPassword,
  emailSmtpUser,
  getAnthropicApiKey,
  getApiKey,
  getUserRole,
  googlePlaySaJson,
  httpStatusForError,
  isStaffRole,
  lencoApiKeyValue,
  lencoEmailSecrets,
  openaiApiKey,
  raisePlayConfigError,
  recordAppCheckCallable,
  redactForLogs,
  screenLearnerMessage,
  shouldSendWebhookAlert,
  softVerifyAppCheckHttp,
};

const paymentHandlers = require("./paymentHandlers").buildPaymentHandlers(batch3HandlerDeps);
const httpSurfaceHandlers = require("./httpSurfaceHandlers").buildHttpSurfaceHandlers(batch3HandlerDeps);

exports.appCheckPing = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 10,
    enforceAppCheck: false,
  },
  accountCallableHandlers.appCheckPing,
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

// ADMIN_EMAILS is an AUTHORIZATION allowlist, not a mailing list: every address
// here is an account that is born an administrator (resolveInitialUserRole
// below). The name says "bootstrap" so the next person wiring up an alert
// reaches for OPS_ALERT_EMAILS (functions/opsAlertRecipients.js) instead of
// widening this — routing a notification through an allowlist was how the two
// became the same switch in the first place.
function getAdminBootstrapEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

// Initial role for a brand-new account. Matching ADMIN_EMAILS is NOT enough —
// the address must also be PROVEN. The rule and its reasoning live in
// security/adminBootstrapCore.js so they are testable under plain `node`.
function resolveInitialUserRole(email, {emailVerified = false} = {}) {
  const {resolveInitialRole} = require("./security/adminBootstrapCore");
  return resolveInitialRole({
    email: cleanString(email, 254),
    emailVerified,
    adminEmails: getAdminBootstrapEmails(),
  });
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
            <a href="${resetLink}" style="display:inline-block;background:#c5613f;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:10px;">
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
  // Written with the ADMIN SDK (bypasses the users create rule) from a
  // callable that is exempt from assertVerifiedAuth — so an elevated token
  // role is accepted here only alongside a proven address. See
  // security/adminBootstrapCore.js.
  const {resolveBootstrapProfileRole} = require("./security/adminBootstrapCore");
  const emailVerified = authUser?.emailVerified === true;
  const role = resolveBootstrapProfileRole({
    tokenRole,
    email,
    emailVerified,
    adminEmails: getAdminBootstrapEmails(),
  });

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

const userRoleTrigger = require("./account/userRoleTrigger")
    .buildUserRoleTrigger({resolveInitialUserRole});

exports.setUserRole = functions.auth.user().onCreate(userRoleTrigger);

exports.bootstrapUserProfile = onCall(
  {region: "us-central1", timeoutSeconds: 20},
  accountCallableHandlers.bootstrapUserProfile,
);

// ── Self-service account deletion (Google Play data-deletion policy) ──
// A signed-in user can permanently delete their own account and personal
// data. This is the in-app half of the Play requirement; the Privacy
// Policy hosts the web-facing deletion instructions Play's Data Safety
// form links to. Purges Firestore first (functions/accountDeletion.js), then
// removes the Auth user so the session can no longer sign in.
//
// Because the purge is IRREVERSIBLE (LEGAL-003), request.auth alone is not
// enough — a stolen/persisted ID token could wipe an account with one call.
// Two guards close that:
//   • a short burst rate limit (assertCallableRateLimit), so a leaked token
//     can't hammer the endpoint; and
//   • a recent-login (re-auth) requirement: the client re-authenticates and
//     force-refreshes its token immediately before calling, so the token's
//     auth_time is fresh; a stale session is rejected with requires-recent-
//     login and the client re-prompts for identity.
// NOT gated on email verification (a user who mistyped their email must still
// be able to delete the account they can never verify — see authGuard.js).
exports.deleteMyAccount = onCall(
  {region: "us-central1", timeoutSeconds: 300},
  accountCallableHandlers.deleteMyAccount,
);

// ── Account-purge sweeper (the recovery half of the deletion order) ──
// deleteMyAccount destroys the session BEFORE it purges Firestore, which is
// what stops a still-live session rebuilding the profile mid-purge — and which
// means a purge that fails leaves data nobody can retry, because the account it
// belonged to is gone. Every deletion therefore writes an accountPurgeJobs/{uid}
// tombstone first; this cron adopts any that are still `pending` after 15
// minutes, re-runs the purge, and alerts once one has failed three times.
// Daily is enough: the handler's own purge is the fast path, this is the net.
// us-central1 per the repo convention for scheduled functions (Cloud Scheduler
// has no African region).
exports.accountPurgeSweep = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "Etc/UTC",
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "512MiB",
    secrets: opsAlertSecrets([emailSmtpUser, emailSmtpPassword]),
  },
  scheduledOpsHandlers.accountPurgeSweep,
);;

// ── Account-purge Storage RE-SWEEP (the surviving-token window) ──────
// Different job from the sweeper above, on a different query and cadence.
// `revokeRefreshTokens` + `deleteUser` stop the session being RENEWED; neither
// invalidates an ID token already minted, and those live 60 minutes. So for up
// to an hour after an account is destroyed, a tab still holding one can upload
// — after the auth-delete cascade (onUserDeleted) already enumerated the
// bucket. This re-enumerates that uid's Storage prefixes once the window has
// closed (75 min = 60 min token + 15 min slack) and deletes anything present.
//
// It replaces the storage.rules gate that #2258 added and #2399 removed. A
// rules predicate could only refuse a NEW write, so it never addressed the
// objects already written; and asking the question from the Storage rules
// engine required a cross-service firestore.exists() on every evaluation,
// which took uploads down for five days. Cleanup off the request path costs
// nothing per request and covers the window from both ends.
//
// Every 15 minutes so a job waits at most that long past its due time; the
// work is one Firestore query plus, for the handful of jobs actually due, a
// prefix listing each. us-central1 per the repo convention for scheduled
// functions (Cloud Scheduler has no African region).
exports.accountPurgeResweep = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "Etc/UTC",
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "512MiB",
    secrets: opsAlertSecrets([emailSmtpUser, emailSmtpPassword]),
  },
  scheduledOpsHandlers.accountPurgeResweep,
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
  accountCallableHandlers.assessRecaptcha,
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

// Give back what a FAILED attempt charged. The counters are incremented
// up-front on purpose — that ordering is what stops a concurrent burst from
// all reading the same pre-increment count — so the only correct place to
// undo one is after the failure is known.
//
// A compensating decrement, not a delete: another attempt may have
// incremented the same document in between, and deleting would wipe its
// charge too. Every refund pairs with exactly one increment, so the counter
// cannot be driven below zero by this path.
//
// Best-effort and awaited: the caller is already on its way to an error
// reply, and a refund that silently didn't happen would spend a user's daily
// allowance on our outage — the exact thing this exists to prevent.
async function refundPasswordResetAttempt(db, keys) {
  await Promise.all(
    (keys || []).filter(Boolean).map((key) =>
      db.collection(PWRESET_RL_COLLECTION).doc(key).set({
        day: passwordResetDayKey(),
        count: admin.firestore.FieldValue.increment(-1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true}).catch((err) => {
        console.warn("[sendPasswordResetEmail] rate-limit refund failed", err);
      })),
  );
}

exports.sendPasswordResetEmail = onCall(
  {secrets: [emailSmtpUser, emailSmtpPassword], region: "us-central1", timeoutSeconds: 30},
  messagingHandlers.sendPasswordResetEmail,
);;

// Zed chat model. Tune Zed independently of the shared OPENAI_MODEL default:
// set ZED_CHAT_MODEL (e.g. "gpt-4o") to upgrade just the study assistant
// without touching any other OpenAI call. When unset, callOpenAI/
// callOpenAIStream fall back to OPENAI_MODEL, then "gpt-4o-mini".

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
  chatHandlers.aiChat,
);;

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
}, paymentHandlers.resendInvoiceEmail);

// Admin-only — sends an activation confirmation to the customer's
// WhatsApp via the Meta Cloud API helper that's already wired for the
// parent digest (functions/metaWhatsApp.js). Soft-fails when the Meta
// secrets aren't bound so local dev still works; the admin UI falls
// back to the copy-paste WhatsApp deep link in that case.
exports.sendActivationConfirmation = onCall(
  {
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
  secrets: [...require("./metaWhatsApp").WHATSAPP_SECRETS],
},
  messagingHandlers.sendActivationConfirmation,
);;

// Admin-only — sends renewal nudges via WhatsApp to learners whose
// subscription expires soon (next 3 days) or recently lapsed (last 14
// days). Idempotent on a 20-hour cooldown: each user gets at most one
// reminder per day even if the button is clicked repeatedly.
//
// Returns a summary so the admin can see how many sends fired vs.
// were skipped (no phone on file, cooldown, Meta-not-configured).
exports.sendExpiryReminders = onCall(
  {
  region: "us-central1",
  timeoutSeconds: 120,
  memory: "256MiB",
  secrets: [...require("./metaWhatsApp").WHATSAPP_SECRETS],
},
  messagingHandlers.sendExpiryReminders,
);;

// Dawn — launch the on-demand "morning briefing" Managed Agent from the admin
// UI instead of a laptop script. This callable only STARTS the run (a couple of
// fast API calls) and returns the session id; the deliverDawnBriefings poller
// (functions/agents/cron.js) collects the briefing ~10 min later, emails it, and
// saves it onto dawnRuns/{sessionId} for the panel to render. The Anthropic key
// stays a server secret — it never reaches the browser. Config (the agent /
// environment / vault ids + the recipient email) lives in dawnConfig/default,
// set once from the same panel; we never put those in client code.
exports.runDawnBriefing = onCall(
  {
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
  secrets: [anthropicApiKey],
},
  agentOpsHandlers.runDawnBriefing,
);;

// Zed chat SSE transport — OpenAI-backed (see aiChat above for the model note).
exports.apiAiChat = onRequest(
  {secrets: [openaiApiKey], region: "us-central1", timeoutSeconds: 60},
  httpSurfaceHandlers.apiAiChat,
);

// ── Daily Quiz ──────────────────────────────────────────────────────
//
// getTodaysQuiz is the ONE read path: every surface that shows the daily
// quiz calls it, and nothing else reads the dailyQuizzes collection.
//
// The BUILDERS stay here and only the bodies live in functions/dailyQuiz/ —
// the shape `test:functions-manifest` requires, so that region, schedule and
// timeout stay inside the frozen surface it reads from this file.
exports.getTodaysQuiz = onCall(
    {region: "us-central1", timeoutSeconds: 60},
    dailyQuizFns.getTodaysQuizHandler,
);
exports.answerDailyQuizQuestion = onCall(
    {region: "us-central1", timeoutSeconds: 60},
    dailyQuizFns.answerDailyQuizQuestionHandler,
);
// 00:05 Lusaka. Nine small documents a night at most — but it reads the whole
// approved bank per grade, so it gets a generous timeout.
exports.buildDailyQuizzes = onSchedule(
    {schedule: "5 0 * * *", timeZone: "Africa/Lusaka", region: "us-central1", timeoutSeconds: 300},
    dailyQuizFns.buildDailyQuizzesHandler,
);
exports.adminDailyQuizOverview = onCall(
    {region: "us-central1", timeoutSeconds: 60},
    dailyQuizFns.adminDailyQuizOverviewHandler,
);
exports.adminDailyQuizFunnel = onCall(
    {region: "us-central1", timeoutSeconds: 60},
    dailyQuizFns.adminDailyQuizFunnelHandler,
);
exports.adminRunDailyQuizNow = onCall(
    {region: "us-central1", timeoutSeconds: 300},
    dailyQuizFns.adminRunDailyQuizNowHandler,
);
exports.adminSwapDailyQuizQuestion = onCall(
    {region: "us-central1", timeoutSeconds: 60},
    dailyQuizFns.adminSwapDailyQuizQuestionHandler,
);
exports.adminVoidDailyQuizQuestion = onCall(
    {region: "us-central1", timeoutSeconds: 300},
    dailyQuizFns.adminVoidDailyQuizQuestionHandler,
);

// Retained for HISTORY only — a learner's past daily-exam attempts stay
// readable and re-openable. Nothing promotes a new daily exam any more.
exports.getExamQuestions = getExamQuestionsFn;
exports.submitDailyExam = submitDailyExamFn;

exports.explainAnswer = onCall(
  {
    secrets: [anthropicApiKey],
    region: "us-central1",
    timeoutSeconds: 30,
    enforceAppCheck: shouldEnforceAppCheck("explainAnswer"),
  },
  quizAiHandlers.explainAnswer,
);;

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
  noteAiHandlers.generateNoteInsights,
);;

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
  noteAiHandlers.generateNoteSmart,
);;

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
  quizAiHandlers.editQuizQuestion,
);;

exports.generateQuizQuestions = onCall(
  {
    secrets: [anthropicApiKey],
    region: "us-central1",
    timeoutSeconds: 45,
    enforceAppCheck: shouldEnforceAppCheck("generateQuizQuestions"),
  },
  quizAiHandlers.generateQuizQuestions,
);;

// Vex — pre-publish quiz verifier. Synchronous: the editor calls this and
// blocks the publish flow on its result. No agentJobs / aiGenerations writes.
exports.verifyQuiz = onCall(
  {secrets: [anthropicApiKey], region: "us-central1", timeoutSeconds: 60,
    memory: "512MiB"},
  quizAiHandlers.verifyQuiz,
);;

exports.structureImportedQuiz = onCall(
  {
    secrets: [anthropicApiKey, geminiApiKey],
    region: "us-central1",
    // The pipeline calls two models sequentially, and a full 60-question
    // past paper needs a long Claude generation (~12K+ output tokens). The
    // old 90s deadline was routinely blown on real papers: the function
    // died mid-generation, the client retried, and the same thing happened
    // again — two rounds of provider spend, zero imported questions.
    // Budget: Gemini pre-pass (≤ ~40s) + Claude (bounded at ~300s by
    // undici's default headersTimeout on the non-streaming fetch).
    timeoutSeconds: 360,
    enforceAppCheck: shouldEnforceAppCheck("structureImportedQuiz"),
  },
  quizAiHandlers.structureImportedQuiz,
);;

// Scanned past-paper import for the Quiz Editor. The client rasterises an
// image-only PDF into page images and sends them here in batches; each call
// runs the dual-model OCR pipeline (Claude vision primary + Gemini assist)
// and returns blank-answer MCQs flagged for review. Higher memory + timeout
// than structureImportedQuiz because page images are large and vision is slow.
exports.structureScannedQuiz = onCall(
  {
    // openaiApiKey is bound so the recall assist can fall back to OpenAI vision
    // when the Gemini key is unset or the Gemini call fails.
    secrets: [anthropicApiKey, geminiApiKey, openaiApiKey],
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
  quizAiHandlers.structureScannedQuiz,
);;

// Notes document import — converts raw document text into structured `study`
// note blocks via Claude. Staff-only, app-check enforced, daily-capped.
exports.structureImportedNote = onCall(
  {
    secrets: [anthropicApiKey],
    region: "us-central1",
    timeoutSeconds: 120,
    enforceAppCheck: shouldEnforceAppCheck("structureImportedNote"),
  },
  noteAiHandlers.structureImportedNote,
);;

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
  noteAiHandlers.ocrNotePages,
);;

// Visual Studio v2 auto-labelling — one diagram image in, proposed labels
// out ({ word, anchor, confidence }). NOTHING IS WRITTEN: proposals go back
// to the editor as pre-filled manual labels the teacher reviews, drags,
// renames or deletes; low-confidence ones are flagged amber client-side.
exports.autoLabelDiagram = onCall(
  {
    secrets: [anthropicApiKey],
    region: "us-central1",
    timeoutSeconds: 120,
    memory: "1GiB",
    enforceAppCheck: shouldEnforceAppCheck("autoLabelDiagram"),
  },
  visualAiHandlers.autoLabelDiagram,
);;

// Class-list capture — the client photographs the pages of a written or
// printed class register and sends them here in batches; each call returns the
// learner rows read from those pages, per page, with a per-row confidence.
//
// NOTHING IS WRITTEN. The rows go back to the browser, the teacher reviews and
// corrects them on the import review screen, and the class list is written
// from there. A class list is the register's source of truth for a whole year;
// it is not something a model gets to create unattended.
exports.extractClassListPages = onCall(
  {
    secrets: [anthropicApiKey],
    region: "us-central1",
    timeoutSeconds: 240,
    memory: "1GiB",
    enforceAppCheck: shouldEnforceAppCheck("extractClassListPages"),
  },
  visualAiHandlers.extractClassListPages,
);;

// Bulk "suggest answers" for the Quiz Editor's answer-key tools. Answers a
// batch of MCQs in one Claude call; the admin verifies before publishing.
exports.suggestQuizAnswers = onCall(
  {
    secrets: [anthropicApiKey],
    region: "us-central1",
    timeoutSeconds: 120,
    enforceAppCheck: shouldEnforceAppCheck("suggestQuizAnswers"),
  },
  quizAiHandlers.suggestQuizAnswers,
);;

exports.checkShortAnswer = onCall(
  {
    // openaiApiKey is bound for the AI-003 learner-safety moderation of the
    // student's free-text answer (the marking model itself is Anthropic).
    secrets: [anthropicApiKey, openaiApiKey],
    region: "us-central1",
    timeoutSeconds: 30,
    enforceAppCheck: shouldEnforceAppCheck("checkShortAnswer"),
  },
  quizAiHandlers.checkShortAnswer,
);;

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

      // Declared Content-Type + body cap (SECURITY_ENDPOINT_AUDIT §4.5), while
      // an ordinary JSON error response is still possible — once the SSE
      // headers go out the only way to report a rejection is an error event.
      // The client (src/utils/teacherTools.js) sends application/json.
      if (require("./httpRequestGuard").enforceJsonRequest(req, res, {label: `api${tool}`})) return;

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
        // The idempotency key travels in the POST body, exactly as it travels
        // in the callable's payload — the SSE endpoint is a SECOND DOOR into
        // the same runner, and a door that does not carry the key is a door
        // with no duplicate protection behind it.
        //
        // This is how generateWorksheet's primary "Generate" reached the
        // provider with no reservation at all while its regenerate button was
        // fully protected: the studio generates via this stream and only
        // regenerates via the callable, so the migration that hardened the
        // callable never touched the path teachers actually use.
        const result = await runCore({
          uid,
          rawInputs: req.body || {},
          idempotencyKey: (req.body || {}).idempotencyKey,
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

// Past Paper Studio — staff-only paper-file URL resolver (crop-from-page
// fallback; see functions/teacherTools/paperAssetUrl.js).
exports.resolvePaperAssetUrl = createResolvePaperAssetUrl();

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

// Teacher Tools — Assessment plan (§3.1). Derives the paper's plan — sections,
// per-question topic/outcome/thinking level/difficulty/marks — and returns it for
// the teacher to confirm BEFORE anything is generated. No model call, no secret,
// no usage charge: Firestore reads and arithmetic. The plan the teacher confirms
// is sent back with the generate call and re-checked there.
exports.planAssessment = createPlanAssessment();

// Teacher Tools — rewrite ONE question of a paper (§3.6), bound to the slot that
// question occupies in the paper's plan so the paper stays balanced. Cheap (Haiku,
// one item) and metered on revise_question, not the paper allowance: fixing one
// question must not cost a whole paper.
exports.regenerateAssessmentQuestion =
  createRegenerateAssessmentQuestion(anthropicApiKey);

// Teacher Tools — SBA Studio (ECZ School Based Assessment task, Grades 5–7).
exports.generateSbaTask = createGenerateSbaTask(anthropicApiKey);

// Teacher Tools — Quiz (short curriculum-grounded formative quiz).
exports.generateQuiz = createGenerateQuiz(anthropicApiKey);

// The generateExamPaper callable was retired 2026-07: no frontend ever called
// it — every assessment type, test AND examination, generates through the
// one generateAssessment (Assessment Paper Studio; assessmentType is one of
// topic_test/weekly_test/mid_term/end_of_term/mock_exam/examination/
// final_exam — see functions/teacherTools/assessmentFormats.js). Legacy
// `tool:'exam_paper'` aiGenerations docs still render in the library via
// src/utils/aiPaperToSections.js.

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
  visualAiHandlers.nameBankPictures,
);;

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
    anthropicApiKey, opsAlertSecrets([emailSmtpUser, emailSmtpPassword]));
exports.agentJobsOnApproved = createAgentJobsOnApproved(
    opsAlertSecrets([emailSmtpUser, emailSmtpPassword]));

// Central Question Bank — Qix reviews each captured question (questionBank/{id})
// in the background and writes a verdict back onto the doc (africa-south1).
// OpenAI key powers the embedding-based semantic duplicate check (optional —
// review degrades gracefully without it).
exports.questionReviewOnWrite = createQuestionReviewOnWrite(anthropicApiKey, openaiApiKey);

// Live challenge (PROMPT 9) — server-authoritative learner-vs-learner race.
// The trigger pairs queued players and creates the match (africa-south1,
// colocated with the database); the callable grades raw answers against the
// server's copy of the questions — a score is never accepted from a client.
const {createDuelQueueOnCreate, createSubmitDuelAnswers} = require("./duel");
exports.duelQueueOnCreate = createDuelQueueOnCreate();
exports.submitDuelAnswers = createSubmitDuelAnswers();

// Central Question Bank — admin-only grade classifier for the one-click
// "Import existing questions" backfill (/admin/import-questions). Given a batch
// of questions whose syllabus topic didn't map to one grade, returns the CBC
// grade (4-7) for each via the shared gradeReclassifier (Haiku).
exports.classifyQuestionGrades = onCall(
  {secrets: [anthropicApiKey], timeoutSeconds: 120, memory: "256MiB"},
  agentOpsHandlers.classifyQuestionGrades,
);;

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
  agentOpsHandlers.retryAgentJob,
);;


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

// Daily Firestore backup export (Africa/Lusaka 01:30). Kicks off a Firestore
// Admin exportDocuments run into the FIRESTORE_BACKUP_BUCKET GCS bucket and
// records the outcome in opsBackups/{date}; alerts ops on failure. Safe to
// deploy before the bucket exists — unconfigured runs skip with a warning.
// Setup (bucket, IAM, PITR) is documented in functions/firestoreBackup.js.
exports.dailyFirestoreBackup = require("./firestoreBackup").dailyFirestoreBackup;
// Async completion checker (Africa/Lusaka 03:30) — exportDocuments is a
// long-running op, so the 01:30 run records "started"; this reads the recent
// "started" summaries back and flips them to "completed" (or records a real
// post-acceptance failure) so the DR floor is verified unattended (DR-007).
exports.backupCompletionCheck = require("./firestoreBackup").backupCompletionCheck;
// Storage-backup health check (Africa/Lusaka 04:00) — verifies the operator's
// cross-region Storage Transfer Service mirror actually ran (a recent object in
// the backup bucket), recording opsStorageBackups/{date} and alerting ops when
// the mirror is misconfigured / empty / stale. Closes DR-003 (Storage had no
// verified backup). Safe to deploy before STORAGE_BACKUP_BUCKET is set.
exports.storageBackupCheck = require("./storageBackup").storageBackupCheck;
exports.storageBackupHeartbeat = require("./storageBackup").storageBackupHeartbeat;
// Rate-limiter health canary (hourly) — probes the fail-open burst limiter and
// raises an ops alert (edge-triggered) when it is degraded, turning the
// `rate_limit_degraded` telemetry into an actual notification (OBS-005/OBS-004).
exports.rateLimitHealthCheck = require("./rateLimitHealth").rateLimitHealthCheck;
// Cross-subsystem dead-man's-switch (every 6h) — alerts if any ops heartbeat
// (opsBackups / opsStorageBackups / opsRateLimitHealth) goes stale/missing,
// i.e. a scheduled monitor's OWN trigger stopped firing (OBS-004).
exports.opsHeartbeatCheck = require("./opsHeartbeat").opsHeartbeatCheck;

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

// Platform metrics — the DAU / WAU / retention rollup. Runs 00:30 Africa/Lusaka
// over the day that just ended and writes platformStats/{YYYY-MM-DD}.
//
// This is the answer to a question neither existing analytics surface can
// reach: visitorStats counts anonymous pageviews with no uid attached, and
// PostHog runs learners with identify:false by deliberate children's-privacy
// policy, so a learner's events can never be joined into a cohort there. This
// derives activity first-party from documents the product already writes
// (results, scores, exam_attempts) — no new client instrumentation, no third
// party, no cookie-consent dependency. Admin-read; server-only write.
exports.rollUpPlatformMetrics = rollUpPlatformMetricsCron;

// Class Register Studio — server-validated attendance writes (see
// functions/attendance/). Rules deny direct client writes to the
// attendance subcollection, so this is the only write path.
exports.saveClassAttendance = saveClassAttendance;

// B4 follow-up — daily AI cost summary. Runs 02:00 Africa/Lusaka,
// summarises yesterday's spend, and emails ADMIN_EMAILS when
// yesterday > 2× the 7-day median. Always writes an agentJobs
// rollup so /admin/agents shows the run alongside the other crons.
exports.aiCostDailySummary = aiCostDailySummary;

// Hourly reclaim of expired AI-budget reservations — frees budget a
// crashed/timed-out call left on hold even when no contention triggers
// the reserve path's own lazy reclaim (aiBudgetReclaim.js).
exports.reclaimAiBudgetReservations = reclaimAiBudgetReservations;

// Admin-only budget-enforcement summary (ceiling status + per-provider
// reservation breakdown) for /admin/ai-costs. The reservation buckets are
// server-only, so the dashboard reads them through this callable.
exports.getAiBudgetEnforcement = getAiBudgetEnforcement;

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
// The child's answer to "is this your grown-up?". Redeeming a code now
// creates a PENDING link and this is what makes it real — see the header
// of functions/familyPortal.js.
exports.respondToFamilyLink = respondToFamilyLink;
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

// Admin-only "does the alarm actually ring?" check — fires one real ops alert
// (severity info) down both channels and reports per-channel delivery. Same
// binding wrapper as every other alerting function, so it proves the webhook
// binding rather than testing a path of its own. (lencoEmailSecrets is the
// shared SMTP-secret reader despite the name — raisePlayConfigError uses it too.)
exports.sendTestOpsAlert = require("./opsAlertTest").createSendTestOpsAlert(
    lencoEmailSecrets, opsAlertSecrets([emailSmtpUser, emailSmtpPassword]));

// Cloud Functions error monitoring (docs/architecture/13-cloud-functions-register.md).
// Sentry is frontend-only — it cannot see a Cloud Function fail, which is how
// 80 errors from apiTrackVisit went unnoticed on 2026-08-09. This reads Cloud
// Logging every 5 minutes and routes anything worth saying through the same
// sendOpsAlert channel as every other alarm.
// Declared through an alias rather than `require(...).x` on purpose: the
// frozen-surface follower resolves `const m = require("./mod")` + `m.name`, but
// records the inline `require('./x').y` form as factory-built and therefore
// unguarded. That blind spot is what hid apiTrackVisit's 128MiB, so a function
// added BECAUSE of that incident should not join it.
// The builder lives HERE, not in the module: the module carries decisions and
// is unit-tested under the root install, which has firebase-admin but not
// firebase-functions. It is also where Phase 5 wants every builder, so the
// frozen-surface guard reads these options directly from index.js.
exports.functionErrorWatch = onSchedule(
  {
  schedule: "every 5 minutes",
  region: "us-central1",
  timeoutSeconds: 120,
  memory: "256MiB",
  secrets: opsAlertSecrets([emailSmtpUser, emailSmtpPassword]),
},
  scheduledOpsHandlers.functionErrorWatch,
);;

// Admin-only drill: injects a synthetic memory kill and runs the REAL watch,
// so what is proven is the whole path (classifier → thresholds → channel →
// secret bindings), not just that the mailer works. Same binding wrapper as
// every other alerting function.
exports.sendTestFunctionErrorAlert =
    require("./monitoring/functionErrorWatchTest").createSendTestFunctionErrorAlert(
        opsAlertSecrets([emailSmtpUser, emailSmtpPassword]));

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

// Read-only quote for the checkout screen: the server-computed amount due
// today, whether it's a prorated Pro→Max upgrade, and the renewal date a
// successful payment would produce. The client DISPLAYS this and echoes
// amountZMW back as expectedAmountZMW on initiation, where it's verified —
// the server remains the only authority for the amount actually charged.
exports.getUpgradeQuote = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
}, paymentHandlers.getUpgradeQuote);

exports.initiateLencoPayment = onCall({
  secrets: [lencoApiKey, emailSmtpUser, emailSmtpPassword],
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
}, paymentHandlers.initiateLencoPayment);

exports.submitLencoOtp = onCall({
  secrets: [lencoApiKey, emailSmtpUser, emailSmtpPassword],
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
}, paymentHandlers.submitLencoOtp);

exports.getLencoPaymentStatus = onCall({
  secrets: [lencoApiKey, emailSmtpUser, emailSmtpPassword],
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
}, paymentHandlers.getLencoPaymentStatus);

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
}, paymentHandlers.recoverMyPendingPayments);

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
      opsAlertEmails: process.env.OPS_ALERT_EMAILS,
      adminEmails: process.env.ADMIN_EMAILS,
      fallbackSender: senderEmail,
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
  secrets: opsAlertSecrets([googlePlaySaJson, emailSmtpUser, emailSmtpPassword]),
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
  enforceAppCheck: shouldEnforceAppCheck("verifyGooglePlayPurchase"),
}, paymentHandlers.verifyGooglePlayPurchase);

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
  secrets: opsAlertSecrets([lencoApiKey, emailSmtpUser, emailSmtpPassword]),
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
}, paymentHandlers.lencoWebhook);

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
}, httpSurfaceHandlers.apiWhatsAppWebhook);

exports.apiTextToSpeech = require('./tts').apiTextToSpeech;
exports.getTtsControlRoom = require('./ttsAdmin').getTtsControlRoom;
// Builders here, bodies in ttsAdmin.js — the frozen-surface guard requires a
// NEW export's options to live in this file. previewTtsVoice binds its own
// defineSecret instance for ELEVENLABS_API_KEY (duplicates of one name are
// the accepted pattern — see the SMTP pair in firestoreBackup.js).
const elevenLabsApiKeyTts = defineSecret("ELEVENLABS_API_KEY");
exports.setTtsOfferedVoices = onCall(
    {region: "us-central1", memory: "256MiB", timeoutSeconds: 30},
    require('./ttsAdmin').setTtsOfferedVoicesHandler,
);
exports.previewTtsVoice = onCall(
    {
      region: "us-central1",
      memory: "256MiB",
      timeoutSeconds: 30,
      secrets: [elevenLabsApiKeyTts],
    },
    require('./ttsAdmin').previewTtsVoiceHandler,
);

// Website visitor tracker — unauthenticated beacon the SPA POSTs on each
// route change. Records page-view docs + daily rollups for /admin/visitors.
// See functions/visitorTracking.js (privacy posture + Firestore shape).
exports.apiTrackVisit = require('./visitorTracking').apiTrackVisit;
// Scheduled rollup: sums the sharded per-pageview counters into the day doc the
// /admin/visitors dashboard reads (every 5 min, Lusaka today + yesterday).
exports.aggregateVisitorStats = require('./visitorTracking').aggregateVisitorStats;

// Public account-deletion request form (zedexams.com/delete-account), reached
// via the /api/account/delete-request Hosting rewrite. Google Play requires a
// deletion route that does NOT need the app — for someone who lost their
// password or device, or a parent acting for a child. It RECORDS a request for
// a human to verify; it never deletes. The destructive path stays
// `deleteMyAccount` above, which is authenticated and requires a fresh login.
exports.apiRequestAccountDeletion =
  require('./accountDeletionRequests').apiRequestAccountDeletion;

// ── Guardian consent (Families policy / Zambia DPA) ────────────────────────
// Learners under 18 need a parent or guardian to approve the account before it
// leaves limited mode. sendGuardianConsent messages the guardian;
// apiGuardianConsent renders the decision page behind the /consent rewrite and
// applies the answer; recordAgeGateAttempt is the neutral age screen's
// retry cooldown (unauthenticated — it runs before an account exists).
// See functions/guardianConsent/ and functions/shared/consent/.
exports.sendGuardianConsent = require('./guardianConsent').sendGuardianConsent;
exports.apiGuardianConsent = require('./guardianConsent').apiGuardianConsent;
exports.recordAgeGateAttempt = require('./guardianConsent').recordAgeGateAttempt;

// "Ask your guardian to unlock this" — the under-18 half of the paywall. A
// learner under 18 is never shown a price; they tap a lock and this sends
// their guardian a progress report with the offer at the end of it. Rate
// limited to one per learner per 72 hours SERVER-SIDE (the client's copy of
// that rule runs on the learner's device and is a courtesy to the button).
// See functions/guardianUnlock/ and functions/shared/guardian/.
exports.requestGuardianUnlock = require('./guardianUnlock').requestGuardianUnlock;

// The Guardian Zone's permission controls. The ONLY writer of
// users/{uid}.guardianControls — that field is on the users self-update
// blocklist in firestore.rules, so a client cannot set it directly. Turning
// a control off is enforced server-side in consentGuard.assertLearnerCapability
// (the one gate both the aiChat callable and the apiAiChat SSE endpoint pass
// through), and every change appends to guardianControlAudit and emails the
// guardian — the zone runs in the child's own session, so the guarantee is
// "cannot change silently", not "cannot change".
// See functions/guardianControls/ and functions/shared/guardian/.
exports.setGuardianControl = require('./guardianControls').setGuardianControl;

// ── Account deletion: the child asks, the guardian decides ───────────
//
// Deleting a child's account is a state machine, not a button, and the reason
// is that three requirements pull against each other: a minor's account is the
// guardian's responsibility, a guardian who never answers must not be able to
// trap a child inside the product, and a child whose "guardian" is the wrong
// adult must never be made to ask that adult for permission.
//
//   pending_guardian --approve--> scheduled --30 days--> completed
//          |                          `--restore/sign-in--> cancelled
//          |--decline--> declined
//          |--7 days---> escalated_support     (silence is not a veto)
//          `--cancel---> cancelled
//
// Nothing is deleted until `completed`. `scheduled` in particular is a LIVE
// account with a banner on it — the 30 days are the product, not a formality —
// and the purge runs in exactly one place, the daily executor, never in a
// callable and never on approval.
//
// Decisions are pure and node-tested in deletionFlow/deletionRequestCore.js;
// the sweeps' write ORDER (purge first, `completed` second) is tested in
// deletionFlow/deletionSweeps.test.js, because writing `completed` on a purge
// that then failed would mark an account deleted that still exists and hide it
// from every future sweep.
//
// `accountDeletionRequests`, NOT `deletionRequests` — the latter is the public,
// email-keyed /delete-account portal Google Play requires and has a different
// shape, lifecycle and security posture. See functions/deletionFlow/.
const deletionFlow = require('./deletionFlow');
const DELETION_CALL_OPTS = {
  secrets: deletionFlow.DELETION_FLOW_SECRETS,
  region: 'us-central1',
  timeoutSeconds: 60,
};

exports.requestAccountDeletion = onCall(DELETION_CALL_OPTS, deletionFlow.requestAccountDeletion);
exports.respondToDeletionRequest = onCall(DELETION_CALL_OPTS, deletionFlow.respondToDeletionRequest);
exports.cancelDeletionRequest = onCall(DELETION_CALL_OPTS, deletionFlow.cancelDeletionRequest);
exports.getDeletionRequest = onCall(DELETION_CALL_OPTS, deletionFlow.getDeletionRequest);
exports.reportWrongGuardian = onCall(DELETION_CALL_OPTS, deletionFlow.reportWrongGuardian);

// The 7-day escalation and the day-25 reminders.
//
// Every 6 hours rather than daily, and the difference belongs to the child: a
// daily sweep means a request that came due at 09:00 waits until tomorrow's
// run, so the "seven days" they were promised is really seven-to-eight. Four
// runs a day costs four Firestore queries and makes the number honest.
exports.deletionRequestSweep = onSchedule(
  {
    schedule: 'every 6 hours',
    timeZone: 'Etc/UTC',
    region: 'us-central1',
    timeoutSeconds: 540,
    memory: '256MiB',
    secrets: deletionFlow.DELETION_FLOW_SECRETS,
  },
  async () => {
    const summary = await deletionFlow.runDeletionRequestSweep();
    console.log('[deletionRequestSweep]', JSON.stringify(summary));
  },
);

// The 30-day window closing. Daily is right here, unlike the sweep above:
// being a few hours late to DELETE errs in the direction of the account still
// existing, which is the survivable mistake. Being early is not.
exports.deletionExecutionSweep = onSchedule(
  {
    schedule: 'every 24 hours',
    timeZone: 'Etc/UTC',
    region: 'us-central1',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: deletionFlow.DELETION_FLOW_SECRETS,
  },
  async () => {
    const summary = await deletionFlow.runScheduledDeletionExecution();
    console.log('[deletionExecutionSweep]', JSON.stringify(summary));
  },
);

// ── The guardian↔learner LINK lifecycle ────────────────────────────────
//
// The link record IS the relationship: consent, permissions, role and
// entitlement all hang off `parentLinks/{parentUid}_{learnerUid}`, and the
// learner's own state is DERIVED from the set (approved iff at least one
// link is approved). Two doors create one — the child naming a guardian's
// email (guardianConsent/) and a parent typing a family code
// (familyPortal.js) — and both converge on ONE guardian account, matched
// on the verified address (guardianLink/convergence.js).
//
// These five own what happens to a link after it exists:
//
//   (the child's accept/decline is respondToFamilyLink, in
//    functions/familyPortal.js — `status` is the confirmation flag and
//    that flow owns it. What lives here is everything `status` cannot
//    express.)
//   requestGuardianUnlink   the child asks to be unlinked. Files a
//                           request; removes nobody. See the module
//                           docblock for why this one is not immediate,
//                           and for the Childline route that pays for it.
//   reportGuardianLink      "this isn't my grown-up." Removes an
//                           unconfirmed link outright, flags a confirmed
//                           one for review, and never silently does
//                           nothing.
//   withdrawGuardianConsent the guardian ends it. The child returns to
//                           limited mode only if no OTHER guardian's
//                           approval is still standing.
//   setLinkPermission       one guardian's own view on one permission,
//                           written to THEIR link. Two guardians who
//                           disagree are both recorded and resolved
//                           most-restrictive-wins at read time.
//
// Every transition appends to `guardianLinkAudit` (server-only,
// append-only), because /child-safety promises a guardian can see what we
// hold and "who approved what, when" cannot be reconstructed from a
// mutable document after the fact.
const guardianLink = require('./guardianLink');
exports.requestGuardianUnlink = guardianLink.requestGuardianUnlink;
exports.reportGuardianLink = guardianLink.reportGuardianLink;
exports.withdrawGuardianConsent = guardianLink.withdrawGuardianConsent;
exports.setLinkPermission = guardianLink.setLinkPermission;

// The rules-readable mirror of the fold above. A Firestore rule can `get()`
// one document but cannot run a query, so "does this learner have an
// approved link" is unaskable in firestore.rules — and the leaderboard is
// written straight from the client with no function in the path. This
// trigger mirrors the answer onto `users/{uid}.guardian.effective` where a
// rule can reach it. It is a CACHE: nothing that can read the live links
// reads it instead. Pinned to africa-south1 like every Firestore trigger.
exports.onParentLinkWritten = require('./guardianLink/onLinkWritten').onParentLinkWritten;

// ── The parent app (PROMPT 8g) — the guardian's OWN logged-in surface ──
//
// Distinct from the Guardian Zone above, which renders the same data inside
// the CHILD's app behind a friction gate. These callables are called by a
// verified adult signed in as themselves, on their own device.
//
// Almost all of them are callables rather than client reads for one reason:
// a parent may read `parentLinks` only for rows that name them, and every
// question this surface asks (who else guards this child, which of us owns
// the account, may I approve this) needs the OTHER rows. Answering
// server-side behind an explicit check is the alternative to widening that
// rule until the client can answer for itself.
//
// setChildGuardianControl is the second writer of users/{uid}.guardianControls
// and the stronger of the two — the caller is an authenticated guardian
// rather than whoever passed a times-table sum on the child's phone. It
// writes the same guardianControlAudit trail, stamped with who did it.
// See functions/parentApp/.
// The BUILDERS stay here and only the bodies live in functions/parentApp/ —
// test:functions-manifest's rule, and the reason for it is that a bare
// re-export takes an export's region, secrets and runtime options out of that
// guard's sight.
const parentApp = require('./parentApp');

// Read-only reads. No secrets; 512MiB because listGuardianChildren fans out
// over every linked child.
exports.listGuardianChildren = onCall({
  region: "us-central1", timeoutSeconds: 60, memory: "512MiB",
}, parentApp.listGuardianChildren);

exports.getGuardianChildDetail = onCall({
  region: "us-central1", timeoutSeconds: 60, memory: "512MiB",
}, parentApp.getGuardianChildDetail);

exports.getGuardianChildActivity = onCall({
  region: "us-central1", timeoutSeconds: 60, memory: "512MiB",
}, parentApp.getGuardianChildActivity);

exports.listGuardianApprovals = onCall({
  region: "us-central1", timeoutSeconds: 60, memory: "512MiB",
}, parentApp.listGuardianApprovals);

exports.getGuardianWeeklyReport = onCall({
  region: "us-central1", timeoutSeconds: 60, memory: "512MiB",
}, parentApp.getGuardianWeeklyReport);

// Writes. setChildGuardianControl carries the SMTP secrets because a control
// change mails the guardian — the same "cannot change silently" promise
// setGuardianControl makes above.
exports.setChildGuardianControl = onCall({
  secrets: [emailSmtpUser, emailSmtpPassword],
  region: "us-central1", timeoutSeconds: 30,
}, parentApp.setChildGuardianControl);

exports.declineGuardianApproval = onCall({
  region: "us-central1", timeoutSeconds: 30,
}, parentApp.declineGuardianApproval);

// Family sharing. inviteCoGuardian mails the invite; accept/remove do not.
exports.inviteCoGuardian = onCall({
  secrets: [emailSmtpUser, emailSmtpPassword],
  region: "us-central1", timeoutSeconds: 30,
}, parentApp.inviteCoGuardian);

exports.acceptCoGuardianInvite = onCall({
  region: "us-central1", timeoutSeconds: 30,
}, parentApp.acceptCoGuardianInvite);

exports.removeCoGuardian = onCall({
  region: "us-central1", timeoutSeconds: 30,
}, parentApp.removeCoGuardian);

// Guardian consent, granted or withdrawn from the parent app. Owner-only
// server-side; withdrawing writes the same denied/suspended/scheduled-for-
// deletion record the emailed "this wasn't me" link writes, through the one
// shared builder in guardianConsent/consentRecord.js.
exports.setGuardianConsent = onCall({
  region: "us-central1", timeoutSeconds: 30,
}, parentApp.setGuardianConsent);

// The guardian pay link. UNAUTHENTICATED by design: the guardian who
// receives requestGuardianUnlock's email may have no ZedExams account, and a
// link that demands a sign-in before it will say what it is about is a link
// people close. It requires the 32-byte raw token (never stored — the request
// doc id is its sha256), returns only what that email already told them, and
// grants nothing; paying still goes through the authorised checkout.
exports.resolveGuardianPayLink = onCall({
  region: "us-central1", timeoutSeconds: 30,
}, parentApp.resolveGuardianPayLink);

// The Sunday report, for parent ACCOUNTS. Not a duplicate of
// weeklyParentDigest: that one fans out over `progressShares` (the anonymous
// link a learner hands to a parent with no account), this one over
// `parentLinks` (real guardian accounts). The populations do not overlap, so
// a family gets one email. It renders the SAME words as the Reports screen,
// because a parent who reads the email and then opens the app must not find
// a different account of the same week — and a quiet week is not emailed at
// all. See functions/parentApp/weeklyGuardianReport.js.
exports.weeklyGuardianReport = onSchedule({
  schedule: "every sunday 09:00",
  timeZone: "Africa/Lusaka",
  secrets: [emailSmtpUser, emailSmtpPassword],
  region: "us-central1",
  timeoutSeconds: 540,
  memory: "512MiB",
}, require('./parentApp/weeklyGuardianReport').runWeeklyGuardianReport);
// Re-derives isMinor from the declared date of birth on user-doc creation, so
// the flag the consent gate reads is never the one the client wrote. Pinned to
// africa-south1 with the (default) database.
exports.learnerAgeOnUserCreated =
  require('./guardianConsent/onUserCreated').learnerAgeOnUserCreated;

// Server-generated library downloads: regenerate a saved document on the server
// and stream it from zedexams.com with the correct filename — no upload, no
// Firebase Storage, works on every browser. See functions/libraryDownload.js.
const libraryDownload = require('./libraryDownload');
exports.createLibraryDownloadTicket = libraryDownload.createLibraryDownloadTicket;
exports.apiLibraryDownload = libraryDownload.apiLibraryDownload;
exports.reapDownloadTickets = libraryDownload.reapDownloadTickets;

// Versioned, cached assessment exports: source-hash keyed Storage objects served
// through the branded same-origin endpoint /downloads/assessments/:id/:type so a
// download comes FROM zedexams.com (never firebasestorage.googleapis.com) and an
// unchanged paper streams its pre-generated file. See functions/assessmentExports/.
const assessmentExports = require('./assessmentExports/exportService');
exports.requestAssessmentExport = assessmentExports.requestAssessmentExport;
exports.getAssessmentExportStatus = assessmentExports.getAssessmentExportStatus;
exports.prewarmAssessmentExports = assessmentExports.prewarmAssessmentExports;
exports.apiAssessmentDownload = assessmentExports.apiAssessmentDownload;
exports.reapAssessmentExportsOnDelete = assessmentExports.reapAssessmentExportsOnDelete;

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

// Super-admin MFA recovery — remove a locked-out admin's TOTP factors, revoke
// their sessions, force re-enrolment. See functions/security/resetAdminMfa.js.
exports.resetAdminMfa = require("./security/resetAdminMfa").resetAdminMfa;

// Client-called logger for admin MFA enrolment events (started/completed/
// failed) → securityAuditLogs. See functions/security/logAdminMfaEvent.js.
exports.logAdminMfaEvent = require("./security/logAdminMfaEvent").logAdminMfaEvent;

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
}, paymentHandlers.bulkGrantDemoTrials);

// Passkey (WebAuthn) sign-in was removed 2026-08-17 — the eleven passkey
// callables (seven us-central1 + four africa-south1 twins) and functions/
// passkeys/ are gone. Google + email/password sign-in are unaffected.
// accountDeletion.js still purges the legacy passkey collections.
