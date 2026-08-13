# Runbooks — launch-blocking services

> Snapshot as of 2026-07-20 — verify before acting.

One runbook per launch-blocking service touched by the remediation. Format:
symptoms → dashboards/logs → likely causes → immediate containment → rollback →
verification → escalation owner.

---

## 1. `/api/track/visit` (visitor telemetry)

- **Symptoms:** 503s on `/api/track/visit` in the browser Network tab; visitor
  counts flat in `/admin/visitors`.
- **Dashboards/logs:** Cloud Functions logs for `apiTrackVisit` (region
  `us-central1`). Every line is one-line JSON `{"event":"track_visit_*",
  "rid":"…","category":"…"}`. Filter by `category`:
  `validation` (bad client body), `rate_limited`/`rate_limit` (abuse or slow
  limiter), `server`/`server_timeout` (Firestore), `method_not_allowed`.
- **Likely causes:** (a) **platform cold-start** — the function scaled from 0
  and Hosting returned 503 during spin-up (no app log line for the request);
  (b) deploy mismatch — the rewrite points at a function not yet deployed;
  (c) genuine Firestore slowness → look for `write_timeout`.
- **Immediate containment:** telemetry is fire-and-forget and never blocks
  navigation, so no user-facing action is needed. If cold-start 503s are
  frequent, set `minInstances: 1` on `apiTrackVisit` (cost trade-off: one warm
  128 MiB instance) and redeploy.
- **Rollback:** revert `functions/visitorTracking.js`; the endpoint reverts to
  its prior (already-204-on-error) behaviour.
- **Verification:** `curl -XPOST https://zedexams.com/api/track/visit -d '{}'`
  → HTTP 204 + an `x-request-id` header; a malformed body logs
  `category:"validation"`.
- **Owner:** Infra / backend.

---

## 2. Featured-quiz subject integrity

- **Symptoms:** a featured/past-paper quiz shows questions from the wrong
  subject; a learner reports "this Social Studies quiz is Maths".
- **Dashboards/logs:** browser console — `[PublicQuizRunner] subject-integrity
  check failed — refusing to render` with the violation codes. Run the audit:
  `node scripts/repair-quiz-subject-integrity.mjs` (dry-run).
- **Likely causes:** a paper's `subject` was edited while its linked
  `quizId` (and questions) stayed on the old subject; or the paper points at a
  quiz built for a different paper (`wrong_quiz`).
- **Immediate containment:** none needed — the public app **fails closed** (the
  runner refuses to render; the featured strip drops the card). To remediate the
  underlying data: `node scripts/repair-quiz-subject-integrity.mjs --apply
  --rebuild-index` (quarantines the paper, non-destructive, audited in
  `quizIntegrityAudit`).
- **Rollback:** quarantine only adds fields; to un-quarantine, clear
  `integrityStatus` on the paper. Nothing is deleted.
- **Verification:** re-run the script → the paper no longer appears in
  `mismatched`; open the paper's quiz → the fail-closed message or the corrected
  content.
- **Owner:** Content / admin.

---

## 3. Firebase App Check / reCAPTCHA

- **Symptoms:** intermittent 403s on Firestore/callable/`/api/*`; a spike in
  `/admin/app-check` "missing/invalid" attestation.
- **Dashboards/logs:** `/admin/app-check` (per-product attestation); browser
  console `[appCheck]` warnings; the global `unhandledrejection` sink (PostHog).
- **Likely causes:** a protected request issued before the first token minted
  (boot race); an unregistered preview domain in the reCAPTCHA Enterprise key;
  a blocked reCAPTCHA script.
- **Immediate containment:** App Check init is exactly-once and fail-open — a
  missing token yields no header, not a crash. Callers that must have a token
  can `await whenAppCheckReady()` before issuing the request. Do **not** disable
  enforcement globally.
- **Rollback:** revert `src/firebase/config.js`; the readiness gate is additive.
- **Verification:** `src/firebase/config.spec.js` readiness tests; on preview,
  confirm no 403 burst in the first seconds after load.
- **Owner:** Web / auth.

---

## 4. Login / invalid-credentials flow

- **Symptoms:** an invalid login throws an uncaught error, or a double-click
  fires two sign-ins.
- **Dashboards/logs:** PostHog client-error sink (`unhandledrejection`);
  browser console.
- **Likely causes:** a floating reCAPTCHA render rejection (absorbed by the
  global guard); a UI that re-enabled the submit button too early.
- **Immediate containment:** the submit button disables while a sign-in is
  in-flight (no double-submit); credentials are preserved on a recoverable
  failure so the user retries without retyping; the token-mint timeout is
  fail-open.
- **Rollback:** n/a (tests only).
- **Verification:** `src/features/auth/pages/Login.spec.jsx` duplicate-submit +
  retry tests.
- **Owner:** Web / auth.

---

## 5. Public status page

- **Symptoms:** `/status` shows "all operational" during a real outage, or shows
  outage during a healthy period.
- **Dashboards/logs:** `publicStatus/current` doc; Vigil rollup in
  `/admin/agents`; `hourlyMonitor` function logs.
- **Likely causes:** `hourlyMonitor` stopped writing `publicStatus/current`
  (→ the page correctly shows **unknown** after 135 min); or a genuine component
  failure Vigil detected.
- **Immediate containment:** the page is truthful by construction — a stale or
  missing doc reads "unknown", never "operational". If Vigil itself is down,
  investigate `hourlyMonitor`.
- **Rollback:** revert `functions/agents/cron.js` + `StatusPage.jsx`; the page
  tolerates a missing doc.
- **Verification:** `functions/agents/publicStatusCore.test.js` +
  `scripts/test-system-status.mjs`; deliberately fail a component and confirm the
  page reflects it within an hour.
- **Owner:** SRE / Vigil.

---

## 6. Payments (Lenco)

- **Symptoms:** a paid user has no entitlement; a payment charged twice; a
  webhook rejected.
- **Dashboards/logs:** `payments/{reference}` docs; `subscriptionActivation`
  logs; Till reconciler rollup; `lencoWebhook` logs (401 = bad signature).
- **Likely causes:** a dropped webhook (Till reconciles it); an amount mismatch
  (parked as `amount_mismatch`); a signature/key misconfiguration.
- **Immediate containment:** fulfilment is idempotent + server-authoritative —
  a duplicate webhook grants nothing extra; a client "success" never grants
  entitlement. For a stuck pending payment, Till re-queries Lenco hourly.
- **Safe testing:** never use real customer money. Use the mock provider:
  set `PAYMENTS_PROVIDER=mock` in the **emulator** (or a test env) — it is
  hard-blocked in production. `functions/paymentProviderContract.test.js`
  exercises the full lifecycle over the pure decision logic, and
  `functions/paymentLifecycleEmulator.test.js` (`npm run
  test:payment-lifecycle-emulator`) runs it end-to-end over the **real**
  activation + webhook dispatch against the Firestore + Storage emulators.
- **Rollback:** revert `functions/paymentProvider.js`; the callables fall back
  to the real Lenco client.
- **Verification:** the contract test (28 assertions) + the emulator end-to-end
  run (35 assertions, CI-gated) both green; remaining before launch is one Lenco
  sandbox / low-value live transaction with real credentials.
- **Owner:** Payments / backend.
