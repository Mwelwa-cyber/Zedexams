# ZedExams — Production-Readiness Architecture Audit

> Snapshot as of 2026-07-19 — verify before acting.
>
> This is an **engineering assessment**, not a formal security certification,
> penetration test, or legal compliance opinion. It is based on **static
> inspection of the repository** at commit `fec801f` on branch
> `claude/zedexams-production-audit-v663g5`. Items that require a running
> environment, provider dashboards, or legal review are flagged as such.

ZedExams is **already live in production** at zedexams.com. This audit is
therefore a *residual-risk and hardening* assessment, not a "can we launch"
gate — but it is written to the standard of a first launch so that every
material risk is surfaced explicitly.

## How this set is organised

| File | Contents |
|---|---|
| [`01-executive-summary.md`](./01-executive-summary.md) | Scores, headline strengths/gaps, blockers, launch conditions, final verdict |
| [`02-current-architecture.md`](./02-current-architecture.md) | The system as built (descriptive) |
| [`03-layer-by-layer-audit.md`](./03-layer-by-layer-audit.md) | The 20-layer status table |
| [`04-security-and-access-control.md`](./04-security-and-access-control.md) | Identity, Firestore rules, App Check, hardening (SEC-*) |
| [`05-data-and-firestore.md`](./05-data-and-firestore.md) | Data model, indexes, scaling hazards (DATA-*) |
| [`06-storage-and-files.md`](./06-storage-and-files.md) | Storage rules, uploads, orphans, downloads (STOR-*) |
| [`07-ai-readiness.md`](./07-ai-readiness.md) | AI paths, validation, quotas, budget, safety (AI-*) |
| [`08-payments-and-entitlements.md`](./08-payments-and-entitlements.md) | Lenco + Google Play, entitlement enforcement (PAY-*) |
| [`09-reliability-and-offline.md`](./09-reliability-and-offline.md) | Autosave, offline, duplicate-submission, work loss (REL-*) |
| [`10-performance-and-scalability.md`](./10-performance-and-scalability.md) | Bottlenecks at 100 / 1k / 10k / 100k users (PERF-*) |
| [`11-observability-and-audit.md`](./11-observability-and-audit.md) | Logging, monitoring, alerts, audit ledger (OBS-*) |
| [`12-testing-and-quality.md`](./12-testing-and-quality.md) | Test inventory, 15 critical-workflow coverage (TEST-*) |
| [`13-cicd-and-release.md`](./13-cicd-and-release.md) | Workflows, environments, rollback (CICD-*) |
| [`14-backup-and-disaster-recovery.md`](./14-backup-and-disaster-recovery.md) | Firestore export, RPO/RTO, restore (DR-*) |
| [`15-privacy-legal-and-compliance.md`](./15-privacy-legal-and-compliance.md) | Child data, consent, retention, copyright (LEGAL-*) |
| [`16-production-blockers.md`](./16-production-blockers.md) | The blocker shortlist with exploit scenarios |
| [`17-remediation-roadmap.md`](./17-remediation-roadmap.md) | Phase 0–4 plan |
| [`18-production-readiness-checklist.md`](./18-production-readiness-checklist.md) | Grouped checkbox scorecard |

## Finding ID prefixes

`SEC` security · `DATA` Firestore data · `STOR` storage · `AI` AI · `PAY` payments ·
`REL` reliability/offline · `PERF` performance · `OBS` observability · `TEST` testing ·
`CICD` release · `DR` backup/DR · `LEGAL` privacy/legal.

## Severity & confidence scales

- **Severity**: Critical · High · Medium · Low · Informational
- **Confidence**: Confirmed · High confidence · Moderate confidence · Requires runtime verification
- **Layer status**: Complete · Mostly complete · Partial · Weak · Missing · Not applicable · Unable to verify

## Method & limits

- Evidence is cited as `path:line`. Where a control depends on a **runtime env var**
  (e.g. `APPCHECK_ENFORCE`, `AI_MONTHLY_BUDGET_USD`, `FIRESTORE_BACKUP_BUCKET`,
  `PLAY_ENFORCE_ACCOUNT_BINDING`, `VITE_SENTRY_DSN`), static inspection can show the
  *mechanism* but not whether it is *armed in production*. These are marked
  "Requires runtime verification."
- Firestore/Storage **rules behaviour** was read but not executed against the
  emulator in this pass; emulator suites exist in CI (see `12-testing-and-quality.md`).
- No production code was modified in producing this audit.
