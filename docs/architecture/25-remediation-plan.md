# 25 — Remediation Plan (P0 done · P1/P2 roadmap)

> Snapshot as of 2026-07-17 — verify before acting. Baseline commit `0cd4c49`.

This tracks the security/consistency remediation programme. The **P0 security PR** was scoped to two backend-authorization fixes only; everything else is sequenced into separate follow-up PRs so no unrelated refactor rides along.

## P0 — lifecycle status

| Stage | State |
|---|---|
| Identified | ✔ (architecture audit, snapshot `0cd4c49`) |
| Implementation | ✔ complete (Firestore rules, Storage rules, `functions/authGuard.js`) |
| Behavioural tests | ✔ passed — 138/138 Firestore emulator, 12/12 `authGuard.test.js`; Storage rules passed in CI |
| Merge | ✔ complete — PR #1774, head `63e796a`, merge `7b0ad2f` |
| Production deployment | ✔ **confirmed** — Deploy Firebase run `29571690692` released Firestore rules, Storage rules, indexes and the affected Cloud Functions (project `examsprepzambia`) |
| Independent review | ✔ **Approved with follow-ups** |
| Residual risks | **F1** payment-initiation fail-open ([`23`](./23-risk-register.md) RISK-19); **F2** previously issued Storage download tokens ([`23`](./23-risk-register.md) RISK-20) |

### Residual follow-ups (not resolved by the P0 PR)

- **F1 — Payment-initiation fail-open.** `assertActiveAccount` (used by `initiateLencoPayment` etc.) fails **open** on a transient `users/{uid}.status` read error so a Firestore blip can't lock the platform out. Low severity (not attacker-inducible; rules + revoked tokens still bound it). *Follow-up:* review payment initiation separately; make it fail **closed** where appropriate; ensure no Lenco request is created after an authorization failure; add suspended/deleted/missing-user/read-error tests. **Do not change payment code as a documentation task.**
- **F2 — Existing Storage download tokens.** Storage rules gate `getDownloadURL()`/SDK access (the app path), and no token URLs are persisted in Firestore — but a token minted/shared before the change stays valid until rotated. **Unverified** whether any were distributed; tokens were **not** rotated. *Follow-up options:* audit premium-file metadata tokens; rotate/remove them; stop persisting long-lived tokenised URLs; use authenticated or short-lived signed downloads; or a backend download endpoint. **Do not rotate tokens as a documentation task.**

## ✅ P0 — what landed (enforcement)

**Goal:** premium learner content and suspended accounts are enforced by the backend, not the client.

| Fix | Enforcement point | Files |
|---|---|---|
| Premium quiz body (answer keys + explanations) | Firestore `quizzes/{id}/questions` read requires `parent.isDemo == true \|\| hasValidEntitlement()` (owner/admin retained; publicAccess past-paper preview + daily-exam server-gating preserved) | `firestore.rules` (`hasValidEntitlement()`, `callerUserData()`) |
| Premium past-paper PDFs + mark schemes | Storage `papers/` read requires `hasValidEntitlement() \|\| isTeacherOrAdmin() \|\| ownsPath()` + `callerActive()` | `storage.rules` (`hasValidEntitlement()`, `callerActive()`) |
| Suspended-account (Firestore) | `notSuspended()` folded into `isVerified()` → all verified reads/writes denied for `suspended`/`deleted` | `firestore.rules` (`notSuspended()`) |
| Suspended-account (Storage) | `callerActive()` folded into `ownsPath()` (uploads) + `papers/` read | `storage.rules` (`callerActive()`) |
| Suspended-account (Cloud Functions) | `assertActiveAccount` folded into `assertVerifiedAuth`/`assertDecodedVerified` (fail-open on transient read error) — blocks every sensitive callable/HTTP incl. AI + payments | `functions/authGuard.js` |

**Entitlement source:** mirrors `hasPremiumAccess()` (`src/utils/subscriptionConfig.js`) — access flag (`premium`/`isPremium`/`paymentStatus`/`subscriptionStatus`/`plan`) **AND** unexpired `subscriptionExpiry` (or `subscriptionLifetime`), admin/superAdmin always pass. Expiry enforced at read time (matches the no-cron backend). Fields are the ones `functions/subscriptionActivation.js` reliably writes for both Lenco and Google Play, so the fix is provider-agnostic.

**Status source:** canonical `users.status` (`active`/`suspended`/`deleted`), written only by `adminSetUserStatus`; **absence == active** (legacy-safe).

**No migration / no schema change:** all fields already exist. Legacy docs (no `status`, no entitlement fields) resolve to *active* + *free* — the safe default. No backfill is required or included.

