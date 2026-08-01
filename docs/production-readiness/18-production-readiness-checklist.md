# 18 — Production-Readiness Checklist

> Snapshot as of 2026-07-19. `[x]` Confirmed · `[~]` Partial · `[ ]` Missing · `[?]` Unable to verify (needs runtime/settings/legal).

## Authentication
- [x] Email/password + Google sign-in, multi-tab persistence (`firebase/config.js`)
- [x] Email-verification enforced via token claim, not mirror field (`authGuard.js`, rules)
- [x] Suspension revokes refresh tokens + enforced at rules layer (`adminUsers.js`, `isVerified()`)
- [x] Password-reset `continueUrl` allowlisted (`index.js:593-607`)
- [ ] MFA for admins (not present)
- [~] Account deletion exists but no re-auth / rate limit (LEGAL-003)

## Authorization
- [x] Deny-by-default Firestore rules with recursive catch-all
- [x] Role/subscription/credit self-write blocklists (create + update)
- [x] Server-only payments/audit/attendance/usage writes
- [x] Canonical school-membership RBAC (rules) with cross-school isolation
- [x] Behavioural rules-emulator tests assert escalation + cross-school denial
- [~] `platformAdmin` claim defined but never minted (SEC-002) — provisioning admin-SDK-only
- [?] App Check enforcement (observe-only by default; SEC-001)

## Firestore
- [x] Consistent ownership keys, Zod schemas, sharded counters, cron'd global stats
- [x] Composite indexes for leaderboard/results/library/pagination
- [x] Disciplined idempotent migrations with drift-guard tests
- [~] Admin list views capped at 200 rows; server pagination built-but-unwired (DATA-002)
- [ ] `schoolId` on core collections (no multi-school aggregation; DATA-001)
- [~] No soft-delete/version convention on teacher docs (DATA-004)

## Storage
- [x] Path-scoped rules; no public-write; no unauthenticated-read paths
- [x] SVG excluded everywhere; assessment exports rules-denied + server-streamed
- [x] SSRF-contained image proxy; cascade cleanup triggers; temp/ticket reapers
- [~] `lesson-files/` note docs readable by any verified user (STOR-001)
- [ ] Magic-byte verification / malware scanning (STOR-003)
- [~] Some orphan classes reaped only by manual script (STOR-004)

## AI
- [x] Shared retry wrapper; tool-forced structured output; deterministic post-validation before persist
- [x] Idempotency + cost-reservation service exist; budget check runs before provider call
- [~] Idempotency/refund wired to **one** generator (~14 unprotected; AI-002/AI-006)
- [?] Monthly cost ceiling armed in prod (fails open if unset; AI-001)
- [ ] Text content-moderation on learner-facing paths (AI-003)
- [~] Image safety gate exists but not in the write path (AI-004)
- [~] Import prompts lack injection delimiting (AI-005)

## Payments
- [x] Server-authoritative amounts (Lenco + Google Play)
- [x] Lenco webhook HMAC fail-closed; idempotent activation; reconcile cron
- [x] Play token verified server-side; cross-account replay blocked; restore handled
- [x] No client self-grant of premium (rules)
- [x] Full payment lifecycle run end-to-end on the emulator (mock provider → real activation + webhook dispatch → real Firestore/Storage), CI-gated
- [~] Play account-binding observe-only by default (PAY-001)
- [~] Collected-amount check skipped when provider omits amount (PAY-003)
- [~] No sandbox/prod separation (shares single project; CICD-004)

## Offline & autosave
- [x] IndexedDB persistence; durable outbox with mutex + backoff; attendance STALE_VERSION
- [x] Production-grade draft framework + chunk-load recovery
- [~] 5 teacher generators have no autosave/unsaved-work protection (REL-001)
- [~] Multi-tab last-write-wins on teacher docs (REL-003)

