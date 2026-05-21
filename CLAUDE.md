# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo at a glance

ZedExams is a CBC-aligned learning platform for Zambian learners, teachers, and admins, live at zedexams.com. It is a Vite/React 18 SPA backed by Firebase (Auth, Firestore, Storage, Cloud Functions v2 on Node 22). AI runs server-side via Anthropic Claude (Sonnet 4.5 for generators + Zed chat, Haiku 4.5 for quiz verification), OpenAI for short-answer marking, and Firebase AI Logic / Gemini for client-side helpers. Payments are MTN MoMo (Zambia live + sandbox). A Capacitor wrapper produces Android builds.

The Firebase project id is `examsprepzambia` (see `.firebaserc`).

## Common commands

```bash
# Frontend dev
npm install                       # repo root deps
cd functions && npm install && cd ..   # Cloud Functions deps (separate package.json)
npm run dev                       # Vite at http://localhost:5173
npm run build                     # production build into dist/
npm run preview                   # serve built dist/ locally

# Lint
npm run lint                      # flat-config ESLint over src/ + functions/
npm run lint:fix

# Tests — there is no test runner. Each script is plain `node` invocation.
npm run test:all                  # what CI's "Tests" job runs (importer + sanitize + schema + …)
npm run test:importer             # quiz-document parser unit tests
npm run test:sanitize             # rich-text sanitiser
npm run test:schema               # question schema
npm run test:schemas-domain       # quiz/attempt domain schemas
npm run test:csv-import           # CSV quiz import
npm run test:client-errors        # client error reporting helper
npm run test:rules-text           # Firestore rules text checks
npm run test:storage-rules-text   # Storage rules text checks
npm run test:exam-grading         # functions/grading/dailyExamGrading.test.js
npm run test:ai-prompt-policy     # functions/aiPromptPolicy.test.js
npm run test:momo-settlement      # functions/momoSettlement.test.js
npm run test:cors                 # functions/cors.test.js
npm run test:storage-cleanup      # functions/storageCleanup helpers

# Run a single test directly — bypass npm if iterating:
node scripts/test-question-schema.mjs
node functions/grading/dailyExamGrading.test.js

# Integrity (also runs on every commit via husky)
npm run check:integrity           # whole tree; blocks trailing-NUL / truncated-JSX / bad-JSON files

# Android (Capacitor)
npm run android:apk:debug         # vite build + cap sync + gradle assembleDebug
npm run android:run               # launch on a connected device

# Allowed direct deploys
npx firebase deploy --only firestore:indexes   # indexes are the one CLI deploy that's OK from a workstation
```

`.env` (frontend) must be present for `npm run dev`. All vars start with `VITE_FIREBASE_*` — see `.env.example`. Backend secrets (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, MTN MoMo keys) live as Firebase Functions secrets, not in `.env`.

## Deploy flow — read this before shipping

ZedExams ships via GitHub Actions. As of 2026-05-14 the project owner delegated the merge step to Claude — **there is no human-merge gate**, but `main` is branch-protected. After a code change:

1. Verify locally — `npm run lint && npm run build` at minimum, plus the relevant feature tests. The deploy workflow re-runs these; failing on CI wastes a deploy slot.
2. Commit + push the branch (`git push -u origin <branch>`).
3. Open a PR with `gh pr create -R Mwelwa-cyber/Zedexams ...` (the repo has two identical remotes, so `-R` is required for `gh pr ...`; `gh api` uses the URL path directly).
4. Self-merge with `gh pr merge <num> --auto --squash --delete-branch -R Mwelwa-cyber/Zedexams`. The `--auto` flag queues the merge to fire the moment the required `Lint` + `Tests (importer + sanitize + schema)` status checks from [`ci.yml`](.github/workflows/ci.yml) turn green. GitHub will refuse the merge until they pass; `enforce_admins` is on so nothing bypasses this. **Do not wait for a human to merge.**
5. The push to `main` triggers [`deploy-hosting.yml`](.github/workflows/deploy-hosting.yml) (re-runs lint + `test:all` before the Firebase Hosting deploy) and, if relevant paths changed, [`deploy-firebase.yml`](.github/workflows/deploy-firebase.yml) (Firestore rules + indexes, Storage rules, Cloud Functions).

### Off-limits

