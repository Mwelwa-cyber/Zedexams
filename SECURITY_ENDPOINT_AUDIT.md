# ZedExams — Endpoint & API Security Audit

> Snapshot as of 2026-07-18 — verify before acting. This is a point-in-time audit of the deployed Cloud Functions surface; treat the inventory as a map, not a live source of truth.

Scope: every externally reachable endpoint in `functions/` — 168 exports in `functions/index.js` plus the modules they wire in. The audit checks each endpoint for intentional exposure, authentication, function- and object-level authorisation, tenant isolation, input validation, rate limiting, App Check, idempotency, replay/injection/exhaustion safety, observability, and private-by-default posture.

## Executive summary

The callable surface is, on the whole, **already well hardened** — the product of the earlier hardening prompts. This audit found the remaining gaps concentrated on the **unauthenticated HTTP surface** and a handful of **uncapped AI callables**, and fixed the highest-value ones. Key results:

- **Callable authz / IDOR / tenant isolation / mass-assignment: clean.** Every consequential `onCall` verifies a server-derived `uid` (never a body field), enforces a server-side role for admin actions, re-checks object ownership/tenancy before reading or mutating, and writes Firestore documents from explicit field allowlists (no payload spreads into `.set()`/`.update()`).
- **Payment + WhatsApp webhooks: signature-verified against the raw body, fail-closed,** with idempotent + status-guarded downstream state transitions (replay of a `successful` or `failed` Lenco event cannot double-grant or downgrade).
- **Firestore/Storage triggers: all correctly pinned to `africa-south1`;** scheduled crons are idempotent by construction.
- **Fixed in this change (7):** SSRF-via-redirect + missing timeout + pre-buffer size check + missing rate limit on `apiImageProxy`; error-detail leak on `apiTextToSpeech`; missing rate limit on the unauthenticated `apiTrackVisit` write path and the paid `assessRecaptcha` call; and per-minute burst caps on the two uncapped expensive AI endpoints (`importPastPaperQuestions`, `analyzePaperLayout`).

Nothing found rises to a live, remotely-exploitable data-exposure or privilege-escalation vulnerability. The fixes are cost-abuse / DoS / defence-in-depth hardening.

---

## 1. Endpoint inventory & classification

Classification key: **PUB** = public read-only · **AUTH** = authenticated user · **APP** = app-attested · **ADMIN** = administrative · **HOOK** = webhook · **EVENT** = event-triggered (Firestore/Storage/Pub-Sub/schedule).

### 1.1 HTTP endpoints (`onRequest`) — internet-reachable

| Endpoint | Source | Region | Method | Class | Auth | App Check | Rate limit | Notes |
|---|---|---|---|---|---|---|---|---|
| `apiAiChat` | index.js:1387 | us-central1 | POST/OPTIONS | AUTH | ID token + verified | soft-verify | ✓ before work | CORS allowlist; SSE |
| `apiGenerateLessonPlan` | index.js:2255 | us-central1 | POST/OPTIONS | AUTH (staff) | ID token + verified + staff role | soft-verify | ✓ | SSE |
| `apiGenerateWorksheet` | index.js:2255 | us-central1 | POST/OPTIONS | AUTH (staff) | ID token + verified + staff role | soft-verify | ✓ | SSE |
| `apiTextToSpeech` | tts.js | us-central1 | POST/OPTIONS | AUTH | ID token + verified | — (recommended) | ✓ before Google TTS | voice allowlist, `MAX_CHARS`; **error leak fixed** |
| `apiImageProxy` | imageProxy.js | us-central1 | GET/HEAD | PUB | none (SSRF-gated) | — | **added** (IP) | Storage-only URL gate; **SSRF+timeout+size fixed** |
| `apiLibraryDownload` | libraryDownload.js | us-central1 | GET | AUTH | owner-scoped ticket | — | via ticket TTL | 5-min single-owner ticket, re-checked on stream |
| `apiTrackVisit` | visitorTracking.js | us-central1 | POST/OPTIONS | PUB (beacon) | none | — | **added** (IP) | server-derived UA/country; never persists IP |
| `apiWhatsAppWebhook` | index.js:3841 | us-central1 | GET/POST | HOOK | Meta HMAC (raw body) | n/a | per-conv | fail-closed once app secret set; kill-switch |
| `lencoWebhook` | index.js:3703 | us-central1 | POST | HOOK | Lenco HMAC-SHA512 (raw body) | n/a | n/a | idempotent + status-guarded activation |

