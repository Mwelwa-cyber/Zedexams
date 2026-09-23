// Guards the firebase-admin namespace → modular migration in functions/.
//
// firebase-admin 14 DELETES the namespace API: `admin.firestore()`,
// `admin.auth()`, `admin.storage()`, `admin.messaging()`, `admin.appCheck()`
// and the statics hung off them (`admin.firestore.FieldValue`, `.Timestamp`,
// `.FieldPath`). On 14, `require("firebase-admin")` exports only the app
// functions (initializeApp, getApp, cert, …), so every one of those calls
// becomes `undefined is not a function` AT RUNTIME. Nothing in lint catches it
// — `no-undef` cannot see a missing property — and most callers have no test.
//
// The replacement is the modular import, which 13.x already supports:
//   const {getFirestore, FieldValue} = require("firebase-admin/firestore");
//   const {getAuth} = require("firebase-admin/auth");
//
// LEGACY below is the shrink-only list of files still on the namespace API.
// A file NOT on it that uses the namespace fails (no new debt); a file ON it
// that no longer does also fails (delete the line, so the list cannot rot into
// something that only looks like a record). The version bump to 14 is safe
// exactly when this list is empty.
//
// Run: npm run test:firebase-admin-modular  (auto-discovered by test:all)

import {readFileSync, readdirSync, statSync} from "node:fs";
import {join, relative} from "node:path";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "functions");

// Namespace service calls and the statics that live on them. Deliberately NOT
// `admin.initializeApp` / `admin.apps` / `admin.credential`: initializeApp
// survives in 14, and the other two are handled where they are used.
export const NAMESPACE_USE =
  /\badmin\.(?:firestore|auth|storage|messaging|appCheck|database|remoteConfig|securityRules|machineLearning|projectManagement|installations|instanceId)\b/;

const LEGACY = new Set([
  "account/accountCallableHandlers.js",
  "account/accountPurgeResweeper.js",
  "account/accountPurgeSweeper.js",
  "account/userRoleTrigger.js",
  "accountDeletionRequests.js",
  "adminPayments.js",
  "adminUsers.js",
  "agentOpsHandlers.js",
  "agents/cron.js",
  "agents/dispatcher.js",
  "agents/platformHealth.js",
  "agents/questionReview.js",
  "agents/runners/aria.js",
  "agents/runners/monitor.js",
  "agents/runners/pubo.js",
  "agents/runners/quill.js",
  "aiBudgetEnforcement.js",
  "aiBudgetReclaim.js",
  "aiCostDailySummary.js",
  "aiCostTracking.js",
  "aiOperations.js",
  "aiService.js",
  "appCheckHttp.js",
  "auditLog.js",
  "authGuard.js",
  "consentGuard.js",
  "dailyExamGradingFns.js",
  "dailyReminders.js",
  "familyPortal.js",
  "firestoreBackup.js",
  "fxRate.js",
  "googlePlayBilling.js",
  "googlePlayRtdn.js",
  "guardianEntitlement.js",
  "httpSurfaceHandlers.js",
  "index.js",
  "invoiceGenerator.js",
  "libraryDownload.js",
  "messagingHandlers.js",
  "newsletter.js",
  "noteInsights.js",
  "noteSmart.js",
  "opsAlertTest.js",
  "opsHeartbeat.js",
  "parentPortal.js",
  "parentPortalShared.js",
  "pastPapersIndex.js",
  "paymentHandlers.js",
  "platformMetrics.js",
  "publicStats.js",
  "rateLimit.js",
  "rateLimitHealth.js",
  "referralBackfill.js",
  "referralRedemption.js",
  "scripts/backfillNotePictures.js",
  "security/adminClaims.js",
  "security/logAdminMfaEvent.js",
  "security/requireAdminMfa.js",
  "security/resetAdminMfa.js",
  "security/securityAudit.js",
  "storageBackup.js",
  "studentAgents.js",
  "subscriptionActivation.js",
  "subscriptionLifecycle.js",
  "teacherTools/activateSyllabusVersion.js",
  "teacherTools/assessmentBands.js",
  "teacherTools/assessmentFormats.js",
  "teacherTools/backfillKbSourceRefs.js",
  "teacherTools/cbcKnowledge.js",
  "teacherTools/cleanupArchivedSyllabusData.js",
  "teacherTools/examPaperLibrary.js",
  "teacherTools/expandKbLessons.js",
  "teacherTools/extractAssessmentFormat.js",
  "teacherTools/extractTopicsFromPdf.js",
  "teacherTools/generateAssessment.js",
  "teacherTools/generateDiagram.js",
  "teacherTools/generateFlashcards.js",
  "teacherTools/generateHomework.js",
  "teacherTools/generateLessonActivities.js",
  "teacherTools/generateLessonPlan.js",
  "teacherTools/generateNotePictures.js",
  "teacherTools/generateNotes.js",
  "teacherTools/generateQuiz.js",
  "teacherTools/generateRubric.js",
  "teacherTools/generateSbaTask.js",
  "teacherTools/generateSchemeOfWork.js",
  "teacherTools/generateSlideNotes.js",
  "teacherTools/generateWorksheet.js",
  "teacherTools/importBuiltInAssessmentFormats.js",
  "teacherTools/importBuiltInCbcTopics.js",
  "teacherTools/importCurriculumModules.js",
  "teacherTools/invalidateKbCache.js",
  "teacherTools/masterBankSourcing.js",
  "teacherTools/misconceptions.js",
  "teacherTools/paperAssetUrl.js",
  "teacherTools/parseSyllabusUpload.js",
  "teacherTools/pastPaperImport.js",
  "teacherTools/privateCurriculum.js",
  "teacherTools/regenerateAssessmentQuestion.js",
  "teacherTools/reviseLessonSection.js",
  "teacherTools/reviseQuestion.js",
  "teacherTools/rollbackSyllabusVersion.js",
  "teacherTools/studioLessonPlan.js",
  "teacherTools/suggestAnswer.js",
  "teacherTools/syllabiCurriculumData.js",
  "teacherTools/syllabusOverrides.js",
  "teacherTools/teacherPlanContext.js",
  "teacherTools/templateBankFunctions.js",
  "teacherTools/testPaperImport/redrawTestPaperDiagram.js",
  "teacherTools/uploadCurriculumModule.js",
  "teacherTools/usageMeter.js",
  "tts.js",
  "ttsAdmin.js",
  "ttsCache.js",
  "ttsVoiceConfig.js",
  "visitorTracking.js",
  "visualAiHandlers.js",
  "webhookEventLedger.js",
  "weeklyParentDigest.js",
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".js") && !name.endsWith(".test.js")) out.push(full);
  }
  return out;
}

