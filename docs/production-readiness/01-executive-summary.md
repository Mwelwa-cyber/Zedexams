# 01 — Executive Summary

> Snapshot as of 2026-07-19. Commit `fec801f`, branch `claude/zedexams-production-audit-v663g5`.
> These scores are **engineering assessments, not formal certifications** — not a penetration test,
> SOC 2, or legal compliance opinion. They are based on static repository inspection; items that
> need a running environment, provider dashboards, or legal counsel are flagged throughout.

## Scores (out of 100)

| Dimension | Score | One-line basis |
|---|---:|---|
| **Overall production-readiness** | **68** | Strong security + payments core; DR, observability, and AI-cost controls are the drag |
| Security | 82 | Deny-by-default rules, escalation closed, strong CSP, behavioural rules tests; App Check off, dep CVEs, no HSTS |
| Reliability | 70 | Excellent draft/offline/idempotency **primitives**, but uneven adoption (work loss on 5 studios) |
| Data-protection | 52 | Rules protect data in-flight, but the **backup floor is effectively non-functional** + hard deletes + un-re-authed delete |
| Payment-readiness | 85 | Server-authoritative amounts, HMAC webhooks, idempotent activation, server entitlement gate — a genuine strength |
| AI-readiness | 65 | Mature validation + idempotency service, but budget fails open, idempotency on 1/15 generators, no learner moderation |
| Scalability | 60 | Superb client perf + no write hotspots, but 200-row admin ceiling and no `schoolId` for multi-school |
| Observability | 58 | Good audit ledger + synthetic checks, but thin tracing, single-channel alerts, no correlation IDs |
| Testing | 78 | Behavioural rules/storage emulator suites are a standout; no authenticated E2E, payments mock-only |
| Operational-readiness | 62 | Rich admin tooling, but some actions bypass the audited path; provisioning is manual |

## What is already strong

1. **Firestore Security Rules** — 2801 lines of deny-by-default with comprehensive self-write
   blocklists (role, subscription, credits), server-only sensitive writes, and canonical tamper-proof
   school membership. Backed by **behavioural** emulator tests that actually assert escalation and
   cross-school denial. No client escalation path was found.
2. **Payments & entitlements** — amounts are server-authoritative on both rails, the Lenco webhook is
   HMAC-verified fail-closed, activation is idempotent, and entitlement is enforced server-side before
   AI generation. A hostile client cannot mark itself paid or alter the amount.
3. **Frontend reliability primitives** — a production-grade draft framework, a synchronous request
   lock, a durable offline outbox, transactionally-safe payments/attendance, and exceptional
   chunk-load recovery.
4. **Client performance engineering** — a hand-tuned lazy bundle, 157 code-split routes, sharded
   high-frequency counters, and cron-recomputed global stats that avoid write hotspots.
5. **Testing discipline** — ~450 node logic scripts plus genuine Firestore/Storage rules-emulator
   suites and end-to-end idempotency tests; a mature, honest `concurrency-audit.md`.

## What is partially implemented

- **AI controls** exist but are edge-incomplete: cost ceiling opt-in, idempotency/refund on one
  generator, image safety gate not in the write path, no learner-facing text moderation.
- **Observability** has an audit ledger + synthetic checks but no structured logging/correlation IDs,
  single-channel email alerts, and Sentry gated on a DSN.
- **Multi-school RBAC** is half-laid — rules + a dry-run migration exist, but core data has no
  `schoolId` and no runtime code reads the membership model.
- **Reliability adoption** — the right tools exist but 5 generators lack autosave and ~14 lack
  duplicate-submission protection.

## What is missing

- **A working backup/restore floor** — the daily export is unconfigured; no restore script/test; no
  Storage backup.
- **Learner-facing AI content moderation.**
- **Staging/prod environment separation** and **CI dependency scanning.**
- **A verifiable parental-consent mechanism** and a documented **ECZ past-paper licensing basis**
  (both need legal counsel).

## Immediate blockers (see [`16`](./16-production-blockers.md))

- **B1 (Critical):** Firestore backups not running → permanent, unrecoverable data loss (DR-001).
- **B2 (High):** `adm-zip` ZIP-bomb DoS reachable via teacher DOCX upload + critical `websocket-driver`
  (SEC-007).
- **B3 (High, public launch):** unrestricted expensive AI calls — budget fails open, App Check
  observe-only, thin rate limiting (AI-001 + SEC-001 + OBS-005).
- **B4 (High):** security-rule + build jobs likely not required checks → untested rules can deploy
  (CICD-001).
- **B5 / B6 (legal):** no verifiable parental consent (LEGAL-001); ECZ licensing basis unclear (LEGAL-002).

## Major risks

Denial-of-wallet on AI, permanent data loss from the missing backup floor, teacher work loss on the
un-drafted studios, an audit ledger that isn't provably complete, and a data model that cannot scale
to multi-school without a schema rollout.

## Recommended launch conditions

ZedExams is **already live**, so the recommendation is about *what to fix to be safely in production*
and *what gates a broader marketed / multi-school push*:

1. **Do not run any risky data migration or bulk operation** until DR-001 (backups + restore) is
   fixed and a restore is rehearsed.
2. **Before any marketing push:** arm the AI budget ceiling, stage App Check enforcement, and add a
   generator burst cap (B3).
3. **This week:** patch the `functions/` CVEs + guard the DOCX-upload path (B2); make the
   rules-emulator/build jobs required checks (B4).
4. **Before onboarding schools:** clear parental consent + ECZ licensing with counsel (B5/B6) and
   land the `schoolId` tenancy model (DATA-001).

---

## Final section (required answers)

