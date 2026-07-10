# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Binding standards:** every AI session must follow [`AI_DEVELOPMENT_GUIDE.md`](./AI_DEVELOPMENT_GUIDE.md) — Definition of Done, coding standards, schema rules, and test rules. Read it before making changes; it is enforced in CI by `npm run test:ai-dev-guide`.

## Repo at a glance

ZedExams is a CBC-aligned learning platform for Zambian learners, teachers, and admins, live at zedexams.com. It is a Vite/React 18 SPA backed by Firebase (Auth, Firestore, Storage, Cloud Functions v2 on Node 22). AI runs server-side via Anthropic Claude (Sonnet 4.5 default — `claude-sonnet-4-5`, overridable per-runtime with `ANTHROPIC_MODEL` — for generators; Haiku 4.5 `claude-haiku-4-5-20251001` for quiz verification), OpenAI for Zed chat + short-answer marking, and Firebase AI Logic / Gemini for client-side helpers. **Image generation** (question/passage diagrams, note pictures, visual notes) runs on OpenAI gpt-image-1 (with a Gemini path via `geminiImageClient.js`) — see `generateDiagram` / `generateNotePictures` / `generateVisualNotes`. The Recraft and Kie providers were decommissioned (2026-06 / 2026-07); their style selectors (`recraft` line-art, `kie` colour illustration) now render through gpt-image-1. Payments run through Lenco (MTN, Airtel, and Zamtel mobile money plus cards, in ZMW) on the web, and through **Google Play Billing** (in-app subscriptions) on the Android build — see `functions/googlePlayBilling.js` + `verifyGooglePlayPurchase`. A Capacitor wrapper produces Android builds.

The Firebase project id is `examsprepzambia` (see `.firebaserc`).

> **Firestore region:** the `(default)` Firestore database lives in **`africa-south1`** (moved from `us-central1` for Zambian latency). Firestore-triggered Cloud Functions (`onDocument*`, agent dispatcher, storage-cleanup triggers) must be pinned to `africa-south1` too so Eventarc doesn't make a cross-region hop on every event. HTTP/callable functions have no regional trigger and stay in **`us-central1`** (this is what `firebase.json` rewrites point at). When you add a new Firestore trigger, set `region: "africa-south1"`.

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

# Tests — two suites, kept separate by filename:
#   • `*.test.js` / `test-*.mjs`  → plain `node` assertion scripts (the bulk of the suite)
#   • `*.spec.{js,jsx}`           → Vitest (jsdom) component/hook/behaviour tests
npm run test:all                  # what CI's "Tests" job runs (importer + sanitize + schema + …) — the node scripts
npm run test:unit                 # Vitest run over src/**/*.spec.{js,jsx} (jsdom)
npm run test:unit:watch           # Vitest watch mode
npm run test:coverage             # Vitest + v8 coverage of src/ → ./coverage (frontend gap is measured here)
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
npm run test:cors                 # functions/cors.test.js
npm run test:storage-cleanup      # functions/storageCleanup helpers
npm run test:secret-hygiene       # release-safety: no committed credential/artifact + .gitignore policy guard

# Mobile smoke (release-safety) — NOT in test:all (needs a build + a real
# Chromium). Builds with the fake public Firebase config in .env.smoke, then
# boots /, /login, /register, /papers, /pricing in a phone-sized headless
# browser and asserts each renders (no crash card / white screen / overflow).
# Runs as the "Build + mobile smoke" CI job; locally:
npm run smoke                     # = smoke:build (vite build --mode smoke) + smoke:mobile

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