// Strip comments before matching: a JSDoc line reading "(defaults to
// admin.firestore())" is history, not a call.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

export function usesNamespace(src) {
  return NAMESPACE_USE.test(stripComments(src));
}

// The detector must be able to fail, or an empty report proves nothing.
assert.ok(usesNamespace("const db = admin.firestore();"), "detector misses admin.firestore()");
assert.ok(usesNamespace("x = admin.firestore.FieldValue.serverTimestamp()"), "detector misses FieldValue static");
assert.ok(usesNamespace("await admin.auth().getUser(uid)"), "detector misses admin.auth()");
assert.ok(!usesNamespace("// defaults to admin.firestore()\nconst db = getFirestore();"), "detector reads comments");
assert.ok(!usesNamespace("admin.initializeApp();"), "initializeApp survives v14 and must not be flagged");

const offenders = [];
const stale = [];
const seen = new Set();
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split("\\").join("/");
  const hit = usesNamespace(readFileSync(file, "utf8"));
  if (hit) seen.add(rel);
  if (hit && !LEGACY.has(rel)) offenders.push(rel);
  if (!hit && LEGACY.has(rel)) stale.push(rel);
}
for (const rel of LEGACY) if (!seen.has(rel) && !stale.includes(rel)) stale.push(rel);

if (offenders.length) {
  console.error("New firebase-admin namespace usage (removed in v14) — use the modular import instead:");
  for (const f of offenders) console.error("  functions/" + f);
}
if (stale.length) {
  console.error("Migrated (or deleted) but still listed in LEGACY — delete these lines from scripts/test-firebase-admin-modular.mjs:");
  for (const f of stale) console.error("  functions/" + f);
}
if (offenders.length || stale.length) process.exit(1);

console.log(`test:firebase-admin-modular OK — ${LEGACY.size} file(s) left on the namespace API; v14 bump is safe at 0.`);
