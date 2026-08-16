# 26 — Public Database Rules & Access-Control Audit

> Snapshot as of 2026-07-18 — verify before acting. Audited branch
> `claude/zedexams-firestore-security-audit`. No secret values appear here.
> Companion to [`18-security-review.md`](./18-security-review.md) (findings +
> P0 remediation), [`11-firestore-data-model.md`](./11-firestore-data-model.md)
> and [`12-storage-map.md`](./12-storage-map.md). This document is the canonical
> **"what may be public"** allowlist; the behavioural proof lives in
> `scripts/test-firestore-rules-emulator.mjs` + `test-storage-rules-emulator.mjs`.

## Objective

Only explicitly-published, non-sensitive, **read-only** ZedExams content is
reachable without authentication (or across tenants). Everything else stays
gated by ownership, role, tenant/school membership, schema validation, and
server-side (Admin SDK) writes.

"Public" here means: the record was intentionally published, contains no
private fields, lives in an approved public collection, is safe for
unauthenticated viewing, and its writes remain server-controlled. It does **not**
mean "any doc", "any authed user", "anyone can write", or "reachable with a
guessed id".

## Posture

- **Default deny.** `firestore.rules` and `storage.rules` both end with an
  explicit recursive catch-all — `match /{document=**} { allow read, write: if
  false; }` / `match /{allPaths=**} { allow read, write: if false; }`. Every
  allowed operation is granted by a narrower, earlier match. (The Firestore
  catch-all was made explicit in this audit; behaviour was already deny-by-
  default, but the explicit block future-proofs new collections and is pinned by
  `test:rules-text`.)
- **Explicit public allowlist** (below) — a small, enumerated set.
- **Public reads are read-only** — every public collection denies client
  create/update/delete; the data is written by Admin-SDK Cloud Functions or
  admin console only.
- **Tenant isolation** — teacher/learner/school data is owner- or
  membership-scoped; cross-tenant reads are denied and emulator-tested.
- **No client-controlled privilege fields** — role, plan, premium, payment,
  entitlement, teacherPlan, generationCredits, publication, usage, referral, and
  lifecycle fields are blocklisted on user self-write and pinned on create.
