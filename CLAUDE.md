# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Binding standards:** every AI session must follow [`AI_DEVELOPMENT_GUIDE.md`](./AI_DEVELOPMENT_GUIDE.md) — Definition of Done, coding standards, schema rules, and test rules. Read it before making changes; it is enforced in CI by `npm run test:ai-dev-guide`.

## Binding architecture

[`docs/architecture.md`](./docs/architecture.md) is the binding target architecture and migration contract (verified at commit `79ff3d2`). Read it before any restructuring or migration work. Migration PRs implement it; they do not reinterpret it. On frozen surfaces (collections, function exports, rewrite paths, regions), stop and report conflicts instead of choosing an interpretation.

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
# There are ~500 `test:*` scripts. The sample below is the load-bearing ones —
# `node -e "console.log(Object.keys(require('./package.json').scripts))"` for all.
npm run test:all                  # what CI's "Tests" job runs (importer + sanitize + schema + …) — the node scripts
npm run test:unit                 # Vitest run over src/**/*.spec.{js,jsx} (jsdom)
npm run test:unit:watch           # Vitest watch mode
npm run test:coverage             # Vitest + v8 coverage of src/ → ./coverage (frontend gap is measured here)
npm run src:coverage              # c8 coverage of src/ from the plain-node suite → ./coverage-src (.c8rc.src.json ratchet)
npm run functions:coverage        # c8 coverage of functions/ from the backend node suite → ./coverage-functions (.c8rc.json ratchet)
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
npm run test:secret-hygiene       # release-safety: .gitignore policy + no committed credential/artifact + dotenv CONTENT scan
npm run test:shim-guard           # fails if a src/utils shim grows a rule the server won't enforce
npm run test:shared-assessment-neutral  # fails if functions/shared/ imports React/DOM/Firebase/docx
npm run test:paper-pagination     # measured Print/PDF page flow (pure core)
npm run test:paper-health         # the one Save/Export verdict
npm run test:paper-golden         # renders reference papers to a real .docx and asserts on document.xml
npm run test:visual-verdict       # the required visual-regression gate's pass/fail logic

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
  features/flashcards/ — the REFERENCE MIGRATION (architecture.md Phase 2, steps written up in `docs/MIGRATION_TEMPLATE.md` — read it before migrating another feature). Page, components, hook, `services/` (the only Firebase access), `lib/*Core.js` (pure, node-tested) and `export/` behind one public `index.js`. The page is deliberately NOT exported: route tables mount it with `lazy(() => import('…/pages/FlashcardGenerator'))`, because a page in a front door lands in the chunk of every consumer — one of which is the public marketing page
  app/ engines/ shared/ curriculum/ — MIGRATION SCAFFOLD (architecture.md Phase 1), empty apart from `curriculum/catalog/`, which re-exports the taxonomy roots `config/canonicalEducation.js` + `config/educationLevels.js`. Nothing has moved in yet: App.jsx, src/contexts/, the four quiz runners and the exporters are all still canonical where they are. What IS live is the layering — `app → features → engines/curriculum → shared/services/config`, one-way, enforced by the `no-restricted-imports` blocks in `eslint.config.js` plus `test:import-boundaries` (which resolves every import in `src/` to a real path — covering the sibling-feature case ESLint's string matching cannot see, **dynamic `import()` which it does not inspect at all**, and the shrink-only debt lists a warning could never fail a build over — and asserts the lint rules still fire). Each directory index is a namespace marker, NOT a barrel — import the area (`src/shared/utils`), never the root
  App.jsx                       — router; nearly every route is React.lazy(); ThemeApplicator pins public routes to brand default
  main.jsx                      — entry; wraps <App /> in ErrorBoundary + AuthProvider + ThemeProvider + DataSaverProvider + PlatformSettingsProvider
  firebase/config.js            — Firebase init; sets auth persistence, App Check (reCAPTCHA Enterprise on web, Play Integrity on Android via Capacitor plugin), multi-tab IndexedDB persistence, FCM (web-push only)
  firebase/ai.js                — Firebase AI Logic (Gemini) client; src/utils/aiLogic.js wraps generateText/streamText/generateJSON
  contexts/                     — AuthContext, ThemeContext, DataSaverContext, PlatformSettingsContext
  components/
    admin/                      — /admin/* — learners, results, approvals, CBC KB editor, generation logs, payments, agent ops at /admin/agents (now lists the ops/growth agents too), the /admin/company HQ (Marshal's fleet-health dashboard), /admin/question-review (Qix's Central Question Bank queue), PictureBankAdmin + VisualStudioAdmin (image pipeline), PastPaperStudio, CurriculumReplaceStudio (syllabus versioning). **PastPaperStudio's Quiz step is optional** — a paper can publish with `quizStatus: 'pending'` (learners see the paper immediately with a "Quiz coming soon" note; `/admin/papers` badges it **Quiz pending** and deep-links "Add quiz" to `/admin/papers/:id/edit?step=quiz`). Every read of that state goes through `src/utils/pastPaperQuizStatus.js` — papers published before the field existed have no `quizStatus`, so the status is DERIVED (`quizStatus ?? (quizId ? 'attached' : 'pending')`), and it fail-closes: `'attached'` with no `quizId` reads as pending rather than rendering a Start Quiz button that leads nowhere. The Studio parks its authoring quiz in `pendingQuizId` and only promotes it to `quizId` — with `quizStatus: 'attached'`, in ONE `updateDoc` — once the quiz actually has questions. `functions/pastPapersIndexHelpers.js` carries a CommonJS mirror of the derivation for the hub's index doc (kept honest by `test:past-papers-index`)
    ai/                         — ZedChatLauncher + ZedChatPage (learner study assistant; SSE streamed from apiAiChat)
    auth/                       — Login, Register, AuthAction (password reset)
    dashboard/                  — StudentDashboard, GradeHub, MyResults, Badges, Profile
    exams/                      — Daily exams hub, runner, results, live leaderboard
    games/                      — Games hub + engines (TimedQuizGame, MemoryMatchGame, WordBuilderGame, ProvinceShapesGame, …)
    lessons/                    — Lesson library + slide player + editor; src/features/notes/ holds Notes Studio (admin authoring + learner reader gated by LearnerGate)
    quiz/                       — QuizList, EditQuizV2, QuizRunnerV2, QuizResultsV2, document-quiz importer + scanned-image (OCR) importer; QuizVerifyModal calls Vex. Question types include MCQ, short-answer, and Fill-in-the-Blanks
    teacher/                    — TeacherDashboard + studios (lesson plan / worksheet / flashcards / scheme of work / rubric / notes / homework / assessment / SBA task). **`TeacherLayout` is the ONE shell for the whole teacher area** (2026-07-30) — sidebar, mobile chrome, account menu, logout — and EVERY `/teacher/*` route renders inside it, the dashboard included. Routes are declared as data in `teacher/teacherRoutes.jsx` (App.jsx just maps them) so `teacherRoutes.spec.jsx` can render every one and fail if the shell is missing; a route that deliberately opts out sets `shell: false` and must give a `shellExemptReason`. Add a teacher page THERE, not in App.jsx. `variant` picks only the CONTENT container (`'studio'` = the `.studio-shell` well + TeacherTopBar; `'dashboard'` = the page brings its own `.tdv2-main`/`.tdv2-content` grid and header) — never the navigation. **One nav config**: `TEACHER_NAV_GROUPS` in `dashboardV2Config.js`, rendered by `Sidebar` (desktop) and `NavDrawer` (mobile); the old NAV_GROUPS/STUDIO_NAV_GROUPS fork is gone, and `dashboardV2Config.spec.js` pins the menu contents exactly. Active state is route-derived, longest-match-wins, in `dashboardV2/teacherNavActive.js` (one resolver for both surfaces; `test:teacher-nav-active`). **One breakpoint**: exactly one navigation system is MOUNTED at a time (`useIsMobile`, 768px) — sidebar ≥768, header+drawer+dock <768; the CSS media queries are a backstop, not the mechanism. Before this, the shell cut over at 1024 and the dashboard at 768, so a tablet showed the dashboard an icon rail and every studio page a bottom dock. **The sidebar collapses to a 76px icon rail from its own toggle** at every width it renders at (`useSidebarCollapsed` + `sidebarCollapseCore.js`, persisted in `localStorage` under `zedexams:teacher-sidebar-collapsed`; `test:sidebar-collapse` + `sidebarCollapse.spec.jsx`). The rail is driven by `is-collapsed` on `.tdv2-sidebar` / `.tdv2-shell`, NOT by a media query — 1024px only picks the DEFAULT (rail on a tablet, full panel on a desktop) and a stored choice outranks it, so a width can no longer answer which state the sidebar is in. Collapsed, group headings become divider rules and the item labels are VISUALLY hidden rather than `display:none`, because an icon-only link still needs its accessible name; the hover/focus tooltip that replaces them is `position:fixed` (`.tdv2-nav` scrolls, so anything parented to the item would be clipped). Below 768px none of this applies — the sidebar isn't mounted. `TeacherLayout` also owns a Suspense boundary INSIDE the shell so a page chunk loading doesn't blank the sidebar. Tool names are canonical per ROUTE via `CANONICAL_TOOL_LABELS`/`canonicalToolLabel` — the sidebar's label wins on every navigation surface (Quick Create, workspace tiles, all-tools grid, the mobile sheet); "Studio" survives only in page headers. `teacher/dashboardV2/` holds the dashboard PAGE CONTENT: `TeacherDashboardLive` (real data via `useTeacherDashboardData` — one generations fetch + one assessments fetch + Teaching Profile + MoE calendar, derived through the pure `dashboardV2Data.js` helpers) renders `DashboardView` in the scoped `tdv2-` design system (lucide-react + recharts). The same view serves `/teacher/dashboard-preview` (`TeacherDashboardV2`, intentionally unguarded, mockData.js only, PreviewChrome banner + non-production control panel), and the pre-V2 dashboard remains at `/teacher/classic` as a transition fallback. Below 768px the dashboard swaps to a dedicated MOBILE information architecture (`MobileDashboardView`'s default export — hero, compact checklist, app-style tool tiles; a CONTENT decision only, since the chrome around it is the shell's at every width). A six-step spotlight onboarding tour (`OnboardingTour.jsx`, pure logic in `onboardingTourCore.js`) runs once per device on the dashboard; replay via `/teacher?tour=1` (Help & Support link) or the preview control panel. `/teacher/help` (dashboardV2/HelpSupportPage) is the teacher Help & Support surface: contact/report forms via the shared marketing ContactDialog (→ `contactMessages`, triaged by Echo), suggestions via FeedbackDialog (→ `feedback`), WhatsApp + support-email channels, teacher FAQs. `scripts/test-dashboard-v2-links.mjs` (`test:dashboard-v2-links`) fails CI if any hard-coded dashboardV2 navigation target doesn't resolve to a declared route. Route-parsing guards read BOTH declaration sites through `scripts/lib/declaredRoutes.mjs` — App.jsx alone is no longer the route table. AssessmentStudio is the largest — it's the **Assessment Paper Studio**, the single merged studio for every assessment type (2026-07 merge of the former "Test Paper Studio" and "Exam Studio"): topic/weekly/mid-term/end-of-term tests AND mock/examination/final examinations are all authored, saved, listed and exported through it. Canonical routes are `/teacher/assessment-papers`, `/teacher/assessment-papers/new`, `/teacher/assessment-papers/:id/edit`; the legacy `/teacher/test-papers`, `/teacher/exam-papers` and `/teacher/assessments` paths (and `AssessmentStudio`/`AssessmentList`'s old `variant` prop) are kept ONLY as redirects in `App.jsx` for old bookmarks/links — the studio itself no longer branches on a route-level variant. Which type a saved paper is comes entirely from its own `assessmentType`, drawn from the canonical registry in `paperTaxonomy.js` (`ASSESSMENT_TYPES`: `topic_test`/`weekly_test`/`mid_term`/`end_of_term`/`mock_exam`/`examination`/`final_exam`) and normalized on read via `normalizeAssessmentType()` for legacy/pre-merge values (`topic`, `mock`, `exam`, …) — the same registry drives the grouped Tests/Examinations picker, `generateAssessment`'s payload, the saved document, and title/export formatting (`buildTitleFromForm` / `assessmentPaperLayout.js`'s `buildPaperTitle`). Free-plan teachers see locked studios (LockedStudio + StudioGate) with samples + paywall. NOTE: the teacher-facing agent-submission surface (AgentBriefForm + AgentJobsList at /teacher/agents) was removed in 2026-06 — it duplicated the direct studios behind a human-approval gate nobody staffed. The server-side agentJobs pipeline + the /admin/agents approval UI remain. The Full Lesson studio was retired in 2026-07 (generation surface + `generateFullLesson` function removed); the library still renders/exports lessons saved before removal via `views/FullLessonView` + `fullLessonToDocx`/`fullLessonToPdf`. The Class Register lives in teacher/register/ (classRegisters collection: roster, marks, reports) and includes the **Class Register Studio** (teacher/register/attendance/, routed at /teacher/attendance + the register's Attendance tab): daily attendance marking, a month-windowed term grid, summaries, and official A4 register printing/exports. Attendance data sits in classRegisters/{classId}/attendance/{YYYY-MM-DD} (one doc per class per date), attendanceTerms/{termId} (policy, day overrides, custom term dates, mid-term-break config, draft→submitted→locked→reopened lifecycle; locked is teacher-read-only, admin-reopen-with-reason), and attendanceAudit (append-only). **Attendance day writes are server-only**: rules deny client writes and every mutation (single mark, mark-all, grid edits, corrections, offline replays) goes through the `saveClassAttendance` callable (functions/attendance/ — term resolved from the date, lock/eligibility/status validation, server-recomputed counts, strict STALE_VERSION versioning; MoE term windows mirrored in functions/attendance/moeTermData.js, guarded by test:attendance-term-mirror). The client keeps a localStorage outbox (useClassRegister) with queued/syncing/conflict/rejected states. Pure logic in src/utils/attendance*.js (constants/calculator/calendar-resolver/day-core/export) — teaching days resolve from the MoE calendar via attendanceCalendarResolver; late counts as present in the percentage but is totalled separately.
    diagrams/                   — diagram rendering + the leader-line label layer for question/passage figures
    papers/                     — Past papers viewer + practice + history
    parent/                     — Parent portal pages
    classes/                    — Class management UI (rosters, invites, assignments, analytics)
  features/lessons, features/notes, features/visualStudio — feature-folder pattern (pages/, components/, services/, lib/) for newer surfaces; visualStudio drives admin image authoring AND the teacher Picture & Diagram Studio at /teacher/visual-studio. **Visual Studio v2 foundation (2026-08)**: the `diagramAssets` collection is the curriculum Diagram Library — ONE asset stores source art + labels `{ word, anchor, box }` (normalized 0–1) and the four printable versions (teacher words / learner P,Q,R / answer key / picture only) are RENDER-TIME projections (`lib/diagramProjections.js`; letters are NEVER stored — derived from reading order, sort anchor.y then anchor.x, so add/delete can't skip a letter; the learner word bank is lowercase-alphabetical because anchor order leaks answers). `lib/labelBoxLayout.js` owns auto box placement (nearer margin, greedy push-down) + the 2F "Perfect layout" + leader-crossing detection; `schemas/diagramAsset.js` is the Zod pair; `services/diagramAssetService.js` bumps `version` on every label edit (consumers reference assetId + version). AI auto-label: the `autoLabelDiagram` callable (`functions/teacherTools/autoLabelDiagram.js`, pure decisions in `autoLabelCore.js`) runs Claude vision + `resolveCbcContext` grounding and returns proposals the editor treats as pre-filled manual labels — confidence < 0.7 flags amber, an ungrounded run says so, two malformed replies fall back to manual mode, and NOTHING is written server-side. Legacy pictureBank/visualAssets docs migrate via `npm run migrate:diagram-assets:dry` (idempotent, deterministic `mig-*` doc ids)
  editor/                       — TipTap-based rich-content editor shared between quiz/notes/lessons
  hooks/                        — useFirestore, useSubscription, useTeacherUsage, useQuizPersistence, …
  utils/                        — Firestore services + AI clients + DOCX/PDF exporters + Lenco payments + permissions + paywall + analytics (~325 non-test modules; the catch-all bucket). Several files here are now RE-EXPORT SHIMS onto functions/shared/assessment — see "One copy of the export rules" below before adding logic to one
  schemas/                      — Zod schemas for quiz, attempt, result
  config/curriculum.js          — SUBJECTS / GRADES; single source of truth for CBC dropdowns

functions/                      — Cloud Functions v2, Node 22, codebase=default. Separate package.json.
  index.js                      — every function export lives here (~193 exports): aiChat, generateQuiz, verifyQuiz, checkShortAnswer, apiAiChat SSE, apiGenerateLessonPlan / Worksheet SSE, the generate* teacher tools (Assessment/SbaTask/Homework/Notes/Flashcards/SchemeOfWork/Rubric/Diagram/NotePictures/VisualNotes/SlideNotes; the generateExamPaper callable was retired 2026-07 — every assessment type, test AND examination, now generates through the one generateAssessment (the merged Assessment Paper Studio; `assessmentType` is one of the 7 canonical values in `functions/teacherTools/assessmentFormats.js`'s `ASSESSMENT_TYPES`, reaching the backend exactly as the teacher picked it — `examination`/`final_exam` are real recognised types, never collapsed to `mock_exam`), and the library still renders legacy `tool:'exam_paper'` docs via `src/utils/aiPaperToSections.js`; `planAssessment` derives the same paper plan with NO model call so the teacher confirms it before generating, and `regenerateAssessmentQuestion` rewrites ONE question against its plan slot), scanned-quiz + note OCR (structureScannedQuiz, ocrNotePages), class management (createClassAssignment, joinClassByCode, getClassStats), parent portal + weeklyParentDigest, newsletter (subscribeToNewsletter), invoices, referrals, syllabus versioning (parseSyllabusUpload, activateSyllabusVersion, rollbackSyllabusVersion), Lenco (lencoWebhook + payment recovery) + Google Play Billing (verifyGooglePlayPurchase), Central Question Bank (questionReviewOnWrite=Qix, importPastPaperQuestions, classifyQuestionGrades, reviseQuestion), agentJobsOnCreate/Approved, storageCleanup triggers, and the scheduled crons (nightlyQaSmoke, hourlyMonitor, hourlyAgentSupervisor=Marshal, hourlyRevenueReconcile, supportTriage, contentAutoPublish, weeklyProductSignal, weeklyRetentionScan, deliverDawnBriefings, weeklyCbcAlignmentAudit, autoPickDailyExams, daily/weekly learner reminders, dailyFxRefresh, aiCostDailySummary, reclaimAiBudgetReservations, rebuildPastPapersIndexCron)
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
  shared/assessment/            — ⚠️ SHARED WITH THE FRONTEND. The rules deciding whether a paper may be exported, imported unchanged by BOTH src/ and the Cloud Functions export callable. Plain ESM (own package.json, "type":"module"), no React/DOM/Firebase/docx imports. See "One copy of the export rules" below — new readiness rules go HERE, never in src/utils/
  assessmentExports/            — the server-side export callable (requestAssessmentExport) + exportReadiness.js, the server gate that runs the shared rules
  opsAlert.js / opsAlertSecrets.js — ops alerting: email always, plus an OPT-IN Slack/Discord webhook channel (see "Ops alerts" below)
  scripts/                      — CBC ingestion utilities (cbc:verify, cbc:ingest, cbc:check)

scripts/                        — top-level data-migration + integrity + test scripts (all plain `node`); also scripts/agents/ for agent-runner harnesses; scripts/visual/ drives the visual-regression gate
docs/                           — the long-form reference set, far more detailed than this file. docs/architecture/ (26 numbered docs: system overview, repository map, route register, Firestore data model, Cloud Functions register, security review, duplication/dead-code/risk registers, target architecture + remediation plan) and docs/production-readiness/ (18 numbered audits + runbooks/ for deploy-rollback, firestore-restore, secrets-recovery, ci-supply-chain, launch-operator-guide). Also PASSKEYS.md, GOOGLE-PLAY-BILLING.md, ANDROID-RELEASE.md, visual-regression-gate.md, CHANGELOG.md, security/. Read the relevant numbered doc before a deep change — but treat every one as a snapshot, not as current truth
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

### Blueprint-driven assessment generation

The Assessment Paper Studio plans a paper BEFORE the model writes it, rather than
generating a paper and auditing it afterwards. The plan (`paperBlueprint.js`,
`blueprint.v1`) fixes every slot's topic, sub-topic, syllabus outcome, Bloom level,
difficulty tier, marks and figure requirement, so marks reconcile with the header
by construction and the analysis tools report DRIFT from a stated intent rather
than absence of one.

- **One plan, two callers.** `assessmentPlanning.planPaper()` is the only thing that
  builds a plan. `planAssessment` (callable, no model call, no usage charge) shows
  it to the teacher for confirmation; `generateAssessment` builds the same object to
  constrain the model. A test compares the two — if they could diverge the teacher
  would confirm one paper and get another. The confirmed plan travels back with the
  generate call and is re-checked by `acceptClientBlueprint` (version, marks,
  grade/subject/curriculum/type, and every slot's activity against the band's
  ceiling); anything refused is rebuilt server-side and logged.
- **Plain-language summary.** `src/utils/blueprintSummary.js` is the only place tiers
  and Bloom levels become words; `PaperPlanPanel.jsx` renders them. Its tests fail if
  machine vocabulary reaches the screen.
- **Drift, not discovery.** `src/utils/blueprintDrift.js` compares the saved paper to
  its blueprint. Two vocabularies are folded here: the studio's easy/medium/hard onto
  the four tiers, and `analyze`/`analyse` onto one Bloom key.
- **Structured item contract.** `assessmentToolSchema.js` makes each item's metadata
  `required` in the tool schema instead of requested in prose. Its enums are tested
  against `assessmentSchema.js`'s own vocabularies.
- **Targeted regeneration.** `regenerateAssessmentQuestion` returns ONE question bound
  to its slot (the slot, not the model, owns marks/topic/outcome/level).
  `src/utils/questionRegeneration.js` splices it in with every other question object
  reference-identical — its tests assert `===`, because "byte-identical" is a claim
  about identity. A question can be `locked` (refused outright, survives save/reload)
  and a teacher-authored edit is confirmed before it is replaced.
- **Distractor quality.** `topicMisconceptions/{cbc|obc}_{GRADE}_{subject}_{topic-slug}`
  records the learner misconceptions the generator articulated in earlier papers'
  `distractorRationale`, counted when they recur, and feeds them back into the prompt
  as material to draw on. Server-only in rules, both directions. Descriptive only —
  a topic nothing is known about adds nothing to the prompt.
- **§3.5, twice.** A grade+subject with no approved syllabus is refused at the plan
  step AND in the generator, with one shared message (`assessmentLabels.js`). A read
  FAILURE is never reported as an empty catalogue.

### Nothing is filed until the teacher edits it, and a paper's name identifies it

Two data-integrity rules the Assessment Paper Studio now holds to.

- **"Untouched" is identity, not a content heuristic.** `isUntouchedPaper` +
  `paperSignature` (`assessmentAutosave.js`) compare the live `{form, sections, parts}`
  against the baseline the MACHINE established, and every place the studio fills the
  paper in for the teacher re-arms that baseline: the initial state, the School-Profile
  seeding, "New paper", and the edit-mode hydration of a saved paper. Neither autosave
  — the 800ms device draft nor the 2s library write — may fire while the paper still
  matches it. The old test was "empty starter question AND no title AND no school name",
  which the studio's own School-Profile seeding defeated by writing the teacher's school
  name onto an untouched paper: **loading `/teacher/assessment-papers/new` filed a
  phantom paper holding one blank question, every visit.** Second layer: the gate reads
  `countAuthoredQuestions(sections)` (questions with something in them), never the raw
  `questionCount`, which counts the blank starter slot. No paper doc is created before
  the first real edit — the id is minted by `persistAssessment`, not eagerly on mount.
  Already-filed phantoms: `npm run cleanup:phantom-assessments:dry` (rules in
  `phantomAssessment.js`, dry-run by default, `--live` requires typing DELETE, every
  deleted doc backed up first). It is a one-off, never a scheduled sweep.
- **A paper has TWO titles, and they are different strings on purpose**
  (`assessmentTitle.js`). The DOCUMENT title is the library/Recent-Documents/filename
  name and carries grade + **subject** + type + **term** + year
  ("GRADE 4 INTEGRATED SCIENCE - END OF TERM 2 TEST - 2026"); the printed HEADER title
  omits the subject because `assessmentPaperLayout`'s header block prints it on its own
  line right below. One string used to do both jobs, with no subject and a DEFAULTED
  term, so every Grade 4 end-of-term paper a teacher wrote in a year had one name. The
  term is read from the paper (`readPaperTerm`) — a paper that states none is not given
  one. `mapAssessmentToForm` deliberately does NOT carry a generated title into
  `form.title`, which is what lets an old paper pick up its subject on the next save;
  papers now record `titleSource: 'auto' | 'manual'`. Existing papers:
  `npm run backfill:assessment-titles:dry` — it rewrites only a title
  `isGeneratedAssessmentTitle` recognises (including one stamped with the wrong term)
  and never one a human chose.

### The Question Bank is a view of the Assessment Paper Studio, not a page

There is no `/teacher/question-bank` page any more (2026-08). A bank you could
search but not insert from made teachers copy questions out of it by hand, so it
moved to where papers are built: a **view inside the studio** (`?view=bank`, the
"Bank" entry on the studio dock) and a **drawer/bottom sheet** over the builder.
The old route is a redirect that carries its whole query string across, and
`bankFiltersFromParams`/`bankFiltersToParams` (`questionBankDeepLink.js`,
`test:question-bank-deep-link`) make "the filters were preserved" checkable
rather than claimed. The dashboard tile, sidebar entry, workspace tile and
all-tools card are gone.

- **One bank UI, two frames.** `QuestionBankBrowser.jsx` renders both — same
  search, same filters, same cards, same actions. `QuestionBankPanel` is the
  drawer shell (context-seeded from the paper's grade/subject/topic);
  `QuestionBankView` is the full-page frame. Before this there were two
  components, one with the full filter set and no way to insert and one that
  could insert but offered four filters. Filtering is entirely client-side over
  ONE cached fetch (`applyBankBrowserFilters` in `questionBankPanel.js`), so a
  keystroke costs no Firestore read and both surfaces share the cache entry.
- **Use never inserts silently (§2).** `questionBankPlacement.buildPlacementPlan`
  derives each section's type FROM ITS QUESTIONS (empty and mixed accept
  anything; True/False is its own family and is never folded into MCQ) and
  returns every insertion point numbered by the number the question would take —
  **including the incompatible ones**, disabled and carrying their reason, so a
  teacher looking for Q8 learns why rather than wondering where it went. No
  compatible section at all → the picker says so and offers to add one, which
  creates the Part and inserts in one action (an empty Part is not yet a
  position). Nothing is ever converted to fit. `test:question-bank-placement`.
- **Copy-on-insert (§3).** `buildInsertedQuestion` deep-clones and stamps
  `sourceQuestionId` / `sourceBank` / `insertedAt` / `sourceVersion` (plus the
  legacy `sourceBankId`), strips in-paper identity so a stale `localId` cannot
  collide in the number map, and arrives unlocked/unedited. Use creates ZERO
  bank documents; the only bank write is the atomic `usageCount` increment.
  Provenance enables a future "update from bank" and implies nothing automatic —
  nothing reads it back. **Editing a Master-Bank question forks it** into the
  teacher's own bank first; the shared record is never written to.
- **The insert is a subcollection add, not an array rewrite.** Questions live in
  `assessments/{id}/questions/{qid}`, one doc each. `test:bank-insert-writes`
  scans for the shape — `arrayUnion`, a written `questions:` field, or any
  Firestore call inside `insertBankCopyAt` — because a behaviour test cannot
  tell "inserted one question" from "overwrote the other twenty-nine with one",
  which is the historical zero-question wipe. The guard proves it can fail.

### The words a paper is allowed to use (§4.1)

`src/config/paperTerminology.js` is the single declaration of the Zambian
classroom vocabulary a paper may print — numerator/denominator/lowest terms,
dividend/divisor/quotient/remainder, place value, "Show your working" — so a
generator prompt, a validation message and a printed instruction all draw the
same word for the same idea. Three rules make it more than a word list:

- **Graded by level, twice.** Keyed to the band's existing `instructionFormality`
  (`spoken` → `examination`), so the ladder is declared once in
  `assessmentBands.js`. Both the instruction verbs AND the vocabulary topics are
  graded: a Nursery paper gets "Work out"/"Share equally" and is never told what
  a denominator is, because offering a term to the model is how it reaches the
  page. A Form 4 paper gets "Express your answer in its lowest terms".
- **The curriculum picks its own word.** CBC teaches `regroup`, OBC's materials
  say `borrow`; neither is hard-coded. `normalizeCurriculum` accepts every
  spelling already in the repo (`cbc`/`obc`/`previous`/`2023`/`2013`) so no
  caller needs to know which its neighbour uses.
- **Our machinery is never printed.** `FORBIDDEN_ON_PAPER` (MathML, LaTeX, SVG,
  raster fallback, render node, model output, validation schema, question
  payload) is both a prompt instruction and a post-render check — being told not
  to do something isn't the same as not having done it. Checked against the
  RENDERED `.docx`, not source, because every one of those words appears
  legitimately in the exporters' own identifiers; `test:paper-golden` also proves
  the check catches a real leak, so it can't be decoration.

`functions/` gets the DATA as generated JSON (`npm run sync:paper-terminology`,
staleness + directive-parity guarded by `test:paper-terminology-mirror`); the
directive builder lives server-side, following `buildBandDirective`.
`generateAssessment` renders it at call time, so correcting a word is a config
edit rather than a prompt-version bump.

### Four renderers, one paper — and formulas without JavaScript

`assessmentPaperLayout.buildPaperLayout()` returns typed, rendering-agnostic
blocks that the in-studio preview, the PDF print window and the DOCX export all
walk, so the three cannot drift. Two things about that pipeline are easy to get
wrong:

- **The preview and the exports render maths differently, on purpose.** The
  preview draws KaTeX live (with `mhchem`, so `\ce{}` works). The print window
  and Word run no JavaScript, so `safeRender.flattenMathNodes` replaces every math
  node before those two ever see the paper. Whatever it leaves behind IS the
  formula on the printed page — it emits text plus real `<sub>`/`<sup>` elements,
  which the print window draws natively and `assessmentToDocx`'s walker turns into
  Word superscript/subscript runs.
- **`src/utils/paperContentModel.js` is the only parser of paper rich text.** The
  blocks were already shared, but the CONTENT inside a block travelled as an HTML
  string that each renderer parsed back — `assessmentToDocx` carried a full DOM
  walker of its own. The layout now parses once (`textNodes` / `optionsNodes` on
  each block) and the exporters MAP typed nodes. Node vocabulary: `paragraph`,
  `verticalArithmetic`; inline `text` (with bold/italic/underline/strike/sup/sub
  marks), `fraction`, `numberBase`, `break`. `contentToHtml` round-trips (its
  output re-parses to the same model) and `contentToPlainText` feeds search/alt
  text. A test in `paperContentModel.test.js` fails if `assessmentToDocx.js`
  starts reading `tagName`/`classList`/`data-*` again. Each structured maths node
  is recognised through ONE exported selector + attribute reader
  (`FRACTION_SELECTOR`/`readFractionAttrs` in `MathFraction.js`, and the twins in
  `NumberBase.js` / `VerticalArithmetic.js`), shared by the editor, the print
  hydrator in `safeRender.js` and the content model — they disagreed until
  2026-07, when a fraction stored in the `data-math-fraction` spelling reached
  Word as the bare characters "12". Pinned by `paperContentModel.spec.js`.
  **`textHtml` stays generated by `richTextToPaperHtml`, not by the model**, and
  that is now a measured decision rather than a deferral: the model's vocabulary
  has no lists, headings, blockquotes or code, so serialising it back to print
  HTML would strip bullets and numbering from every printed paper. A test records
  each unsupported construct. Closing §4.1's other half means extending the model
  first, which changes the printed page and wants the print CSS reviewed with it.
- **`src/utils/latexToUnicode.js` is the only LaTeX→text converter.** It parses
  (brace-aware `\frac`/`\sqrt`, mhchem's coefficient-vs-subscript rule) rather
  than pattern-matching; the regex version it replaced silently dropped the bar of
  any fraction with a braced numerator and had no `\ce{}` handling at all.
  `latexToReadableText` in `quizRichText.js` now delegates to it.
- **Word gets real equations for stacked maths (§4.2).** `flattenMathNodes` keeps
  the source LaTeX on the element as `data-tex`; the content model carries it as a
  `math` node alongside the already-flattened printable fallback; and
  `assessmentToDocx` builds genuine OMML (`<m:oMath>`/`<m:f>`/`<m:rad>`/`<m:sSup>`)
  via `latexToMathTree`. Only two-dimensional constructs qualify —
  `needsEquation()` keeps chemistry and inline powers as ordinary runs with real
  sub/superscript, because Word renders those perfectly and a teacher can still
  edit them as text. Any construct the tree does not model, or that throws while
  building, falls back to the linear text form: never a silently dropped formula.
- **Library diagrams reach Word as VECTOR (§4.2).** The catalog shapes are drawn
  as SVG and the preview and print window both use them as SVG; Word was the one
  renderer getting a flattened bitmap, so the only figure on the paper that is
  vector all the way down was the one printing with resampled edges.
  `svgImageRun` embeds an SVG part with the high-DPI PNG as `docx`'s required
  `fallback` — Word 2016+/LibreOffice draw the vector, older builds draw the
  raster we already produced, so the worst case IS the status quo. **Pass the SVG
  as BYTES**: `docx` treats a string `data` as base64 and throws on markup, which
  the fallback would swallow. The labelled-photo composite deliberately stays
  raster — its SVG inlines the photo as a data URI, which is where Word's SVG
  support is least dependable.
- **The band's minimum figure size is enforced, not just declared (§4.2).**
  Phase 2 gave every band a `minFigureSizeMm` (45mm at Early Childhood → 30mm at
  senior secondary) and only the generator PROMPT read it. `src/utils/figureSizing.js`
  now makes it a floor the teacher's width preset cannot go under, resolved per
  document from `seedBandForLevel` (published defaults — an export must not block
  on a config read). The page always wins over the floor; a figure the column
  cannot fit reports the shortfall via `figureSizeWarning` rather than
  overflowing. Everything is in CSS pixels because that is what BOTH consumers
  take — the rasteriser and `docx`'s ImageRun (9525 EMU/px). Using points there
  under-applies the floor by a third.
- **`src/utils/figureLabelLayout.js` decides where a figure's labels sit** — the
  preview, the print window and the Word overlay all call `resolveFigureLabels`,
  so a label separated in one is separated in all three. It de-collides labels
  that would print on top of each other, and anchors each leader line on the
  pill's EDGE facing the part rather than its centre (the line used to run out
  from under the label and strike through the text). The rule that makes moving
  a label safe: a label with no leader names the part it SITS ON, so one the
  resolver had to move grows a leader back to where it was authored — otherwise
  de-collision silently relabels the diagram. Positions come back normalised
  0–1, resolved against a nominal A4-column figure box, because each renderer
  draws its own pill size but they must all agree on placement.
  `resolveAnswerKeyLabels` builds §4.3's twin figure from the same source: the
  learner gets numbered markers, the marking key gets those same markers plus
  the part names in green. Correspondence is the point, so the markers are
  resolved exactly as the learner's copy resolves them and then passed to the
  names as immovable `anchors` — a name can never shove a number off its part.
  Every renderer gates this on `block.showAnswer`, and each has a test that the
  learner copy carries no answer text.
- **`src/utils/monochrome.js` + `test:monochrome` keep the paper printable in
  black and white.** Most Zambian schools print monochrome and photocopy the
  master, so luminance — not just colour — decides whether a learner can read
  the sheet. The test SCANS the three renderers for every hex they print in and
  checks each against a declared role (`text` 4.5:1, `largeText`/`line` 3:1,
  `background` checked from the other side). An **undeclared** colour fails the
  test, so adding one means saying what it is for and CI answers whether it
  survives the printer — a hand-kept list would have drifted immediately. This
  caught `#ccc` borders printing at 1.6:1 (invisible once photocopied) and
  `#999` rules at 2.85:1; all rules are now the one declared `#888888`.
  Its companion **`src/utils/figureContrast.js` checks the ink we DON'T choose** —
  the pixels of a generated or uploaded figure. The failure it looks for is
  narrow on purpose: not "is this colourful" (a colourful figure whose colours
  differ in lightness prints fine) but two prominent regions that differ in HUE
  and not in luminance — a red artery beside a blue vein — which the printer
  merges into one grey. The Word export samples each figure on a 64px canvas and
  the studio warns the teacher before they run forty copies; the figure is still
  embedded, so this is advisory. Verdicts are `ok` / `colour_dependent` / `flat`
  / **`unknown`** — a sampling failure is never reported as a pass.
- **`src/utils/paperGolden.test.js`** (`test:paper-golden`) renders reference
  papers all the way to a real `.docx`, unzips it and asserts against
  `word/document.xml`. It is the net for "looks right in Preview, breaks in Word",
  and also pins that a learner copy never carries the marking explanation and that
  the download is a ZIP/WordprocessingML file rather than an MHTML blob.
- **Keep-together** (`KEEP_WITH_NEXT` in `assessmentToDocx.js`) is applied only to
  headings, question stems and figures. `keepNext` on every paragraph chains the
  paper into one unbreakable block and Word pushes it to a fresh page.

NOTE: `quizRichText.js` also carries a SECOND, CDN-loaded KaTeX (jsdelivr, no
mhchem) used by the quiz editor's `QuizRichText.jsx` — not by the assessment
paper path. It is a runtime external dependency and a known gap.

### One copy of the export rules — `functions/shared/assessment`

The rules that decide whether a paper may leave the building live in ONE package
that the React app and the Cloud Functions export callable both import — not two
implementations kept in step by code review (#1977). Read
[`functions/shared/README.md`](functions/shared/README.md) before touching it.

- **Why it sits under `functions/` and not at the repo root.** `firebase.json`
  sets the functions `source` to `functions`, and the CLI uploads only that
  directory. A root package would exist on a developer's machine and be absent at
  runtime; the usual fix — sync it in at deploy — buys the worst failure
  available here, a stale copy with the server enforcing yesterday's rules while
  the studio enforces today's, silently. `src/` reaches it by relative path.
- **The files in `src/utils/` with these names are re-export shims and nothing
  else** — `unresolvedFigures.js`, `assessmentExportGate.js`,
  `comprehensionGrouping.js`, `fillBlanks.js`, `questionType.js`. Each carries one
  instruction: **DO NOT ADD A RULE HERE.** `test:shim-guard` fails if one grows a
  function body, a branch, or a constant with a rule in it — that is the quiet way
  the fork comes back (someone opens the file the studio imports, adds a condition
  where the bug appeared, and the server never sees it).
- **If a change decides whether a paper may be downloaded, printed or exported**
  — a new completeness check, a new blocking classification, a change to the words
  a teacher reads, a new figure requirement — it goes in this directory. Not in
  `src/utils/`, not in `functions/assessmentExports/`, not in a component. There
  is **one** diagram catalogue (`diagramCatalogCore.js`) and it is here; do not
  add a second one for the server.
- **The import contract.** These modules must not import React, DOM APIs
  (`document`/`window`/`canvas`/`DOMParser`), Firebase client or admin SDKs,
  `docx`, KaTeX, any browser exporter, or anything from `src/`.
  `test:shared-assessment-neutral` fails the build if they do. Cloud Functions is
  CommonJS and this package is ESM, so the server reaches it with `await
  import(...)` **inside the async handler** — never a top-level `require`.
- **Identity comes from the adapter, never from the question.**
  `assessmentValidationCore` is handed `{ question, identity, number }` and never
  looks for `localId` itself, because the two callers know different things (live
  studio: editor-minted `localId`; saved paper: the Firestore doc id or its
  printed position). `number` is always display order, so a stored question with
  no `localId` still yields *"Question 3 is not finished"* rather than a blocked
  paper whose message names nothing.
- **What deliberately stays out:** editor-only concerns in
  `src/utils/quizValidation.js` — the pre-publish checklist summary, "image still
  uploading" flags (live state a saved paper cannot have), and Part membership (an
  authoring construct). `collectQuizIssues` calls into the package for everything
  that blocks an export.

**The server gate is not advisory.** `functions/assessmentExports/exportReadiness.js`
runs the same modules on every export request and reads **nothing** the client
asserts — not `ready`, not `allowUnresolvedFigures`, not a precomputed verdict.
Before #1977 the only content check on the server was "has at least one question",
while every other rule lived in the browser; the studio's own library autosave
files incomplete papers to Firestore regardless of error count, so papers failing
those rules demonstrably exist to be exported. Tests: `test:shared-rules`,
`test:shim-guard`, `test:shared-assessment-validation`,
`test:shared-assessment-neutral`, `test:server-export-readiness`,
`test:export-blocking`, `test:export-gate`, `test:unresolved-figures`.

### The page count is measured, not estimated (Print/PDF only)

`Math.ceil((questionCount + totalMarks * 0.4) / 8)`, printed to teachers as
"Est. 3 pages · A4", was arithmetic on the question count — blind to a diagram, a
passage, a table, a teacher's page break, or twenty ruled answer lines. It is gone
(#1978). The replacement measures.

- **`paperPaginationMeasure.js`** (browser-only) renders `buildPrintableHtml` —
  *the same function the print window is handed*, same stylesheet, same `@page`
  rule, same flattened maths — into an iframe sized to the A4 **content box**, and
  reads back real block heights. Two non-negotiables: the iframe is
  `visibility: hidden` and off-screen, **never `display: none`** (a display:none
  subtree has no layout, every height reads zero, and that paginates to one page
  and looks like a working answer); and fonts must be ready before anything is
  read, or the measurement is taken against fallback metrics and is wrong by a
  line here and there — the kind of wrong that moves a page boundary without ever
  looking broken.
- **`paperPaginationCore.js`** (pure, no DOM) flows those measured heights into
  real A4 page boxes under the stylesheet's declared fragmentation rules. There is
  no browser API that reports where the engine fragmented a document, so the flow
  is simulated from the same inputs the engine uses.
- **Hard scope boundary: this is the BROWSER print/PDF page count and must never
  be presented as the Word one.** Word paginates with its own engine, font metrics
  and widow/orphan rules. `.docx` exports carry no page count from this module,
  and `printPdfReadiness` is consulted by the Print and PDF routes only — the Word
  route reads the base readiness and nothing else. There is a test for that,
  because it is exactly the kind of thing a later refactor tidies into one gate.
- **`printableModel.js` — one object, fingerprinted AND measured.** The hook used
  to fingerprint passages/parts/pagebreaks while handing the measurement only the
  assessment and questions, so editing a passage marked the count stale and then
  re-measured a document without the edit — a "fresh" answer identical to the
  stale one. Now one canonical object is both fingerprinted and rendered, and
  `assertMeasurable` refuses a caller that measures something else. Identity is a
  hash of the whole model, not a summary of lengths and counts: "IIII" and "WWWW"
  are the same length and half a line apart.
- **`usePaperPagination.js`** runs idle → measuring → ready, going **stale** on
  edit rather than keeping the old number on screen (a count for a different
  document is indistinguishable from a current one). The in-flight token is
  cleared when the paper *changes*, not when the next measurement *starts* —
  otherwise a measurement already in flight for the old paper resolves during the
  debounce window and writes itself back as confidently `ready`.
- **`printPdfReadiness.js`** is a second, stricter layer over
  `buildAssessmentExportReadiness`. The base gate answers "is this paper
  finished"; this answers "does it come out of a browser correctly" — a blank
  trailing sheet, a question split across a page turn, a diagram printing away
  from its stem, a table clipped at the right edge. **"Not yet measured" blocks
  rather than allows** (a paper whose layout is unverified is one we know nothing
  about; letting it through because no problem was *reported* is treating a failed
  check as a pass), and clears itself within about a second.
- **`paperHealth.js`** folds the studio's now-four quality surfaces into one
  verdict the `PaperHealthModal` renders and the Save/Export buttons key off:
  `blocked` (a correctness blocker — no route out of the studio) ▸ `print-blocked`
  (the paper is correct, the browser layout is not — #1982 made printability its
  own classification precisely because it blocks the browser routes and not Word)
  ▸ `attention` ▸ `ready`.

Tests: `test:paper-pagination`, `test:printable-model`, `test:print-pdf-readiness`,
`test:paper-health`, `test:export-readiness`, plus `usePaperPagination.spec.jsx` /
`paperPaginationMeasure.spec.jsx` / `PaperHealthModal.spec.jsx` under Vitest.
Background: [`docs/architecture/pagination.md`](docs/architecture/pagination.md).

### The visual gate's baselines are recorded by CI, never by hand (§4.6)

`scripts/visual/` renders the fixture papers through Chromium and LibreOffice and
compares them to committed baselines under `tests/visual/baselines/`. Three
things about operating it:

- **Never record a baseline locally.** `baselineIdentity` keys each one to the
  renderer versions and font digest that drew it, and `assertComparableEnvironment`
  rejects a baseline recorded anywhere else — so a hand-committed one is dead
  weight CI will never match. Both writers are `workflow_dispatch`-only and both
  open a draft PR: `visual-baseline-bootstrap.yml` records baselines that do not
  exist, `visual-baseline-update.yml` replaces one that does (naming its fixture,
  its family and why). The refusal to overwrite from a bootstrap is a rule in
  `gateCore.planBaselineBootstrap`, not a convention.
- **The gate reports red until the baselines exist**, and that is correct rather
  than broken — `runVisualGate.mjs` never creates a baseline from a comparison
  run, so it cannot approve its own first render.
- **`workflow_dispatch` only resolves on the default branch**, so neither writer
  can be dispatched from a feature branch. A PR that adds or changes fixtures
  merges first (red), then the bootstrap runs from `main`.

**Exactly one check from this workflow is required on `main`: `Visual regression
gate`** (2026-07-27, #1979 — it was non-required while the baselines were being
recorded). The other two jobs must NOT be required, and the reason is the whole
design:

- **A path filter cannot be a required check.** `visual-regression.yml` used to
  be `paths:`-filtered, so it never started on an unrelated PR — and a check that
  never runs is *missing*, not passed, so branch protection would hold every
  README typo open forever. The classification therefore moved INSIDE the
  workflow: it starts on every PR, decides whether printed output can be
  affected, and reports one check either way. The expensive render still only
  runs when it can matter.
- **`scripts/visual/printAffectingPaths.js`** owns "can this file change a
  printed paper". It errs WIDE on purpose — a false positive costs eight minutes
  of CI, a false negative ships a changed paper behind a green gate — and it is
  an optimisation, never a guarantee (an indirect dependency can always be
  missed, which is what `force` on the manual dispatch is for).
- **`scripts/visual/gateVerdict.js`** owns the pass/fail verdict, as a tested
  module rather than an `if:` expression, because every way this can be wrong is
  quiet. It passes only when the scope job resolved AND either the render
  succeeded or it was skipped *because the scope proved printed output cannot be
  affected*. A skip for any other reason — cancelled run, failed dependency, an
  edited `if:` — is absence of evidence, and absence of evidence fails. The gate
  job runs `if: always()` so it always reports under a stable name.

Tests: `test:visual-paths` (`printAffectingPaths`), `test:visual-verdict`
(`gateVerdict`), `test:visual-gate` — the scope job runs them before its own
classification is trusted. See [`docs/visual-regression-gate.md`](docs/visual-regression-gate.md).

### AI request locking + idempotency (rollout in progress)

The shared service that stops one intentional AI generation from becoming two provider calls, two saved documents, or two usage charges (double-click, rapid tap, rerender, refresh, timeout retry, or a second tab). Two layers:

- **Frontend lock** — `src/hooks/useAiOperationLock.js` (pure decision logic in `aiOperationLockCore.js`). A synchronous `useRef` claims a module-level lock keyed by an operation-specific `lockKey` (e.g. `assessment-studio:create-paper:generate-full`) *before* any `await`, so a second click in the same tick is refused — React `status` state alone updates too late to catch this. It also mints a `crypto.randomUUID()` idempotency key per logical request, persisted in `sessionStorage` so a page refresh mid-request reuses the SAME key (never mint a fresh one just because the client timed out) while a genuinely different request (changed inputs → different fingerprint) gets a fresh one. Cross-tab awareness is advisory only (`BroadcastChannel`), never load-bearing.
- **Backend service** — `functions/aiOperations.js` (pure decision logic in `aiOperationsCore.js`), modelled on `subscriptionActivation.js`'s status-guarded transaction and the `paymentLocks/{uid}` lock-doc pattern in `paymentInitiationCore.js`. `reserveAiOperation()` atomically `tx.create()`s `aiOperations/{idempotencyKey}` (userId server-derived, never client-supplied); a duplicate reservation resumes a `completed` result, refuses to restart a `processing` one, retries a `failed`+`retryable` one with backoff, and rejects the same key reused with a different input fingerprint (`IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_INPUT`). `completeAiOperation`/`failAiOperation` settle the record; usage (`usageMeter.assertAndIncrement`/`refundGeneration`) is called at most once per key because those early-return paths short-circuit before it's ever reached.

**Rollout status** (2026-07-27). Three states, not two — the distinction matters because the middle one is invisible from outside:

- **One generator is fully enforced end-to-end**: `generateAssessment` (via `CreatePaperModal.jsx`). `reserveAiOperation` is called unconditionally, so a request with no idempotency key is *refused*; the result document is `aiGenerations/{idempotencyKey}`.
- **Five generators have `aiOperations` integration on the keyed happy path, but remain partial** because a request without a valid idempotency key can bypass reservation: `generateWorksheet`, `generateHomework`, `generateFlashcards`, `generateRubric`, `generateSchemeOfWork` (#1861). Each guards the reservation behind `isValidIdempotencyKey`, so a keyless request silently takes the old unprotected path — auto-id document, no reservation, and nothing recording that protection was skipped. A stale cached client or a direct callable invocation gets pre-Phase-5 behaviour.
- **Twenty generators remain unmigrated.**

Do not describe this as "six migrated" or "six wired end-to-end" — a server guarantee that disappears when the client omits a key is not a completed migration. The authoritative, machine-checked count is `npm run test:ai-generator-inventory`.

Tests prove duplicate-provider-call/duplicate-write/duplicate-charge prevention on the keyed path (`generateAssessment.test.js`, `aiOperations.test.js`, `aiOperationsCore.test.js`, `CreatePaperModal.spec.jsx`, `HomeworkStudio.spec.jsx`, `useAiOperationLock.spec.jsx`).

Still on the pre-existing `status === 'generating'` button-disable guard alone, and the documented next phase: `generateLessonPlan`, `generateNotes`, `generateSbaTask`, `generateQuiz`, `generateSlideNotes`, `generateLessonActivities`, the image generators (`generateDiagram`, `generateNotePictures`), and the import paths (past-paper import, document/OCR import). Wiring one is mechanical: frontend, swap the raw callable call for `useAiOperationLock`'s `run()` wrapping it (see `CreatePaperModal.jsx` or `WorksheetGenerator.jsx`); backend, call `reserveAiOperation` before the provider call and `completeAiOperation`/`failAiOperation` after (see `generateAssessment.js`), and switch the result doc to `.doc(idempotencyKey)`.

### Agent pipeline (the internal "AI company")

See [`ORG.md`](./ORG.md) for the full org chart and cost budgets. The **content line** flows through Firestore:

```
content job written to agentJobs collection (by an admin tool or a cron)
   → agentJobsOnCreate (functions/agents/dispatcher.js, region africa-south1) runs Aria → Cala → Reva sequentially
   → status flips to awaiting_approval
   → admin clicks Approve in /admin/agents  (OR Gate auto-approves if agentControl/content.autoPublish === true and the bar passes)
   → agentJobsOnApproved fires; Pubo flips the reserved aiGenerations doc public + stamps approval and sets status='done'
```

Per-agent circuit breaker: `agentControl/{agentId}.paused`. Three failures in one hour pauses the agent automatically — implemented in `functions/agents/circuitBreaker.js`: each dispatcher runner failure is recorded against `agentControl/{agentId}.recentFailures`, and on the trip it sets `paused: true` and emails `OPS_ALERT_EMAILS` via `functions/opsAlert.js`. An admin can also pause manually from `/admin/agents`.

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

### Ops alerts — email always, Slack opt-in (and the deploy trap behind it)

`functions/opsAlert.js`'s `sendOpsAlert` emails **`OPS_ALERT_EMAILS`** and, since #1983,
can also POST `{text}` to an incoming webhook (Slack / Discord / Mattermost /
generic). The two channels are independent, so an unbound webhook only ever costs
the chat copy — email keeps delivering. `sendOpsAlert` reads the URL from

**Recipients are `OPS_ALERT_EMAILS`, NOT `ADMIN_EMAILS` (#1993).** The two used to
be one variable, and that variable does double duty: `resolveInitialUserRole`
makes every address in `ADMIN_EMAILS` an account that is *born an administrator*.
So the only way to get an alert delivered was to widen an authorization allowlist
— one that lives in a committed file. `functions/opsAlertRecipients.js` owns the
precedence (`OPS_ALERT_EMAILS` → `ADMIN_EMAILS` → the SMTP sender; the middle step
is back-compat, since *reading* a list grants nothing). When you wire up a new
alert, address it to `OPS_ALERT_EMAILS`. `ADMIN_EMAILS` ships **unset**; populating
it is an authorization decision, and `scripts/grant-superadmin.mjs` — which
promotes an account that already exists — is almost always what you actually want.
Admin bootstrap additionally requires a **verified** address
(`functions/security/adminBootstrapCore.js`, `test:admin-bootstrap`): an
allowlisted address with no account behind it used to be registerable by anyone,
who could then convert the minted claim into an authoritative `users.role` through
`bootstrapUserProfile` — that callable is exempt from `assertVerifiedAuth` by
design and writes with the admin SDK, so neither the verification guard nor the
`firestore.rules` create-rule pin stood in the way. See AUTH-L6 in
[`docs/architecture/10-authentication-and-roles.md`](docs/architecture/10-authentication-and-roles.md).

`sendOpsAlert` reads the URL from
`process.env.OPS_ALERT_WEBHOOK_URL`, and Cloud Functions only puts it there for a
secret **bound** to the function, which is what `functions/opsAlertSecrets.js`
decides.

The binding is **unconditional**, and the reason it can't be conditional is worth
knowing before you gate any other secret: **`firebase deploy` decides which
secrets to bind by analysing the source in a subprocess handed only
`FIREBASE_CONFIG` + `GCLOUD_PROJECT`** (firebase-tools `prepare.js` →
`discoverBuild`). `functions/.env.<project>` is loaded on a *different* path, for
the deployed runtime's environment only. A `process.env` flag read at module load
is therefore always undefined at deploy time — #1983 gated the bind on
`OPS_ALERT_WEBHOOK_BOUND` and nothing was ever bound, silently: an *unreferenced*
secret is never validated, so the deploy passed, and email kept delivering, so
alerts kept arriving. Fixed in #1991; `opsAlertSecrets.test.js` now fails on any
`process.env` read in that module.

The trade the flag was avoiding is real and now a stated consequence instead:
**a `defineSecret()` bound to a function whose secret has no value in Secret
Manager makes `firebase deploy` HARD-FAIL ("no value for the secret: X") and
blocks EVERY functions deploy** — the trap documented for `RECRAFT_API_KEY` in
`index.js` and worked around for the inbound WhatsApp secrets in
`metaWhatsApp.js`. So `OPS_ALERT_WEBHOOK_URL` must exist (stored 2026-07-27,
version 1, a Slack incoming webhook for `#zedexams-ops`); retiring the chat
channel means deleting the `list.push(...)` in `opsAlertSecrets.js` and
redeploying *before* destroying the secret. Ten functions carry it:
`agentJobsOnCreate`, `agentJobsOnApproved`, `dailyFirestoreBackup`,
`backupCompletionCheck`, `storageBackupCheck`, `rateLimitHealthCheck`,
`opsHeartbeatCheck`, `verifyGooglePlayPurchase`, `lencoWebhook`,
`sendTestOpsAlert`.

**Proving it rings:** `/admin` → Developer tools → **Test the ops alarm**
(`sendTestOpsAlert` + `OpsAlertTester.jsx`) fires one real `info` alert down both
channels and reports each separately, naming the reason a silent channel was
silent. Three verdicts — `both` / `one` (delivered, but the redundancy is gone) /
`none`. Throttled to one per admin per 5 minutes. It is what caught #1991 on its
first press. Tests: `test:ops-alert`, `test:ops-alert-secrets`,
`test:ops-alert-test`, `OpsAlertTester.spec.jsx`.

### Hosting + Functions wiring

`firebase.json` rewrites `/api/*` straight to specific `onRequest` Cloud Functions in `us-central1`. This is how SSE endpoints (Zed chat, lesson plan stream, worksheet stream) avoid CORS — the browser hits same-origin `/api/...`, Hosting proxies to the function. New API endpoints need both the function export in `functions/index.js` AND a rewrite entry here.

### Firestore offline + multi-tab

`firebase/config.js` enables `enableMultiTabIndexedDbPersistence` so the app survives offline and shares cache across tabs. Failures (Safari < 15, private mode, quota) are non-fatal — code paths must still handle a fresh-fetch round-trip. Firestore writes queue while offline and replay on reconnect.

### Passkey (WebAuthn) sign-in

Users can sign in with their device's biometric/screen-lock (fingerprint, face, PIN, security key) as an ADDITIVE method — Google + email/password are untouched. Flow: `@simplewebauthn/browser` on the client (`src/services/passkeyService.js`, the single entry point — components never touch `navigator.credentials`) → callables in `functions/index.js` wrapping `functions/passkeys/passkeyService.js` (pure decisions in `passkeyCore.js`, plain-node tested via `test:passkeys`) → `@simplewebauthn/server` verification (challenge/origin/RP-ID/signature/UV, no custom crypto) → uid resolved from the server-only `passkeyCredentials/{credentialId}` doc (NEVER client-supplied) → `createCustomToken` → `signInWithCustomToken` restores the same account/role/claims. Challenges are single-use hashed docs in `webauthnChallenges` (5-min expiry, consumed in a transaction before verification; TTL on `expiresAt` set out-of-band); audit trail in `passkeyAuditLog` (hashes + coarse UA only); all four collections (`passkeyCredentials`, `webauthnChallenges`, `passkeyUserHandles`, `passkeyAuditLog`) are server-only in rules (pinned by `test:rules-text`). Feature-flagged via `settings/global.featureFlags.passkeyAuthenticationEnabled` (default off, fail-closed, admin toggle under Developer → Feature flags; optional `passkeyRolloutRoles`/`passkeyRolloutUids` narrow who can register). **Admin accounts are excluded from passkeys entirely** (`PASSKEY_ADMIN_MFA_REQUIRED` at registration + sign-in): mandatory admin TOTP MFA (`security/requireAdminMfaCore.js`) never accepts a custom-token session as second-factor proof. Account deletion purges the passkey collections via `accountDeletion.js`'s lists. RP config is env-managed (`PASSKEY_RP_ID`=zedexams.com, `PASSKEY_ALLOWED_ORIGINS`, wildcards refused). UI: `PasskeySignInButton` on Login + the shared `src/components/auth/passkeys/PasskeySection.jsx` mounted in all three role security panels (teacher tset, learner lset, admin zedexams-settings), with explicit-action registration + shared-device warning (never auto-register after sign-in). **Region migration in flight**: the four flow callables have `africa-south1` twins (`…Africa` exports, Firestore colocation for latency) deployed alongside the `us-central1` originals; client routing + instant no-redeploy rollback via `featureFlags.passkeyFunctionsRegion` (`off`/`pilot`+`pilotUids`/`all`, default off → us-central1), resolved only in `src/services/passkeyService.js` + `passkeyRegionCore.js` (mirror of `functions/passkeys/passkeyRegions.js`, guarded by `test:passkey-region-routing`). Do not delete the `us-central1` originals without explicit owner approval. See `docs/PASSKEYS.md`.

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
- **Two curricula, and a picker must not mix them.** CBC and the 2013 ("previous"/OBC) syllabus are both live. Topic options are scoped strictly by curriculum AND grade (`src/components/teacher/syllabusTopicOptions.js` + `src/utils/syllabus2013Topics.js`, #1974) — a leak shows a teacher topics from a syllabus they aren't teaching. The two frameworks also *name their levels differently*, so grade labels come from `src/components/teacher/frameworkLevelLabels.js` (#1976) rather than being formatted at each call site. `normalizeCurriculum` accepts every spelling already in the repo (`cbc`/`obc`/`previous`/`2023`/`2013`) so no caller needs to know which its neighbour uses.
- **Don't accrete one-off report docs.** Audit reports, debug runbooks, feasibility writeups, and launch/polish plans rot fast — by 2026-05 most root `*.md` reports were ~90% stale (cleaned up in #702). So: (1) don't commit a standalone report/plan `*.md` to the repo root unless asked — put findings in the conversation or the PR description; (2) any status/plan/audit doc that *is* committed gets a `> Snapshot as of YYYY-MM-DD — verify before acting` header from the start; (3) `BUG_REPORT.md` is the single curated "what's broken now" doc — prune resolved items there rather than spawning new snapshots; (4) when a branch merges, remove its worktree (`git worktree remove`) — merged worktrees linger and pile up.

## Repo notes

- Two identical remotes. `gh pr ...` needs `-R Mwelwa-cyber/Zedexams`. `gh api` uses URL paths.
- `main` is branch-protected and `enforce_admins` is on. Use `gh pr merge --auto` rather than blocking on checks. **Nine required checks** as of 2026-07-27 — eight jobs in [`ci.yml`](.github/workflows/ci.yml) (`Lint`, `Tests (importer + sanitize + schema)`, `Tests (Vitest unit + coverage)`, `Tests (Firestore rules emulator)`, `Tests (Storage rules emulator)`, `Tests (Functions coverage)`, `Build + mobile smoke`, `Dependency audit (prod deps)`) plus `Visual regression gate` from [`visual-regression.yml`](.github/workflows/visual-regression.yml). `Tests (Payment lifecycle emulator)` runs but is deliberately not required.
  - **A required job must report on EVERY pull request.** None of the nine may grow a `paths:` filter, a job-level `if:`, or `continue-on-error` — a job that is filtered out is not "passed", it is *missing*, and branch protection then holds every unrelated PR open forever waiting for a result that never arrives. This is why the visual gate requires `Visual regression gate` (the `always()` router that reports on every PR) and **not** `Visual regression (Chromium + LibreOffice)`, which legitimately skips when nothing print-affecting changed. Adding a `paths:` filter to a required job is the single easiest way to wedge the whole repo.
  - A print-affecting PR now waits on the full Chromium + LibreOffice render (up to ~30 min) before it can merge. That is the intended cost of the §4.6 gate.
  - Bot-authored PRs land in `action_required` until someone clicks "Approve and run workflows"; with nine required checks that state blocks everything rather than most things.
- The dev server needs `.env` from the project owner. CI builds use repo secrets (`deploy-hosting.yml:60-83`).
- Today's date and the user's email are surfaced in the session header. Don't hard-code either into code or tests.