- `firebase deploy --only hosting` (any flavor) — production hosting goes through CI only. Also enforced via `permissions.deny` in [`.claude/settings.json`](.claude/settings.json).
- `firebase deploy --only functions` — same reason; CI ships Cloud Functions via `deploy-firebase.yml`.
- Direct pushes to `main` — open a PR even for one-line changes so there's an audit trail.

### Allowed direct CLI

- `firebase deploy --only firestore:indexes` — index changes don't affect the hosted bundle and need to land before code that queries against them.

## Repo layout that matters

```
src/
  App.jsx                       — router; nearly every route is React.lazy(); ThemeApplicator pins public routes to brand default
  main.jsx                      — entry; wraps <App /> in ErrorBoundary + AuthProvider + ThemeProvider + DataSaverProvider + PlatformSettingsProvider
  firebase/config.js            — Firebase init; sets auth persistence, App Check (reCAPTCHA v3 on web, Play Integrity on Android via Capacitor plugin), multi-tab IndexedDB persistence, FCM (web-push only)
  firebase/ai.js                — Firebase AI Logic (Gemini) client; src/utils/aiLogic.js wraps generateText/streamText/generateJSON
  contexts/                     — AuthContext, ThemeContext, DataSaverContext, PlatformSettingsContext
  components/
    admin/                      — /admin/* — learners, results, approvals, CBC KB editor, generation logs, agent ops at /admin/agents
    ai/                         — ZedChatLauncher + ZedChatPage (learner study assistant; SSE streamed from apiAiChat)
    auth/                       — Login, Register, AuthAction (password reset)
    dashboard/                  — StudentDashboard, GradeHub, MyResults, Badges, Profile
    exams/                      — Daily exams hub, runner, results, live leaderboard
    games/                      — Games hub + engines (TimedQuizGame, MemoryMatchGame, WordBuilderGame, ProvinceShapesGame, …)
    lessons/                    — Lesson library + slide player + editor; src/features/notes/ holds Notes Studio (admin authoring + learner reader gated by LearnerGate)
    quiz/                       — QuizList, EditQuizV2, QuizRunnerV2, QuizResultsV2, document-quiz importer; QuizVerifyModal calls Vex
    teacher/                    — TeacherDashboard + studios (lesson plan / worksheet / flashcards / scheme of work / rubric / notes / full lesson / homework / assessment); AgentBriefForm + AgentJobsList for the agent pipeline
    papers/                     — Past papers viewer + practice + history
    parent/                     — Parent portal pages
    classes/                    — Class management UI
  features/lessons, features/notes — feature-folder pattern (pages/, components/, services/) for newer surfaces
  editor/                       — TipTap-based rich-content editor shared between quiz/notes/lessons
  hooks/                        — useFirestore, useSubscription, useTeacherUsage, useQuizPersistence, …
  utils/                        — Firestore services + AI clients + DOCX/PDF exporters + MoMo + permissions + paywall + analytics
  schemas/                      — Zod schemas for quiz, attempt, result
  config/curriculum.js          — SUBJECTS / GRADES; single source of truth for CBC dropdowns

functions/                      — Cloud Functions v2, Node 22, codebase=default. Separate package.json.
  index.js                      — every function export lives here (aiChat, generateQuiz, verifyQuiz, checkShortAnswer, apiAiChat SSE, apiGenerateLessonPlan / Worksheet SSE, MoMo webhooks, agentJobsOnCreate/Approved, storageCleanup triggers, scheduled jobs)
  aiService.js                  — Anthropic client (streaming + non-streaming + prompt-caching), assertDailyLimit, role helpers, parsers
  anthropicFetch.js             — low-level fetch around Anthropic API
  geminiClient.js               — Gemini REST client used by structureImportedQuiz
  openaiClient.js               — OpenAI client (short-answer marking)
  teacherTools/                 — one folder per generator (prompt + schema + run* runner) + cbcKnowledge.js (KB resolver), usageMeter.js (per-user + per-agent daily caps), privateCurriculum.js
  agents/                       — Internal agent pipeline. dispatcher.js drives Aria → Cala → Reva → awaiting_approval → Pubo via Firestore triggers on agentJobs/{id}. Runners live in agents/runners/{aria,cala,reva,pubo,quill,vex}.js. agentControl/{agentId}.paused acts as a circuit breaker.
  grading/                      — daily-exam grading
  storageCleanup/               — Firestore triggers that cascade-delete Storage blobs when lessons/quiz questions change
  momoService.js + momoSettlement.js — MTN MoMo (sandbox EUR + mtnzambia ZMW)
  scripts/                      — CBC ingestion utilities (cbc:verify, cbc:ingest, cbc:check)

scripts/                        — top-level data-migration + integrity + test scripts (all plain `node`); also scripts/agents/ for agent-runner harnesses
firestore.rules                 — large, hand-written; the test:rules-text script is a text-level sanity check, not a behavioural test
firestore.indexes.json          — composite indexes (leaderboard, results, attempts). Deploy these BEFORE shipping queries that need them.
storage.rules                   — Storage security rules
firebase.json                   — hosting rewrites map /api/ai/chat, /api/teacher/lesson-plan/stream, /api/teacher/worksheet/stream, /api/tts, /api/payments/momo/* to the matching onRequest Cloud Functions in us-central1; SPA fallback at the bottom
capacitor.config.json           — appId com.zedexams.app; android/ holds the generated native project
.claude/settings.json           — repo-level permission allow/deny list (denies `firebase deploy --only hosting|functions`)
.claude/agents/                 — subagent definitions (cbc-alignment, content-author, content-reviewer, code-reviewer, publisher, qa-smoke, quiz-verifier, release-notes); see ORG.md for the agent org chart
```