### 1.2 Callable functions (`onCall`) — classified

- **Public / pre-auth (intentional, defended):** `sendPasswordResetEmail` (per-email + per-IP daily caps), `bootstrapUserProfile`, `deleteMyAccount`, `subscribeToNewsletter` (honeypot + per-IP cap), `assessRecaptcha` (**rate limit added**), `getProgressShare` (token-scoped), `appCheckPing` (still requires auth).
- **Authenticated user (AUTH):** the learner/teacher tools — `aiChat`, `explainAnswer`, `generateNoteInsights/Smart`, `editQuizQuestion`, `generateQuizQuestions`, `verifyQuiz`, `structureImportedQuiz/Note`, `structureScannedQuiz`, `ocrNotePages`, `suggestQuizAnswers`, `checkShortAnswer`, `submitDailyExam`, `getExamQuestions`, `saveClassAttendance`, `joinClassByCode`/`leaveClass`, `createLibraryDownloadTicket`, family/parent portal (`getChildProgress`, `redeemFamilyInviteCode`, `createProgressShare`, …), Lenco buyer flows (`initiateLencoPayment`, `submitLencoOtp`, `getLencoPaymentStatus`, `recoverMyPendingPayments`, `getUpgradeQuote`, `setSubscriptionCancellation`), `verifyGooglePlayPurchase`. All call `assertVerifiedAuth` then role/ownership checks.
- **Teacher-tool generators (AUTH, staff-gated):** `generateLessonPlan/Worksheet/Homework/Notes/Flashcards/Rubric/SchemeOfWork/SbaTask/Quiz/Assessment/StudyPlan/Diagram/NotePictures/VisualNotes`, `reviseQuestion`, `reviseLessonSection`, `importPastPaperQuestions` (**rate limit added**), `analyzePaperLayout` (**rate limit added**), `redrawTestPaperDiagram`, `rebuildTableFromImage`. `isStaffRole` after auth; metered generators charge the monthly usage meter.
- **Administrative (ADMIN):** `adminSetUserRole`, `adminSetUserStatus`, `adminGrantPremium`, `adminRevokePremium`, `adminConfirmPayment`, `adminRejectPayment`, `setUserRole`, `bulkGrantDemoTrials`, `classifyQuestionGrades`, `nameBankPictures`, `retryAgentJob`, `runDawnBriefing`, `sendActivationConfirmation`, `sendExpiryReminders`, `resendInvoiceEmail` (admin-or-owner), `triggerWeeklyParentDigest`, `getPlatformHealth`, `initializeAgentPipeline`, `runSampleAgentJob`, `analyzeExamPaper`, `synthesizeAssessmentFormat`, `extractAssessmentFormat`, `extractTopicsFromPdf`, `uploadCurriculumModule`, `deleteCurriculumUpload`, and the syllabus-versioning set (`activateSyllabusVersion`, `rollbackSyllabusVersion`, `parseSyllabusUpload` companions, `upsertSyllabusRow`, `deleteSyllabusRow`, `restoreSyllabusRow`, `importBuiltInAssessmentFormats`, `importBuiltInCbcTopics`, `importCurriculumModules`, `backfillKbSourceRefs`, `backfillReferralCodes`, `invalidateKbCache`, `expandKbLessons`). All enforce a server-side role (`users/{uid}.role ∈ {admin, superAdmin}`); money/lifecycle actions write `auditLog`.

### 1.3 Event-triggered functions (EVENT) — not public APIs

