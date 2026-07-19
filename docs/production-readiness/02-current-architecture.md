# 02 — Current Architecture

> Snapshot as of 2026-07-19 — verify before acting. Part of the production-readiness audit set. See [README](./README.md).

This document describes the system **as built**, from direct inspection of the
repository. It is descriptive, not evaluative — judgements live in
[`03-layer-by-layer-audit.md`](./03-layer-by-layer-audit.md) and the domain files.

## 1. Platform shape

ZedExams is a **CBC-aligned education platform** for Zambian learners, teachers,
parents, and admins, live at `zedexams.com` and shipped as an Android app via
Capacitor (`appId com.zedexams.android`).

- **Frontend**: Vite + React 18 SPA. Router is fully lazy (`src/App.jsx`), wrapped
  in `ErrorBoundary + AuthProvider + ThemeProvider + DataSaverProvider + PlatformSettingsProvider`
  (`src/main.jsx`). ~1,500 source files.
- **Backend**: Firebase Cloud Functions v2, Node 22, single codebase `default`
  (`functions/`, ~156 exports in `functions/index.js`, ~400 JS files).
- **Data**: Firestore `(default)` database in **`africa-south1`**; Firebase Storage;
  Firebase Auth.
- **Hosting**: Firebase Hosting serving `dist/`, with `/api/*` and `/downloads/**`
  rewrites proxied to `onRequest` functions in **`us-central1`** (`firebase.json`).
- **Firebase project**: `examsprepzambia` (`.firebaserc`) — single project, no
  separate staging project observed.

## 2. Regional split

| Concern | Region | Evidence |
|---|---|---|
| Firestore `(default)` DB | `africa-south1` | CLAUDE.md; rules deployed there |
| Firestore-triggered functions (`onDocument*`, dispatcher, storage cleanup) | `africa-south1` | pinned to avoid Eventarc cross-region hop |
| HTTP/callable functions | `us-central1` | `firebase.json` rewrites target `us-central1` |

This is a deliberate latency choice (Zambian users) with a documented rationale.

## 3. Identity & roles

- **Auth**: Firebase Authentication (email/password + Google). Multi-tab IndexedDB
  persistence, App Check (reCAPTCHA Enterprise on web, Play Integrity on Android).
- **Roles**: two-tier model.
  - Ordinary role in `users/{uid}.role` (`learner` / `teacher` / `admin` /
    `superAdmin`), blocklisted from client self-writes in `firestore.rules`.
  - High-level platform admin via a **custom claim** `platformAdmin`, minted only
    by the `adminSetPlatformAdmin` Cloud Function (`firestore.rules:52-56`).