`.env` (frontend) must be present for `npm run dev`. All vars start with `VITE_FIREBASE_*` — see `.env.example`. Backend secrets (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `LENCO_API_KEY`) live as Firebase Functions secrets, not in `.env`.

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
- `npm run storage:cors` — one-time (re-run if origins change) push of [`cors.json`](cors.json) to the Storage bucket so cross-origin **reads** of generated/uploaded images work. Without it, an `<img>` still *displays* (no CORS needed) but exporters that need the *bytes/pixels* fail silently: the PDF (`htmlToPdf.js` → `html2canvas({useCORS:true})`) and Word (`assessmentToDocx.js` → `fetch(url,{mode:'cors'})`) drop every question/passage diagram — the classic "diagrams show in the studio preview but vanish from the downloads" bug. The script targets `gs://examsprepzambia.firebasestorage.app`; if `VITE_FIREBASE_STORAGE_BUCKET` is the older `examsprepzambia.appspot.com`, edit the bucket in the `storage:cors` script first. Exporters now also render a dashed-red "Figure could not be loaded" placeholder when a read fails, so a missing diagram is visible rather than a silent gap.

## Repo layout that matters

```
src/
  App.jsx                       — router; nearly every route is React.lazy(); ThemeApplicator pins public routes to brand default
  main.jsx                      — entry; wraps <App /> in ErrorBoundary + AuthProvider + ThemeProvider + DataSaverProvider + PlatformSettingsProvider
  firebase/config.js            — Firebase init; sets auth persistence, App Check (reCAPTCHA Enterprise on web, Play Integrity on Android via Capacitor plugin), multi-tab IndexedDB persistence, FCM (web-push only)
  firebase/ai.js                — Firebase AI Logic (Gemini) client; src/utils/aiLogic.js wraps generateText/streamText/generateJSON
  contexts/                     — AuthContext, ThemeContext, DataSaverContext, PlatformSettingsContext
  components/
    admin/                      — /admin/* — learners, results, approvals, CBC KB editor, generation logs, payments, agent ops at /admin/agents (now lists the ops/growth agents too), the /admin/company HQ (Marshal's fleet-health dashboard), /admin/question-review (Qix's Central Question Bank queue), PictureBankAdmin + VisualStudioAdmin (image pipeline), PastPaperStudio, CurriculumReplaceStudio (syllabus versioning)
    ai/                         — ZedChatLauncher + ZedChatPage (learner study assistant; SSE streamed from apiAiChat)
    auth/                       — Login, Register, AuthAction (password reset)
    dashboard/                  — StudentDashboard, GradeHub, MyResults, Badges, Profile
    exams/                      — Daily exams hub, runner, results, live leaderboard
    games/                      — Games hub + engines (TimedQuizGame, MemoryMatchGame, WordBuilderGame, ProvinceShapesGame, …)
    lessons/                    — Lesson library + slide player + editor; src/features/notes/ holds Notes Studio (admin authoring + learner reader gated by LearnerGate)
    quiz/                       — QuizList, EditQuizV2, QuizRunnerV2, QuizResultsV2, document-quiz importer + scanned-image (OCR) importer; QuizVerifyModal calls Vex. Question types include MCQ, short-answer, and Fill-in-the-Blanks
    teacher/                    — TeacherDashboard + studios (lesson plan / worksheet / flashcards / scheme of work / rubric / notes / homework / assessment / exam paper / SBA task). AssessmentStudio is the largest. Free-plan teachers see locked studios (LockedStudio + StudioGate) with samples + paywall. NOTE: the teacher-facing agent-submission surface (AgentBriefForm + AgentJobsList at /teacher/agents) was removed in 2026-06 — it duplicated the direct studios behind a human-approval gate nobody staffed. The server-side agentJobs pipeline + the /admin/agents approval UI remain. The Full Lesson studio was retired in 2026-07 (generation surface + `generateFullLesson` function removed); the library still renders/exports lessons saved before removal via `views/FullLessonView` + `fullLessonToDocx`/`fullLessonToPdf`.
    diagrams/                   — diagram rendering + the leader-line label layer for question/passage figures
    papers/                     — Past papers viewer + practice + history
    parent/                     — Parent portal pages
    classes/                    — Class management UI (rosters, invites, assignments, analytics)
  features/lessons, features/notes, features/visualStudio — feature-folder pattern (pages/, components/, services/, lib/) for newer surfaces; visualStudio drives admin image authoring
  editor/                       — TipTap-based rich-content editor shared between quiz/notes/lessons
  hooks/                        — useFirestore, useSubscription, useTeacherUsage, useQuizPersistence, …
  utils/                        — Firestore services + AI clients + DOCX/PDF exporters + Lenco payments + permissions + paywall + analytics (~210 modules; the catch-all bucket)
  schemas/                      — Zod schemas for quiz, attempt, result
  config/curriculum.js          — SUBJECTS / GRADES; single source of truth for CBC dropdowns

functions/                      — Cloud Functions v2, Node 22, codebase=default. Separate package.json.
  index.js                      — every function export lives here (~156 exports): aiChat, generateQuiz, verifyQuiz, checkShortAnswer, apiAiChat SSE, apiGenerateLessonPlan / Worksheet SSE, the generate* teacher tools (Assessment/SbaTask/Homework/Notes/Flashcards/SchemeOfWork/Rubric/Diagram/NotePictures/VisualNotes/SlideNotes; the generateExamPaper callable was retired 2026-07 — the Exam Studio generates through generateAssessment with `assessmentType:'mock_exam'`, and the library still renders legacy `tool:'exam_paper'` docs via `src/utils/aiPaperToSections.js`), scanned-quiz + note OCR (structureScannedQuiz, ocrNotePages), class management (createClassAssignment, joinClassByCode, getClassStats), parent portal + weeklyParentDigest, newsletter (subscribeToNewsletter), invoices, referrals, syllabus versioning (parseSyllabusUpload, activateSyllabusVersion, rollbackSyllabusVersion), Lenco (lencoWebhook + payment recovery) + Google Play Billing (verifyGooglePlayPurchase), Central Question Bank (questionReviewOnWrite=Qix, importPastPaperQuestions, classifyQuestionGrades, reviseQuestion), agentJobsOnCreate/Approved, storageCleanup triggers, and the scheduled crons (nightlyQaSmoke, hourlyMonitor, hourlyAgentSupervisor=Marshal, hourlyRevenueReconcile, supportTriage, contentAutoPublish, weeklyProductSignal, weeklyRetentionScan, deliverDawnBriefings, weeklyCbcAlignmentAudit, autoPickDailyExams, daily/weekly learner reminders, dailyFxRefresh, aiCostDailySummary, rebuildPastPapersIndexCron)
  aiService.js                  — Anthropic client (streaming + non-streaming + prompt-caching), assertDailyLimit, role helpers, parsers
  anthropicFetch.js             — low-level fetch around Anthropic API
  geminiClient.js + geminiImageClient.js — Gemini REST client (structureImportedQuiz) + Gemini image generation
  visualSafety.js / visualSafetyCore.js — safety gate for generated images; pictureNaming.js auto-names picture-bank assets
  openaiClient.js               — OpenAI client (short-answer marking)
  teacherTools/                 — one folder per generator (prompt + schema + generate*/run* runner) + cbcKnowledge.js + cbcTopics.js (KB resolver), usageMeter.js (per-user + per-agent daily caps), privateCurriculum.js, assessment/exam-paper/SBA schemas + format seeds
  agents/                       — Internal agent pipeline. dispatcher.js drives Aria → Cala → Reva → awaiting_approval → Pubo via Firestore triggers on agentJobs/{id} (pinned to africa-south1). agents/runners/ holds the content agents (aria, cala, reva, pubo, vex) AND the ops/growth agents driven by agents/cron.js (monitor=Vigil, till, echo, compass, anchor, gate, dawn, quill). agentControl/{agentId}.paused is a circuit breaker; agentControl/content.autoPublish gates Gate. learnerAi/ holds the curriculum-ingester runner.
  grading/                      — daily-exam grading
  classManagement.js / classAnalytics.js — teacher classes, rosters, invites, assignments, stats
  parentPortal.js / weeklyParentDigest.js — parent portal data + weekly digest email
  invoiceGenerator.js / lencoService.js / subscriptionActivation.js / subscriptionLifecycle.js / subscriptionUpgrade.js — Lenco payments (MTN/Airtel/Zamtel mobile money + cards, ZMW), idempotent activation, invoices, expiry/cancellation lifecycle, upgrades
  googlePlayBilling.js (+ googlePlayBillingCore.js) — Android in-app subscriptions via Google Play Billing; `verifyGooglePlayPurchase` validates a purchase token against the Play Developer API then activates through the shared idempotent path. `PLAY_PRODUCT_TO_PLAN` must stay the inverse of `src/utils/playBillingCatalog.js` (guarded by `test:play-catalog-mirror`)
  treasury.js                   — the "AI Company Treasury": a revenue-linked AI budget that caps monthly Anthropic/OpenAI/Gemini spend at a fixed reinvestment fraction of actually-earned ZMW subscription revenue (enforced by the budget gate in `aiCostTracking.js`)
  metaWhatsApp.js (+ metaWhatsAppCore.js, pure helpers) / newsletter.js / referralRedemption.js — WhatsApp (Meta) channel (outbound digests/reminders + the inbound Bonga reply webhook), newsletter signup, referral codes
  storageCleanup/               — Firestore triggers that cascade-delete Storage blobs when lessons/quiz/assessment questions change
  scripts/                      — CBC ingestion utilities (cbc:verify, cbc:ingest, cbc:check)

scripts/                        — top-level data-migration + integrity + test scripts (all plain `node`); also scripts/agents/ for agent-runner harnesses
firestore.rules                 — large, hand-written; the test:rules-text script is a text-level sanity check, not a behavioural test
firestore.indexes.json          — composite indexes (leaderboard, results, attempts). Deploy these BEFORE shipping queries that need them.
storage.rules                   — Storage security rules
firebase.json                   — hosting rewrites map /api/ai/chat, /api/teacher/lesson-plan/stream, /api/teacher/worksheet/stream, /api/tts, /api/payments/lenco/webhook to the matching onRequest Cloud Functions in us-central1; SPA fallback at the bottom
capacitor.config.json           — appId com.zedexams.android; android/ holds the generated native project
.claude/settings.json           — repo-level permission allow/deny list (denies `firebase deploy --only hosting|functions`)
.claude/agents/                 — subagent definitions (cbc-alignment, content-author, content-reviewer, code-reviewer, publisher, qa-smoke, quiz-verifier, release-notes); see ORG.md for the agent org chart
```

