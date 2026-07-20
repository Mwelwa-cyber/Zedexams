# 11 — Observability & Audit

> Snapshot as of 2026-07-19. Layers 12 (observability), 13 (audit-log). Finding IDs: `OBS-*`.

## Verdict

The **audit ledger is well-designed** (`adminAuditLogs` is append-only + server-only, admin-read),
and there is real synthetic monitoring (Vigil, Marshal) plus email ops-alerts. But
**production tracing is thin**: frontend crash reporting depends on a DSN that may be unset, there
is no structured logging / correlation IDs, alerting is single-channel email that fails silently,
and the audit ledger has completeness gaps (admin direct-write fallback + swallowed write failures).
A production failure often cannot be traced UI → function → data cleanly.

## Strengths (evidence)

- **`adminAuditLogs`** append-only, server-only, admin-read (`firestore.rules:437-440`,
  `auditLog.js`); records `actorUid/actorEmail/action/targetType/targetId/before/after/metadata/createdAt`.
- Audit writes on role change, suspend/delete, payment confirm/reject, premium grant/revoke, agent
  publish/approval (`adminUsers.js:71,116`, `adminPayments.js:122-256`, `dispatcher.js:378-387`).
- **Synthetic checks** — Vigil (`hourlyMonitor`) pages/Firebase/images/quizzes; Marshal
  (`hourlyAgentSupervisor`) agent-freshness → `/admin/company`.
- **Ops alerts** — `sendOpsAlert` → email `ADMIN_EMAILS` (`opsAlert.js:69-106`); AI-cost/budget
  alerts (`aiCostDailySummary.js`); Lenco amount-mismatch/over-collection/config alerts.
- Attendance changes logged to `attendanceAudit` (append-only, `saveClassAttendance.js:120`).

## Findings

### OBS-001 — Frontend crash reporting off without a DSN; no active APM
- **Severity:** Medium · **Confidence:** High confidence
- **Affected:** `src/utils/sentry.js:9` (DSN-gated dynamic import; "team isn't on Sentry yet"),
  `vite.config.js:382` (hidden maps only when `SENTRY_AUTH_TOKEN` present, else stripped);
  Performance Monitoring referenced in `firebase/config.js` but not wired to components.
- **Current:** `docs/PRODUCTION_READINESS.md` says `VITE_SENTRY_DSN` is present in Actions secrets,
  so Sentry is *likely* live in prod — but static code shows it no-ops without the DSN, and there is
  no active `getPerformance()` usage. Without the DSN, production has no frontend error sink beyond
  the friendly `ErrorBoundary` card.
- **Risk:** Blind to client-side crashes; no user-journey performance data.
- **Correction:** Confirm `VITE_SENTRY_DSN` is set in the prod build; wire Firebase Performance or
  Sentry performance. **Launch blocker:** No, but confirm at runtime. **Complexity:** Low.

### OBS-002 — Admin direct-write fallback bypasses the audit ledger; audit write failures swallowed
- **Severity:** Medium · **Confidence:** High confidence
- **Affected:** `src/utils/adminPaymentsService.js:19-28` (`withFallback` → direct client Firestore
  write on `functions/not-found`); `firestore.rules:410-411` still allows admin direct writes;
  `auditLog.js:36-39` swallows audit-write failures (best-effort).
- **Current:** An admin can mutate roles/subscriptions/payments via a direct SDK path that skips
  `writeAuditLog`; and even on the callable path, an audit-write failure is logged-and-ignored, so an
  action can succeed with no ledger entry and no alert. Attendance uses a **separate** `attendanceAudit`
  ledger — two disjoint audit systems.
- **Risk:** The audit ledger cannot be relied on as *complete* — a forensic gap for a platform
  handling money + child data.
- **Correction:** Tighten admin-mutation rules to server-only (remove the client fallback), or make
  the fallback also write audit; alert on audit-write failure; unify the ledgers. **Blocker:** No.
  **Complexity:** Medium.

### OBS-003 — No structured logging / request-correlation IDs
- **Severity:** Low–Medium · **Confidence:** Moderate confidence
- **Affected:** backend uses `console.warn/error` with `[module]` tags; no JSON logger, no
  request/correlation/trace IDs threaded UI→function→data.
- **Current:** A production incident cannot be traced end-to-end by a single correlation id.
- **Correction:** Adopt structured logging with a per-request id propagated from the client.
- **Launch blocker:** No. **Complexity:** Medium.