- **Multi-school RBAC** (recent, PR #1798): canonical membership documents at
  `schools/{schoolId}/members/{uid}` with `role` ∈
  `school_admin|teacher|learner|parent` and `status` ∈
  `active|invited|suspended|removed`. School-scoped rules resolve rights from that
  document, never from a `schoolId` on the user profile (`firestore.rules:64-117`).
- **Account lifecycle**: `users/{uid}.status` (`active|suspended|deleted`), written
  only by `adminSetUserStatus`; folded into the `isVerified()` gate so a suspended
  account is denied at the rules layer (`firestore.rules:119-130`).

## 4. Three AI surfaces, three models

| Surface | Provider / model | Entry point |
|---|---|---|
| Teacher generators (assessment, worksheet, lesson plan, notes, …) | Anthropic Sonnet 4.5 (`ANTHROPIC_MODEL` override) | `functions/teacherTools/*` + `aiService.callAnthropic` |
| Zed chat (learner assistant) | OpenAI `gpt-4o-mini` (`ZED_CHAT_MODEL`) | `apiAiChat` SSE / `aiChat` callable |
| Quiz verification (Vex) | Anthropic Haiku 4.5 | `verifyQuiz` callable |
| Short-answer marking | OpenAI GPT | `checkShortAnswer` callable |
| Image generation | OpenAI gpt-image-1 (+ Gemini path) | `generateDiagram` / `generateNotePictures` / `generateVisualNotes` |
| Question review (Qix) | Anthropic Haiku | `questionReviewOnWrite` trigger |
| Client helpers | Firebase AI Logic / Gemini | `src/utils/aiLogic.js` |

Cost/quota controls: per-user daily caps (`functions/teacherTools/usageMeter.js`),
a revenue-linked monthly budget gate (`functions/treasury.js` +
`aiCostTracking.js`), request-locking/idempotency (`functions/aiOperations.js` +
`src/hooks/useAiOperationLock.js`), and cost tracking (`aiCostTracking.js`).

## 5. Agent pipeline (internal "AI company")

Content jobs flow through Firestore: `agentJobs/{id}` → `agentJobsOnCreate`
dispatcher (Aria → Cala → Reva → `awaiting_approval` → Pubo) in `africa-south1`.
A fleet of scheduled ops/growth agents (`functions/agents/cron.js`: Vigil, Marshal,
Till, Echo, Gate, Compass, Anchor, Dawn, Quill) writes rollups surfaced in
`/admin/agents` and `/admin/company`. Per-agent circuit breaker
`agentControl/{agentId}.paused`. **Bonga** (`apiWhatsAppWebhook`) is the only agent
that messages users directly. See [`ORG.md`](../../ORG.md).

## 6. Payments & entitlements

- **Web**: Lenco (MTN/Airtel/Zamtel mobile money + cards, ZMW). Initiation +
  `lencoWebhook` (signature-checked in `functions/index.js`, routed by
  `lencoWebhookProcessor.js`), idempotent activation
  (`subscriptionActivation.js`), amount verified server-side against the charged
  amount (`collectedAmount` → `amount-mismatch`). Reconcile cron **Till**
  (`hourlyRevenueReconcile`).
- **Android**: Google Play Billing (`functions/googlePlayBilling.js` +
  `Core`); `verifyGooglePlayPurchase` validates the purchase token against the Play
  Developer API, then activates through the same idempotent path.
- **Rules**: `payments`, `subscriptions`-related user fields, `invoices`,
  `usageMeters`, `aiOperations` are all server-write-only; users cannot self-grant
  premium (`firestore.rules` users blocklist + `payments:757-766`).

## 7. Storage & file lifecycle

Firebase Storage holds uploads (PDF/Word/images/past papers/scanned quizzes) and
generated exports. `storage.rules` (424 lines) governs access. `cors.json` opens
cross-origin reads for exporters. Cascade cleanup lives in
`functions/storageCleanup/` (Firestore triggers delete blobs when parent docs
change/delete). Downloads flow through ticketed endpoints
(`apiLibraryDownload` / `apiAssessmentDownload`, `downloadTickets` server-only) and
an image proxy (`apiImageProxy`).

## 8. Reliability & offline

Firestore offline persistence (`enableMultiTabIndexedDbPersistence` in
`firebase/config.js`), a VitePWA service worker with `autoUpdate`
(skipped on native), draft/autosave infrastructure (`src/hooks/draft/`), and a
localStorage outbox for class attendance (`useClassRegister`, with server-only
`saveClassAttendance` writes and STALE_VERSION conflict handling).

## 9. Observability

Sentry wired for frontend crash reporting (`VITE_SENTRY_DSN`, confirmed present in
Actions secrets per `docs/PRODUCTION_READINESS.md`). Ops alerting via
`functions/opsAlert.js` → `ADMIN_EMAILS`. Vigil (`hourlyMonitor`) synthetic
checks. Admin cost/health dashboards (`/admin/ai-costs`, `/admin/company`). Audit
ledger `adminAuditLogs` (`functions/auditLog.js`, server-write-only, admin-read).

## 10. CI/CD & DR

GitHub Actions: `ci.yml` (Lint + node test suite + Vitest + rules emulator +
mobile smoke), `deploy-hosting.yml`, `deploy-firebase.yml`, `security-review.yml`,
`android-*.yml`. `main` is branch-protected (`enforce_admins` on). Daily
cross-region Firestore export (`functions/firestoreBackup.js`, gated on
`FIRESTORE_BACKUP_BUCKET`).

---

*Evaluation of each of the above follows in the layer files.*
