# 13 — Cloud Functions Register

> Snapshot as of 2026-07-17 — verify before acting. Audited commit `0cd4c49`.
> Source: `functions/index.js` (~4,255 lines) + imported modules. **≈167 exported functions at the audited snapshot** (`0cd4c49`; an exact `exports.X =` count on `main` gives 168 — the number drifts as functions are added/removed, so treat it as approximate). CLAUDE.md says ~156; delta is paired/re-exported triggers.

## Conventions

- **Region:** HTTP/callable (`onCall`/`onRequest`) + all crons + both v1 Auth triggers → **us-central1** (v2 default). Every Firestore `onDocument*` and the one Storage trigger → **africa-south1** (verified: convention holds cleanly).
- **Runtime:** Node 22.
- **Auth legend:** *staff* = `isStaffRole`; *admin* = admin/superAdmin; *verified* = `assertVerifiedAuth`; *public* = logged-out ok.
- **Suspension (P0, 2026-07-17):** `assertVerifiedAuth`/`assertDecodedVerified` now also reject `users.status ∈ {suspended, deleted}` via `assertActiveAccount` (fail-open on transient read error), so every function using the shared guard blocks suspended callers. Deliberately-exempt functions (`deleteMyAccount`, `bootstrapUserProfile`, `sendPasswordResetEmail`, webhooks) don't call the guard and stay status-agnostic.
- **App Check:** graduated / **observe-only** default via `enforceAppCheck: shouldEnforceAppCheck("<label>")` (env-gated); `softVerifyAppCheckHttp` on HTTP. `consumeAppCheckToken` was removed (2026-07). The two webhooks (`lencoWebhook`, `apiWhatsAppWebhook`) authenticate by **HMAC**, not App Check/CORS.
- **Secrets** (`defineSecret`, names only): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `LENCO_API_KEY`, `GOOGLE_PLAY_SA_JSON`, `EMAIL_SMTP_USER`/`EMAIL_SMTP_PASSWORD`, WhatsApp groups (`WHATSAPP_SECRETS`/`WHATSAPP_WEBHOOK_SECRETS`). Dead-provider secrets `RECRAFT_API_KEY`/`KIE_API_KEY` are deliberately **not** declared (would hard-fail deploy) — all image styles run on `gpt-image-1`.

## Shared-module startup cost (measured 2026-08-09)

Every Cloud Functions instance loads the **whole** of `functions/index.js`,
because all ~202 exports deploy from one source directory. A function that
touches three modules still pays for the Anthropic client, the OpenAI client,
`docx`, Gemini, every teacherTool and every agent — on **every cold start**, not
just the heavy functions.

Measured on Node 22, in this repo:

| stage | RSS |
|---|---|
| bare `node` | 43 MiB |
| `+ require('firebase-admin')` | 64 MiB |
| `+ admin.initializeApp()` | 64 MiB |
| `+ require('./visitorTracking')` | 72 MiB |
| `+ admin.firestore()` | 76 MiB |
| **`+ require('./index.js')` — the deployed reality** | **148 MiB**, 2.7 s to load |

Reproduce:

```bash
node -e "
process.env.GCLOUD_PROJECT='examsprepzambia';
process.env.FIREBASE_CONFIG=JSON.stringify({projectId:'examsprepzambia',storageBucket:'examsprepzambia.firebasestorage.app'});
const mb=()=>Math.round(process.memoryUsage().rss/1024/1024);
require('./functions/index.js'); console.log(mb(),'MiB');
"
```

### Consequences

