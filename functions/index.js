const functions = require("firebase-functions/v1");
const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("node:crypto");
const nodemailer = require("nodemailer");

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
const {resolveAppCheckEnforcement} = require("./appCheckEnforcement");
const {
  resolveShardCount: resolveAppCheckShardCount,
  resolveSampleRate: resolveAppCheckSampleRate,
  weightForSampleRate: appCheckWeightForSampleRate,
  shouldSample: shouldSampleAppCheck,
  pickShardId: pickAppCheckShardId,
  classifyOutcome: classifyAppCheckOutcome,
  buildHealthShardUpdate: buildAppCheckShardUpdate,
} = require("./appCheckHealthCore");
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
  // Best-effort observability — sharded + sampled so it never becomes a
  // per-request hotspot on one daily doc (see appCheckHealthCore.js).
  await recordAppCheckHealth({
    label,
    tokenPresent: Boolean(token),
    verified: Boolean(verified),
    canDistinguishInvalid: true, // HTTP path: token-but-unverified == invalid
  });
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
  // A callable can't tell "no token" from "invalid token", so an
  // unverified call folds into "missing" (canDistinguishInvalid: false).
  await recordAppCheckHealth({
    label,
    tokenPresent: verified, // callables only surface a token when it verified
    verified,
    canDistinguishInvalid: false,
  });
}