### OBS-004 — Single-channel email alerting that fails silently
- **Severity:** Low–Medium · **Confidence:** High confidence
- **Affected:** `opsAlert.js:83-84` — best-effort SMTP; no PagerDuty/Slack; no dead-man's-switch if
  the alerter itself is down or SMTP unconfigured.
- **Risk:** A critical alert (backup failed, budget exhausted, agent breaker tripped) can be missed.
- **Correction:** Add a second channel (Slack/webhook) + a heartbeat that alerts if no
  daily-summary/backup ran. **Launch blocker:** No, but pairs with DR-005. **Complexity:** Low.

### OBS-005 — Thin per-minute rate limiting (bot/abuse) — **generators now covered (2026-07-19)**
- **Severity:** Medium → Low (residual) · **Confidence:** High confidence
- **Was:** `rateLimit.js` applied to only ~8 surfaces; ~180 callables had no burst cap (only per-user
  *daily* quota). Fails open by design; per-uid is the real control.
- **Done (tranche 1):** all 14 teacher-tool AI generators now call `assertGeneratorRateLimit` — a
  per-user, per-minute, per-tool cap (default 10/min, `RATE_LIMIT_GENERATOR_PER_MIN`-tunable) via the
  shared limiter (`generatorRateLimit.js` + tested `generatorRateLimitCore.js`).
- **Done (tranche 2):** the remaining AI callables now carry a per-user burst cap via
  `assertCallableRateLimit` — `checkShortAnswer` (30/min), `verifyQuiz` (15), `generateNoteInsights`
  (15), `generateNoteSmart` (12), `structureImportedQuiz` (8), `structureScannedQuiz` (8),
  `ocrNotePages` (8) in `index.js`, and `generateStudyPlan` (12) in `studentAgents.js`.
- **Corrective follow-up (this PR):** an earlier "complete coverage" claim was unverified. A
  repo-wide inventory (`functions/aiProviderCallInventory.js`) found **21 more provider-backed
  callables uncapped** — all now wired. The coverage test now **auto-discovers** the deployed surface
  (`functions/aiEndpointDiscovery.js`: parses every `exports.*` in `index.js`, tags kind + provider
  secret) and **fails on any unclassified provider-backed callable/HTTP endpoint or stale inventory
  row** — a substring check over a hand-listed set alone was insufficient. Auto-discovery immediately
  caught **2 surfaces the manual list missed** (`runDawnBriefing` → now rate-limited; `apiWhatsAppWebhook`
  → documented exempt). Also: a **structured error taxonomy** (burst vs daily vs budget); a
  **learner-scoring correctness + provisional-persistence fix** (a throttle could mark a correct answer
  wrong — now **pending**, the attempt persists as **provisional** with a null `finalScore`, durably,
  so it never counts as settled downstream); a **scanned-import regression fix** (cap 8→40 with safety
  from the bounded retry pipeline + a `submitted = processed + failed` page-accounting invariant).
- **Degraded-limit telemetry implemented; operational alert verification pending.** A jammed limiter
  emits a structured `rate_limit_degraded` log (scope-tagged) that an ops alert **can** be built on —
  wiring that alert channel is a runtime/ops follow-up (pairs with OBS-004), not code done here. The
  hard monthly-budget reservation gate is never bypassed, so a degraded limiter can't exhaust the wallet.
- **Coverage now:** every Anthropic/OpenAI/Gemini/TTS/vision callable/HTTP surface has a burst cap,
  verified in CI by auto-discovery (173 exports scanned; 50 provider-backed callable/HTTP classified).
- **Complexity:** Low (limiter + helper exist).

### OBS-006 — No trigger retry / dead-letter handling
- **Severity:** Low · **Confidence:** Moderate confidence
- **Affected:** no `retry:`/dead-letter config anywhere; Firestore/Eventarc triggers use default
  (retry off). A transient failure in the agent dispatcher / storage-cleanup cascade can silently
  drop work (mitigated by at-least-once `claimEventOnce`).
- **Correction:** Enable retry on idempotent triggers; add a dead-letter/alert. **Blocker:** No.

## Cross-references
- Rate limiting + App Check + budget: [`04`](./04-security-and-access-control.md) SEC-001, [`07`](./07-ai-readiness.md) AI-001.
- Backup monitoring gap: [`14-backup-and-disaster-recovery.md`](./14-backup-and-disaster-recovery.md) DR-005.