## Architecture notes that span multiple files

### Three AI surfaces, each on a different model

- **Generators (lesson plan, worksheet, flashcards, scheme of work, rubric, notes, full lesson, homework, assessment, quiz)** — Cloud Functions in `functions/teacherTools/*`. Each tool is a pair of `<tool>Prompt.js` + `<tool>Schema.js` plus a `generate<Tool>.js` runner. They all share `aiService.callAnthropic` (Sonnet 4.5 by default; override per-runtime with `ANTHROPIC_MODEL`). Two-layer caching: Anthropic prompt caching for the system prompt + CBC-context caching via `teacherTools/cbcKnowledge.js`'s `resolveCbcContext()`. Per-user daily caps live in `usageMeter.js` and write to `aiUsage/{uid}_{day}` / `usageMeters/`. Super-admins bypass the meter (see PR #512).
- **Zed chat (learner study assistant)** — SSE-streamed via `apiAiChat` (HTTP) and `aiChat` (callable). The hosting rewrite `/api/ai/chat` → `apiAiChat` is how the SPA reaches it without CORS.
- **Quiz verification (Vex)** — synchronous callable `verifyQuiz` using Anthropic Haiku 4.5, layered on top of deterministic structural checks (empty/duplicate/out-of-range options). Vex is intentionally **not** routed through `agentJobs` because authors expect Grammarly-style instant feedback. Returns `{ verdict, overallScore, scores, summary, blockers[], warnings[] }` directly to the caller — no Firestore writes.
- **Short-answer marking** — OpenAI (GPT) via `checkShortAnswer` callable, in `functions/openaiClient.js`.
- **Client-side helpers** — Firebase AI Logic / Gemini, exposed through `src/utils/aiLogic.js` (`generateText`, `streamText`, `generateJSON`). Requires App Check enforcement before it's safe to enable on the public origin.

### Agent pipeline (the internal "AI company")

See [`ORG.md`](./ORG.md) for the full org chart and cost budgets. Operationally:

```
teacher submits brief
   → write to agentJobs collection
   → agentJobsOnCreate (functions/agents/dispatcher.js) runs Aria → Cala → Reva sequentially
   → status flips to awaiting_approval
   → admin clicks Approve in /admin/agents
   → agentJobsOnApproved fires; Pubo writes the final artefact to aiGenerations and flips status='done'
```