- **Firestore/Storage triggers (all pinned `africa-south1`):** `agentJobsOnCreate`/`agentJobsOnApproved` (dispatcher.js), `questionReviewOnWrite` (Qix), `onQuizWritten`, `onQuizQuestionUpdated/Deleted`, `onAssessmentQuestionUpdated/Deleted`, `onLessonUpdated/Deleted`, `onLearnerStatsWritten`, `onAnnouncementWritten`, `onUserCreatedNotifyAdmins`, `onFeedbackCreatedNotifyAdmins`, `onUserDeleted`, `pastPapersIndexOnWrite`, `lessonPlanTemplateOnWrite`, `recordTemplateInteraction` companions, storage-cleanup triggers (`onLessonChange`, `onQuestionChange`), `parseSyllabusUpload` (Storage). Least-privilege service identity; input-validated; idempotent.
- **Scheduled crons (`onSchedule`, Pub/Sub-triggered, IAM-protected):** `nightlyQaSmoke`, `hourlyMonitor`, `hourlyAgentSupervisor`, `hourlyRevenueReconcile`, `supportTriage`, `contentAutoPublish`, `weeklyProductSignal`, `weeklyRetentionScan`, `deliverDawnBriefings`, `weeklyCbcAlignmentAudit`, `autoPickDailyExams`, `daily/weekly reminders`, `dailyFxRefresh`, `aiCostDailySummary`, `reclaimAiBudgetReservations`, `rebuildPastPapersIndexCron`, `updatePublicStats`, `aggregateVisitorStats`, `dailyFirestoreBackup`, `weeklyParentDigest`, `orphanStorageReaper`, `reapDownloadTickets`, `tmpDownloadReaper`, `archiveOldNotifications`, `cleanupArchivedSyllabusData`. Not client-callable; idempotent writes.

### 1.4 Unused / legacy endpoints

No orphaned public HTTP routes or debug/test/migration endpoints were found exposed. Migration/backfill callables (`backfillReferralCodes`, `backfillKbSourceRefs`, `importBuiltIn*`, `bulkGrantDemoTrials`) are all admin-role-gated rather than relying on obscurity. `initializeAgentPipeline`/`runSampleAgentJob` are admin-only diagnostics. Recommend a periodic re-check that these stay admin-gated as new ones are added.

---

## 2. Findings & fixes applied in this change

| # | Endpoint | Severity | Finding | Fix |
|---|---|---|---|---|
| F1 | `apiImageProxy` | MEDIUM | `fetch(target)` used the default `redirect: "follow"`. `resolveStorageTarget` vets only the URL given; a 3xx from the (trusted) Storage host would be followed with no re-validation — an SSRF allowlist bypass. | `fetch(target, {redirect: "error", signal: AbortSignal.timeout(20s)})`. |
| F2 | `apiImageProxy` | LOW | Body fully buffered into a 256 MiB-memory function *before* the 15 MB size check; no fetch timeout. | New pure `checkUpstreamHeaders()` vets `content-type` + declared `content-length` **before** buffering; 20 s abort added. Unit-tested. |
| F3 | `apiImageProxy` | MEDIUM | Unauthenticated public GET with no rate limit — bandwidth-amplification / Storage-egress-billing surface. | IP-scoped `guardHttpRateLimit` (fail-open) before any outbound fetch. |
| F4 | `apiTextToSpeech` | MEDIUM | 500 response forwarded `detail: String(err.message)` — leaks internal/provider exception text. | Log server-side; return a generic message only. |
| F5 | `apiTrackVisit` | MEDIUM | Unauthenticated endpoint writes `visits/{autoId}` + a counter txn per hit with no throttle — billing-abuse + data-poisoning. | IP-scoped fixed-window cap (fail-open); a blocked beacon is dropped **silently** with 204 to keep its never-surface-an-error contract. |
| F6 | `assessRecaptcha` | MEDIUM | Public; every assessable token triggers a **billed** reCAPTCHA Enterprise Assessment call, uncapped. | Per-IP cap; on block returns the fail-open `skip` verdict (no throw, no paid call) — never blocks sign-in. |
| F7 | `importPastPaperQuestions` | HIGH | The single highest-cost AI endpoint (up to 8 sequential Claude vision passes @16k tokens over a 32 MB PDF), callable by any teacher, with **no** rate limit, usage cap, or idempotency — a leaked token or client loop could run unbounded spend up to only the monthly treasury gate. | `assertCallableRateLimit` (4/user/min, fail-open) before any provider call. |
| F8 | `analyzePaperLayout` | MEDIUM | Staff-callable Claude vision classifier with no usage meter and no rate limit (its siblings meter via `assertAndIncrement`). | `assertCallableRateLimit` (30/user/min). |