// Shared writer for the App Check health telemetry. Sampled (only a
// fraction of requests write) and sharded (writes fan out across N docs)
// so it can never serialise the request path on one hot daily document.
// ALWAYS best-effort: sampling-out and any Firestore error are swallowed
// so a metrics failure can never fail or delay App Check verification.
async function recordAppCheckHealth({label, tokenPresent, verified, canDistinguishInvalid}) {
  try {
    const sampleRate = resolveAppCheckSampleRate();
    if (!shouldSampleAppCheck(sampleRate)) return; // not selected → no write
    const date = new Date().toISOString().slice(0, 10);
    const shardCount = resolveAppCheckShardCount();
    const shardId = pickAppCheckShardId(shardCount);
    const outcome = classifyAppCheckOutcome({tokenPresent, verified, canDistinguishInvalid});
    const inc = (n) => admin.firestore.FieldValue.increment(n);
    const update = buildAppCheckShardUpdate({
      label, outcome, weight: appCheckWeightForSampleRate(sampleRate), inc,
    });
    update.date = date;
    update.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await admin.firestore()
        .collection("appCheckHealth").doc(date)
        .collection("shards").doc(String(shardId))
        .set(update, {merge: true});
  } catch (err) {
    console.warn(`[appCheck:${label}] health write failed`, err?.message || err);
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
  nodemailer,
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
// SSE keep-alive interval while apiAiChat buffers + moderates. Comfortably under
// the client's 30s stall watchdog (src/utils/aiAssistant.js AI_CHAT_STREAM_STALL_MS).
const CHAT_HEARTBEAT_MS = 10000;

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
  async (req, res) => {
    // Browser CORS via the shared origin allow-list. The default header
    // set already includes X-Firebase-AppCheck (Audit B3).
    applyCors(req, res);

    // Structured logging + correlation id (OBS-003): trace this request by the
    // id the client sent (src/utils/requestId.js), or mint one, and echo it back
    // so a browser can report it. Every log line below carries `rid`.
    const {createLogger, requestIdFromReq} = require("./logger");
    const rid = requestIdFromReq(req);
    res.set("x-request-id", rid);
    const log = createLogger("apiAiChat", {rid});

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
    let moderationBlocked = false;
    // Set when learnerSafetyCore intercepts a distress or secrecy message.
    // Streamed verbatim instead of the model reply — see below.
    let safetyReply = null;
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

      // Families policy — same gate as the `aiChat` callable. This is the path
      // the SPA actually uses, so gating only the callable would leave the
      // real door open.
      await assertLearnerCapability(decoded.uid, CAPABILITY_AI_CHAT);

      const message = cleanAiString(req.body?.message, LIMITS.message);
      if (!message) {
        throw new HttpsError("invalid-argument", "Please enter a question for Zed.");
      }

      const role = await getUserRole(decoded.uid);
      await assertDailyLimit(decoded.uid, role, "chat");

      log.info("chat_request", {uid: decoded.uid, role});

      // Deterministic child-safety handling, ahead of moderation and the
      // model — same rule as the `aiChat` callable. A child disclosing
      // self-harm or abuse gets a fixed, careful reply naming a trusted adult
      // and a real helpline, not the generic schoolwork redirect.
      if (!isStaffRole(role)) {
        const screened = screenLearnerMessage(message);
        if (screened.action === "respond") {
          console.warn(JSON.stringify({
            event: "learner_safety_intercept",
            category: screened.category,
            surface: "apiAiChat",
            message: redactForLogs(message).slice(0, 200),
          }));
          safetyReply = screened.reply;
        }
      }

      ({systemPrompt, messages} = buildAnthropicChat({
        message,
        context: req.body?.context || {},
        history: req.body?.history || [],
        role,
        customSystemPrompt: req.body?.systemPrompt,
      }));
      apiKey = getApiKey(openaiApiKey);

      // Learner-safety moderation (AI-003): screen the child's message before
      // opening the stream. A positive unsafe verdict streams a gentle refusal
      // instead of the model reply (handled just below, before the real
      // stream's headers). A moderation-service outage fails open.
      const inputModeration = await checkLearnerText(apiKey, message, {label: "apiAiChat:input"});
      moderationBlocked = inputModeration.blocked;
    } catch (error) {
      log.error("chat_auth_error", {
        code: error?.code,
        errorMessage: error?.message,
      });
      res.status(httpStatusForError(error)).json({
        error: error?.message || "Zed is unavailable right now.",
      });
      return;
    }

    // Fixed reply instead of the model, streamed in the same SSE shape the
    // client expects. Two causes, checked in this order:
    //   • safetyReply — a distress or secrecy disclosure. Takes precedence,
    //     because moderation would classify the same message as unsafe and
    //     answer with the generic refusal, which is the wrong answer to a
    //     child asking for help.
    //   • moderationBlocked — the message was flagged unsafe (AI-003).
    const fixedReply = safetyReply || (moderationBlocked ? LEARNER_BLOCK_MESSAGE : null);
    if (fixedReply) {
      res.set("Content-Type", "text/event-stream; charset=utf-8");
      res.set("Cache-Control", "no-cache");
      res.status(200);
      res.write(`data: ${JSON.stringify({text: fixedReply})}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
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

    // Heartbeat lives outside the try so `finally` can always clear it.
    let heartbeatTimer = null;
    try {
      // AI-003: the model OUTPUT must be moderated BEFORE it reaches the child,
      // same as the aiChat callable. Streaming tokens live would display unsafe
      // text before we could screen it, so the reply is accumulated, moderated,
      // then sent as one chunk — the client already supports a single-chunk
      // reply (its Android SSE fallback). Input was already moderated above.
      //
      // While buffering + moderating the connection would otherwise go silent,
      // tripping the client's stall watchdog (AI_CHAT_STREAM_STALL_MS = 30s,
      // which resets on ANY bytes it reads). An SSE comment carries no data
      // event, so a TIME-based heartbeat keeps the connection alive. It must be
      // time-based, not token-count-based: a slow or sparse token stream (a long
      // first-token latency) could otherwise miss the 30s window entirely.
      const heartbeat = () => {
        try { res.write(": keepalive\n\n"); } catch (e) { /* client already gone */ }
      };
      heartbeatTimer = setInterval(heartbeat, CHAT_HEARTBEAT_MS);
      let full = "";
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
          full += token;
        },
      );
      // Screen the ENTIRE reply — moderateText clamps one call to 8000 chars, so
      // a long reply is windowed; content past the first window can't slip through.
      const outputModeration = await checkLearnerTextWindowed(apiKey, full, {label: "apiAiChat:output"});
      if (outputModeration.blocked) {
        log.warn("chat_output_moderated", {uid: decoded.uid, categories: outputModeration.matchedCategories});
      }
      const reply = outputModeration.blocked ? LEARNER_BLOCK_MESSAGE : full;
      res.write(`data: ${JSON.stringify({text: reply})}\n\n`);
      res.write("data: [DONE]\n\n");
    } catch (error) {
      // Route through the request-bound logger so provider outages + mid-stream
      // failures — the incidents most in need of correlation — carry `rid`.
      log.error("chat_stream_error", {
        code: error?.code,
        errorMessage: error?.message,
      });
      // Best-effort: send error event then close. The client uses [ERROR] to
      // surface a user-facing message and fall back gracefully.
      res.write(`data: [ERROR] ${JSON.stringify({error: error?.message || "Zed is unavailable right now."})}\n\n`);
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
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
}, async (request) => {
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
});

exports.initiateLencoPayment = onCall({
  secrets: [lencoApiKey, emailSmtpUser, emailSmtpPassword],
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
}, async (request) => {
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
  secrets: opsAlertSecrets([lencoApiKey, emailSmtpUser, emailSmtpPassword]),
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
}, async (req, res) => {
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
}, async (request) => {
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
});

// ── Passkey (WebAuthn) sign-in ───────────────────────────────────────────
// Users authenticate with the biometric / device-lock method already on
// their device; ZedExams only ever stores the public key. Verification is
// @simplewebauthn/server (no custom crypto), the uid is resolved from the
// server-held credential record (never the client), and a Firebase custom
// token restores the SAME account — role, claims, subscription untouched.
// Feature-flagged via settings/global.featureFlags.passkeyAuthenticationEnabled
// (fail-closed). See functions/passkeys/ and docs/PASSKEYS.md.
const {
  runGeneratePasskeyRegistrationOptions,
  runVerifyPasskeyRegistration,
  runGeneratePasskeyAuthenticationOptions,
  runVerifyPasskeyAuthentication,
  runListUserPasskeys,
  runRenameUserPasskey,
  runRemoveUserPasskey,
} = require("./passkeys/passkeyService");

// Phase 5 batch 1a: the seven passkey callable BODIES live in
// passkeys/passkeyCallableHandlers.js; the builders and their frozen options
// stay here, where the manifest guard reads them (docs/phase5-plan.md).
const passkeyCallableHandlers = require("./passkeys/passkeyCallableHandlers")
    .buildPasskeyCallableHandlers({recordAppCheckCallable});

exports.generatePasskeyRegistrationOptions = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
  enforceAppCheck: shouldEnforceAppCheck("generatePasskeyRegistrationOptions"),
}, passkeyCallableHandlers.generatePasskeyRegistrationOptions);

exports.verifyPasskeyRegistration = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
  enforceAppCheck: shouldEnforceAppCheck("verifyPasskeyRegistration"),
}, passkeyCallableHandlers.verifyPasskeyRegistration);

// Pre-auth (no Firebase session yet): App Check observed/enforced per the
// graduated APPCHECK_ENFORCE rollout + per-IP burst rate limiting inside.
exports.generatePasskeyAuthenticationOptions = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
  enforceAppCheck: shouldEnforceAppCheck("generatePasskeyAuthenticationOptions"),
}, passkeyCallableHandlers.generatePasskeyAuthenticationOptions);

exports.verifyPasskeyAuthentication = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
  enforceAppCheck: shouldEnforceAppCheck("verifyPasskeyAuthentication"),
}, passkeyCallableHandlers.verifyPasskeyAuthentication);

exports.listUserPasskeys = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
  enforceAppCheck: shouldEnforceAppCheck("listUserPasskeys"),
}, passkeyCallableHandlers.listUserPasskeys);

exports.renameUserPasskey = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
  enforceAppCheck: shouldEnforceAppCheck("renameUserPasskey"),
}, passkeyCallableHandlers.renameUserPasskey);

exports.removeUserPasskey = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
  enforceAppCheck: shouldEnforceAppCheck("removeUserPasskey"),
}, passkeyCallableHandlers.removeUserPasskey);

// ── Passkey regional twins (staged us-central1 → africa-south1 migration) ─
// The (default) Firestore database lives in africa-south1, so the sequential
// Firestore operations on the sign-in path each pay a cross-region round
// trip from us-central1. These four exports are parallel africa-south1
// deployments of the FLOW callables, shipped ALONGSIDE — never replacing —
// the us-central1 originals above. Same handlers, same runtime options, and
// the same App Check enforcement key (the base name), so request/response
// schemas, security checks and error codes are identical by construction;
// only the serving region differs. Management callables (list/rename/remove)
// intentionally have no twin — they are not on the sign-in path.
//
// Client routing + instant no-redeploy rollback:
// settings/global.featureFlags.passkeyFunctionsRegion, resolved in
// src/services/passkeyRegionCore.js (mirrors functions/passkeys/
// passkeyRegions.js). Deleting the us-central1 originals is a separate,
// explicitly-approved step AFTER the observation window — never automatic.
const {
  PASSKEY_REGIONAL_REGION,
  PASSKEY_CALLABLE_RUNTIME,
} = require("./passkeys/passkeyRegions");

function passkeyRegionalCallable(baseName, handler) {
  return onCall({
    region: PASSKEY_REGIONAL_REGION,
    ...PASSKEY_CALLABLE_RUNTIME,
    enforceAppCheck: shouldEnforceAppCheck(baseName),
  }, async (request) => {
    await recordAppCheckCallable(request, baseName);
    return handler(request, {region: PASSKEY_REGIONAL_REGION});
  });
}

exports.generatePasskeyRegistrationOptionsAfrica = passkeyRegionalCallable(
    "generatePasskeyRegistrationOptions", runGeneratePasskeyRegistrationOptions);
exports.verifyPasskeyRegistrationAfrica = passkeyRegionalCallable(
    "verifyPasskeyRegistration", runVerifyPasskeyRegistration);
exports.generatePasskeyAuthenticationOptionsAfrica = passkeyRegionalCallable(
    "generatePasskeyAuthenticationOptions", runGeneratePasskeyAuthenticationOptions);
exports.verifyPasskeyAuthenticationAfrica = passkeyRegionalCallable(
    "verifyPasskeyAuthentication", runVerifyPasskeyAuthentication);
