# 12 — Testing & Quality

> Snapshot as of 2026-07-19. Layer 14. Finding IDs: `TEST-*`.

## Verdict

Testing is a genuine **strength**: ~450 plain-node logic scripts, a Vitest component/hook suite,
and — most importantly — **behavioural** Firestore + Storage rules-emulator suites that assert
real access decisions (cross-school denial, role escalation denial, entitlement expiry, payment
forgery). Idempotency/duplicate-request prevention is tested end-to-end. The gaps are **no
authenticated end-to-end journeys**, **payment flows are mock-only** (no provider sandbox), and a
few specific untested callables (short-answer marking, end-to-end publishing).

## Suite inventory

- **Plain-`node` logic** (`*.test.js` / `test-*.mjs`): ~450 `test:*` scripts, auto-discovered by
  `scripts/run-all-tests.mjs` (`test:all`).
- **Vitest (jsdom)**: `test:unit` / `test:coverage` (component/hook, e.g. `useAiOperationLock.spec.jsx`).
- **Firestore rules emulator**: `test-firestore-rules-emulator.mjs` (1393 lines, real `firestore.rules`
  loaded, `assertSucceeds`/`assertFails`), `test-school-membership-rules-emulator.mjs`,
  `test-quiz-autosave-rules-emulator.mjs` (real editor payloads vs rules).
- **Storage rules emulator**: `test-storage-rules-emulator.mjs` (boots Firestore + Storage).
- **Cloud Function tests**: extensive `functions/**/*.test.js` + `functions:coverage` (c8).
- **Offline/recovery**: `syncQueueCore.test.js`, `offlineSecurity.test.js`, `test-sw-recovery.mjs`,
  `test-critical-work.mjs`.

**The rules emulator suites are real, not text-checks** — they assert cross-teacher draft denial
(`:444`), cross-learner read denial (`:367`), self-cannot-mint-`role:admin` (`:395`),
cannot-mint-`plan:premium`/`generationCredits` (`:405,:425`), cross-school denial
(`test-school-membership…:138,206,238`), entitlement expiry, suspended-account, payment forgery.

## 15 critical workflows — coverage

| # | Workflow | Status | Evidence |
|---|---|---|---|
| 1 | Sign-in / session restore | Partial | Logic only (`test-auth-recovery.mjs`, `appCheckResilient.test.js`); no auth E2E |
| 2 | Role & school isolation | Tested | rules emulator suites |
| 3 | Teacher create + autosave | Tested | `test-assessment-autosave.mjs`, `assessmentDraftCore.test.js`, autosave-rules emulator |
| 4 | AI generate success + failure | Tested | `generateAssessment.test.js`, `aiOperations.test.js`, `aiValidation/*` |
| 5 | Download generation | Tested (unit render) | `docxExporters.test.js`, `assessmentToDocx.test.js`; **CORS-byte-fetch path not integration-tested** |
| 6 | Assessment publishing | Partial | `pubo.test.js`, `gate.test.js`, visibility flip in rules; no end-to-end publish assertion |
| 7 | Learner submission | Tested (rules) | rules emulator anti-forgery `:642-679`; `dailyExamGrading.test.js` |
| 8 | Teacher marking | Partial | `grading.test.js`; **`checkShortAnswer` has no dedicated test** |
| 9 | Attendance saving | Tested | `attendanceServer.test.js`, calculator/day-core/calendar, term-mirror |
| 10 | Payment verification | Tested (mock) | `lencoWebhookProcessor.test.js`, `googlePlayVerify.test.js`, `subscriptionActivation.test.js`; **no live sandbox** |
| 11 | Subscription entitlement | Tested | rules premium/expired/lifetime `:497-507`, `subscriptionUpgrade.test.js` |
| 12 | File upload permissions | Tested | storage rules emulator |
| 13 | Cross-school access denial | Tested | school-membership emulator |
| 14 | Offline recovery | Tested (logic) | `syncQueueCore.test.js`, `test-sw-recovery.mjs`, `test-critical-work.mjs` |
| 15 | Duplicate-request prevention | Tested | `idempotency.test.js`, `aiOperations(Core).test.js`, `paymentInitiationCore.test.js` |

## Findings

### TEST-001 — No authenticated end-to-end tests
- **Severity:** Medium · **Confidence:** High confidence
- **Affected:** only `smoke:mobile` (`test-mobile-smoke.mjs`) — a public-route paint check
  (`/`, `/login`, `/register`, `/papers`, `/pricing`). No logged-in journey is driven end-to-end
  (sign-in → create → autosave → generate → download → publish → learner submit → mark).
- **Risk:** Integration regressions across the auth boundary (rules + callable + UI wiring) are not
  caught by CI; each layer is unit-tested but the seams aren't.
- **Correction:** Add a small Playwright E2E covering the top 2–3 authenticated journeys against the
  emulator suite. **Launch blocker:** No. **Complexity:** Medium.

### TEST-002 — Short-answer marking callable untested
- **Severity:** Low–Medium · **Confidence:** High confidence
- **Affected:** `checkShortAnswer` — no dedicated test found; it marks learner answers with an LLM.
- **Correction:** Add unit tests for `parseMarkerResponse` boundary/failure cases + a golden-set
  regression. **Launch blocker:** No. **Complexity:** Low.

### TEST-003 — Payment flows are mock-only (no provider sandbox test)
- **Severity:** Medium · **Confidence:** High confidence
- **Affected:** Lenco + Google Play tests are unit/mock; no integration against a provider sandbox.
- **Risk:** A change to the real webhook/verify contract is not caught until production.
- **Correction:** Add a sandbox-integration test (gated/nightly) for both rails. **Blocker:** No.

### TEST-004 — Publishing pipeline lacks an end-to-end assertion
- **Severity:** Low · **Confidence:** Moderate confidence
- **Affected:** agent-runner units exist but no test drives job → approve → public visibility flip
  end-to-end. **Correction:** Add an emulator-backed pipeline test. **Blocker:** No.

## Cross-references
- Required-check enforcement of these suites: [`13-cicd-and-release.md`](./13-cicd-and-release.md) CICD-001.