All fixes are **fail-open** with respect to limiter/infra errors (a Firestore blip never takes the product down) and sit **before** the expensive work.

---

## 3. Deliverable coverage (from the audit brief)

- **Endpoint inventory / exposure classification / legacy scan** — §1.
- **Unauthenticated endpoints discovered** — the public HTTP set in §1.1 (`apiImageProxy`, `apiTrackVisit`) + public callables in §1.2; all now rate-limited/SSRF-gated.
- **Missing function-level authz** — none found (§ callable audit). Admin actions all server-role-gated.
- **Missing object-level authz (IDOR) / cross-school** — none found; ownership/tenancy re-checked before every object read/mutation (`getExamQuestions`, `getChildProgress`, `getClassStats`, `saveClassAttendance`, `createLibraryDownloadTicket`, class-management set).
- **Input schemas / request-size limits** — string/array/enum caps present on the AI paths (`cleanString`, `MAX_CHARS`, batch slices ≤25/≤40); §5 lists the remaining recommendation to assert `Content-Type: application/json` and explicit body caps on the JSON POST endpoints.
- **App Check coverage** — graduated observe-only via `resolveAppCheckEnforcement` (env-flippable per-label); HTTP AI streams soft-verify. Recommendation: extend soft-verify to `apiTextToSpeech`.
- **CORS** — `functions/cors.js` explicit allowlist + preview-channel regex, single matched origin echoed (never `*`), `Vary: Origin`. Correct.
- **Rate limits / resource limits** — `functions/rateLimit.js` fixed-window per-user + per-IP; now on the previously-uncapped surfaces above.
- **Webhook protections** — HMAC over raw body (Lenco SHA512, Meta SHA256), fail-closed, idempotent + status-guarded downstream.
- **Idempotency** — `aiOperations.reserveAiOperation` (generateAssessment), idempotent payment activation, `merge:true` admin writes, optimistic-concurrency on syllabus versioning.
- **Secret management** — provider keys are Firebase Functions secrets, never in the frontend bundle or responses; `deadProviderSecrets.test.js` guards decommissioned keys; `test:secret-hygiene` guards committed credentials.
- **Security tests** — added `checkUpstreamHeaders` cases to `imageProxy.test.js`; full suite (392 node scripts) green.

---

## 4. Remaining risks / accepted-as-is (recommendations, not fixed here)