Per-agent circuit breaker: `agentControl/{agentId}.paused`. Three failures in one hour pauses the agent automatically. Vex is the **only** agent that bypasses this pipeline (it's synchronous, called from the quiz editor).

### Hosting + Functions wiring

`firebase.json` rewrites `/api/*` straight to specific `onRequest` Cloud Functions in `us-central1`. This is how SSE endpoints (Zed chat, lesson plan stream, worksheet stream) avoid CORS — the browser hits same-origin `/api/...`, Hosting proxies to the function. New API endpoints need both the function export in `functions/index.js` AND a rewrite entry here.

### Firestore offline + multi-tab

`firebase/config.js` enables `enableMultiTabIndexedDbPersistence` so the app survives offline and shares cache across tabs. Failures (Safari < 15, private mode, quota) are non-fatal — code paths must still handle a fresh-fetch round-trip. Firestore writes queue while offline and replay on reconnect.

### Service worker

VitePWA `generateSW` with `registerType: 'autoUpdate'` — the new SW activates on next open without a prompt, so HTML/meta changes reach returning users. `<UpdatePrompt />` is left in place but never fires in this mode. `vite.config.js` has a post-build `firebaseMessagingSwConfig` plugin that substitutes `__FIREBASE_*__` tokens in `dist/firebase-messaging-sw.js` because the SW context can't read `import.meta.env`. On Capacitor the SW is not registered.

### App Check

Web uses reCAPTCHA v3 (silent unless score is low). Android uses Play Integrity via `@capacitor-firebase/app-check`, looked up at runtime through `Capacitor.Plugins.FirebaseAppCheck` rather than `await import(...)` so the web build stays package-agnostic. Without `VITE_FIREBASE_APPCHECK_RECAPTCHA_KEY` the web init silently no-ops — fine for lint-only builds, dangerous for a real deploy.

### Capacitor wrapper caveats

- Google sign-in popups don't work in Android WebView — use `signInWithRedirect` or `@capacitor-firebase/authentication`.
- Web reCAPTCHA App Check provider doesn't work in WebView; the Play Integrity provider must be configured before enforcement is turned on for Firebase AI Logic / Functions.
- `src/main.jsx` skips `registerSW()` on native — the bundled `capacitor://` origin makes the SW dead weight and `file://` blocks it.

### Schemas

Quiz/attempt/result Zod schemas live in `src/schemas/`. There's also a parallel server-side schema at `scripts/test-quiz-attempt-schemas.mjs` for the migration tooling. The teacher-tool generators each have their own JSON schema in `functions/teacherTools/<tool>Schema.js` — they describe the LLM output shape, not Firestore docs.

## Conventions worth knowing

- **ESLint config is in `eslint.config.js`** (flat config). The file is heavily commented with the rationale for each rule. `no-unused-vars` exempts `caughtErrors` (lots of intentional `catch (err) {}`), `no-empty` allows empty catches, `eqeqeq` is `'smart'`. Tests + Cloud Functions get Node globals and `no-unused-vars` off.
- **Pre-commit hook** (`.husky/pre-commit`) only runs `scripts/check-file-integrity.mjs` against staged files — it does **not** run lint-staged or ESLint. The history of stash/restore cycles corrupting Windows-filesystem working trees is in the hook comments; don't switch it back without reading that. Run `npm run lint` manually before pushing if you care about CI-clean output.
- **lint-staged config exists in package.json** but is only invoked by lint-staged-aware tooling, not by the pre-commit hook.
- **No test runner / no `vitest`**. Every test file is invoked with `node` directly. Add new tests as plain ES-module scripts that throw on assertion failure and add a `test:*` npm script + a line in `test:all`.
- **Router is fully lazy.** Adding a new route in `App.jsx` means `lazy(() => import('...'))` + a `<Suspense fallback={<PageLoader />}>` if it's a new top-level branch. Don't import page components eagerly.
- **`<NavLink>` / `Navigate` use `getRoleLandingPath`** (`src/utils/navigation.js`) to send each role to the right landing page after auth.
- **Public theme paths** are pinned to the brand default theme in `App.jsx` (`PUBLIC_THEME_PATHS` + `isPublicThemePath`). Adding a new always-public route may need an entry here so it doesn't inherit a saved learner theme.
- **CBC topic + grade lists are in `src/config/curriculum.js`** for the client. The server-side authoritative KB is `functions/teacherTools/cbcKnowledge.js` / `cbcTopics.js`. They have to stay in sync.

## Repo notes

- Two identical remotes. `gh pr ...` needs `-R Mwelwa-cyber/Zedexams`. `gh api` uses URL paths.
- `main` is branch-protected. Required checks: `Lint` + `Tests (importer + sanitize + schema)`. `enforce_admins` is on. Use `gh pr merge --auto` rather than blocking on checks.
- The dev server needs `.env` from the project owner. CI builds use repo secrets (`deploy-hosting.yml:60-83`).
- Today's date and the user's email are surfaced in the session header. Don't hard-code either into code or tests.