- **Server-side validation** — presence-gated type/size/enum validators back
  every client-writable document as a tampered-client backstop (client Zod
  schemas are the primary validator; rules keep the integrity-critical teeth
  within Firestore's 1000-expression evaluation budget).
- **Tested before deploy** — `test:rules-text` (static invariants) + the
  Firestore/Storage rules emulator suites gate CI.

## Firestore public-read allowlist

Every entry below is read-only for clients; writes are Admin-SDK / admin-only.

| Path | Public read scope | Business reason | Write path |
|---|---|---|---|
| `settings/{id}` | `if true` for `global` + `quizLibrary` ONLY; every other id is admin-read | Site config the SPA needs pre-auth: `global` (site name, maintenance flag, registration toggle — read by `passkeyService.js` before sign-in) and `quizLibrary` (quiz summary index behind the public runner). `fxRate` is consumed only by `/admin/company` + the server-side budget governor, so it moved behind admin read | admin only |
| `examTimetables/{id}` | `if true` | Published ECZ exam schedules; `/timetable` renders pre-auth | admin (seed script) |
| `announcements/{id}` | `if true` | Non-secret platform banners | admin |
| `pastPapers/{id}` | `status == 'published'` (drafts/archived admin-only) | SEO/marketing archive index | admin only, schema-validated |
| `pastPapersIndex/{id}` | `if true` | Denormalised published-papers list for the `/papers` hub | server-only trigger/cron |
| `publicStats/{id}` | `if true` | Marketing social-proof counters | server-only cron |
| `quizzes/{id}` (+ `questions/`) | `publicAccess == true && isPublished == true` (questions exclude `daily_exam`) | Past-paper preview quizzes indexable for marketing | admin Past-Paper Studio |
| `quizSummaries/{id}` | mirrors `quizzes` (`publicAccess && isPublished`) | Lightweight library-list mirror | server-only trigger |
| `games/{id}` | `active == true` | Anonymous game play | admin |
| `scores/{id}` | `if true` | Leaderboard (only name + score leak) | self-create (own uid), server-pinned time |
| `leaderboards/{id}` | `if true` | Aggregated top-N per game | server-only |
| `daily_challenges/{id}` | `if true` | One featured game per day | admin |
| `shares/{token}` | **`get` only**, `if true`; `list` admin-only | Token-as-permission share links (teacher plans) | owner create/update |
| `progressShares/{token}` | **`get` only**, `if true`; `list` admin-only | Token-as-permission parent progress links | learner create |

Two protections worth calling out:

1. **`get`/`list` split.** `shares` and `progressShares` are readable by the
   unguessable token id (`allow get: if true`) but their `list` is admin/owner-
   scoped, so knowing one token cannot enumerate every share (which would leak
   author uids and parent email/phone). Pinned by `test:rules-text`.
2. **Public queries must carry the rule's filters.** e.g. `pastPapers` list must
   `where('status','==','published')`; the client never downloads a mixed set
   and relies on rules to strip it (a `list` fails wholesale if any returned doc
   fails the rule).

### Public write (unauthenticated) — controlled, single collection

- `contactMessages/{id}` — `create` only, with a strict `keys().hasOnly(...)` +
  `hasAll(...)` allowlist, per-field size caps, server-pinned `createdAt`, and a
  role enum. Reads/updates/deletes are admin-only. Newsletter, feedback,
  referral, and family-invite submissions are routed through Admin-SDK callables
  (validation + rate-limit + honeypot the rules can't express) — direct client
  writes are denied.

## Private / never-public collections (representative)

Owner-, role-, tenant-, or server-scoped — never anonymous, never cross-tenant:

- **Identity/billing:** `users`, `payments`, `invoices`, `subscriptionEvents`,
  `referralRedemptions`, `referralCodes` (authed read, owner create).
- **AI/usage:** `aiGenerations`, `generatedContent`, `aiOperations`,
  `aiUsage/**`, `aiUsageDaily`, `aiDailyLimits`, `rateLimits`, `usageMeters/**`,
  `aiAgentTasks`, `aiGeneratedContent(Versions)`, `aiAgentLogs`,
  `aiSupervisorLogs`, `aiLiveAgentStates`, `aiTaskSteps`, `learnerWeaknessProfiles`.
- **Curriculum corpus (server-only):** `curriculum`, `rag_chunks`,
  `curriculumUploads` (admin read).
- **Assessments/quizzing:** `assessments` (+ `questions/`), `assessmentDrafts`,
  `drafts/**`, `questionBank` (owner + approved Master-Bank + admin),
  `exam_attempts/{id}/private/**` (owner/admin), `results`, `paperAttempts`.
- **Teacher tenant:** `teacherLibraries/**`, `schoolProfiles`, `teacherProfiles`
  (+ `teachingAssignments/`), `lessonPlans`, `lessonProgress`, `lessonSeries/**`.
- **School/class:** `classes`, `classInvites`, `assignments` (CF-only writes),
  `classRegisters/**` — including `roster/`, `records/`, and the **server-only**
  `attendance/`, `attendanceTerms/`, `attendanceAudit/`.
- **Learner-private:** `learnerProgress`, `learner_profiles`, `learnerStats`,
  `dailyStreaks`, `studyPlanProgress`, `noteProgress`, `flashcardProgress`,
  `parentDigestEvents`, `notifications/{uid}/feed/**`.
- **Family:** `parentLinks`, `familyInviteCodes` (owner read; CF-only writes).
- **Ops/admin/audit:** `adminAuditLogs`, `visits`, `visitorStats/**`,
  `appCheckHealth/**`, `playBindingHealth`, `newsletterSubscribers`,
  `newsletterSignupRateLimit`, `dawnConfig`, `dawnRuns`, `promptTemplates/**`,
  `schoolLicences`, `downloadTickets` (server-only), `feedback` (admin read).

## Storage path classification

There is **no world-public Storage path** — every match requires `isVerified()`
at minimum, and the file ends with a deny-all catch-all.

| Path | Read | Write |
|---|---|---|
| `papers/{ownerUid}/**`, `papers/{file}` | entitled learner **or** teacher/admin **or** owner, `callerActive()` | owner teacher/admin, `validPaperUpload()` |
| `quiz-images/`, `visual-studio/`, `lesson-images/`, `lesson-presentations/`, `lesson-files/**`, `picture-bank/**` | any verified user (assets embed in shared docs) | owner teacher/admin, type/size validated |
| `assessment-images/`, `user-branding/`, `invoices/`, `tmp-downloads/` | owner (+admin) only | owner (or server-only for invoices) |
| `syllabus-uploads*/`, `curriculum-uploads/`, `assessment-format-samples/` | admin only | admin, content-type pinned |
| everything else | **deny** | **deny** |

Notes: SVG is deliberately excluded from presentation uploads (stored XSS via
direct-URL navigation); `tmp-downloads/` is swept hourly by `tmpDownloadReaper`;
bucket CORS (`cors.json`) is required so exporters can read image **bytes**.

## Admin SDK / server bypass

Cloud Functions use the Admin SDK, which **bypasses these rules**. Server
handlers therefore enforce their own auth independently: `functions/authGuard.js`
(`assertVerifiedAuth` → verification + `assertActiveAccount`), role checks
(`assertCallerIsAdmin` / `isStaffRole`), ownership (`loadClassOrThrow`), input
validation, rate limiting (`rateLimitCore.js`), idempotency
(`aiOperations.js`, `subscriptionActivation.js`), and audit logging
(`adminAuditLogs`). Writes to server-owned collections (grading, publication,
attendance days, payments, usage) are deliberately `if false` for clients so the
only path is the validated callable.

## App Check status

Web = reCAPTCHA Enterprise, Android = Play Integrity. **Observe-only by default**
(SEC-M2) — additional abuse protection, not a replacement for auth/rules. Enforce
after registering all apps and confirming production traffic verifies. See
[`18-security-review.md`](./18-security-review.md) SEC-M2 and
`docs/RECAPTCHA-ENTERPRISE-SETUP.md` / `docs/B3-PLAY-INTEGRITY-SETUP.md`.

## Test coverage (this audit)

- `scripts/test-firestore-rules-text.mjs` — +1 invariant: the explicit
  default-deny catch-all must exist and deny read+write (53 tests total).
- `scripts/test-firestore-rules-emulator.mjs` — +16 cases (154 total):
  default-deny for anonymous/learner/admin on an unlisted collection; anonymous
  can read a **published** past paper / index / public stats but **not** a draft,
  assessment, payment, AI operation, or curriculum corpus; anonymous/learner
  cannot create public docs or publish a past paper; cross-user AI-operation read
  denied. All green (`npm run test:rules-emulator`).
- Pre-existing suites retained: premium-entitlement gate, suspension
  enforcement, tenant isolation (teacher↔teacher, learner↔learner), token-as-
  permission enumeration denial, server-owned write locks, every editor question
  type, Class-Register subcollection isolation.

## Deployment & rollback

Firestore rules ship via CI (`deploy-firebase.yml` on relevant path changes);
indexes may be deployed directly (`firebase deploy --only firestore:indexes`).
This change is **rules-only and additive** (an `if false` catch-all cannot
narrow any existing grant), so it ships independently of any query change and
needs no data migration. Rollback = revert the rules commit and redeploy;
the previous ruleset behaves identically for all currently-matched paths.

## Residual risks (tracked, not introduced here)

- ~~**`settings/{settingId}` is `read: if true` across the wildcard.**~~
  **CLOSED.** Public read is now pinned to an explicit allowlist —
  `isPublicSettingsDoc(settingId)` permits `global` and `quizLibrary`; every
  other id (including `fxRate` and the internal `curriculumUpdateSourceState`
  scraper state) falls through to `isAdmin()`. A sensitive doc written under
  `settings/` in future is admin-read by default rather than public by default,
  which is the property this entry asked for. Adding a new PUBLIC settings doc
  is now a deliberate one-line edit to the allowlist.
- **SEC-M4 — `agentControl` readable by any verified user.** Circuit-breaker /
  `autoPublish` state is low-harm but should tighten to admin read.
- **SEC-M2 — App Check observe-only.** Public reads (e.g. `pastPapers`,
  `scores`, `publicStats`) remain scrape-able until enforcement + pagination
  limits are in place; keep public list queries bounded (`limit`) and CDN-cached.
- **SEC-F2 — pre-existing Storage download tokens.** Tokens minted before the
  premium gate remain valid until rotated (see `18-security-review.md`).

None of the above is introduced by this audit; the audit's net change is the
explicit default-deny catch-all + the public-access / default-deny regression
tests.