## Architecture notes that span multiple files

### Three AI surfaces, each on a different model

- **Generators (lesson plan, worksheet, flashcards, scheme of work, rubric, notes, homework, assessment, quiz)** — Cloud Functions in `functions/teacherTools/*`. Each tool is a pair of `<tool>Prompt.js` + `<tool>Schema.js` plus a `generate<Tool>.js` runner. They all share `aiService.callAnthropic` (Sonnet 4.5 by default; override per-runtime with `ANTHROPIC_MODEL`). Two-layer caching: Anthropic prompt caching for the system prompt + CBC-context caching via `teacherTools/cbcKnowledge.js`'s `resolveCbcContext()`. Per-user daily caps live in `usageMeter.js` and write to `aiUsage/{uid}_{day}` / `usageMeters/`. Super-admins bypass the meter (see PR #512).
- **Zed chat (learner study assistant)** — OpenAI (`gpt-4o-mini` by default; override Zed-only with `ZED_CHAT_MODEL`, which falls back to the shared `OPENAI_MODEL`) via `aiService.callOpenAI` / `callOpenAIStream`. SSE-streamed via `apiAiChat` (HTTP) and `aiChat` (callable). The hosting rewrite `/api/ai/chat` → `apiAiChat` is how the SPA reaches it without CORS. Spend lands on the same `/admin/ai-costs` rollup (priced via the `gpt-*` rows in `aiCostTracking.js`).
- **Quiz verification (Vex)** — synchronous callable `verifyQuiz` using Anthropic Haiku 4.5, layered on top of deterministic structural checks (empty/duplicate/out-of-range options). Vex is intentionally **not** routed through `agentJobs` because authors expect Grammarly-style instant feedback. Returns `{ verdict, overallScore, scores, summary, blockers[], warnings[] }` directly to the caller — no Firestore writes.
- **Short-answer marking** — OpenAI (GPT) via `checkShortAnswer` callable, in `functions/openaiClient.js`.
- **Image generation** — `generateDiagram` accepts three style selectors (`recraft` line-art / `openai` photoreal / `kie` full-colour) per `ALLOWED_PROVIDERS`, but all of them render on OpenAI gpt-image-1: the Recraft and Kie backends were decommissioned (`RECRAFT_ENABLED=false`; the Kie client + `KIE_API_KEY` secret were removed), so only `OPENAI_API_KEY` is bound. `geminiImageClient.js` is a separate Gemini path. Outputs flow through `visualSafety` before landing in Storage + the picture bank. Surfaces: `generateNotePictures`, `generateVisualNotes`, plus admin VisualStudio/PictureBank.
- **Client-side helpers** — Firebase AI Logic / Gemini, exposed through `src/utils/aiLogic.js` (`generateText`, `streamText`, `generateJSON`). Requires App Check enforcement before it's safe to enable on the public origin.

