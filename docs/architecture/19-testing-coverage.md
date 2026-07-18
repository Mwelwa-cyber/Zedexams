# 19 — Testing & Coverage

> Snapshot as of 2026-07-17 — verify before acting. Audited commit `0cd4c49`.

## Two suites, split by filename

1. **Plain-node scripts** — every `*.test.js` / `test-*.mjs` is invoked directly with `node` (throw on assertion). Aggregated by `scripts/run-all-tests.mjs`, which auto-discovers every `test:*` npm script whose command starts with `node`. `npm run test:all` runs this. **Do not edit `test:all` by hand** — adding a `node`-based `test:*` key is enough.
2. **Vitest** — `*.spec.{js,jsx}` under `src/` (jsdom). `npm run test:unit` / `test:coverage` (v8 → `./coverage`). Config `vitest.config.js`; setup `src/test/setup.js`.

The two never collide (Vitest only collects `*.spec.*`; node scripts are all `*.test.*`).

## Counts (excl. node_modules)

| Kind | Count |
|---|---|
| `*.test.js` (node) | ~235 |
| `test-*.mjs` (node) | ~165 |
| `*.spec.{js,jsx}` (Vitest) | ~247 |
| `test:*` npm scripts | ~330 |

Emulator/smoke suites (separate CI jobs, **not** in `test:all` because they aren't `node`): Firestore rules (`test:rules-emulator` + `test:quiz-autosave-rules`; text guard `test:rules-text`), Storage rules (`test:storage-rules-emulator`; text `test:storage-rules-text`), mobile smoke (`scripts/test-mobile-smoke.mjs` boots `/`, `/login`, `/register`, `/papers`, `/pricing` in phone Chromium, asserts no crash/white-screen/overflow), functions coverage (c8 ratchet).

## CI jobs (`ci.yml`, PR gate)

`Lint` · `Tests (importer + sanitize + schema)` = `test:all` · `Functions coverage` (c8) · `Tests (Vitest unit + coverage)` · `Build + mobile smoke` · `Tests (Firestore rules emulator)` · `Tests (Storage rules emulator)`. **Required checks on `main`:** `Lint` + `Tests (importer + sanitize + schema)` (`enforce_admins` on). Build+smoke is not yet a required check (per its own comment).

## Coverage map

| Feature | Coverage | Notes |
|---|---|---|
| Authentication / recovery | **Strong** | recaptcha, appcheck, verification, session |
| Teaching Profile / timetable / calendar | **Strong** | |
| Curriculum / CBC KB | **Strong (unit)** | but see the drift risks in [`06`](./06-curriculum-architecture.md) — no cross-source canon test |
| Studios / generators | **Strong** | assessment prompt v5–v10, lesson-plan, scheme, worksheet, SBA, notes |
| Payments | **Strong** | Lenco + webhook, Play Billing core/verify + catalog-mirror, admin |
| Quotas / AI budget / treasury / usage meters | **Strong** | |
| Exports (DOCX/PDF/XLSX + pagination) | **Strong** | pure slice/pagination logic tested; image embedding needs a browser (degrades in node) |
| Firestore / Storage rules | **Strong (emulator)** | separate CI jobs |
| Agents | **Strong** | all content + ops runners + bonga + circuit-breaker + dedup/embedding |
| Offline / PWA / SW | **Strong** | |
| Games | **Strong** | per-engine |
| **Android native (Java)** | **Weak/None** | only stock stubs; `MainActivity` splash, `RecaptchaPlugin`, `ZedExamsApplication` untested; JS-side specs exist (`test:android-release-config`, `test:statusbar`, `test:play-catalog-mirror`, `nativeDownload.spec.js`, `CameraCaptureModal.spec.jsx`, `test:boot-watchdog`) |

## P0 security regression tests (added 2026-07-17)

> **Status:** these tests passed, the fix was **merged (#1774) and deployed to production** (2026-07-17), and the change was **independently reviewed — approved with follow-ups**. Two low residual items remain (payment-initiation fail-open; existing Storage download tokens) — see [`18`](./18-security-review.md) / [`25`](./25-remediation-plan.md). The emulator suites require a **Java** runtime.

| Test | Proves |
|---|---|
| `functions/authGuard.test.js` (`test:auth-guard`, in `test:all`) | `assertVerifiedAuth`/`assertDecodedVerified`/`assertActiveAccount` reject suspended/deleted, pass active/legacy/missing-doc, keep unauth/unverified/grace behaviour, and fail-open on transient read error (12 cases). |
| `scripts/test-firestore-rules-emulator.mjs` (premium + suspension suites) | Free/expired/suspended learners denied premium quiz questions; demo + entitled + lifetime + owner + admin + anonymous past-paper preview allowed; metadata stays list-safe; suspended denied reads/writes and can't clear own status; active/legacy not over-blocked. **138 pass.** |
| `scripts/test-storage-rules-emulator.mjs` (papers entitlement + suspension) | Free/suspended denied premium past-paper PDFs; entitled/teacher/admin allowed; suspended teacher can't upload. (Validates in CI; this sandbox's Storage→Firestore cross-service lookup doesn't resolve — 15 pre-existing baseline failures on unchanged rules confirm the environment limitation.) |

## Recommended tests for critical workflows not fully covered

| Workflow | Recommended test |
|---|---|
| Curriculum canon | `test:curriculum-canon` — assert no module re-declares a grade/subject array outside `config/curriculum.js` + `config/teacherTaxonomy.js`; assert the 13 server `ALLOWED_*` allowlists match one source (closes the [`06`](./06-curriculum-architecture.md) §D drift). |
| Draft recovery (unmigrated) | Recovery/`beforeunload` tests for CreateQuizV2, EditQuizV2, AssessmentStudio singleton overwrite (closes [`15`](./15-drafts-and-autosave.md) gaps). |
| Learner content gating | Firestore-rules emulator test asserting a free/expired learner cannot read premium quiz questions/answers (PAY-1, currently client-only). |
| Suspension enforcement | Rules-emulator test that a suspended user is denied sensitive writes (AUTH-H1). |
| Client-side AI budget | Attribution test that the client Gemini path is accounted (AI-1). |
| Android lifecycle | Instrumented smoke: back button, native Google sign-in, Play Billing restore. |

## Gaps / notes

- Android native Java has no real unit/instrumented coverage.
- `npm-publish-github-packages.yml` is **vestigial/dead** (`npm test` is not a defined script; repo is `private:true`).
- Several CI-consumed `VITE_*` secrets (Sentry/VAPID/AppCheck-reCAPTCHA/PostHog) are missing from `.env.example` — onboarding doc gap.
- "Build + mobile smoke" runs but is not yet a required merge check.
