# 04 — Security & Access Control

> Snapshot as of 2026-07-19. Layers 4 (Identity/Access), 6 (Firestore Rules), 20 (Hardening).
> Finding IDs: `SEC-*`. See [README](./README.md) for scales.

## Verdict

**The access-control core is strong and genuinely defense-in-depth.** Deny-by-default
Firestore rules, comprehensive `users` self-write blocklists, server-only writes for
payments/audit/attendance/usage, a canonical tamper-proof school-membership model, strict
DOMPurify sanitization with SVG excluded, a hardened CSP, and *behavioural* rules-emulator
tests in CI. **No path was found by which a hostile client can escalate role, self-grant a
subscription or AI credits, mark a payment successful, publish unapproved content, tamper
their result percentage, overwrite audit logs, or read another school's/learner's data.**

The material residuals are: App Check enforcement defaults to observe-only (verify at
runtime), and the advertised `platformAdmin`/school-provisioning path is unwired.

## What is strong (evidence)

- **Deny-by-default** — terminal `match /{document=**} { allow read, write: if false; }`
  (`firestore.rules:2796-2798`), pinned by `test:rules-text`.
- **Role escalation closed** — `users` self-update blocklists `role`, all subscription
  fields, `teacherPlan*`, `generationCredits` (`firestore.rules:371-403`); create pins them
  to safe defaults (`:299-358`). No rule reads `request.auth.token.role`; role is resolved
  via a Firestore `get()` (`callerRole()`, `:32`).
- **Result-tamper closed** — `results` update is `isAdmin()`-only (`:729`), explicitly
  closing "PATCH my percentage to 100".
- **Server-only sensitive writes** — `payments` (`:757-766`), `invoices` (`:1816`),
  `usageMeters/periods` (`:1169`), `aiUsage*` (`:1836+`), `adminAuditLogs` (`:437-440`),
  `attendance` (`:2211-2216`), `notifications` create (`:2705-2711`) — all `if false` or
  admin-only.
- **Canonical multi-school RBAC** — school role lives only in
  `schools/{schoolId}/members/{uid}`; `isSchoolAdmin(schoolId)` resolves membership in *that*
  school (`:64-117`, `:2714-2782`), giving true cross-school isolation; `validMembershipFields()`
  blocks re-keying to another uid/school.
- **Email verification** — token-claim-driven (`authGuard.js:86-97`, rules `:18-30`), with a
  documented server-only grace window; suspension revokes refresh tokens (`adminUsers.js:64`)
  and is enforced in `isVerified()`/`notSuspended()`.
- **Hardening** — strong CSP with **no `'unsafe-inline'` in `script-src`**, `object-src 'none'`,
  scoped `connect/img/frame/form-action` (`firebase.json:18-27`); `nosniff`, `X-Frame-Options`,
  `Referrer-Policy`, locked `Permissions-Policy`. DOMPurify per-surface allow-lists
  (`src/editor/utils/sanitize.js`), `ALLOW_DATA_ATTR:false`. SVG excluded from every upload path.
- **Behavioural rules tests** — `ci.yml` runs `test:rules-emulator`,
  `test:school-membership-rules` (`scripts/test-school-membership-rules-emulator.mjs`),
  `test:quiz-autosave-rules`, `test:storage-rules-emulator` (boots Firestore+Storage together).

## Findings

### SEC-001 — App Check enforcement is OFF by default (observe-only) — **canary ARMED (2026-07-19)**
- **Update:** `functions/.env.examsprepzambia` sets `APPCHECK_ENFORCE_LABELS="aiChat,generateQuizQuestions"`,
  so those two endpoints now **hard-enforce** attestation; the rest remain observe-only. Widening is an
  ops decision gated on `/admin/app-check` (do not blind-widen); global `APPCHECK_ENFORCE` still waits on
  Android Play Integrity registration (`docs/B3-PLAY-INTEGRITY-SETUP.md`).
- **Severity:** Medium–High → Medium (partial) · **Confidence:** Requires runtime verification
- **Affected:** `functions/appCheckEnforcement.js:40-51`, `functions/index.js:470-491`,
  `docs/PRODUCTION_READINESS.md:30-37`
- **Current behaviour:** `shouldEnforceAppCheck(label)` returns `false` unless
  `APPCHECK_ENFORCE=1` or `APPCHECK_ENFORCE_LABELS` is set. Default is observe-only — health
  counters recorded in `appCheckHealth/{date}`, but **no callable or HTTP endpoint blocks an
  unattested request.** Replay protection (`consumeAppCheckToken`) was also removed 2026-07
  (`index.js:479-487`), so even under enforcement there are no limited-use tokens.
- **Risk / exploit:** A leaked/scripted ID token can call expensive AI endpoints with no
  attestation backstop — abuse / denial-of-wallet, bounded only by per-user daily usage meters
  and the (thin) rate limiting. Bots can hit public endpoints.