### Live Generation Canvas (teacher studios)

Every teacher generate-studio output panel is `src/components/ui/LiveGenerationCanvas.jsx` — instead of a spinner-then-dump it shows a friendly progress timeline with checkmarks (prep steps → one step per content section → "formatting") and reveals the document **section by section**, then offers Stop / Continue editing / Save to library / Regenerate (whole + per-section). The generators still return the whole document at once (or stream token counts), so the reveal is an honest, client-paced unveiling of the real result, not fabricated streaming. Pure sectioning/timeline logic is `src/components/ui/liveGenerationSections.js` (`buildSections`/`buildTimeline`/`computeTimelineStatus`, tested by `scripts/test-live-generation-sections.mjs` → `npm run test:live-canvas`); the reveal-timing state machine is `src/hooks/useLiveReveal.js`; the generic value renderer is `LiveGenerationSectionValue.jsx`. Wiring a studio = swap `AiGenerationProgress` for `LiveGenerationCanvas`, add a `handedOff` flag (its existing success View + export buttons render once the teacher clicks "Continue editing"), and add a `regenerateSection`/`saveToLibrary` closure. Add a `TOOL_SECTION_CONFIG` entry (order/labels/icons) for a new tool. `variant="embedded"` drops the panel chrome for use inside a modal (see `CreatePaperModal`); the Lesson Plan does **not** use it — `studio/StudioCanvas.jsx` has its own bespoke `LiveLessonPlanPreview` implementing the same watch-it-build idea. On mobile the panel variant opens full-screen once Generate is clicked. It supersedes the older `AiGenerationProgress` tracker for document-output studios. `AiGenerationProgress` intentionally remains on the three generate-and-append flows that have no output panel to reveal (results land in an existing editor, not a document view): the Assessment studio's AI slide-over (`AssessmentSlideOvers.jsx`), admin `CreateQuizV2.jsx`, and `AdminVisualNotesGenerator.jsx` (bespoke `SlideNotesReader` preview) — migrating those is a UX redesign, not a component swap.