**Tests:** `scripts/test-firestore-rules-emulator.mjs` (premium + suspension suites), `scripts/test-storage-rules-emulator.mjs` (papers entitlement + suspension), `functions/authGuard.test.js` (12 cases: active/legacy/missing-doc pass; suspended/deleted reject; unauth/unverified; grace; fail-open). Emulator note: this sandbox's Storage→Firestore cross-service `firestore.get()` doesn't resolve (15 pre-existing baseline failures on unchanged rules), so the storage papers-entitlement cases validate in CI.

**Scope decision — lessons/notes:** verified **not** premium-gated in the current client (`LearnerGate` is auth-only, readers have no `PremiumGate`, `isDemo` is quiz-only). They are free content, so not part of the leak. Making them premium later needs a body/metadata split (body + metadata share one `lessons/{id}` doc; doc-level gating would break the free learner list query) — see P1 below.

## Follow-up PRs (do NOT fold into the P0 PR)

### P1-a — Optional: lessons/notes premium delivery *(only if the business wants them paywalled)*
- Split `lessons/{id}` body (`content`/`blocks`/slides) into a `lessons/{id}/content` subcollection gated like quiz questions, **or** serve the body via an entitlement-checked callable (daily-exam model). Keep metadata public for the free list/search.
- Tests: free learner sees list but not body; entitled learner sees body; owner/admin unaffected; `LearnerSearch` still works.

### P1-b — Canonical curriculum module *(largest correctness win — [`06`](./06-curriculum-architecture.md))*
- Merge `config/curriculum.js` + `config/teacherTaxonomy.js` into one canon (G-code wire vocab); unify the 13 drifted server `ALLOWED_*` into `assessmentAllowlists.js`; collapse the `curriculumSelectorConstants.js` verbatim grade copies; add `test:curriculum-canon`. Sequence: allowlists first (closes active drift bugs), then studio pickers, then learner surfaces.

### P1-c — Shared AI gateway + client-Gemini removal *(RISK-4 — [`09`](./09-ai-architecture.md))*
- One client `callFn()` wrapper (region/timeout/error/SSE); route the client-side Gemini path (`src/utils/aiLogic.js` + `src/firebase/ai.js`) through a Cloud Function so it inherits auth + active-account + budget reservation + usage caps + cost rollups. **If** the client Gemini path is ever found to expose premium content directly, block it minimally in a hotfix; otherwise consolidate here.
- **BLOCKER — do not fix `AI-004` in isolation.** The client AI Logic path is currently failing on quota. **Fixing that quota bug would make an unmetered, uncapped client-side AI path start working** — RISK-4 arriving in practice rather than in principle. Settle the routing question below *before, or together with,* the quota fix. (`AI-004` in [`BUG_REPORT.md`](../../BUG_REPORT.md).)
- **Open question + measured scope (2026-08-05 console review — [`AUDIT_LOG.md`](../security/AUDIT_LOG.md)).** The open decision is whether these two features should route through the server-side Cloud Functions AI stack like the rest of the app, or keep calling AI Logic from the client. Three measurements that bear on it: the client AI Logic path has **exactly two consumers** — `src/utils/timetableExtraction.js` (dynamic import) and `src/utils/forecastResourceSuggest.js` — so the migration surface is two call sites, not a sweep; `firebasevertexai.googleapis.com` served **one production request in six weeks, and it 429'd**, so nobody is currently being served by this path either way; and that 429 is the separate live bug called out in the blocker above.

### P1-d — Universal draft-manager migrations *([`15`](./15-drafts-and-autosave.md))*
- One PR per surface: migrate `CreateQuizV2`, `EditQuizV2`, and `AssessmentStudio` (singleton) onto `draftCore`. Test refresh/close/Android-lifecycle/assignment-switch/cross-tab/cloud-save-failure/schema-migration recovery.

### P2 — Staged App Check enforcement *(RISK-5 — [`10`](./10-authentication-and-roles.md))*
- Measure valid/invalid traffic → verify web + Android token coverage → enforce on low-risk endpoints first → expand → keep an emergency rollback env switch. Do not flip global enforcement in one step.

### P2 — Duplication cleanup *([`21`](./21-duplication-register.md))*
- By risk/dependency, not file count: client AI-request construction (D13), path constants (D5/D6), subscription `toDateValue` (D8), draft/calendar/assignment second-resolvers (D10/D11/D12). Never remove a duplicate before its canonical replacement is tested.

### P3 — Verified dead-code cleanup *([`22`](./22-dead-code-register.md))*
- Zero-import files + orphaned collections/indexes — only after re-checking dynamic imports, string refs, CF exports, scripts, deploy config, and git history.

## Recommended PR order

1. **P0 security** (this PR).
2. P1-b canonical curriculum foundation (allowlists → pickers → learner).
3. P1-c shared AI gateway + Gemini removal.
4. P1-d draft-manager migrations (one studio per PR).
5. P1-a lessons/notes premium delivery (only if paywalled by product decision).
6. P2 staged App Check enforcement.
7. P2 duplication cleanup, then P3 dead-code cleanup.