> **ALL SIX ARE NOW CLOSED (2026-08-14)** — burned down under Phase 5 exit
> criterion 3, each as its own PR. Item 3 turned out to have been done already
> and merely left listed as open. The struck text below is the original
> recommendation, kept so the reasoning that produced it stays readable; the
> note after each says what was actually built and where it differs from what
> was recommended. Two of them differ deliberately (4 and 5) and say why.
>
> **Re-verified 2026-08-16** by running the suites each entry names, not by
> re-reading the entries — `test:webhook-ledger`, `test:appcheck-http`,
> `test:ai-provider-inventory`, `test:library-download`,
> `test:http-request-guard`, all green, and item 6's `getUserRole` /
> `isAdminRole` pattern confirmed in `functions/teacherTools/syllabusOverrides.js`.
> Worth doing because the Phase 5 batch-3 commit, written hours before these
> landed, still says the burn-down is outstanding — and a commit message never
> learns.
>
> **A SEVENTH item existed outside this list and outlasted it**: the two
> fail-open defaults recorded in `docs/architecture.md` §7 — moderation on
> provider error, rate limiting on Firestore error. Rate limiting was already
> covered (`rate_limit_degraded` + the `rateLimitHealth.js` canary). Moderation
> was not: it failed open with a bare `console.warn` that named the provider
> error but never the OUTCOME, so learner text passing UNSCREENED left no record
> distinguishable from a clean screen — and `functionErrorWatch`, the only thing
> watching server logs since #2230, filters `severity>=ERROR`, so a WARNING was
> invisible to it rather than merely quiet. **Closed 2026-08-16**: a structured
> `moderation_degraded` record, ERROR when it failed open and WARN when it
> failed closed, with the fail-open default itself deliberately unchanged
> (`MODERATION_FAIL_CLOSED` already flips it; knowing was the missing part).
> `test:moderation-core`, `test:moderation`.
>
> **Re-derive before trusting any of this** — it is a 2026-07-18 audit with
> later annotations, not a live source of truth.

Each of these is defence-in-depth on an already-mitigated path; deferred to avoid risk to the money/critical path in this change.

1. ~~**Webhook event-id ledger (Lenco + WhatsApp).** Neither webhook persists a processed-event id set; replay safety currently rests on idempotent+status-guarded activation (Lenco) and single-last-id dedup (WhatsApp). Both hold today. Recommend a `processedWebhookEvents/{eventId}` `tx.create` ledger as belt-and-braces (bounds cost of a replayed WhatsApp message and hardens against any future non-idempotent handler).~~ **DONE 2026-08-14.** `processedWebhookEvents/{eventKey}`, claimed with a transactional create so the first delivery wins atomically even when two retries land on two instances. Both webhooks claim after their signature check — before it, an unsigned payload could pre-claim the key of a genuine delivery and have it discarded as a duplicate. WhatsApp claims *per message, before* the Anthropic call and the outbound send, which is the cost the item was about; the existing single-last-id check stays as the cheap first pass. **Fails open**: this is a second layer over already-idempotent activation, so an unreachable ledger processes and logs rather than refusing — blocking a real payment webhook during a Firestore blip would cause exactly the outcome the collection exists to prevent. Server-only in rules (`test:rules-text` + a rules-emulator case for the pre-claim attack), RETAINED on account deletion with a reason, 30-day `expiresAt` for a TTL policy. `test:webhook-ledger`.

    **The trap worth recording:** the obvious key — Lenco's collection id — is wrong in the expensive direction. Lenco sends `pending` and then `successful` for one payment, both carrying the same collection id and reference; keyed on those, the ledger would discard the `successful` event and the buyer would pay and never be granted access. Identity is therefore what the event *says* — reference + type + status — not which payment it concerns. That case is the first test in the file.