### Agent pipeline (the internal "AI company")

See [`ORG.md`](./ORG.md) for the full org chart and cost budgets. The **content line** flows through Firestore:

```
content job written to agentJobs collection (by an admin tool or a cron)
   → agentJobsOnCreate (functions/agents/dispatcher.js, region africa-south1) runs Aria → Cala → Reva sequentially
   → status flips to awaiting_approval
   → admin clicks Approve in /admin/agents  (OR Gate auto-approves if agentControl/content.autoPublish === true and the bar passes)
   → agentJobsOnApproved fires; Pubo flips the reserved aiGenerations doc public + stamps approval and sets status='done'
```

Per-agent circuit breaker: `agentControl/{agentId}.paused`. Three failures in one hour pauses the agent automatically — implemented in `functions/agents/circuitBreaker.js`: each dispatcher runner failure is recorded against `agentControl/{agentId}.recentFailures`, and on the trip it sets `paused: true` and emails `ADMIN_EMAILS` via `functions/opsAlert.js`. An admin can also pause manually from `/admin/agents`.

**Central Question Bank + Qix.** A second content flow: whenever a teacher creates or imports a question, it lands in the `questionBank/{id}` collection with `reviewStatus: 'pending_review'`, and the `questionReviewOnWrite` trigger (**Qix**, `functions/agents/questionReview.js`, region `africa-south1`) reviews it in the background — the teacher never waits. Qix first runs deterministic dedup (`questionDedupCore.js` exact/near-text + `questionEmbeddingCore.js` semantic via `openaiEmbeddings.js`) against sibling questions; an exact/near hit short-circuits with **no model call** and links to the original. Otherwise it runs an Anthropic Haiku review (tool-forced structured output) scoring quality + curriculum/grade fit and recommends approve / needs_admin / reject — fail-closed to `needs_admin` on any error, so nothing reaches the **Master Bank** without a clean pass. Verdicts surface in `/admin/question-review` (`QuestionReviewQueue.jsx`). Circuit breaker: `agentControl/qix.paused`. Unlike the content line, Qix does **not** write to `agentJobs` (per-question volume would drown the feed). Opt-in auto-approve of clean passes into the Master Bank is gated per the review UI.

