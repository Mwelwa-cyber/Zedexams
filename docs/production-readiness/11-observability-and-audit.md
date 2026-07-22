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

### OBS-002 — Admin direct-write fallback bypasses the audit ledger; audit write failures swallowed ✅ both made loud in this PR
- **Severity:** Medium → Low (residual) · **Confidence:** High confidence
- **Was:** `auditLog.js` **swallowed** audit-write failures (an action could succeed with no ledger
  entry and no alert), and `adminPaymentsService.js`'s `withFallback` did a **silent** direct client
  write when the audited callable was `functions/not-found` (deploy skew), skipping the ledger entirely.
- **Fixed here:**
  - `writeAuditLog` now **raises an ops alert** on a failed ledger write (naming action/actor/target for
    reconciliation) and returns `{written: false}` — the underlying action still succeeds, but the gap
    is no longer silent. Pure `buildAuditEntry` + injectable `{db, alert}`; tests: `auditLog.test.js` (9).
  - The client fallback path now **reports a forced client error** (`adminPayments.auditBypass`) every
    time it fires, so a ledger-bypassing direct write during deploy skew is visible and reconcilable.
- **Residual:** tighten `firestore.rules` admin-mutation to server-only (remove the client-write path
  altogether) and **unify** the disjoint `adminAuditLogs` + `attendanceAudit` ledgers — both are
  behavioural/rules changes best done with the rules emulator, tracked separately. **Blocker:** No.
  **Complexity:** Medium.

### OBS-003 — No structured logging / request-correlation IDs
- **Severity:** Low–Medium · **Confidence:** Moderate confidence
- **Affected:** backend uses `console.warn/error` with `[module]` tags; no JSON logger, no
  request/correlation/trace IDs threaded UI→function→data.
- **Current:** A production incident cannot be traced end-to-end by a single correlation id.
- **Correction:** Adopt structured logging with a per-request id propagated from the client.
- **Launch blocker:** No. **Complexity:** Medium.

### OBS-004 — Single-channel email alerting that fails silently ✅ second channel added
- **Severity:** Low–Medium → Low (residual) · **Confidence:** High confidence
- **Was:** `opsAlert.js` was best-effort SMTP only — a bad SMTP cred or an unconfigured mailbox
  silently dropped every critical alert (backup failed, budget exhausted, agent breaker tripped).
- **Fixed here:** `sendOpsAlert` now delivers over **two independent channels in parallel** — the
  existing email AND a **Slack-compatible incoming webhook** (`OPS_ALERT_WEBHOOK_URL`;
  Slack/Discord/Mattermost/generic all accept the `{text}` payload from the pure
  `buildOpsAlertWebhook`). The channels are fully independent (one failing/unconfigured never blocks the
  other), and `delivered` is true if EITHER got the alert out — so a single-channel failure no longer
  loses a critical alert. Best-effort, never throws. Tests: `opsAlert.test.js` (webhook build + POST
  2xx/non-2xx/network-error + two-channel delivery incl. "webhook alone delivers when email is down").
- **Heartbeat + dead-man's-switch:** the synthetic canaries (`storageBackupCheck`, `rateLimitHealthCheck`,
  `backupCompletionCheck`) write per-subsystem heartbeats to `opsBackups` / `opsStorageBackups` /
  `opsRateLimitHealth`. A new **cross-subsystem dead-man's-switch** (`opsHeartbeatCheck`, every 6h,
  `functions/opsHeartbeat.js` + `opsHeartbeatCore.js`) reads all three and raises ONE edge-triggered
  alert if any is **stale or missing** — i.e. that monitor's OWN scheduled trigger stopped firing, the
  one failure a subsystem can't self-report. 22 tests. Verdict persists to `opsHeartbeat/status`.
  Marshal already confirms scheduled agents ran.
- **Residual:** set `OPS_ALERT_WEBHOOK_URL` on the deploy + confirm a test alert lands in the channel
  (runtime). **Launch blocker:** No. **Complexity:** Low.

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
- **Degraded-limit alert now wired (code-level).** Beyond the structured `rate_limit_degraded` log, a
  scheduled **synthetic canary** (`rateLimitHealthCheck`, hourly, `functions/rateLimitHealth.js` +
  `rateLimitHealthCore.js`) probes the fail-open limiter and raises an **email ops alert** when it comes
  back degraded — **edge-triggered** (one alert at onset, not one per hour of a sustained outage) and
  **kill-switch aware** (`RATE_LIMIT_DISABLED` reads as `disabled`, never alerts). Verdicts persist to
  `opsRateLimitHealth/status`. 18 tests. The `rate_limit_degraded` log remains for operators who prefer
  a GCP **log-based metric + alert policy** (per-event granularity + custom threshold/window). The hard
  monthly-budget reservation gate is never bypassed, so a degraded limiter can't exhaust the wallet.
  **Runtime verification still owed:** trigger a degraded probe on the deploy and confirm the alert email
  arrives (threshold/window/destination all exercised).
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