2. ~~**App Check on `apiTextToSpeech`** — the priciest per-call surface should join the soft-verify + graduated-enforcement set.~~ **DONE 2026-08-14.** The gate and its telemetry writer were local to `functions/index.js`, so a handler in another module could not reach them at all; both moved to `functions/appCheckHttp.js` and `tts.js` now calls `softVerifyAppCheckHttp(req, 'apiTextToSpeech')` after auth and before the rate limiter and the daily meter. Observe-only by default, like every other surface. They were MOVED, not copied: the writer is sampled and sharded, so a second copy would be a second sampling decision and a second shard-picking rule for the same counters. `test:appcheck-http` pins the decisions, that `tts.js` actually calls it (with a control proving that scan can fail), and that no second writer has reappeared.
3. ~~**Broaden `assertCallableRateLimit`** to the remaining metered AI generators (currently bounded by daily/monthly caps but not per-minute burst). Mechanical, fail-open.~~ **ALREADY DONE — found closed 2026-08-14, not by this change.** All 30 metered generators carry burst limiters; `aiProviderCallInventory` reports 55 limited surfaces and 53 provider-backed callable/HTTP endpoints all classified. The 5 remaining exemptions are `apiWhatsAppWebhook` (HMAC-verified, not a user surface) and four trigger/cron families exempt by KIND. There is no "remaining metered AI generator" left to broaden to. Derive before trusting this line: `npm run test:ai-provider-inventory`.
4. ~~**`apiLibraryDownload` single-use tickets** — delete the ticket on first successful stream instead of relying only on the 5-min TTL reaper (bounds replay within the window; impact already owner-scoped).~~ **DONE 2026-08-14.** `claimDownloadTicket` validates and **consumes** the ticket in one transaction, *before* the render rather than after a successful stream. Deleting after success does not make a ticket single-use: the .docx regeneration takes real time, and two requests inside that window would both read a live ticket and both render. Claiming first closes it — the delete IS the claim, and Firestore serialises it. Cost of the trade: a render failure burns the ticket, which is a re-mint of a cheap authenticated callable, against a finding that is otherwise a replayable bearer credential in a URL. An expired ticket is deleted on sight too. `test:library-download`, whose concurrency case is what distinguishes the two designs.
5. ~~**`Content-Type: application/json` assertion + explicit body caps** on the JSON POST endpoints (downstream field validation makes this low).~~ **DONE 2026-08-14**, but applied SELECTIVELY, and the exclusions are the substance. `functions/httpRequestGuard.js` vets the declared type (415) and the declared size (413, 1 MiB) on the five first-party JSON POST endpoints whose clients were each checked to send JSON: `apiTextToSpeech`, `apiAiChat`, `apiGenerateLessonPlan`, `apiGenerateWorksheet`, `apiRequestAccountDeletion`.

    **Three surfaces are deliberately excluded, and applying it to them "for consistency" would break production:**
    - **`apiGuardianConsent`** receives an HTML `<form method="POST">` from the guardian's emailed decision page — `application/x-www-form-urlencoded` by design. Asserting JSON breaks consent for every under-age signup.
    - **`lencoWebhook` / `apiWhatsAppWebhook`** set their own headers and are gated by an HMAC signature, which already makes a forged body unusable. The assertion adds nothing and hands a provider a way to break payments by adjusting a header.
    - **`apiTrackVisit`** is a best-effort beacon whose handler is documented to never surface an error to the visitor; a 415 contradicts that contract.

    `test:http-request-guard` pins every exclusion *with its reason* — including asserting that the consent page really does emit a form — so undoing one fails a test rather than a user.
6. ~~**`syllabusOverrides.js` admin check** reads the custom claim (`token.role==='admin'`) while every other admin callable reads `users/{uid}.role`; this is **fail-closed** (a panel-promoted admin is locked out of that one editor, never an escalation) — align to the Firestore-role pattern for consistency.~~ **DONE 2026-08-14.** Now `getUserRole` + `isAdminRole`, exactly like every other admin callable. The claim is *derived* from `users/{uid}.role` and only reaches a session on token refresh, so a panel-promoted admin was locked out of this one editor for up to an hour while every other admin surface worked. `isAdminRole` rather than a bare `=== "admin"`, because superAdmin is a strict superset everywhere in the app. (Checked while fixing: superAdmins were **not** affected — `security/adminClaims.js` mints `admin: true` for them, so they passed the old check.)

---

## 5. Security test matrix status

The existing suite already exercises the core adversarial cases (rules-text, schema, rate-limit core, image-proxy SSRF gate, webhook processor idempotency, App Check resilience, offline security). This change adds pre-buffer header-vetting cases. A full emulator-based caller-matrix (learner→teacher, teacher→other-school, invalid/expired token, invalid App Check, webhook replay) is recommended as follow-up under the Firestore-rules emulator job.

---

## 6. Verification

- `npm run lint` — clean on all changed files.
- `npm run test:all` — **392 node test scripts pass.**
- `npm run build` — production build succeeds.