Beyond the content line, a fleet of **ops/growth agents** runs on schedules in `functions/agents/cron.js` (each writes an `agentJobs` rollup the `/admin/agents` dashboard surfaces — all are read-only/draft-only; the one agent that messages users directly is **Bonga**, the WhatsApp reply agent described below):

| Agent | Schedule | Job |
|-------|----------|-----|
| **Quill** (`nightlyQaSmoke`) | daily 02:00 | walks Firestore for stuck jobs + KB freshness |
| **Cala** (`weeklyCbcAlignmentAudit`) | Sun 03:00 | re-runs alignment on recent `aiGenerations`, catches drift |
| **Vigil** (`hourlyMonitor`, runner `monitor.js`) | hourly | checks pages/Firebase/images/quizzes + today's daily-exam picks (self-heals a missed 05:00 auto-pick by re-running the idempotent picker); on failure asks Haiku for fixes, emails + files a GitHub bug issue → Mendi |
| **Marshal** (`hourlyAgentSupervisor`, runner `marshal.js`) | hourly | the watchdog-of-watchdogs: confirms every scheduled agent that writes a predictable rollup actually ran in its window, surfaces stuck jobs / tripped breakers / recent failures into a single company-health verdict for the `/admin/company` HQ (files an `awaiting_approval` job when something's wrong). Deterministic, no LLM |
| **Till** (`hourlyRevenueReconcile`) | hourly | re-queries Lenco for stale "pending" payments; finishes what a dropped webhook missed via the idempotent activation path |
| **Echo** (`supportTriage`) | every 2h | classifies + prioritises new feedback + public `contactMessages`, drafts replies (Haiku) — never sends |
| **Gate** (`contentAutoPublish`) | every 30m | auto-approves content jobs passing a strict bar; OFF unless `agentControl/content.autoPublish === true` |
| **Compass** (`weeklyProductSignal`) | Mon 06:00 | deterministic "what to build next" backlog from quiz/exam attempts |
| **Anchor** (`weeklyRetentionScan`) | Mon 07:00 | finds learners who went quiet 14–45d ago + drafts a win-back nudge |
| **Dawn** (`deliverDawnBriefings`/`runDawnBriefing`) | on-demand | Claude Managed Agent morning briefing; "Run Dawn now" button in `/admin/agents` |

**Vex** bypasses the whole pipeline (synchronous callable from the quiz editor); **Qix** (see above) runs off its own `questionBank` trigger rather than `agentJobs`. **Mendi** (bug-fixer), **Rex** (code review), and **Ledger** (release notes) are subagents invoked from CI/locally, not crons. The full agent roster (including departments + invocation modes) is the single source of truth in `src/config/agents.js`; keep it and [`ORG.md`](./ORG.md) in sync when you add one.

**Bonga** (`apiWhatsAppWebhook`, runner `functions/agents/runners/bonga.js`) is the one agent that talks to people directly. It's an `onRequest` webhook Meta calls on every inbound WhatsApp message: it classifies the message (study / support / sales), drafts a reply with Claude Haiku (`functions/agents/runners/bonga.js` is the pure, unit-testable brain; the model + Firestore I/O live in the webhook), and **auto-sends** the reply inside WhatsApp's 24-hour customer-service window via `metaWhatsApp.sendWhatsAppText`. Safety rails: the `X-Hub-Signature-256` HMAC is validated against `META_WHATSAPP_APP_SECRET` (fail-closed once set), `agentControl/bonga.paused` is an instant kill-switch, replies dedupe per Meta message id, and the system prompt forbids fabricating account/payment state. Conversations + reply status log to `whatsappConversations/{phone}`. New secrets: `META_WHATSAPP_VERIFY_TOKEN` (GET handshake) + `META_WHATSAPP_APP_SECRET` (payload HMAC), alongside the existing `META_WHATSAPP_TOKEN` / `META_WHATSAPP_PHONE_NUMBER_ID`. The pure webhook helpers (handshake match, signature check, payload parse) live in `functions/metaWhatsAppCore.js` so they test under plain `node` with no firebase-functions dep (the `*Core.js` split). Meta's webhook URL is `https://zedexams.com/api/whatsapp/webhook`.

### Hosting + Functions wiring

`firebase.json` rewrites `/api/*` straight to specific `onRequest` Cloud Functions in `us-central1`. This is how SSE endpoints (Zed chat, lesson plan stream, worksheet stream) avoid CORS — the browser hits same-origin `/api/...`, Hosting proxies to the function. New API endpoints need both the function export in `functions/index.js` AND a rewrite entry here.

### Firestore offline + multi-tab

`firebase/config.js` enables `enableMultiTabIndexedDbPersistence` so the app survives offline and shares cache across tabs. Failures (Safari < 15, private mode, quota) are non-fatal — code paths must still handle a fresh-fetch round-trip. Firestore writes queue while offline and replay on reconnect.

### Service worker

VitePWA `generateSW` with `registerType: 'autoUpdate'` — the new SW activates + claims clients automatically. The already-rendered page crosses over at two safe moments (never a hard reload mid-operation): `public/sw-reload-clients.js` posts `SW_RELOAD_REQUEST` on activation → `usePwaUpdate` shows `<UpdatePrompt />`'s "Refresh now" toast; AND `<UpdatePrompt />` auto-applies the update on the user's next in-app navigation (`src/hooks/pwaAutoReload.js` — a route teardown point; imports/long ops don't navigate so they're never interrupted). `vite.config.js` has a post-build `firebaseMessagingSwConfig` plugin that substitutes `__FIREBASE_*__` tokens in `dist/firebase-messaging-sw.js` because the SW context can't read `import.meta.env`. On Capacitor the SW is not registered.

### App Check

Web uses reCAPTCHA Enterprise (via `ReCaptchaEnterpriseProvider`, silent unless score is low; migrated from reCAPTCHA v3). Android uses Play Integrity via `@capacitor-firebase/app-check`, looked up at runtime through `Capacitor.Plugins.FirebaseAppCheck` rather than `await import(...)` so the web build stays package-agnostic. Without `VITE_FIREBASE_APPCHECK_RECAPTCHA_KEY` (the reCAPTCHA Enterprise App Check key, distinct from the Android action-scoring key) the web init silently no-ops — fine for lint-only builds, dangerous for a real deploy.

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
- **Two test suites, split by filename.** (1) The original suite: every `*.test.js` / `test-*.mjs` file is a plain ES-module script invoked with `node` directly — throw on assertion failure, and add a `test:*` npm script whose command starts with `node`. **Do not edit `test:all` by hand** — it's `node scripts/run-all-tests.mjs`, which auto-discovers and runs every `test:*` script that is a `node` command (Vitest + emulator scripts are skipped because they aren't `node`). Adding the `test:*` key is enough; the runner picks it up. (This replaced the old single-line `&&`-chain that every test-adding PR appended to, which made any two such PRs collide on that one line.) This is still the right tool for pure logic, schemas, parsers, and Cloud Functions helpers. (2) Vitest (added for frontend coverage): files named `*.spec.{js,jsx}` run under `npm run test:unit` in jsdom — use these for React component/hook/behaviour tests via `@testing-library/react`. `npm run test:coverage` reports v8 line coverage of `src/` into `./coverage`. The two never collide: Vitest only collects `*.spec.*`, the node scripts are all `*.test.*`. Config is `vitest.config.js`; shared setup (jest-dom matchers + auto-cleanup) is `src/test/setup.js`.
- **Router is fully lazy.** Adding a new route in `App.jsx` means `lazy(() => import('...'))` + a `<Suspense fallback={<PageLoader />}>` if it's a new top-level branch. Don't import page components eagerly.
- **`<NavLink>` / `Navigate` use `getRoleLandingPath`** (`src/utils/navigation.js`) to send each role to the right landing page after auth.
- **Public theme paths** are pinned to the brand default theme in `App.jsx` (`PUBLIC_THEME_PATHS` + `isPublicThemePath`). Adding a new always-public route may need an entry here so it doesn't inherit a saved learner theme.
- **CBC topic + grade lists are in `src/config/curriculum.js`** for the client. The server-side authoritative KB is `functions/teacherTools/cbcKnowledge.js` / `cbcTopics.js`. They have to stay in sync.
- **Don't accrete one-off report docs.** Audit reports, debug runbooks, feasibility writeups, and launch/polish plans rot fast — by 2026-05 most root `*.md` reports were ~90% stale (cleaned up in #702). So: (1) don't commit a standalone report/plan `*.md` to the repo root unless asked — put findings in the conversation or the PR description; (2) any status/plan/audit doc that *is* committed gets a `> Snapshot as of YYYY-MM-DD — verify before acting` header from the start; (3) `BUG_REPORT.md` is the single curated "what's broken now" doc — prune resolved items there rather than spawning new snapshots; (4) when a branch merges, remove its worktree (`git worktree remove`) — merged worktrees linger and pile up.

## Repo notes

- Two identical remotes. `gh pr ...` needs `-R Mwelwa-cyber/Zedexams`. `gh api` uses URL paths.
- `main` is branch-protected. Required checks: `Lint` + `Tests (importer + sanitize + schema)`. `enforce_admins` is on. Use `gh pr merge --auto` rather than blocking on checks. `ci.yml` also runs `Tests (Vitest unit + coverage)`, `Build + mobile smoke` (the clean-build + public-route render gate), and `Tests (Firestore rules emulator)`; make the build job a required check too once it's settled.
- The dev server needs `.env` from the project owner. CI builds use repo secrets (`deploy-hosting.yml:60-83`).
- Today's date and the user's email are surfaced in the session header. Don't hard-code either into code or tests.
