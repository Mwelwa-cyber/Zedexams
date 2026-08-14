# ZedExams — Launch-Blocker Remediation Report

> Snapshot as of 2026-07-23 — verify before acting.

Repository-backed remediation of the seven NO-GO launch blockers. Every fix is
code-level, tested, and lint-clean; this document records the evidence, the root
causes, and — honestly — which acceptance gates still require a **deployed
staging/preview** to verify (this remediation was performed in an isolated CI
container with no production access and no Lenco account).

---

## A. Final verdict

**NO-GO** — held deliberately, per the rule that the verdict may only move to GO
when *every* mandatory gate has **verifiable** evidence.

All seven blockers have been **remediated in code and verified by automated
tests** (2638 Vitest tests + the full `test:all` node suite, both green, plus
new blocker-specific suites). Two mandatory gates cannot be *verified* from this
container and therefore keep the verdict at NO-GO until a preview deploy is run:

1. **Mobile performance thresholds** (Perf ≥ 75, LCP ≤ 3.5 s, TBT ≤ 300 ms) —
   requires mobile Lighthouse against a **deployed** build (CDN + Brotli +
   real network). The code changes that attack the measured root cause are in;
   the *measurement* must be taken on a preview channel.
2. **Complete authenticated payment lifecycle** — a **safe test path now exists**
   (mock provider adapter + full-lifecycle contract test, all green), which is
   exactly what blocker #7 asked us to *establish*. The **emulator** end-to-end
   run is now **done and CI-gated** (2026-07-23, PR #1860): the full lifecycle
   is driven with `PAYMENTS_PROVIDER=mock` through the **real** activation
   (`subscriptionActivation.js`) and webhook dispatch (`lencoWebhookProcessor.js`)
   against a **real (emulated) Firestore + Storage** — see
   `functions/paymentLifecycleEmulator.test.js` (35 assertions) and the
   `Tests (Payment lifecycle emulator)` CI job. The only step now outstanding is
   one **real Lenco sandbox / low-value live transaction** (needs real Lenco
   credentials + a real charge, so it can't be run from a CI container).

Everything else (featured-quiz integrity, `/api/track/visit`, App Check /
reCAPTCHA resilience, truthful status page, telemetry-can't-break-navigation) is
remediated **and** test-verified here.

---

## B. Environment tested

| Field | Value |
|---|---|
| Repo | `Mwelwa-cyber/Zedexams` |
| Branch | `claude/zedexams-launch-blockers-a7dbsy` |
| Base commit | `4308b2a` (34 commits ahead of `origin/main` `4da46e9`) |
| Firebase project | `examsprepzambia` (`.firebaserc`) |
| Firestore region | `africa-south1` (triggers) · HTTP/callable in `us-central1` |
| Build mode | `vite build` (production) + `--mode smoke` for the render gate |
| Node | v22 |
| Test date | 2026-07-20 |
| Verification env | Isolated CI container (no production/staging access, no Lenco account) |

The original Lighthouse verdict (Perf 29, LCP 13.4 s, TBT 2.11 s) was a
**production** (`zedexams.com`) mobile run; it could not be reproduced from this
container. Root-cause analysis was done against the **production bundle** built
here (real chunk sizes below).

---

## C. Root-cause table

| # | Symptom | Root cause | Sev | Fix | Files | Tests | Evidence | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | Mobile Perf 29 / LCP 13.4 s / TBT 2.11 s | LCP hero image lives inside the **lazy** Marketing chunk, so its URL isn't discoverable until the eager JS bundle parses + React mounts + the chunk loads; Firebase Performance Monitoring starts synchronous instrumentation at boot; heroicons barrel retains all icons | P1 | Route-scoped **preload** of the hero on `/`; defer Perf Monitoring off the boot path (dynamic import + 2 s timeout); `/*#__PURE__*/`-annotate the 126 icon wrappers for tree-shaking; `fetchpriority=high` on the mobile hero | `public/boot.js`, `src/firebase/config.js`, `src/components/ui/icons.js`, `src/components/marketing/Marketing.jsx` | `src/firebase/config.spec.js` (+2), full Vitest suite | Chunk deltas in §D; hero now preloaded during head parse | Code done; **Lighthouse gate unverified (needs preview)** |
| 2 | Featured "Social Studies" quiz shows a Maths question | Public runner derives the subject **label** from `paper.subject` but renders questions from a **separately-linked** `quizzes/{quizId}`, with nothing reconciling the two; it "failed open" | P0 | Canonical subject-identity validator (normalises label-vs-slug); **fail-closed** render gate in the runner; subject-filtered featured strip; dry-run/idempotent repair+quarantine script | `src/utils/quizSubjectIntegrity.js`, `src/components/papers/PublicQuizRunner.jsx`, `src/utils/pastPapers.js`, `src/components/marketing/Marketing.jsx`, `scripts/repair-quiz-subject-integrity.mjs` | `scripts/test-quiz-subject-integrity.mjs` (35) | Validator rejects subject/grade/curriculum/wrong-quiz/mixed-question/unpublished/missing-metadata | Done |
| 3 | `/api/track/visit` repeated HTTP 503 | App handler already returns 204 on every path + sharded counter; gap was **observability** (no request IDs / failure categories) and a slow rate-limit call outside the write budget; residual is platform cold-start (no warm instance) | P1 | Structured one-line-JSON logs with `rid` + failure **categories**; time-box the rate-limit call; `x-request-id` header; handler split out for testing | `functions/visitorTracking.js` | `functions/visitorTrackingHandler.test.js` (17) | Handler proven to return 204 on write-failure / limiter-error / cors-throw; categories emitted | Done; cold-start mitigation documented (runbook) |
| 4 | App Check intermittent 403 | App Check init is deferred off the boot path (correct), but there was **no awaitable readiness signal**, so a protected request could race ahead of the first token | P1 | `whenAppCheckReady()` — resolves when init settles or after a bounded timeout, never rejects; init still exactly-once + fail-open | `src/firebase/config.js` | `src/firebase/config.spec.js` (+2) | Readiness resolves on init-settle and via timeout | Done; prod-enforcement behaviour needs preview confirmation |
| 5 | Invalid-login reCAPTCHA timeout uncaught | Token-mint already fail-open + global `unhandledrejection` guard exists; gap was **test coverage** of duplicate-submit / retry / preserved form | P1 | Regression tests proving no double-submit, credentials preserved, retry works after a recoverable failure | `src/features/auth/pages/Login.spec.jsx` (+2) | Login spec (16 total) | Duplicate click ignored while in-flight; retry succeeds | Done |
| 6 | Status page says "all operational" during outages | The page ran three shallow **client** probes (logo HEAD, one `scores` read, no-cors Auth ping) disconnected from Vigil, the real monitor | P0 | Vigil now writes a public `publicStatus/current` doc (rich states + streaks); page renders it; **stale → unknown**; independent CDN probe as a second signal | `functions/agents/publicStatusCore.js`, `functions/agents/cron.js`, `src/utils/systemStatus.js`, `src/components/marketing/StatusPage.jsx`, `firestore.rules` | `functions/agents/publicStatusCore.test.js` (20), `scripts/test-system-status.mjs` (16) | Stale/missing doc → unknown (never operational); recovery needs 2 clean runs | Done |
| 7 | Payment flow unverifiable (no safe test path) | Server path is already idempotent + signature-verified + server-authoritative, but there was **no sandbox/mock** to exercise it | P1 | Mock provider adapter implementing the exact Lenco contract + a factory hard-guarded from production; full-lifecycle contract test over the **real** server decision logic; **emulator end-to-end run** over the **real** activation + webhook dispatch against a real (emulated) Firestore + Storage | `functions/mockPaymentProvider.js`, `functions/paymentProvider.js`, `functions/paymentProviderContract.test.js`, `functions/paymentLifecycleEmulator.test.js`, `functions/index.js` (5 call sites) | `functions/paymentProviderContract.test.js` (28) + `functions/paymentLifecycleEmulator.test.js` (35, emulator, CI-gated) | Duplicate-press reuse, timeout, declined, OTP, delayed+duplicate callback, exactly-once fulfilment, amount-mismatch parking, renewal stacking, top-up credits, bad-signature reject | Safe test path **established** + **emulator end-to-end run done & CI-gated** (PR #1860); only a real Lenco sandbox / low-value live charge remains |

---

## D. Performance results

**Method.** Production `vite build` in this container (no production access, so no
mobile Lighthouse). Numbers below are **bundle-transfer evidence** and the
**mechanism** of the LCP fix; the Lighthouse metrics themselves must be measured
on a deployed preview.

### Eager landing-page chunks (before → after)

| Chunk | Before (raw / gz) | After (raw / gz) | Note |
|---|---|---|---|
| `heroicons-vendor` | 106.73 kB / 18.82 kB | 102.27 kB / 18.11 kB | PURE-annotated wrappers drop app-wide-unused icons |
| `firebase-vendor` | 234.72 kB / 70.45 kB | 234.83 kB / 70.49 kB | Perf SDK stays in-chunk; win is **no boot-time instrumentation**, not bytes |
| `index` (entry) | 328.91 kB / 102.31 kB | 328.95 kB / 102.36 kB | unchanged |
| `firebase-firestore` | 328.82 kB / 100.77 kB | 328.82 kB / 100.77 kB | unchanged (remaining bottleneck) |
| `vendor` (catch-all) | 443.79 kB / 143.72 kB | 443.79 kB / 143.79 kB | unchanged (remaining bottleneck) |

### LCP mechanism fix (not a byte change)

The dominant LCP driver was **discovery latency**: the hero `<img>` sits in the
lazy `Marketing` chunk, so the browser could not begin downloading it until the
~380 kB-gz eager bundle parsed, React mounted, and the chunk rendered. `boot.js`
now injects `<link rel="preload" as="image" fetchpriority="high">` for the hero
**only on `/`**, during early body parse — the image downloads in parallel with
the JS instead of after it. This directly attacks the 13.4 s LCP.

### Measured remaining bottleneck (evidence for the retained NO-GO)

The eager startup set is still ~**1.34 MB raw / ~417 kB gz**
(`index` + `firebase-firestore` + `firebase-vendor` + `vendor`). Firestore's
`persistentLocalCache`/IndexedDB init and the catch-all `vendor` chunk load for
signed-out landing visitors who barely need them. Closing the Perf gate to ≥ 75
likely requires deferring Firestore persistence for anonymous visitors and
splitting the `vendor`/`index` chunks — a larger, separately-reviewed change.
**Until a preview Lighthouse run confirms ≥ 75 / ≤ 3.5 s / ≤ 300 ms, this gate
stays failed.**

Preferred next perf steps (measured, ranked): (1) confirm the hero-preload LCP
win on preview; (2) defer Firestore IndexedDB persistence for signed-out `/`;
(3) split the 443 kB `vendor` catch-all; (4) add `rollup-plugin-visualizer`
behind a flag for regression tracking.

---

## E. Content-integrity results

- **Validator** (`validateQuizSubjectIntegrity`) enforces canonical
  subject / grade / curriculum identity (normalising the label-vs-slug mismatch
  that `paperToQuizConverter` vs `PastPaperStudio` introduce), plus wrong-quiz
  back-link, mixed-subject questions, unpublished, and missing metadata.
- **Public app fails closed**: the runner refuses to render on any violation
  (no cross-subject substitution); the featured strip drops mismatched cards.
- **Repository-wide scan**: `scripts/repair-quiz-subject-integrity.mjs`
  (dry-run default; `--apply` quarantines non-destructively + writes
  `quizIntegrityAudit`; `--rebuild-index` invalidates the featured cache). It
  must be run against production data to produce the live mismatch count — that
  scan is a **deploy-time step** (see §J), not runnable from this container.
- Scanned here: 0 (no production Firestore access). Repaired/quarantined: n/a
  until the scan runs. Test fixtures for all eight mismatch classes: **pass**.

---

## F. Reliability results

- **`/api/track/visit`**: handler proven (17 assertions) to return **204 on
  every failure path** — write-reject, write-timeout, limiter-error, cors-throw,
  rate-limited — and to emit distinct failure **categories** (`validation`,
  `rate_limited`, `rate_limit`, `server`, `server_timeout`, `method_not_allowed`)
  with a per-request `rid`. Counter writes remain sharded (no hot doc). Residual
  503 risk is platform cold-start; mitigation options in the runbook.
- **App Check**: init exactly-once (existing) + new awaitable readiness gate;
  fail-open token path unchanged; prod enforcement not weakened.
- **Auth error handling**: invalid credentials → friendly message; recoverable
  failure → retry with preserved form; no double-submit; global
  `unhandledrejection` guard already installed at boot.
- **Status monitor**: `publicStatus/current` written hourly by Vigil from real
  checks; client down-grades a **stale** doc (> 135 min) to `unknown`; recovery
  requires 2 consecutive clean runs (no flapping); a failure shows on the first
  run (never hidden).
- **Load test**: not run (no infra); the single-doc hotspot was already removed
  (sharded counter) — evidenced by `visitorTrackingCore` shard tests.

---

## G. Payment verification

Testing used a **mock provider adapter** (`functions/mockPaymentProvider.js`)
that implements the exact Lenco client contract, selected by a factory that is
**hard-guarded from production** (`mockAllowed()` returns false whenever
`NODE_ENV=production` and not in the emulator — verified). The contract test
drives the mock through the **real** server decision logic
(`decideLockedInitiation`, `processLencoWebhookEvent`) and an idempotent
activation spy:

| Scenario | Result |
|---|---|
| Authenticated initiation returns pending, grants nothing | ✅ |
| Duplicate button press / concurrent request → reuse in-flight | ✅ |
| Callback-before-redirect → "already paid", never charged twice | ✅ |
| Provider timeout at initiation | ✅ throws, no grant |
| Declined / user cancellation | ✅ markFailed, no grant |
| OTP required → wrong OTP fails, correct OTP proceeds | ✅ |
| Successful via webhook | ✅ activated |
| Delayed callback (poll pending → successful) | ✅ |
| Duplicate callback | ✅ idempotent, fulfilment **exactly once** |
| Invalid / tampered / missing webhook signature | ✅ rejected (fail closed) |
| Unknown reference webhook | ✅ ignored, no grant |
| No entitlement from client-only success state | ✅ (grant only via server activation) |

**Now also done (2026-07-23, PR #1860):** an **emulator** end-to-end run.
`functions/paymentLifecycleEmulator.test.js` (35 assertions, wired into the
`Tests (Payment lifecycle emulator)` CI job) drives the same mock provider
through the **real** activation (`subscriptionActivation.js`) and webhook
dispatch (`lencoWebhookProcessor.js`) against a **real (emulated) Firestore +
Storage** — verifying, on committed documents, premium activation, exactly-once
idempotency on duplicate/delayed callbacks, declined + amount-mismatch parking,
OTP, early-renewal stacking, top-up credits, unknown-reference ignore, and
signature verify/fail-closed.

**Still not done:** a run against a **real Lenco sandbox** or a controlled
low-value **live** transaction (needs real Lenco credentials + a real charge —
not possible from a CI container). The safe path to do so is in place (see §J).

---

## H. Security impact

No security control was weakened to make any test pass:

- App Check init stays exactly-once and **production enforcement is untouched**;
  the readiness gate is additive and never accepts an invalid token.
- The payment mock is **impossible** to select in a deployed production function
  (`mockAllowed()` fail-closed against `NODE_ENV=production`), verified in the
  contract test.
- Webhook signature verification remains fail-closed (HMAC-SHA512, timing-safe);
  the mock's `verifyWebhookSignature` still rejects tampered/garbage/missing
  signatures.
- Firestore rules for the new `publicStatus/current` are **public-read,
  server-write-only** (no client writes), matching `pastPapersIndex`/`publicStats`.
- `/api/track/visit` logs carry **no PII or tokens** — only a request id and a
  failure category.
- The featured-quiz path now **fails closed** (stricter than before).

---

## I. Remaining risks

| Risk | Owner | Severity | Follow-up |
|---|---|---|---|
| Mobile Perf gate unverified (no preview Lighthouse here) | Web perf | P1 | Deploy branch to a Firebase Hosting preview channel; run 3× mobile Lighthouse; if < 75, defer Firestore persistence for signed-out `/` and split `vendor` |
| Live payment lifecycle not run against a real provider sandbox/live | Payments | P1 | Emulator end-to-end run **done & CI-gated** (PR #1860, `functions/paymentLifecycleEmulator.test.js`); remaining: one Lenco sandbox / low-value live transaction with real credentials |
| `/api/track/visit` platform cold-start 503 (no warm instance) | Infra | P2 | Decide on `minInstances: 1` for `apiTrackVisit` (cost trade-off) or accept rare cold-start 503s; telemetry now distinguishes them |
| Production featured-quiz mismatches unquantified | Content | P1 | Run `scripts/repair-quiz-subject-integrity.mjs` (dry-run) against prod; review the report before `--apply` |
| Eager bundle still ~417 kB gz | Web perf | P2 | `rollup-plugin-visualizer` + chunk-splitting follow-up PR |

---

## J. Deployment instructions

Deploy order (nothing here is destructive):

1. **Firestore rules** — `publicStatus/{docId}` public-read rule must land
   before the status page reads it. CI deploys via `deploy-firebase.yml` on
   merge (rules path changed).
2. **Cloud Functions** — `hourlyMonitor` (writes `publicStatus/current`),
   `apiTrackVisit` (structured logs), and the payment callables (provider
   factory — behaviour-identical in prod) ship via `deploy-firebase.yml`.
3. **Hosting** — the SPA (`boot.js` hero preload, StatusPage, PublicQuizRunner
   fail-closed, App Check readiness, perf deferral) ships via
   `deploy-hosting.yml`.
4. **Featured-quiz repair** (post-deploy, gated):
   ```bash
   node scripts/repair-quiz-subject-integrity.mjs                 # dry-run report
   node scripts/repair-quiz-subject-integrity.mjs --apply --rebuild-index
   ```
   Requires `firebase login` or `GOOGLE_APPLICATION_CREDENTIALS`. Review the
   dry-run before `--apply`. `--rebuild-index` clears `pastPapersIndex/published`
   so the cron rebuilds the featured cache (the hub falls back to a direct query
   while it's absent — no gap).
5. **Cache invalidation** — the client `publicStatus`/featured reads pick up the
   new docs on next load; no manual purge needed.

**Rollback:** revert the branch; the added modules are additive. Specifically:
the payment factory falls back to the real Lenco client if `paymentProvider.js`
is reverted; the status page tolerates a missing `publicStatus/current`
(→ "unknown", never a crash); the featured filter degrades to showing fewer
cards, never wrong ones. No schema migration to undo (quarantine flags are
additive fields; the repair script never deletes).

**Verification after deploy:**
- 3× mobile Lighthouse on the preview URL → record median Perf/LCP/TBT/CLS.
- Hit `/status` while a component is deliberately failing → confirm it shows
  degraded/outage, and stale after > 135 min.
- `curl -XPOST /api/track/visit` with a bad body → 204 + a `track_visit_rejected`
  `category:"validation"` log line with an `x-request-id`.
- Run the payment lifecycle end-to-end on the emulator:
  `npm run test:payment-lifecycle-emulator` (drives the mock provider through
  the real activation + webhook dispatch against the Firestore + Storage
  emulators; also runs as the `Tests (Payment lifecycle emulator)` CI job).

---

## K. Evidence

- **Tests added** (all green): `scripts/test-quiz-subject-integrity.mjs` (35),
  `functions/visitorTrackingHandler.test.js` (17),
  `functions/agents/publicStatusCore.test.js` (20),
  `scripts/test-system-status.mjs` (16),
  `functions/paymentProviderContract.test.js` (28),
  `src/firebase/config.spec.js` (+2 readiness),
  `src/features/auth/pages/Login.spec.jsx` (+2 resilience).
- **Suite results**: `npm run test:all` → exit 0; `npx vitest run` → 268 files /
  2638 tests passed; `npm run lint` → exit 0; `npm run build` → success.
- **Runbooks**: see `docs/production-readiness/RUNBOOKS-launch-blockers.md`.
- **PR**: opened as a draft on `claude/zedexams-launch-blockers-a7dbsy`.