- **A function provisioned below ~148 MiB cannot start.** `apiTrackVisit`
  declared `memory: "128MiB"` — the only declaration in the codebase below
  256MiB — and produced 80 ERRORs in a 2h window ("Memory limit of 128 MiB
  exceeded", POST 500s and a 503) while no other function contributed one. It
  was not leaking: this is a fixed module-load cost, identical on every cold
  start and independent of traffic. Fixed by raising it to 256MiB, the Cloud
  Functions default and what all ~141 other declarations already use (#2231).
- **`test:function-memory-floor` enforces the floor.** It scans every
  declaration under `functions/` in both SDK vocabularies (v2 `MiB`/`GiB`, v1
  `MB`/`GB`), covers direct and delegated declaration shapes, self-checks that
  it still understands each shape before trusting its own scan, and fails on a
  value it cannot resolve rather than skipping it. Update `FLOOR_MIB` only with
  a fresh measurement from the command above.
- **This is the measured case for Phase 5.** The 148 MiB and 2.7 s are paid by
  every function's cold start, so "reduce `index.js` to exports"
  (`docs/phase5-plan.md`) is a latency-and-cost argument, not a tidiness one.
  Re-run the measurement at Phase 5 exit — the delta is the result.

## Trigger-type breakdown

| Trigger | Count | Region |
|---|---|---|
| `onCall` | ~118 | us-central1 |
| `onRequest` | 9 | us-central1 (all 9 map to `/api/*` rewrites) |
| `onSchedule` (crons) | ≈28 (repo-wide, at the audited snapshot) | us-central1 |
| Firestore `onDocument*` | 12 | **africa-south1** |
| Storage `onObjectFinalized` | 1 (`parseSyllabusUpload`) | **africa-south1** |
| v1 Auth (`onCreate`/`onDelete`) | 2 | us-central1 |

## `/api/*` rewrites (all → us-central1)

`/api/ai/chat`→`apiAiChat` · `/api/teacher/lesson-plan/stream`→`apiGenerateLessonPlan` · `/api/teacher/worksheet/stream`→`apiGenerateWorksheet` · `/api/tts`→`apiTextToSpeech` · `/api/payments/lenco/webhook`→`lencoWebhook` · `/api/whatsapp/webhook`→`apiWhatsAppWebhook` · `/api/teacher/download`→`apiLibraryDownload` · `/api/track/visit`→`apiTrackVisit` · `/api/image-proxy`→`apiImageProxy`

## AI generation (learner / marking / micro-tools)

| Function | Trigger | Secrets | Auth | Purpose | File |
|---|---|---|---|---|---|
| `aiChat` | onCall | OPENAI_API_KEY | verified; AC | Zed callable fallback | index.js:1017 |
| `apiAiChat` | onRequest SSE | OPENAI_API_KEY | verified; soft AC | Zed chat stream | index.js:1382 |
| `explainAnswer` | onCall | ANTHROPIC_API_KEY | verified; AC | AI answer explanation | index.js:1488 |
| `generateNoteInsights` | onCall | ANTHROPIC_API_KEY | verified; AC | Note summary/key points | index.js:1535 |
| `generateNoteSmart` | onCall | ANTHROPIC_API_KEY | staff; AC | Staff AI highlights | index.js:1567 |
| `editQuizQuestion` | onCall | ANTHROPIC_API_KEY | staff; AC | Per-question edit | index.js:1606 |
| `generateQuizQuestions` | onCall | ANTHROPIC_API_KEY | staff; AC | Generate MCQs | index.js:1672 |
| `verifyQuiz` (Vex) | onCall | ANTHROPIC_API_KEY | staff | Sync pre-publish verify (Haiku) | index.js:1757 |
| `suggestQuizAnswers` | onCall | ANTHROPIC_API_KEY | staff; AC | Bulk answers | index.js:2117 |
| `checkShortAnswer` | onCall | ANTHROPIC_API_KEY | verified; AC | Short-answer marking | index.js:2158 |
| `suggestAnswer` | onCall | ANTHROPIC_API_KEY, GEMINI_API_KEY | staff | Answer hint (Gemini vision) | teacherTools/suggestAnswer.js:561 |
| `reviseQuestion` | onCall | ANTHROPIC_API_KEY | staff | Rewrite question | teacherTools/reviseQuestion.js:83 |
| `aiLessonCount` | onCall | ANTHROPIC_API_KEY | staff | Recommend # lessons | teacherTools/lessonCount.js:83 |
| `reviseLessonSection` | onCall | ANTHROPIC_API_KEY | staff | Edit one section | teacherTools/reviseLessonSection.js:79 |
| `generateStudyPlan` | onCall | ANTHROPIC_API_KEY | verified; AC | Personalised study plan | studentAgents.js:366 |

## Document generation (teacher studios)

`generateLessonPlan`, `apiGenerateLessonPlan` (SSE), `generateWorksheet`, `apiGenerateWorksheet` (SSE), `generateFlashcards`, `generateSchemeOfWork`, `getTermModuleOutline`, `generateRubric`, `generateNotes`, `generateHomework`, `generateLessonActivities`, `generateAssessment` (also `mock_exam` — Exam Studio path; `generateExamPaper` retired), `generateSbaTask`, `generateQuiz`, `generateVisualNotes`, `studioGenerateLessonPlan`. Download path: `createLibraryDownloadTicket` (onCall) → `apiLibraryDownload` (onRequest) → `reapDownloadTickets` (cron 6h). All onCall/us-central1, ANTHROPIC_API_KEY (image ones add OPENAI_API_KEY), staff. Files under `functions/teacherTools/generate*.js`.

## OCR / import

`structureImportedQuiz` (Gemini→Claude), `structureScannedQuiz` (Gemini+Claude OCR), `structureImportedNote`, `ocrNotePages`, `importPastPaperQuestions` (vision), `rebuildTableFromImage`, `analyzePaperLayout` (Haiku), `extractTopicsFromPdf` (admin). All onCall, staff/admin.

## Image

`generateDiagram` (gpt-image-1), `redrawTestPaperDiagram`, `generateNotePictures` (Gemini/OpenAI image, admin), `checkVisualSafety`, `nameBankPictures` (vision, admin), `apiImageProxy` (onRequest, cors:true).

## Payments (Lenco + Google Play)

| Function | Trigger | Secrets | Auth | File |
|---|---|---|---|---|
| `getUpgradeQuote` | onCall | — | verified | index.js:3145 |
| `initiateLencoPayment` | onCall | LENCO_API_KEY, EMAIL_SMTP_* | verified | index.js:3174 |
| `submitLencoOtp` | onCall | LENCO_API_KEY, EMAIL_SMTP_* | verified (owner) | index.js:3403 |
| `getLencoPaymentStatus` | onCall | LENCO_API_KEY, EMAIL_SMTP_* | verified (owner/admin) | index.js:3451 |
| `recoverMyPendingPayments` | onCall | LENCO_API_KEY, EMAIL_SMTP_* | verified | index.js:3517 |
| `lencoWebhook` | onRequest | LENCO_API_KEY, EMAIL_SMTP_* | **HMAC x-lenco-signature** | index.js:3691 |
| `verifyGooglePlayPurchase` | onCall | GOOGLE_PLAY_SA_JSON, EMAIL_SMTP_* | verified; AC | index.js:3600 |
| `resendInvoiceEmail` | onCall | EMAIL_SMTP_* | verified (owner/admin) | index.js:1085 |
| `adminConfirmPayment` / `adminRejectPayment` | onCall | — | admin | adminPayments.js:76/141 |

## Subscriptions

`setSubscriptionCancellation` (verified), `adminGrantPremium`/`adminRevokePremium` (admin), `sendExpiryReminders`/`sendActivationConfirmation` (admin, WhatsApp), `bulkGrantDemoTrials` (admin).

## Usage / AI budget

`getAiBudgetEnforcement` (admin read model), `reclaimAiBudgetReservations` (cron 60m), `aiCostDailySummary` (cron 02:00). Per-user daily caps are inline via `assertDailyLimit` (`aiService.js`), not standalone functions.

## Notifications / messaging

`apiWhatsAppWebhook` (Bonga; onRequest, HMAC x-hub-signature-256, ANTHROPIC + WhatsApp secrets), `weeklyParentDigest` (cron Sun 09:00), `triggerWeeklyParentDigest` (admin), `dailyStreakReminders`/`dailyPracticeReminders`/`weeklyRevisionReminder`/`inactiveLearnerReminder`/`subscriptionExpiryReminders`/`archiveOldNotifications` (crons). Firestore triggers (africa-south1): `onLearnerStatsWritten`, `onAnnouncementWritten`, `onUserCreatedNotifyAdmins`, `onFeedbackCreatedNotifyAdmins`.

## Scheduled crons (non-agent)

`autoPickDailyExams` (05:00), `dailyFxRefresh` (05:00), `dailyFirestoreBackup` (01:30), `updatePublicStats` (30m), `aggregateVisitorStats` (5m), `orphanStorageReaper` (03:00), `tmpDownloadReaper` (60m), `rebuildPastPapersIndexCron` (6h).

## Agents / pipeline

| Function | Trigger | Region | Agent | File |
|---|---|---|---|---|
| `agentJobsOnCreate` | onDocumentCreated (agentJobs) | africa-south1 | Aria→Cala→Reva | dispatcher.js:335 |
| `agentJobsOnApproved` | onDocumentUpdated (agentJobs) | africa-south1 | Pubo | dispatcher.js:361 |
| `questionReviewOnWrite` | onDocumentWritten (questionBank) | africa-south1 | **Qix** | questionReview.js:463 |
| `retryAgentJob`, `classifyQuestionGrades`, `getPlatformHealth`, `initializeAgentPipeline`, `runSampleAgentJob`, `runDawnBriefing` | onCall | us-central1 | — / Dawn | index.js / platformHealth.js |
| `functionErrorWatch` (Cloud Functions error watch, every 5 min) + `sendTestFunctionErrorAlert` (admin drill) | onSchedule / onCall | us-central1 | monitoring | monitoring/functionErrorWatch.js |
| `nightlyQaSmoke` (Quill), `weeklyCbcAlignmentAudit` (Cala), `hourlyMonitor` (Vigil), `hourlyRevenueReconcile` (Till), `supportTriage` (Echo), `contentAutoPublish` (Gate), `weeklyProductSignal` (Compass), `weeklyRetentionScan` (Anchor), `deliverDawnBriefings` (Dawn), `hourlyAgentSupervisor` (Marshal) | onSchedule | us-central1 | ops/growth | agents/cron.js |

## Account / auth / security

`setUserRole` (v1 onCreate — initial role claim), `bootstrapUserProfile`, `deleteMyAccount`, `sendPasswordResetEmail` (public, rate-limited), `adminSetUserStatus`, `adminSetUserRole`, `onUserDeleted` (v1 onDelete — Storage wipe). Security: `appCheckPing`, `assessRecaptcha` (public, fail-open).

## Storage-cleanup + mirror triggers (all africa-south1)

`onLessonDeleted`/`onLessonUpdated`, `onQuizQuestionDeleted`/`onQuizQuestionUpdated`, `onAssessmentQuestionDeleted`/`onAssessmentQuestionUpdated`, `onQuizWritten` (→ `quizSummaries`), `pastPapersIndexOnWrite` (→ `pastPapersIndex/published`). See [`12-storage-map.md`](./12-storage-map.md).

## KB / curriculum admin (Other)

`importBuiltInCbcTopics`, `importBuiltInAssessmentFormats`, `extractAssessmentFormat`, `analyzeExamPaper`, `synthesizeAssessmentFormat`, `importCurriculumModules`, `backfillKbSourceRefs`, `expandKbLessons`, `upsertSyllabusRow`/`deleteSyllabusRow`/`restoreSyllabusRow`, `parseSyllabusUpload` (Storage onFinalize, africa-south1), `invalidateKbCache`, `activateSyllabusVersion`/`rollbackSyllabusVersion`, `cleanupArchivedSyllabusData`, `uploadCurriculumModule`/`deleteCurriculumUpload`, `lessonPlanTemplateOnWrite` (onDocumentWritten aiGenerations, africa-south1), `recordTemplateInteraction`.

## Classes / parents / growth (Other)

`generateClassInvite`, `joinClassByCode`, `approveLearner`/`declineLearner`, `removeLearnerFromClass`, `leaveClass`, `createClassAssignment`/`removeClassAssignment`, `createProgressShare`/`revokeProgressShare`/`getProgressShare` (public token), `createFamilyInviteCode`/`revokeFamilyInviteCode`/`redeemFamilyInviteCode`, `getChildProgress`, `subscribeToNewsletter` (public, rate-limited+honeypot), `backfillReferralCodes` (admin).

## Exams / TTS / analytics

`getExamQuestions`, `submitDailyExam` (grades server-side), `apiTextToSpeech` (onRequest), `apiTrackVisit` (onRequest, public beacon), `getClassStats`, `getAssignmentCompletion`.

## Notes

1. Region convention holds cleanly (all Firestore/Storage triggers africa-south1; everything else us-central1).
2. No true duplicate exports. `autoPickDailyExams` is re-exported and also invoked by Vigil's self-heal — single export.
3. **One-shot/backfill admin tools** (`initializeAgentPipeline`, `runSampleAgentJob`, `backfillReferralCodes`, `backfillKbSourceRefs`, `bulkGrantDemoTrials`, `importBuiltIn*`, `cleanupArchivedSyllabusData`) are rarely hit in routine flows — kept intentionally, not provably dead.
4. Webhooks are HMAC-authed; App Check is observe-only pending staged enforcement (see [`18-security-review.md`](./18-security-review.md)).