## Performance
- [x] Hand-tuned lazy bundle; 157 code-split routes; correct region placement
- [x] No write hotspots (sharded counters, cron'd stats, per-user locks)
- [~] Admin 200-row ceiling (breaks ~10k users; PERF-001)
- [ ] `schoolId` model for 100k/multi-school (PERF-002)

## Monitoring
- [~] Sentry wired (DSN-gated; confirm live in prod; OBS-001)
- [x] Synthetic checks (Vigil, Marshal) + admin health dashboards
- [~] Ops alerts single-channel email, fail-silent (OBS-004)
- [ ] Structured logs / correlation IDs (OBS-003)
- [ ] Active APM / performance monitoring (OBS-001)
- [~] Per-minute rate limiting only on ~8 surfaces (OBS-005)

## Audit logs
- [x] `adminAuditLogs` append-only, server-only, admin-read
- [x] Role/payment/premium/agent-publish changes audited
- [~] Record lacks success/req-id/actor-role; write failures swallowed (OBS-002)
- [~] Admin direct-write fallback bypasses audit; attendance uses separate ledger (OBS-002)

## Testing
- [x] ~450 node logic scripts + Vitest + **behavioural** rules & storage emulator suites
- [x] Idempotency/duplicate-request tested end-to-end
- [ ] Authenticated end-to-end journeys (TEST-001)
- [~] Payment lifecycle run **end-to-end on the Firestore + Storage emulators** over the real activation + webhook dispatch (`functions/paymentLifecycleEmulator.test.js`, CI-gated); real provider (Lenco) sandbox charge still outstanding (TEST-003); short-answer marking untested (TEST-002)

## CI/CD
- [x] 7-job PR gate; post-merge re-verify; deploy-order handled; source-maps stripped
- [x] `functions/` critical/high dependency vulns cleared (adm-zip, websocket-driver → `npm audit` 0; SEC-007)
- [x] DOCX archive hardened (magic bytes, size/ratio/entry caps, traversal/encrypted rejection; SEC-007)
- [?] Rules-emulator/build as *required* checks (CICD-001)
- [~] Dependabot **is configured** (`.github/dependabot.yml` — weekly grouped npm + github-actions updates, CICD-002/CICD-007), alongside the required `dependency-audit` CI job; secret scanning / push protection (CICD-003) is a GitHub repo setting, not visible from the tree — verify in Settings → Code security
- [ ] Staging/prod project separation (CICD-004)
- [x] Rollback runbook (CICD-005 — `runbooks/deploy-rollback.md`; rehearsal drill is the operator step)
- [~] Third-party actions pinned to mutable tags/@main (CICD-007)

## Backups
- [~] Daily Firestore export **configured** — `FIRESTORE_BACKUP_BUCKET=gs://zedexams-backups` IS set in `functions/.env.examsprepzambia`, which records the bucket + IAM as provisioned 2026-07-19. Still to close DR-001 (per that same note): confirm a **first real export** landed (`opsBackups/{date}.status`) and rehearse the **restore drill**
- [~] Restore script + runbook exist and are tested; **restore drill not yet rehearsed** (DR-002)
- [x] Misconfigured prod backup alerts (was silent); prod/dev skip distinguished; structured logs (DR-005 code)
- [x] Retention selector can never delete newest/incomplete backup (tested); bucket lifecycle documented
- [ ] Storage backup (DR-003); Firebase Auth export (DR-002 gap)
- [~] Deletion protection (DR-004) + 7-day PITR (DR-006) — `functions/.env.examsprepzambia` records both as **enabled 2026-07-19**; not independently verifiable from the tree, so confirm in the GCP console rather than re-running the enable commands

## Privacy
- [x] Privacy Policy + Terms, data export, cookie/analytics consent, AI + processor disclosure
- [x] Server-side account-deletion purge (~40 collections)
- [~] Purge best-effort with hand-maintained lists (LEGAL-004)
- [?] Verifiable parental consent for children (disclosure-only; LEGAL-001 — legal)
- [?] ECZ past-paper licensing basis (LEGAL-002 — legal)
- [ ] Breach/incident-response plan (LEGAL-005)

## Operations
- [x] Admin dashboards (users/payments/agents/company/question-review)
- [x] Reconcile crons (Till), agent supervision (Marshal), moderation queues (Echo/Qix)
- [~] Some admin actions fall back to direct Firestore writes (unaudited; OBS-002)
- [~] School provisioning admin-SDK-only (SEC-002)

## Android
- [x] Capacitor wrapper; SW skipped on native; signInWithRedirect; Play Integrity provider
- [x] Signed release + Play Billing verification pipeline
- [?] Play Integrity registered / App Check enforced on Android (SEC-001, docs/B3)
- [~] Play account-binding enforcement off by default (PAY-001)

## Documentation
- [x] CLAUDE.md, ORG.md, DEPLOY.md, architecture set, concurrency-audit, this readiness set
- [x] Hardening/RLS audit docs (`docs/security/`)
- [ ] Restore + incident-response runbooks (DR-002, LEGAL-005)