- **Correction:** Follow the staged rollout already prepared — enforce clean web labels via
  `APPCHECK_ENFORCE_LABELS`, watch `appCheckHealth` 24–48h, widen; do not flip global
  `APPCHECK_ENFORCE=1` until Android Play Integrity is registered
  (`docs/B3-PLAY-INTEGRITY-SETUP.md`). **Confirm at runtime whether either env var is set today.**
- **Launch blocker:** Yes for a *public/marketed* launch (denial-of-wallet); No for a closed pilot.
- **Complexity:** Low (config) + monitoring. **Tests:** `appCheckEnforcement.test.js` covers the resolver; add an integration assert that an unattested call 401s once a label is enforced.

### SEC-002 — `platformAdmin` custom claim is never minted; `adminSetPlatformAdmin` does not exist
- **Severity:** Medium · **Confidence:** Confirmed
- **Affected:** `firestore.rules:39-56`, `:2754` (schools create); no `functions/*.js` defines
  `adminSetPlatformAdmin` (repo-wide grep hits only rules/scripts/docs/ci).
- **Current behaviour:** `isPlatformAdmin()` checks `request.auth.token.platformAdmin===true`,
  but no deployed function ever sets that claim, so it always evaluates `false`. It **fails
  closed** (no hole), but the advertised break-glass admin path and the
  `allow create: if isPlatformAdmin()` school-provisioning path are unreachable from any client —
  schools + first school-admins can be created **only** via direct admin-SDK writes.
- **Risk:** Functional gap in the RBAC model, not a vulnerability. Onboarding a new school
  currently requires a manual admin-SDK/console operation (see also `18` operational).
- **Correction:** Implement `adminSetPlatformAdmin` (admin-gated, audited, `setCustomUserClaims`)
  or remove the unreachable branch and document the admin-SDK provisioning path.
- **Launch blocker:** No (unless self-serve school onboarding is a launch requirement).
- **Complexity:** Low. **Tests:** emulator test that a minted claim satisfies `isSchoolAdmin`.

### SEC-003 — No HSTS header
- **Severity:** Low · **Confidence:** High confidence
- **Affected:** `firebase.json:18-27`
- **Current behaviour:** No `Strict-Transport-Security` header is configured. Firebase Hosting
  serves HTTPS but does not add HSTS unless configured.
- **Risk:** SSL-strip / downgrade on first visit / hostile network; no preload.
- **Correction:** Add `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`.
  Verify current response headers at runtime first (a proxy/CDN may already add it).
- **Launch blocker:** No. **Complexity:** Trivial.

### SEC-004 — Leaderboard `scores.score` has no upper bound
- **Severity:** Low · **Confidence:** Confirmed
- **Affected:** `firestore.rules:1399-1408`
- **Current behaviour:** Create requires `userId==auth.uid`, `score is number`,
  `playedAt==request.time`, but no maximum. A tampered client can submit an arbitrarily large
  score; reads are public.
- **Risk:** Leaderboard/gamification inflation only — no entitlement impact.
- **Correction:** Add a sane `score` range bound, or compute scores server-side.
- **Launch blocker:** No. **Complexity:** Trivial.

### SEC-005 — Role custom-claim goes stale after `adminSetUserRole`
- **Severity:** Low / Informational · **Confidence:** Confirmed
- **Affected:** `functions/adminUsers.js:96-128`
- **Current behaviour:** `adminSetUserRole` updates only Firestore `users/{uid}.role`, not the
  token claim. **Not exploitable** — rules authorize via `callerRole()` (Firestore get), not the
  token claim. The token `role` claim is effectively unused by authorization.
- **Correction:** Either call `setCustomUserClaims` on role change for consistency, or document
  the claim as advisory/unused.
- **Launch blocker:** No.

### SEC-006 — Self-writable gamification docs (accepted low-stakes)
- **Severity:** Informational · **Confidence:** Confirmed
- **Affected:** `learnerStats`, `badges`, `dailyStreaks`, `learner_profiles`,
  `studyPlanProgress` (`firestore.rules:1428-1494, 1517-1519`) — owner-writable with
  range-bounded validators. Documented as low-stakes; values are capped. Acceptable; note it so
  no future entitlement logic ever trusts `learnerStats` (it is client-forgeable — see also
  the concurrency audit R6).

## Cross-references

- App Check + rate limiting interplay: [`11-observability-and-audit.md`](./11-observability-and-audit.md) and OBS/backend findings.
- Storage rules + SVG + tokened URLs: [`06-storage-and-files.md`](./06-storage-and-files.md).
- Payment/entitlement rule enforcement: [`08-payments-and-entitlements.md`](./08-payments-and-entitlements.md).