### 1. Five things already implemented well
1. Deny-by-default Firestore rules with escalation-proof self-write blocklists + behavioural emulator tests.
2. Server-authoritative payments with HMAC webhooks, idempotent activation, and server entitlement gating.
3. A production-grade draft/offline/idempotency primitive set (`useDraftManager`, `syncEngine`, `aiOperations`).
4. Excellent client performance engineering (lazy bundle, sharded counters, no write hotspots).
5. Genuinely behavioural rules + storage emulator test suites.

### 2. Five most dangerous current gaps
1. **Backups effectively off** → permanent data loss / no restore (DR-001).
2. **AI cost ceiling fails open** + App Check observe-only → denial-of-wallet (AI-001, SEC-001).
3. **`adm-zip` ZIP-bomb DoS** reachable via teacher upload (SEC-007).
4. **No verifiable parental consent** for child users (LEGAL-001, legal).
5. **Audit ledger not provably complete** (admin direct-write fallback + swallowed failures) (OBS-002).

### 3. Ten highest-priority actions
1. Configure + verify Firestore backup, enable PITR, rehearse a restore (DR-001/002).
2. `npm audit fix` + bump `adm-zip` + guard the DOCX upload path (SEC-007, STOR-003).
3. Set `AI_MONTHLY_BUDGET_USD` + spend alert (AI-001).
4. Stage App Check enforcement on clean web labels (SEC-001).
5. Add rules-emulator/build to `main` required checks (CICD-001).
6. Add a per-user burst cap to generator callables (OBS-005).
7. Wire `useDraftManager` + `useAiOperationLock` across all generators; refund on failure (REL-001/002, AI-002/006).
8. Require re-auth + rate limit on `deleteMyAccount` (LEGAL-003).
9. Add learner-facing moderation + image safety gate (AI-003/004).
10. Close the admin audit-bypass + add a second alert channel/heartbeat (OBS-002/004); stand up staging (CICD-004).

### 4. What must be tested manually on real devices
- Low-end Android over a slow/unstable connection: offline draft → reconnect sync, attendance outbox
  conflict/rebase, PWA update mid-edit, chunk-load recovery after a deploy.
- Client-side PDF/Word export of a large assessment on a low-RAM phone (html2canvas CPU/memory).
- Google sign-in via `signInWithRedirect` in the Android WebView; Play Integrity App Check;
  Play Billing purchase + **restore** on a real device/account.
- Lenco mobile-money (MTN/Airtel/Zamtel) end-to-end in the live sandbox/production with small amounts.
- Touch-target sizing + screen-reader/keyboard nav on the core learner + teacher journeys.

### 5. What cannot be confirmed from static repository inspection
- Whether `FIRESTORE_BACKUP_BUCKET`, `AI_MONTHLY_BUDGET_USD`/`AI_BUDGET_MODE`, `APPCHECK_ENFORCE*`,
  `PLAY_ENFORCE_ACCOUNT_BINDING`, and `VITE_SENTRY_DSN` are set in the **production** runtime.
- The actual **branch-protection required checks** on `main` (GitHub settings).
- Whether Play Integrity is registered and Firestore PITR / deletion protection / bucket lifecycle
  are enabled (GCP console).
- Runtime behaviour of the rules (read but not emulator-executed in this pass) and real provider
  webhook contracts.
- Legal validity of the consent model and ECZ licensing.

### 6. Is a staged pilot safe?
**Yes — a *controlled* pilot is safe** (small number of trusted teachers/classes), provided **B1
(backups) and B2 (adm-zip) are fixed first**, because those risk permanent data loss and repeatable
DoS regardless of scale. The security + payment cores are strong enough for real users. A **broad,
marketed, or multi-school launch is not yet advisable** until B3 (AI cost controls), B4 (required
checks), and the legal conditions (B5/B6) are resolved.

### 7. What monitoring must be active on launch day
- **Backup success** — alert if `opsBackups/{today}.status !== "started"` (DR-005).
- **AI spend** — a daily/near-real-time budget alert (AI-001) + the `/admin/ai-costs` rollup watched.
- **Payment health** — Lenco amount-mismatch/over-collection/config alerts + Till reconcile output;
  Play verification failures.
- **App Check attestation** telemetry (`appCheckHealth`) as enforcement is staged.
- **Frontend crash rate** (Sentry, once the DSN is confirmed) + **function error rate** (Cloud
  Functions error reporting) + Vigil/Marshal health verdicts.
- **Rate-limit / abuse** counters on the AI endpoints.

---

## Final verdict

### **Suitable for a limited pilot** — *not yet suitable for a broad/marketed production launch, despite already being live.*

**Reasons:**
- The **security and payment cores are genuinely strong** and independently verified — no client
  escalation, no self-grant, no amount tampering, server-side entitlement. These are the hardest
  things to get right and they are right.
- But **two Tier-0 blockers make broad production unsafe today**: the backup/restore floor is
  effectively non-functional (permanent-data-loss risk), and a reachable `adm-zip` ZIP-bomb enables
  on-demand denial-of-service. Both are cheap to fix.
- For a **public/marketed** launch, the **denial-of-wallet exposure** (opt-in AI budget + observe-only
  App Check + thin rate limiting) and the **untested-rules deploy gap** must also be closed.
- **Multi-school** adoption is a separate, larger effort (no `schoolId` tenancy) and should not be
  sold until DATA-001 lands.
- **Legal** conditions (parental consent, ECZ licensing) require counsel and gate scaling to children
  and past-paper distribution.

Fix the Tier-0 blockers (a few days of work) and the verdict rises to **Suitable for controlled
production launch**; add the Tier-1 items and legal clearances for **Production-ready with minor
follow-ups**.
