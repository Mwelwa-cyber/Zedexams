# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Binding standards:** every AI session must follow [`AI_DEVELOPMENT_GUIDE.md`](./AI_DEVELOPMENT_GUIDE.md) — Definition of Ready, Definition of Done, coding standards, schema rules, and test rules. Read it before making changes; it is enforced in CI by `npm run test:ai-dev-guide`.

## Check before you build

**Read the source of truth for every fact a change depends on, before writing the line that depends on it.** Not recalled from earlier in the session, not inferred from a filename, not taken from this file — CLAUDE.md is a long snapshot and the repo moves under it. When the doc and the code disagree the code is right, and the doc is a bug to fix in the same PR.

**The failure this prevents** is the expensive one: code written against a remembered signature, a guessed import path or a field name that sounded right, which fails at lint/build/test time and gets corrected in front of the operator. *"Actually I was wrong — that takes an object, not two arguments"* is never a discovery, it is a lookup that was skipped. The same wrong assumption costs seconds when `grep` catches it, a deploy slot when CI catches it, and the operator's trust when they catch it. Building first and correcting afterwards is not faster; it moves the cost onto the person who has to read the correction.

### Five checks, before the first edit

1. **Read what you are calling.** The signature, the return shape, and one existing call site — `grep -rn "export .*<name>" src/ functions/`. Import paths are the most common miss, because directories here have MOVED, repeatedly and recently: `src/schemas/` → `src/shared/schemas/`, `src/components/admin/` → `features/admin*`, `src/components/quiz/` → three separate destinations, `src/components/teacher/` → three more. An import that resolves from memory fails at build.
2. **Search for it before you write it.** `src/utils/` alone holds hundreds of modules, beside `shared/`, `engines/` and `curriculum/`. A second copy of something that already exists is worse than nothing built: it passes its own tests, drifts from the original, and the fork surfaces later as a bug. Check too whether the file you are about to edit is one of the re-export SHIMS onto `functions/shared/assessment` — adding a rule to one forks the export gate, and `test:shim-guard` fails the build for it.
3. **Read the guards that already pin the area.** `grep -rl "<module>" scripts/ src/ functions/ --include="*test*" --include="*spec*"`. There are hundreds of `test:*` scripts and many are text-level guards asserting a *shape* rather than a behaviour. A guard that already asserts what you are about to change is a decision someone recorded; find out what it was before touching either side. Meeting it as a red CI run means reconstructing that reasoning under time pressure.
4. **Reproduce before you fix.** A failure you have not seen is a failure you are guessing at, and a guess repairs the symptom. Get the error, the stack and the `file:line`, then fix the cause. If it cannot be reproduced locally, say so explicitly and name what the fix rests on instead.
5. **Check the mirror and the layer.** Some constants only move in pairs — `src/config/curriculum.js` ↔ `functions/teacherTools/cbcKnowledge.js`, `playBillingCatalog.js` ↔ `PLAY_PRODUCT_TO_PLAN`, `LEARNER_GRADES` ↔ `DAILY_QUIZ_GRADES`, `src/config/agents.js` ↔ `ORG.md` — and editing one half is a bug that ships green. Layering is one-way (`app → features → engines/curriculum → shared/services/config`); an import crossing it upward fails `test:import-boundaries`, which resolves every path including the dynamic `import()` calls ESLint cannot see.

### Scope the checking to the change

This is not a licence to spend twenty tool calls on a typo. The checks cover what the change TOUCHES, not the repo. A copy edit needs the file read. A new Firestore field needs the rules, the readers, the writers and the index. A change to an export rule needs `functions/shared/assessment` read properly, because the browser and the server both import it and a rule added on one side is a fork by definition.

The cheap habit that prevents most of this: **read the whole file you are editing**, not the twenty lines around the edit.

### Say what you assumed, and stop at the second correction

- **Anything you could not verify is an assumption, and it gets stated out loud** — in the plan, the PR description, or the reply. *"I assumed `attemptCount` is nullable because three of five call sites default it"* is useful to the reader. Silence reads as verification, which is exactly what makes the later correction land as a reversal.
- **Two corrections on the same change means the model is wrong, not the line.** Stop editing and re-read the actual source — the file, the schema, the rules, the test — before the next attempt. A third patch layered on a guess is how a one-line fix becomes a PR that has to be unpicked.
- **Never report a step as run that was not run.** "Should work", "this fixes it" and "verified" are three different claims — use the one that is true. §1 of the guide governs the *after*; this section governs the *before*.

## Binding architecture

[`docs/architecture.md`](./docs/architecture.md) is the binding target architecture and migration contract (verified at commit `79ff3d2`). Read it before any restructuring or migration work. Migration PRs implement it; they do not reinterpret it. On frozen surfaces (collections, function exports, rewrite paths, regions), stop and report conflicts instead of choosing an interpretation.

## Repo at a glance

ZedExams is a CBC-aligned learning platform for Zambian learners, teachers, and admins, live at zedexams.com. It is a Vite/React 19 SPA backed by Firebase (Auth, Firestore, Storage, Cloud Functions v2 on Node 22). AI runs server-side via Anthropic Claude (Sonnet 4.5 default — `claude-sonnet-4-5`, overridable per-runtime with `ANTHROPIC_MODEL` — for generators; Haiku 4.5 `claude-haiku-4-5-20251001` for quiz verification), OpenAI for short-answer marking, and Firebase AI Logic / Gemini for client-side helpers. **Image generation** (question/passage diagrams, note pictures, visual notes) runs on OpenAI gpt-image-1 (with a Gemini path via `geminiImageClient.js`) — see `generateDiagram` / `generateNotePictures` / `generateVisualNotes`. The Recraft and Kie providers were decommissioned (2026-06 / 2026-07); their style selectors (`recraft` line-art, `kie` colour illustration) now render through gpt-image-1. Payments run through Lenco (MTN, Airtel, and Zamtel mobile money plus cards, in ZMW) on the web, and through **Google Play Billing** (in-app subscriptions) on the Android build — see `functions/googlePlayBilling.js` + `verifyGooglePlayPurchase`. A Capacitor wrapper produces Android builds.

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
  app/ engines/ shared/ curriculum/ — the Phase 1 MIGRATION SCAFFOLD, now substantially occupied (this line described it as empty until 2026-08-16, long after it was). Live today: `app/` holds App.jsx + guards + teacherRoutes; `engines/` holds the export engine, assessment engine, paper-render, payment-engine and notification-engine; `shared/` holds components, hooks, utils, schemas, constants, icons and styles; `curriculum/` holds catalog, diagrams and resolvers. **Four areas are still empty and only one of them is merely pending** — `app/providers/`, `curriculum/{adapters,validators}` and `shared/validation/` are BLOCKED by the layering itself, and `app/layouts/` + `curriculum/aliases/` are empty because their contents went elsewhere or never existed. Each area's `index.js` records which case it is and why; read that before assuming a directory is waiting for you. The recurring blocker: a module cannot move UP into `curriculum/` or `engines/` while something in `shared/` or `config/` still imports it, and `src/contexts/` cannot move into `app/providers/` while 294 files under `features/` import it. What IS live is the layering — `app → features → engines/curriculum → shared/services/config`, one-way, enforced by the `no-restricted-imports` blocks in `eslint.config.js` plus `test:import-boundaries` (which resolves every import in `src/` to a real path — covering the sibling-feature case ESLint's string matching cannot see, **dynamic `import()` which it does not inspect at all**, and the shrink-only debt lists a warning could never fail a build over — and asserts the lint rules still fire). Each directory index is a namespace marker, NOT a barrel — import the area (`src/shared/utils`), never the root
  app/App.jsx                       — router; nearly every route is React.lazy(); ThemeApplicator pins public routes to brand default
  main.jsx                      — entry; wraps <App /> in ErrorBoundary + AuthProvider + ThemeProvider + DataSaverProvider + PlatformSettingsProvider
  firebase/config.js            — Firebase init; sets auth persistence, App Check (reCAPTCHA Enterprise on web, Play Integrity on Android via Capacitor plugin), multi-tab IndexedDB persistence, FCM (web-push only)
  firebase/ai.js                — Firebase AI Logic (Gemini) client; src/utils/aiLogic.js wraps generateText/streamText/generateJSON
  contexts/                     — AuthContext, ThemeContext, DataSaverContext, PlatformSettingsContext
  components/
    (admin/ MIGRATED — the directory is gone as of 2026-08-14. Its 26 files became the `features/admin*` features one slice at a time from 2026-08-12; the last three — AdminPastPapers, PastPaperStudio, pastPaperReport — were held back only by the freeze and became `src/features/adminPastPapers/` when the sixth ruling closed it. **PastPaperStudio's Quiz step is still optional** — a paper can publish with `quizStatus: 'pending'`; every read of that state goes through `src/utils/pastPaperQuizStatus.js`, the status is DERIVED (`quizStatus ?? (quizId ? 'attached' : 'pending')`) so papers predating the field still resolve, and it fail-closes: `'attached'` with no `quizId` reads as pending rather than rendering a Start Quiz button that leads nowhere. `functions/pastPapersIndexHelpers.js` carries a CommonJS mirror, kept honest by `test:past-papers-index`)
  features/adminShell — `AdminLayout` is the ONE shell for every `/admin/*` route: sidebar (desktop), drawer (mobile), the ⌘K command palette, the pending-count badges. **One nav registry**: `lib/adminNav.js` holds `ADMIN_NAV_SECTIONS` (the seven grouped sections), `ADMIN_SWITCH_ITEMS` (Teacher/Learner view) and `ADMIN_ACTION_ITEMS` (Sign out, which carries a `command` string the shell resolves rather than a route, so the registry never imports the auth context). It lived inline in `AdminLayout.jsx` until 2026-08-16, which cost two things: the desktop and mobile "Quick switch" links were written out twice and free to drift, and the palette was handed the nav sections ALONE — so ⌘K could reach "AI costs" but not "Sign out" or either view switch, which sat in their own hard-coded block. `ADMIN_PALETTE_SECTIONS` is what the palette gets. **`scripts/test-admin-links.mjs` (`test:admin-links`) is the admin twin of `test:dashboard-v2-links`** — it text-parses seventeen `features/admin*` directories and fails CI if any hard-coded target has no matching `<Route>` (40 targets at introduction, 0 broken). It reads two shapes, because anchoring to a quote is not enough: literal attributes/properties (`to:`, `to=`, `href=`, `route:`) AND expression forms (`navigate(...)`, `to={...}`), where every route-like literal inside the argument text is pulled out — `navigate(id ? `/admin/agents/jobs/${id}` : '/admin/agents/jobs')` matched NEITHER branch under the literal-only pattern, so retargeting a real admin flow at a dead route left the guard green. Dynamic targets (`/admin/users/${uid}`) are unresolvable from source, so they are excluded AND PRINTED: a guard that skips work silently reads exactly like one that found nothing wrong. Keep destinations as plain string literals so the parser can see them. **Palette ranking is pure and node-tested** — `lib/adminNavSearch.js` (`test:admin-nav-search`) matches AND across whitespace tokens over label + section + `keywords` + path, so "costs ai" and "ai costs" are equivalent and an admin can type what a page is FOR ("billing", "refund", "audit") rather than its label; results rank exact-label ▸ label-prefix ▸ label-word ▸ label-substring ▸ keyword-only, ties keeping registry order so the list only ever narrows as you type. Behaviour that needs a DOM (action dispatch, badge pills, focus restore on close, `aria-activedescendant`) is in `CommandPalette.spec.jsx`. Badge counts are five Firestore aggregate queries on a 60s timer that **only runs while the document is visible** and refreshes on becoming visible — before that a backgrounded `/admin` tab billed ~14,400 count queries over a weekend nobody looked at.
    auth/                       — Login, Register, AuthAction (password reset)
    dashboard/                  — StudentDashboard, GradeHub, MyResults, Badges, Profile
    (exams/ MIGRATED 2026-08-14 → src/features/dailyExams/ — the directory is gone. DailyExamRunner was the last named entry on the §14 freeze list; the sixth owner ruling closed that list. The move retired the six re-export shims the quiz migration had left for it, on the condition those shims wrote for themselves)
    (games/ MIGRATED 2026-08-14 → src/features/games/ — the directory is gone; its one re-export shim retired the same day when QuizList migrated)
    lessons/                    — Lesson library + slide player + editor; src/features/notes/ holds Notes Studio (admin authoring + learner reader gated by LearnerGate)
    (quiz/ MIGRATED — the directory is gone as of 2026-08-14. RUNTIME → src/features/quiz/, EDITOR → src/features/quizEditor/, and the document-IMPORT body → **src/services/quizImport/** once AdminPastPapers was released. The body went DOWN to the services layer rather than into a feature because FOUR features import it (quizEditor, assessmentStudio, notes, adminPastPapers) and its closure reaches Firebase via utils/aiAssistant — so shared/ was refused it and any one feature would have been the wrong owner. Costs zero debt: feature → services is the allowed direction, so `utils/paperToQuizConverter.js` keeps reading it from the legacy tree. Question types include MCQ, short-answer, and Fill-in-the-Blanks)
    (teacher/ MIGRATED 2026-08-15 — the last large legacy directory, moved on the owner ruling that closed the remaining migrations. Three destinations, per the §13 inventory: the shared studio layer — curriculum selector, studio hooks, `paperTaxonomy`, `renderPlanHtml`, `syllabusTopicOptions`, generator chrome, `lessonStudio.css` — went to `src/shared/{components,hooks,utils,styles}/`; the classic home surface — TeacherDashboard (/teacher/classic), TeacherWorkspace, QuickCreate, PrepareThisWeek, RecentDocuments, SchoolCalendar, SyllabiLibrary, WelcomeToPro — became `src/features/teacherHome/`; and `teacherRoutes.jsx` + `StudioGate`/`LockedStudio` went to `src/app/{routes,guards}/`. Four files remained until Phase 6 (2026-08-15) emptied the directory: the two dead §R1 headers were deleted, `teacherNav.js` travelled to `src/features/teacherShell/lib/` (trimmed to the live `QUICK_CREATE` export), and the dark-surface guard became `scripts/test-teacher-dark-surface.mjs` — `src/components/teacher/` no longer exists. Everything below still applies — the pieces just live in the features named)
    teacher/ (historical)       — TeacherDashboard + studios (lesson plan / worksheet / flashcards / scheme of work / rubric / notes / homework / assessment / SBA task). **`TeacherLayout` is the ONE shell for the whole teacher area** (2026-07-30) — sidebar, mobile chrome, account menu, logout — and EVERY `/teacher/*` route renders inside it, the dashboard included. Routes are declared as data in `teacher/teacherRoutes.jsx` (App.jsx just maps them) so `teacherRoutes.spec.jsx` can render every one and fail if the shell is missing; a route that deliberately opts out sets `shell: false` and must give a `shellExemptReason`. Add a teacher page THERE, not in App.jsx. `variant` picks only the CONTENT container (`'studio'` = the `.studio-shell` well + TeacherTopBar; `'dashboard'` = the page brings its own `.tdv2-main`/`.tdv2-content` grid and header) — never the navigation. **One nav config**: `TEACHER_NAV_GROUPS` in `dashboardV2Config.js`, rendered by `Sidebar` (desktop) and `NavDrawer` (mobile); the old NAV_GROUPS/STUDIO_NAV_GROUPS fork is gone, and `dashboardV2Config.spec.js` pins the menu contents exactly. Active state is route-derived, longest-match-wins, in `dashboardV2/teacherNavActive.js` (one resolver for both surfaces; `test:teacher-nav-active`). **One breakpoint**: exactly one navigation system is MOUNTED at a time (`useIsMobile`, 768px) — sidebar ≥768, header+drawer+dock <768; the CSS media queries are a backstop, not the mechanism. Before this, the shell cut over at 1024 and the dashboard at 768, so a tablet showed the dashboard an icon rail and every studio page a bottom dock. **The sidebar collapses to a 76px icon rail from its own toggle** at every width it renders at (`useSidebarCollapsed` + `sidebarCollapseCore.js`, persisted in `localStorage` under `zedexams:teacher-sidebar-collapsed`; `test:sidebar-collapse` + `sidebarCollapse.spec.jsx`). The rail is driven by `is-collapsed` on `.tdv2-sidebar` / `.tdv2-shell`, NOT by a media query — 1024px only picks the DEFAULT (rail on a tablet, full panel on a desktop) and a stored choice outranks it, so a width can no longer answer which state the sidebar is in. Collapsed, group headings become divider rules and the item labels are VISUALLY hidden rather than `display:none`, because an icon-only link still needs its accessible name; the hover/focus tooltip that replaces them is `position:fixed` (`.tdv2-nav` scrolls, so anything parented to the item would be clipped). Below 768px none of this applies — the sidebar isn't mounted. `TeacherLayout` also owns a Suspense boundary INSIDE the shell so a page chunk loading doesn't blank the sidebar. Tool names are canonical per ROUTE via `CANONICAL_TOOL_LABELS`/`canonicalToolLabel` — the sidebar's label wins on every navigation surface (Quick Create, workspace tiles, all-tools grid, the mobile sheet); "Studio" survives only in page headers. `teacher/dashboardV2/` holds the dashboard PAGE CONTENT: `TeacherDashboardLive` (real data via `useTeacherDashboardData` — one generations fetch + one assessments fetch + Teaching Profile + MoE calendar, derived through the pure `dashboardV2Data.js` helpers) renders `DashboardView` in the scoped `tdv2-` design system (lucide-react + recharts). The same view serves `/teacher/dashboard-preview` (`TeacherDashboardV2`, intentionally unguarded, mockData.js only, PreviewChrome banner + non-production control panel), and the pre-V2 dashboard remains at `/teacher/classic` as a transition fallback. Below 768px the dashboard swaps to a dedicated MOBILE information architecture (`MobileDashboardView`'s default export — hero, compact checklist, app-style tool tiles; a CONTENT decision only, since the chrome around it is the shell's at every width). A six-step spotlight onboarding tour (`OnboardingTour.jsx`, pure logic in `onboardingTourCore.js`) runs once per device on the dashboard; replay via `/teacher?tour=1` (Help & Support link) or the preview control panel. `/teacher/help` (dashboardV2/HelpSupportPage) is the teacher Help & Support surface: contact/report forms via the shared marketing ContactDialog (→ `contactMessages`, triaged by Echo), suggestions via FeedbackDialog (→ `feedback`), WhatsApp + support-email channels, teacher FAQs. `scripts/test-dashboard-v2-links.mjs` (`test:dashboard-v2-links`) fails CI if any hard-coded dashboardV2 navigation target doesn't resolve to a declared route. Route-parsing guards read BOTH declaration sites through `scripts/lib/declaredRoutes.mjs` — App.jsx alone is no longer the route table. AssessmentStudio is the largest — it's the **Assessment Paper Studio**, the single merged studio for every assessment type (2026-07 merge of the former "Test Paper Studio" and "Exam Studio"): topic/weekly/mid-term/end-of-term tests AND mock/examination/final examinations are all authored, saved, listed and exported through it. Canonical routes are `/teacher/assessment-papers`, `/teacher/assessment-papers/new`, `/teacher/assessment-papers/:id/edit`; the legacy `/teacher/test-papers`, `/teacher/exam-papers` and `/teacher/assessments` paths (and `AssessmentStudio`/`AssessmentList`'s old `variant` prop) are kept ONLY as redirects in `App.jsx` for old bookmarks/links — the studio itself no longer branches on a route-level variant. Which type a saved paper is comes entirely from its own `assessmentType`, drawn from the canonical registry in `paperTaxonomy.js` (`ASSESSMENT_TYPES`: `topic_test`/`weekly_test`/`mid_term`/`end_of_term`/`mock_exam`/`examination`/`final_exam`) and normalized on read via `normalizeAssessmentType()` for legacy/pre-merge values (`topic`, `mock`, `exam`, …) — the same registry drives the grouped Tests/Examinations picker, `generateAssessment`'s payload, the saved document, and title/export formatting (`buildTitleFromForm` / `assessmentPaperLayout.js`'s `buildPaperTitle`). Free-plan teachers see locked studios (LockedStudio + StudioGate) with samples + paywall. NOTE: the teacher-facing agent-submission surface (AgentBriefForm + AgentJobsList at /teacher/agents) was removed in 2026-06 — it duplicated the direct studios behind a human-approval gate nobody staffed. The server-side agentJobs pipeline + the /admin/agents approval UI remain. The Full Lesson studio was retired in 2026-07 (generation surface + `generateFullLesson` function removed); the library still renders/exports lessons saved before removal via `views/FullLessonView` + `fullLessonToDocx`/`fullLessonToPdf`. The Class Register lives in teacher/register/ (classRegisters collection: roster, marks, reports) and includes the **Class Register Studio** (teacher/register/attendance/, routed at /teacher/attendance + the register's Attendance tab): daily attendance marking, a month-windowed term grid, summaries, and official A4 register printing/exports. Attendance data sits in classRegisters/{classId}/attendance/{YYYY-MM-DD} (one doc per class per date), attendanceTerms/{termId} (policy, day overrides, custom term dates, mid-term-break config, draft→submitted→locked→reopened lifecycle; locked is teacher-read-only, admin-reopen-with-reason), and attendanceAudit (append-only). **Attendance day writes are server-only**: rules deny client writes and every mutation (single mark, mark-all, grid edits, corrections, offline replays) goes through the `saveClassAttendance` callable (functions/attendance/ — term resolved from the date, lock/eligibility/status validation, server-recomputed counts, strict STALE_VERSION versioning; MoE term windows mirrored in functions/attendance/moeTermData.js, guarded by test:attendance-term-mirror). The client keeps a localStorage outbox (useClassRegister) with queued/syncing/conflict/rejected states. Pure logic in src/utils/attendance*.js (constants/calculator/calendar-resolver/day-core/export) — teaching days resolve from the MoE calendar via attendanceCalendarResolver; late counts as present in the percentage but is totalled separately.
    diagrams/                   — diagram rendering + the leader-line label layer for question/passage figures
    (papers/ MIGRATED 2026-08-13 → src/features/papers/ — see below)
    parent/                     — Parent portal pages
  features/games — the games surface (`/games`): hub, subject selector, game list, play surface, global leaderboard, and the eight game engines. Migrated out of `src/components/games/` on 2026-08-14 by an explicit **owner ruling releasing it from the Assessment Engine freeze** — the third such ruling. (It released ONE surface; the freeze itself was closed by the sixth ruling on 2026-08-14, which released everything still on the list. The rollout flags are STILL at 0 — that ruling replaced the condition rather than meeting it.) `TimedQuizGame` is the engine's LAST cutover; its `useAssessmentEngineFlag('game')` wiring and both its specs (`.engine.spec` / `.legacy.spec`) moved unchanged and are load-bearing. The front door exports two names only — `GameBadgeCard` and `getSubjectMascot`. **`GameStickerStyles` and `Confetti` are NOT in the feature**: they went to `src/shared/components/`, because exporting them from the front door cost +75 kB of static edges each on GradeHub, SubjectDrillDown and ExamResultsPage (the door also exports `GameBadgeCard`, which reaches `utils/gamesService` → Firebase). `gameBadgesService.js`, `gameProgress.js`, `gameScorePayload.js` and `gamesIntelligence.js` stay in `src/utils/` — each has a consumer outside the feature. **`gamesService.js` no longer does**: it moved to `features/games/services/` on 2026-08-14 with `GamesSeedAdmin` (→ `pages/`), which was the one thing pinning it, so §14.2 is now SATISFIED and the feature has a `services/` directory. Its one remaining outside consumer, `hooks/useLearnerSearch`, reads `listGames` through the front door — measured at +28 bytes on that chunk with no new edge, since it already reached `gamesService` directly. Only `gameSounds.js` travelled, into `lib/`. `QuizList` reached the sticker stylesheet through a one-line re-export shim at the old path while `components/quiz/` was still frozen; the quiz migration hours later moved QuizList, so the shim retired and `src/components/games/` is gone
  features/quiz — the learner-facing quiz RUNTIME (`/quizzes`, `/quiz/:quizId`, `/results/:resultId`): QuizList, QuizRunnerV2, QuizResultsV2, QuizTip. Migrated out of `src/components/quiz/` on 2026-08-14 by an explicit **owner ruling releasing that directory from the Assessment Engine freeze** — the fourth such ruling. **It released the directory, not everything the directory serves:** `admin/CreateQuizV2` was its own freeze entry and pinned 38 modules of quiz AUTHORING; the fifth ruling released it hours later and they became `features/quizEditor`. The split was measured first — the runner's closure is 12 modules, the editor's 29, and they share exactly two (`ExtraQuestionImages`, `ZoomableImage`), both of which went to `src/shared/components/` on consumer count. **Empty front door** — all three screens are route-mounted lazily and nothing else imports them. `QuizRunnerV2` carries the Phase 3 `useAssessmentEngineFlag('quiz')` branch and ALL THREE specs travelled with it, including `.characterisation.spec.jsx`, the recorded byte-compatibility baseline. The reading-assist cluster (PassageViewer, ReadingSettings*, TextToSpeechButton, ThemePreview) + QuizReviewScreen also went to `src/shared/components/` — three areas draw each of them; `DailyExamRunner` reached six through one-line shims at the old paths while it was frozen; those shims were deleted on 2026-08-14 when it migrated to `features/dailyExams/` and now imports `shared/components/` directly
  features/quizEditor — the quiz AUTHORING surface: EditQuizV2 (`/quiz/:quizId/edit`) and **CreateQuizV2** (`/admin/create-quiz`), 20 editor components, and the pure answer-key/bulk-ops/crop/review modules. Migrated 2026-08-14 on the **fifth owner ruling**, which released `admin/CreateQuizV2` — the reason being that it is a PAGE of this feature (create-a-quiz beside edit-a-quiz, rendering the same QuizSectionsEditor / QuizEditorPreviewPanel / QuizValidationChecklist), not a consumer of it. Front door exports two names, `ImageCropModal` + `QuizVerifyModal`, both for `features/assessmentStudio`. `ImportReviewBadge` went to `features/adminContent` instead — its only consumer is ManageContent. **`importRichText` + `importFormatTokens` went to `src/shared/utils/`**, forced: `src/engines/export-engine/` reaches importRichText through `utils/toolNotationRender`, and an engine may not import a feature. `utils/paperPageProvider.js` and `utils/quizReimportDiff.js` came IN (EditQuizV2 was their only consumer); `paperFigureAttach.js` stayed, pinned by the frozen PastPaperStudio
  features/papers — the past-paper archive (`/papers`): hub, reader, timed practice, the public paper-quiz runner, learner history. Migrated out of `src/components/papers/` on 2026-08-13 by an explicit **owner ruling releasing it from the Assessment Engine freeze** — at the time, the rollout flags were still at 0 and the rest of that freeze still stood. (It has since been closed outright by the sixth ruling of 2026-08-14. The flags are STILL at 0 — that ruling replaced the condition rather than meeting it, so nothing here should be read as the Phase 3 ramp having happened.) `PublicQuizRunner` is the engine's designated FIRST flag flip, so its `useAssessmentEngineFlag('pastPaperQuiz')` wiring and its zero-write property (`test:paper-quiz-zero-write`) are load-bearing. The front door exports only `PaperTitle`/`PaperSourceBadge`; the PDF viewers (`PdfJsViewer`, `PdfScrollViewer`, + their chrome) are NOT papers' — they went to `src/shared/components/`, because `PdfScrollViewer`'s only consumer is the exam-timetable page. `src/utils/pastPapers.js` and `pastPaperQuizStatus.js` deliberately stayed behind: at the time their other consumers were frozen. They STILL do not travel now that the freeze is closed, and the reason is now a measurement rather than a deferral — `features/papers` and `features/adminPastPapers` are two features, and a module both read belongs below both
  features/lessons, features/notes, features/visualStudio — feature-folder pattern (pages/, components/, services/, lib/) for newer surfaces; visualStudio drives admin image authoring AND the teacher Picture & Diagram Studio at /teacher/visual-studio. **Visual Studio v2 foundation (2026-08)**: the `diagramAssets` collection is the curriculum Diagram Library — ONE asset stores source art + labels `{ word, anchor, box }` (normalized 0–1) and the four printable versions (teacher words / learner P,Q,R / answer key / picture only) are RENDER-TIME projections (`lib/diagramProjections.js`; letters are NEVER stored — derived from reading order, sort anchor.y then anchor.x, so add/delete can't skip a letter; the learner word bank is lowercase-alphabetical because anchor order leaks answers). `lib/labelBoxLayout.js` owns auto box placement (nearer margin, greedy push-down) + the 2F "Perfect layout" + leader-crossing detection; `schemas/diagramAsset.js` is the Zod pair; `services/diagramAssetService.js` bumps `version` on every label edit (consumers reference assetId + version). AI auto-label: the `autoLabelDiagram` callable (`functions/teacherTools/autoLabelDiagram.js`, pure decisions in `autoLabelCore.js`) runs Claude vision + `resolveCbcContext` grounding and returns proposals the editor treats as pre-filled manual labels — confidence < 0.7 flags amber, an ungrounded run says so, two malformed replies fall back to manual mode, and NOTHING is written server-side. Legacy pictureBank/visualAssets docs migrate via `npm run migrate:diagram-assets:dry` (idempotent, deterministic `mig-*` doc ids)
  editor/                       — TipTap-based rich-content editor shared between quiz/notes/lessons
  hooks/                        — useFirestore, useSubscription, useTeacherUsage, useQuizPersistence, …
  utils/                        — Firestore services + AI clients + DOCX/PDF exporters + Lenco payments + permissions + analytics (~263 non-test modules; the catch-all bucket). Several files here are now RE-EXPORT SHIMS onto functions/shared/assessment — see "One copy of the export rules" below before adding logic to one. **The paywall/entitlement group left on 2026-08-16** → `src/engines/payment-engine/` (`paywall`, `subscriptionConfig`, `subscriptionStatus`, `subscriptionUpgrade`, `teacherPlans`); `permissions.js` stayed, because `isSuperAdmin` is a role predicate the whole app reads, not a payment concept
  (schemas/ MIGRATED 2026-08-16 → src/shared/schemas/ — the root directory is gone. All eight Zod files moved at once rather than one at a time, because each already had consumers in two or more of features/, hooks/ and utils/, so there was no ownership question to settle per file. The precondition was measured, not assumed: `src/shared/**` may not import the Firebase SDK, and all eight are plain-object coercers/validators with no Firebase import — which is why they were eligible where `syllabusKbService.js` and the FCM modules are not. Nine `scripts/` suites import these paths directly under plain node, one of them from inside the rules-emulator job)
  config/curriculum.js          — SUBJECTS / GRADES; single source of truth for CBC dropdowns

functions/                      — Cloud Functions v2, Node 22, codebase=default. Separate package.json.
  index.js                      — every function export lives here (~189 exports): generateQuiz, verifyQuiz, checkShortAnswer, apiGenerateLessonPlan / Worksheet SSE, the generate* teacher tools (Assessment/SbaTask/Homework/Notes/Flashcards/SchemeOfWork/Rubric/Diagram/NotePictures/VisualNotes/SlideNotes; the generateExamPaper callable was retired 2026-07 — every assessment type, test AND examination, now generates through the one generateAssessment (the merged Assessment Paper Studio; `assessmentType` is one of the 7 canonical values in `functions/teacherTools/assessmentFormats.js`'s `ASSESSMENT_TYPES`, reaching the backend exactly as the teacher picked it — `examination`/`final_exam` are real recognised types, never collapsed to `mock_exam`), and the library still renders legacy `tool:'exam_paper'` docs via `src/utils/aiPaperToSections.js`; `planAssessment` derives the same paper plan with NO model call so the teacher confirms it before generating, and `regenerateAssessmentQuestion` rewrites ONE question against its plan slot), scanned-quiz + note OCR (structureScannedQuiz, ocrNotePages), parent portal + weeklyParentDigest, newsletter (subscribeToNewsletter), invoices, referrals, syllabus versioning (parseSyllabusUpload, activateSyllabusVersion, rollbackSyllabusVersion), Lenco (lencoWebhook + payment recovery) + Google Play Billing (verifyGooglePlayPurchase), Central Question Bank (questionReviewOnWrite=Qix, importPastPaperQuestions, classifyQuestionGrades, reviseQuestion), agentJobsOnCreate/Approved, storageCleanup triggers, and the scheduled crons (nightlyQaSmoke, hourlyMonitor, hourlyAgentSupervisor=Marshal, hourlyRevenueReconcile, supportTriage, contentAutoPublish, weeklyProductSignal, weeklyRetentionScan, deliverDawnBriefings, weeklyCbcAlignmentAudit, buildDailyQuizzes, daily/weekly learner reminders, dailyFxRefresh, aiCostDailySummary, reclaimAiBudgetReservations, rebuildPastPapersIndexCron)
  aiService.js                  — Anthropic client (streaming + non-streaming + prompt-caching), assertDailyLimit, role helpers, parsers
  anthropicFetch.js             — low-level fetch around Anthropic API
  geminiClient.js + geminiImageClient.js — Gemini REST client (structureImportedQuiz) + Gemini image generation
  visualSafety.js / visualSafetyCore.js — safety gate for generated images; pictureNaming.js auto-names picture-bank assets
  openaiClient.js               — OpenAI client (short-answer marking)
  teacherTools/                 — one folder per generator (prompt + schema + generate*/run* runner) + cbcKnowledge.js + cbcTopics.js (KB resolver), usageMeter.js (per-user + per-agent daily caps), privateCurriculum.js, assessment/exam-paper/SBA schemas + format seeds
  agents/                       — Internal agent pipeline. dispatcher.js drives Aria → Cala → Reva → awaiting_approval → Pubo via Firestore triggers on agentJobs/{id} (pinned to africa-south1). agents/runners/ holds the content agents (aria, cala, reva, pubo, vex) AND the ops/growth agents driven by agents/cron.js (monitor=Vigil, till, echo, compass, anchor, gate, dawn, quill). agentControl/{agentId}.paused is a circuit breaker; agentControl/content.autoPublish gates Gate. learnerAi/ holds the curriculum-ingester runner.
  dailyQuiz/                    — the Daily Quiz: pure selection rules (dailyQuizCore), the Firestore layer (dailyQuizService) and the handlers (dailyQuizFns). See "The daily quiz is five questions" below
  grading/                      — daily-exam grading (HISTORY ONLY — the daily-exam rotation was retired 2026-08; the grader stays so past attempts remain readable)
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
docs/                           — the long-form reference set, far more detailed than this file. docs/architecture/ (26 numbered docs: system overview, repository map, route register, Firestore data model, Cloud Functions register, security review, duplication/dead-code/risk registers, target architecture + remediation plan) and docs/production-readiness/ (18 numbered audits + runbooks/ for deploy-rollback, firestore-restore, secrets-recovery, ci-supply-chain, launch-operator-guide). Also GOOGLE-PLAY-BILLING.md, ANDROID-RELEASE.md, visual-regression-gate.md, CHANGELOG.md, security/. Read the relevant numbered doc before a deep change — but treat every one as a snapshot, not as current truth
firestore.rules                 — large, hand-written; the test:rules-text script is a text-level sanity check, not a behavioural test
firestore.indexes.json          — composite indexes (leaderboard, results, attempts). Deploy these BEFORE shipping queries that need them.
storage.rules                   — Storage security rules
firebase.json                   — hosting rewrites map /api/ai/chat, /api/teacher/lesson-plan/stream, /api/teacher/worksheet/stream, /api/tts, /api/payments/lenco/webhook to the matching onRequest Cloud Functions in us-central1; SPA fallback at the bottom
capacitor.config.json           — appId com.zedexams.android; android/ holds the generated native project
.claude/settings.json           — repo-level permission allow/deny list (denies `firebase deploy --only hosting|functions`)
.claude/agents/                 — subagent definitions (cbc-alignment, content-author, content-reviewer, code-reviewer, publisher, qa-smoke, quiz-verifier, release-notes); see ORG.md for the agent org chart
```

## Architecture notes that span multiple files

### The guardian↔learner link — one record, two doors

A guardian account and a learner account are never merged. They are joined by
`parentLinks/{parentUid}_{learnerUid}`, and that document is the relationship:
it carries the consent, the permissions, the role and the audit reference.
(The collection kept its pre-existing name — it IS the "link record"; renaming
a live collection with a live parent portal reading it buys nothing.)

**Consent lives on the LINK, not on the learner.** `users/{uid}.guardian.
consentStatus` was one guardian's decision, which cannot represent two: a
withdrawal by one adult would clear the field the other's approval was stored
in. So each link carries its own `consent {state, method, grantedAt,
withdrawnAt}` and the learner's state is DERIVED — approved if **at least one**
link is approved (`guardianLinkCore.resolveLinkConsent`). That one choice is
what makes multi-guardian, withdrawal and "which adult approved what" fall out
instead of each needing a special case. The account-level field is still
honoured (`source: 'account'`), because every learner approved before this
existed has consent recorded only there.

- **Approval is a disjunction, restriction is a conjunction.** One adult saying
  yes approves the child; one adult saying no restricts them
  (`resolveLinkPermissions`, most-restrictive-wins; smallest `dailyMinutes`
  wins; `false` beats `true` beats `null`). The asymmetry is deliberate — were
  approval a conjunction, anyone who typed a family code would hold a veto over
  a child's account. **Only APPROVED links contribute permissions**: a pending
  guardian has not said they are this child's parent, a withdrawn one no longer
  is, and neither sets the rules.
- **Two doors, one guardian account, joined on the verified email.**
  `guardianLink/convergence.js` owns it. Door A (child names a guardian's email
  → they approve by link) creates the link APPROVED — the child nominated the
  address and the adult proved they read that inbox, so both halves are already
  present. If no account holds that address yet, a **claim** is left in
  `guardianLinkClaims` and swept up by `listGuardianChildren` on the parent's
  first visit — not at signup, because parents verify their address afterwards
  and a claim is only redeemable once verified (`admin.auth()`, never the
  profile's `email` field, which the account itself can write).
- **Door B (family code) creates a PENDING link and asks the child.** The code
  is single-use (burned in the same transaction that writes the link), lives 48
  hours, is regenerable, and is rate-limited per account and per IP. The
  confirmation is the real defence against a code reaching the wrong adult — it
  is the only step involving the one human who knows the answer — and it is
  enforced server-side: `parentApp`'s `authorise` refuses **every** read of a
  child's data through an unconfirmed link.
- **Legacy links are grandfathered, explicitly and temporarily.** A link with
  no `consent` object at all reads as approved while `enforceMigration` is
  false (`linkIsApproved`), for the same reason `guardianConsentCore` grants the
  migration grace: the strict reading would lock every existing parent out of
  their own dashboard on one deploy. `npm run backfill:link-consent:live`
  stamps them `grandfathered: true` — approved-by-inference, distinguishable
  from a child having tapped yes — after which the flag can be flipped. A link
  that STATES `pending` is never covered: the grace is for silence, not for a
  recorded answer.

**Server-side enforcement, per capability.** `consentGuard` reads the live
links on every gated call and folds two independent stores: `users.
guardianControls` (set inside the child's session behind a friction gate) and
`parentLinks.permissions` (set by a verified guardian from their own account).
A restriction from either refuses. `purchase` is gated
in Cloud Functions; **`leaderboard` is the exception and needed a mirror** —
scores are written straight from the client with no function in the path, and a
Firestore rule can `get()` one document but cannot run a query, so "does this
learner have an approved link" is unaskable in `firestore.rules`. The
`onParentLinkWritten` trigger (africa-south1, like every Firestore trigger)
mirrors the fold onto `users/{uid}.guardian.effective`, which
`mayAppearOnLeaderboard()` reads by path. **It is a cache**: nothing that can
read the live links reads it instead, so a stale mirror costs at most a
leaderboard row.

**The child is told, and the child can act.** Settings › Guardian
(`GuardianLinkPanel`) names every linked adult, states what they can and cannot
see (`GUARDIAN_VISIBILITY` — one declaration shared with `/child-safety` and
the guardian's confirmation email), shows the permissions each has set, and
carries Childline Zambia 116 as a real `tel:` link. **Settled decision: a
guardian sees TOPICS, never a child's own words** — recorded for the Ask Zed
assistant (removed 2026-08-20) and kept because it governs any future surface
a child types into: forwarding a flagged message would send a child's
disclosure to the adult who may be its subject. A safety flag routes to
Childline and human review, never automatically to a guardian.

**Removal is asymmetric, and that is the point.**

| Who | Action | Effect |
|---|---|---|
| Child, before confirming | reject / report | link **deleted** — refusing a stranger is not ending supervision |
| Child, after confirming | `requestGuardianUnlink` | a **request**; guardian and support told; nobody removed |
| Guardian | `withdrawGuardianConsent` | link marked `withdrawn`, record kept; child limited **only** if no other approval stands |

A child who can quietly drop supervision is a child who can be talked into
dropping it, by the person the supervision exists to notice. What pays for that
is Childline 116, which needs no guardian's knowledge and is returned in every
one of these callables' payloads so a screen cannot forget to show it.
**`firestore.rules` denies every client write to `parentLinks`, delete
included** — both routes are callables that append to `guardianLinkAudit`
(server-only in both directions, as are `guardianLinkClaims` and
`guardianUnlinkRequests`; a readable claims collection would be a directory of
minors indexed by their parents' email addresses).

**Entitlement cascades; unlinking does not revoke.** A confirmed payment on a
guardian unlocks every approved-linked learner to the same expiry
(`guardianEntitlement.js`, called post-commit from `subscriptionActivation` —
so only from the Lenco webhook and Play verification, never from an intent). It
never shortens a plan a child already holds, never grants `teacherPlan`, and
skips suspended or guardian-denied accounts. The grant is a plain expiry on the
child's own document, so a guardian who later unlinks leaves the child's plan
running to the end of the period paid for — intended, and pinned by a test.

Tests: `test:guardian-link`, `test:guardian-link-lifecycle`,
`test:guardian-entitlement`, `test:consent-guard`, `test:family-portal`,
`test:shared-guardian-neutral`, `test:rules-text`, plus
`GuardianLinkPanel.spec.jsx` and the deny-both-directions arms in
`test-firestore-rules-emulator.mjs`.

### The age screen is three numeric boxes and an echo (2026-08-19)

`/register?step=age` (`features/auth/components/AgeGateStep.jsx`) is the neutral
age screen Play's Families policy requires, and it is the ONLY thing the
guardian-consent gate reads from — `users.dob`, no parallel flag. Four things
about it are decisions, not styling:

- **The date is typed, not picked.** Three `inputMode="numeric"` fields that
  auto-advance (and backspace back), replacing three `<select>`s that were
  three modal pickers on Android and a year list a child born in 2014 had to
  scroll a long way down.
- **The age is echoed back and Continue stays disabled until it is.** "That
  makes you 12 years old — 14 March 2014, is that right?" A child who types
  2004 for 2014 fixes it themselves; that single typo is exactly how a
  twelve-year-old lands in an adult account with no guardian.
- **Implausible is a TYPO, refused identically at both ends.** Under 4 and over
  100 both read "that would make you N years old — check the year". The
  symmetry is the neutrality claim: a gentler refusal at one end is a hint
  about which end is welcome. Within the window every real date proceeds —
  there is still no minimum age. Bounds live in `src/utils/ageAnswerCore.js`
  (pure, `test:age-answer`), which `signupFlowCore.checkAgeAnswer` reads.
- **"I'm not sure of my birthday" is never a dead end.** Year-only,
  derive-from-grade, or hand the device to a grown-up. Every ESTIMATE is
  clamped below `GUARDIAN_CONSENT_AGE` when it lands within a year of it
  (`clampEstimateBelowConsentAge`) — a grade tells you an age to ±2 years, so
  an estimate of 18 read as an adult is a coin toss with a child's account on
  it. The clamp moves the DATE, never a flag beside it, so the server's
  re-derivation sees the same thing the client did. A TYPED date is never
  clamped: the learner confirmed an echoed age, and recording a different one
  would make that confirmation a lie.

**The first answer is the answer, and there is only one of it.** `dob`,
`isMinor`, the new `dobSource` (`typed`/`year_only`/`grade`, pinned to that
vocabulary in the rules) and the server-stamped `dobRecordedAt` are all on the
`users` self-update blocklist — a learner cannot edit their date of birth,
relabel a grade-derived one as typed, or move when it was recorded. So is
`dateOfBirth`: learner settings used to carry an editable "Date of birth
(optional)" field writing a SECOND birthday onto the same document that the age
gate never read, so a child who corrected it changed nothing and believed
otherwise. That control is now a read-only display of `dob`.

Mockup + the three places it is deliberately not what shipped:
[`docs/learner/README.md`](docs/learner/README.md). Tests: `test:age-answer`,
`test:signup-flow`, `test:rules-text`, `test:rules-emulator`, plus
`AgeGateStep.spec.jsx` and `Register.spec.jsx`.

### The learner app rolls out one grade at a time (2026-08-18)

The learner side is open to **Grade 7 only**. Grades 4–6 exist everywhere else
in the product and are being authored; they are not offered to learners until
they have content, because a grade opened empty is worse than a grade not yet
open.

**Two lists, not one, and the distinction is the whole design:**

- **`GRADES` (`src/config/curriculum.js`) stays `[4, 5, 6, 7]`** — the CBC
  upper-primary CATALOGUE. It is what the product AUTHORS for: the Assessment
  Studio, the syllabi, the Question Bank, Notes Studio, class registers and
  `functions/teacherTools/cbcKnowledge.js`. Narrowing it would take the
  authoring surfaces down with the learner ones and make it impossible to
  prepare the next grade — which is the one thing the rollout is waiting on.
- **`LEARNER_GRADES` is the rollout list**, currently `[7]`. Every learner-side
  grade picker reads it: the setup wizard, both settings pages, and the gate.

It is deliberately NOT the `active` flag on `ALL_GRADES` further down that
file. That flag answers "which BAND has notes subjects wired up" and its
consumers (`NoteMetaPanel`, `NoteFilters`) are admin AUTHORING screens —
reusing it would stop an admin writing the Grade 5 notes the Grade 5 rollout
is waiting on. Two questions, two lists.

**An existing learner in a paused grade is never relabelled.** This is the
failure the change was built around rather than a nicety: `needsSetup` keys on
the grade, so narrowing the wizard's list ALONE bounces every Grade 4–6 learner
back into onboarding where the only button on offer writes Grade 7 to their
profile — a silent data change to a child's account, made by a rollout decision
they never saw. So `resolveLearnerGradeAccess`
(`features/learnerOnboarding/lib/setupWizardCore.js`) is three-way, not two:

- `OK` — grade is open.
- `WAITLIST` — a real catalogue grade that has not opened. `LearnerGradeGate`
  renders `GradeWaitlistScreen`, the stored grade is kept, and nothing is
  written. Two ways out (change grade → the wizard; sign out) because a screen
  a child cannot leave is the dead end `LearnerOnlyRoute` was careful about for
  teachers. The copy promises no email, because nothing sends one.
- `UNKNOWN` — no grade, or nothing the catalogue knows. Passes through to
  `LearnerSetupGate`, which redirects to the wizard. Returning `WAITLIST` here
  would be both false and inescapable, and would catch every admin and parent —
  they legitimately have no grade of their own.

**`LearnerGradeGate` is composed inside `LearnerOnlyRoute`, not mounted per
route.** `LearnerSetupGate` wraps `/dashboard` alone, which suffices for a
redirect to a wizard. This gate cannot borrow that placement: "only Grade 7 may
use the learner app" has to hold for a deep link into `/quizzes`, a bookmarked
`/notes` and a notification into `/exams` too. `LearnerOnlyRoute` already runs
on every learner route, so composing there covers the surface without editing
thirty route lines — which the route-parsing guards read one line at a time.

**The server twin is `DAILY_EXAM_GRADES` (`functions/dailyExamPickerCore.js`)
and `test:learner-grades` fails if the two disagree.** Both directions are bad
and neither raises an error anywhere: a grade there and not in `LEARNER_GRADES`
has no learners who can reach it, and Vigil (`hourlyMonitor`) re-runs the
picker and reports the gap **every hour, forever** — which is exactly what was
happening for grades 4, 5 and 6 before this landed. A grade in `LEARNER_GRADES`
and not there opens to learners with no daily exam. `dailyExamPicker.test.js`
deliberately checks the list's SHAPE rather than re-pinning its membership;
membership belongs in the one test that compares it against something.

**Opening a grade** is: add it to `LEARNER_GRADES`, add it to
`DAILY_EXAM_GRADES`, and move the marketing copy (`Marketing.jsx`,
`AiTeam.jsx`, `Register.jsx`, `PrivacyPolicy.jsx`) with it. The tests are driven
off the config, so none of them need editing.

### Deleting a game is a Firestore act, not a catalogue edit (2026-08-19)

`/admin/games-seed` compares the curated SEED (`src/data/gamesSeed.js`, a
bundled array of 47 games) against the live `games` collection, and it now
does more than import: an admin can **deactivate** (record stays, learners
stop seeing it) and **delete permanently** (record gone). Those are two
actions and they stay two. So are **Clear selection** — which unchecks boxes
and reaches no Firestore call at all — and **Delete selected**; the old
button was labelled just "Clear", which reads as "clear the games" on a
screen that can now delete.

- **A deleted game LEAVES the list.** It moves to the `Deleted` tab, where
  it can be restored. The first version left it in place reading "Not
  imported" — true of the seed entry, and a straight contradiction of what
  the admin had just done: they deleted a game and the screen went on
  listing it. `filterRows` hides `STATUS.DELETED` from every view except
  its own tab; `buildRows` still returns it, because dropping it from the
  data would make restoring impossible.
- **The seed is never touched.** It is a file in the bundle, so a deleted
  game can always be imported again — from the Deleted tab, under the name
  `Restore` rather than `Import`, because undoing a deletion is not the
  same act as adding something new. That reversibility is a property of
  where the two catalogues live, not a promise the code makes.
- **Statuses are Live / Inactive / Not imported / Deleted / Unknown**, and
  two of them are load-bearing. A FAILED collection read must not render 47
  games as "Not imported", which would put an import over 47 live ones one
  click away — hence `Unknown`, under which the screen offers no action at
  all. And `Deleted` exists because "an admin removed this" and "nobody has
  imported it yet" are different facts that the screen has to treat
  differently; the status is resolved from `gameTombstones`, with a live
  document always outranking a stale tombstone.
- **`gameTombstones/{gameId}` is why deletion is visible to learners.**
  Four learner surfaces fall back to the bundled seed — the hub's catalogue
  rows (`buildCatalogue`), `PlayGame` (by id, which is what made a deleted
  game still launchable through an old direct link), the daily-challenge
  rotation and the duel's question bank (`DuelRace`) — so deleting
  `games/{id}` alone removes the game from the LIVE list and from nothing
  else. Every one of them passes `exclude`; a new seed-fallback caller must
  too. The tombstone is written in the same
  transaction as the delete, read once per page load
  (`src/utils/gameTombstones.js`), and **fails OPEN**: an unreadable list
  leaves the fallback unfiltered, because the fallback exists for exactly
  the outage that would make that read fail, and the Firestore document is
  genuinely deleted either way. Re-importing deletes the tombstone.
- **Learner history is never cascaded into.** Deletion removes
  `games/{id}` and `leaderboards/{id}` (a derived rollup of `scores`,
  rebuildable). `scores`, `badges`, `learner_profiles.recentGames`,
  `dailyStreaks` and duel `matches` are kept: a score row is a learner's own
  result and a public leaderboard row, and deleting a game is an editorial
  decision about the catalogue, not a statement that a child did not play.
  The tombstone carries `gameTitle`/`gameType`/`grade`/`subject` so a
  historical row stays readable — `scores` itself carries only
  gameId/grade/subject and that field set is pinned by `gameScorePayload.js`
  and validated in the rules, so it is not a place to add a title.
- **Authorization is the rules.** `games` create/update/delete and
  `gameTombstones` writes are `isAdmin()`; `<AdminRoute>` and the service
  functions are the client asking nicely. Both are now behaviourally pinned
  in `test-firestore-rules-emulator.mjs` (this is what moved `games` off the
  acknowledged-uncovered list).
- **Import is idempotent by construction** — the doc id is the seed id and
  the existence check is inside the transaction, so a double-click, a stale
  tab or two admins at once converge on one document. An existing game is
  SKIPPED rather than merged over, because writing over an inactive one
  would silently re-activate it.

Decisions live in `features/games/lib/gamesSeedAdminCore.js` (statuses,
filters, the mixed-selection partition, confirmation copy, result counts,
and `DELETION_PLAN` — the reviewable list of what deletion touches). Tests:
`test:games-seed-admin`, `test:games-seed-fallback`, `test:rules-text`,
`test:rules-emulator`, plus `GamesSeedAdmin.spec.jsx`.

### The daily quiz is five questions, and there is one way to read it (2026-08-19)

The Daily Quiz replaced the **Daily Exam rotation**. The old mechanism pinned
one whole published exam paper (`questionCount >= 50`) per grade per day by
flipping fields on a `quizzes` doc, and when `autoPickDailyExams` found nothing
eligible for a grade, Home said **"No quiz today"** with nothing behind it. A
rotation over whole papers has no smaller unit to fall back to.

**One document per grade per day, and everyone in the grade gets the same
five.** `dailyQuizzes/{grade}_{YYYY-MM-DD}` holds five question IDs drawn from
the approved question bank (`masterEligible == true`). That sameness is the
design, not a limitation: a personalised daily quiz cannot be ranked — you
would be comparing a child who drew easy questions with one who drew hard ones.
Personalisation belongs in Quizzes and Practice, which are already adaptive.

**The pick is SEEDED, so races and self-heals cannot disagree.** Every random
choice comes from a PRNG seeded with `hash(grade|date)`
(`functions/dailyQuiz/dailyQuizCore.js`). The nightly cron, the lazy self-heal
and two simultaneous self-heals all produce the identical five, so generation
is idempotent by construction — there is no "two learners triggered it and got
different quizzes" bug to have. `seededShuffle` sorts by id BEFORE shuffling,
because a stable seed over Firestore's unstable result order is still unstable.

**Selection rules, and the ladder when they cannot all hold:** approved only →
not served in this grade's last 30 days → subject spread (Maths and English
every day, the other three slots rotating by weekday through whatever subjects
the grade's pool actually has) → difficulty 2 easy · 2 medium · 1 hard → seeded
pick. When the pool cannot satisfy everything, rules relax in REVERSE order —
difficulty, then subject, then freshness LAST (a repeat is the most visible
failure) — and `rulesRelaxed` records which bent. Only a pool that cannot yield
five at all is `status: 'thin'`.

**`getTodaysQuiz` is the ONE read path, and `firestore.rules` is what makes
that structural.** Every client read of `dailyQuizzes` is denied — admins
included — so the callable is the only way in. That closure matters twice: the
console previews FUTURE dates, so a readable collection would hand a learner
tomorrow's quiz tonight, and the question IDs point into `questionBank`, which
any verified teacher may read for Master-Bank rows. The learner's GRADE comes
from their profile server-side and is never a parameter.

**The cron is an optimisation, not a dependency.** `buildDailyQuizzes` runs at
00:05 Africa/Lusaka; if it misses, the first learner to open the app builds the
document inside a transaction and everyone else gets the same one. A dead cron
must never surface to a learner as "no quiz today". Vigil still checks
hourly — not to rescue learners, but to build a missing day before one pays
the latency, and to escalate a THIN bank, which is the one thing a self-healing
system would otherwise hide completely.

**Feedback is immediate and it is the SERVER's.**
`answerDailyQuizQuestion` marks ONE question and returns the verdict plus a
line of why. The key for a question comes back only once the learner has
committed to an answer for it, which leaks nothing; answers are final, so a
repeat call returns the recorded verdict rather than re-marking. The attempt
FINALISES on the last answer — score, bonus and the leaderboard write happen in
that call, so there is no separate submit to lose. The client sends the chosen
option and nothing else; `test:daily-quiz-scoring` pins that as a list of
fields the handler must never grow, because "we ignore it" is a claim about
absence.

**`dailyAttempts/{uid}_{date}` is the attempt AND the once-a-day lock** — being
keyed uid+date is what makes it the lock, and the transactional create is what
enforces it. **No countdown is ever shown**: elapsed time is recorded only as
the leaderboard tie-break. The week shows **days played out of seven**, never a
streak that resets to zero and tells a child they ruined something.

**The only honest empty state.** A `thin` bank returns a labelled PRACTICE set
(`ranked: false`) drawn from the same pool with every rule but the grade
dropped, preferring the learner's two weakest subjects. It is refused by the
scorer, so `ranked: false` is true rather than decorative. "No quiz today" with
nothing to tap is unreachable — `test:daily-quiz-view` asserts that no input
produces it.

**Unapproved learners play but do not rank.** `mayRank` resolves the guardian
consent gate to a boolean rather than throwing: a refusal costs the child their
rank, never their quiz, per `/child-safety`. It fails CLOSED.

**Post-lock errors are VOIDED, never edited.** Once one child has answered,
changing a question would rank learners against different quizzes. Voiding
credits every player its ten points, re-credits the attempts already filed, and
tells the learner the question was removed. `canEditQuiz` enforces both locks —
the 23:00 clock and, outranking it, "has anyone played", which is read live
rather than from a flag.

**The console is `/admin/daily-quiz`** (staff only, `Disallow`d in robots.txt):
tonight's run + Run now, the read-only funnel, tomorrow's preview + voiding,
bank health, and the event log. **Runway** (eligible ÷ 5 = days left) is what
actually prevents an empty card — the self-heal covers a dead cron, but nothing
covers a starved bank except noticing weeks early, so below 30 days the content
team is emailed once per grade per month. A failed count reports `unknown`,
never zero.

**`DAILY_QUIZ_GRADES` (`dailyQuizCore.js`) is the server twin of
`LEARNER_GRADES`**, guarded by `test:learner-grades`. It replaced
`DAILY_EXAM_GRADES`.

**What survived the retirement, and why exactly that much.** `ExamResultsPage`
(`/exam-results/:attemptId`), `exam_attempts` and its grader stay: a learner's
past attempts are their record and the attempt link is the only way back to
one. `/exams` and `/exam/:examId` are redirects into `/daily`; that page is
deliberately not one. **`npm run retire:daily-exams:dry` must be run once** —
the retired cron's demote half went with it, so whatever was pinned on its last
morning is pinned forever, and a `daily_exam` quiz's questions are unreadable
by clients.

Tests: `test:daily-quiz-core`, `test:daily-quiz-view`, `test:daily-quiz-week`,
`test:daily-quiz-scoring`, `test:admin-daily-quiz`, `test:learner-grades`,
`test:rules-text`, `test:rules-emulator`, plus `DailyQuizPage.spec.jsx`.

### The Ask Zed chat assistant was removed (2026-08-20)

The learner-facing AI study chat is gone in full: `/ask-zed`, the floating
"Ask Zed" pill that mounted on every signed-in screen, the inline "Stuck? Ask
Zed about this" pill in the note reader, the AI Learning Assistant settings
section (`AiPanel` + `ZedAiPanel` + `AiFab`) and its `learnerSettings.zedAi` /
`learnerSettings.aiAssistant` prefs, the `aiChat` callable, the `apiAiChat` SSE
endpoint and its `/api/ai/chat` hosting rewrite, `functions/chatHandlers.js`,
and `sendAIChat` / `sendAIChatStream` in `src/utils/aiAssistant.js`.

**What deliberately stayed, and why each:**

- **`src/utils/aiAssistant.js` itself.** Fifteen modules import it — quiz
  import, note import, the quiz editor, the Assessment Studio, answer
  explanations. Only the two chat exports were Zed's.
- **The Zed MASCOT.** The character carries Race Zed, the games hub, GradeHub
  art, the setup wizard, the notes reader tip boxes, notifications and the
  marketing hero. It is not the chatbot and was explicitly kept.
- **`CAPABILITY.AI_CHAT` in the consent taxonomy.** It now gates NOTHING —
  same treatment `SOCIAL` got when learner classes went — so consent records
  already stored against it keep their meaning, and a future conversational
  surface has to claim an existing capability rather than invent a sixth.
- **`learnerSafety/` and `contentModeration.js`.** Generic screening with no
  caller today; kept for the next surface a learner types into.

**What went with it and is worth knowing.** The guardian `askZed` CONTROL and
the `askZed` LINK PERMISSION were removed — a switch that governs nothing must
not be drawn — which leaves **no control claiming `enforcement: 'server'`**;
the test that keeps that claim honest is now vacuous by design rather than
deleted. The one in-app child-safety reporting path was the Report control on
each AI response, so `/child-safety` now points at Settings → Help & support →
"Report a problem" (`ContactDialog` → `contactMessages`), which is a real
surface. `softVerifyAppCheckHttp` has no callers left, so no HTTP path reports
an `invalid` App Check token separately any more.

**Stored data was not migrated.** `learnerSettings.zedAi`,
`learnerSettings.aiAssistant`, `guardianControls.askZed` and
`parentLinks.permissions.askZed` remain on existing documents and are simply
never read. Chat transcripts never existed server-side — the chat kept history
in `sessionStorage` for the tab.

Re-adding a chat assistant is a new design decision, not a revert.

### There is no learner↔teacher link (removed 2026-08)

Learners and teachers have **no connecting surface**. A teacher cannot reach a
learner's account and a learner cannot attach themselves to a teacher. The
invite-code class feature that did this — `classes` / `classInvites` /
`assignments`, `/classes/*` + `/teacher/classes/*`, the eleven callables in
`classManagement.js` + `classAnalytics.js`, the quiz Assign step and its
wizard, and the "From your teacher" learner card — was deleted in full, and its
production data with it (`npm run cleanup:classes:dry`, then `:live`).

Three things keep it closed, and each fails loudly rather than quietly:

- **The three collections have NO match block in `firestore.rules`.** That is
  the closure, not an oversight: Firestore denies every client read and write
  to a path no rule matches. Deny-by-absence cannot be weakened one `allow` at
  a time the way a deny-block can, and `test:rules-text` fails if a block for
  any of the three reappears.
- **Quiz status has no `'active'`.** `deriveQuizStatus` (now
  `src/utils/quizStatus.js`, moved out of the deleted `quizAssignments.js`)
  took an `activeAssignments` count and returned `'active'` for a published
  quiz that was assigned to a class. Nothing can assign, so the status is
  unreachable and `QuizStatusBadge` no longer renders it. The editor is a
  three-step wizard: create → preview → publish.
- **A Class Register roster holds names, not accounts.** `classRegisters` is a
  *different*, teacher-only collection and survives untouched — but its
  "import from existing learner accounts" tab is gone, because it sourced its
  list from the invite-code classes. Roster entries are typed, pasted or
  uploaded. The `linkedUid` field remains on the schema for rosters that
  already carry one (SBA cross-year matching reads it); nothing writes a
  non-null value any more, and `cleanup-classes.mjs --clear-linked-uids`
  clears the residue.

Consequence worth knowing: the `social` guardian-consent capability now gates
nothing, since learner class-join was its only consumer. It stays in the
consent taxonomy (`functions/shared/consent/guardianConsentCore.js`) so stored
consent records keep their meaning.

If a future feature needs teachers and learners connected, it is a new design
decision — do not restore this one.

### One gating service — `src/services/entitlements/`

Every lock, quota, chip and unlock sheet reads from here, and nothing else may
decide gating. The mount-time "Your Premium has ended" interstitial is **gone**
— deleted outright, not delayed or shrunk — and must not come back in any form.

Two rules override everything else in this area:

1. **No gate ever interrupts work in progress.** Locks live at boundaries — the
   end of a set, the end of a session, a tapped padlock. Screens declare
   themselves with `useActivity('quiz_active')`; `interruptionBudget.canShow`
   refuses while the stack is non-empty.
2. **Feedback on work already done is never charged for.** Marking, wrong
   answers and weak-topic advice for questions the learner has answered are
   free on every plan, permanently. `AUTO_MARKING` covers papers beyond the
   free set and must never sit in front of a free set's own results.

- **`gates.js`** is the registry — a gate declares its quota, tier, icon and
  copy, and nothing may be locked without an entry. **`planState.js`** is pure:
  grace is DERIVED (`expired && now < expiresAt + 3 days`, everything unlocked),
  `ageBand` fails closed (a learner is `under18` unless `isMinor === false`), and
  **every quota must expose a `resetsAt`** — a lock that cannot say when it lifts
  renders nothing rather than rendering bare.
- **Under-18 learners are never shown a price.** `useUnlockFlow` routes them to
  `GuardianAskSheet`, which imports no pricing module at all — the guarantee is
  structural, not a conditional. The ask goes to `requestGuardianUnlock`
  (`functions/guardianUnlock/`), rate-limited to one per learner per 72 hours
  **server-side** (`users.guardianUnlock` is on the rules blocklist). Message
  order is fixed by `functions/shared/guardian/guardianMessageCore.js`:
  evidence → the ask → exam countdown → price. Never price first.
- **The in-paper free set never walls the learner.** `PublicQuizRunner` ends the
  RUN at the free-set boundary and goes to the results screen; the offer is an
  inline `PaperContinueLock` below the free score, free review and free weak
  topic. Answers are written to a local draft BEFORE the results render (the
  route's zero-Firestore-write property is unchanged — see
  `features/papers/lib/paperAttemptDraft.js`). Papers declare
  `freeSet: { toQuestion, sectionId }` landing on a section boundary.
- **Surfaces live where their consumers can reach them without the checkout.**
  The subscription front door eagerly exports `UpgradeModal`; `PlanChip` and
  `LockedCard` are in `src/shared/components/`, `PaperContinueLock` in
  `features/papers/`, and `UnlockSheetHost` / `GraceRibbon` are lazy route
  mounts in App.jsx. `MomentOfWinModal` exists and is tested but is **not
  mounted** — it is Part 9 of the rollout and has no trigger site yet.
- Prices are data (`src/config/plans.js`, joined to the checkout catalogue by
  `checkoutPlanId` and guarded by `test:entitlements`); the exam countdown is
  one constant (`src/config/examDates.js` ← `PSLE_2026.startsAt`, mirrored
  server-side and guarded).

Tests: `test:entitlements`, `test:guardian-unlock`, plus the Vitest specs beside
each surface (`ContextualUnlockSheet`, `MomentOfWinModal`, `FreeSetResults`,
`FreeSetMeter`, `paperAttemptDraft`, `PublicQuizRunner.freeset`).

### Three AI surfaces, each on a different model

- **Generators (lesson plan, worksheet, flashcards, scheme of work, rubric, notes, homework, assessment, quiz)** — Cloud Functions in `functions/teacherTools/*`. Each tool is a pair of `<tool>Prompt.js` + `<tool>Schema.js` plus a `generate<Tool>.js` runner. They all share `aiService.callAnthropic` (Sonnet 4.5 by default; override per-runtime with `ANTHROPIC_MODEL`). Two-layer caching: Anthropic prompt caching for the system prompt + CBC-context caching via `teacherTools/cbcKnowledge.js`'s `resolveCbcContext()`. Per-user daily caps live in `usageMeter.js` and write to `aiUsage/{uid}_{day}` / `usageMeters/`. Super-admins bypass the meter (see PR #512).
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
| **Vigil** (`hourlyMonitor`, runner `monitor.js`) | hourly | checks pages/Firebase/images/quizzes + today's daily quiz per live grade (builds a missing one so no learner pays the self-heal, and escalates a THIN bank — the one thing self-healing cannot fix); on failure asks Haiku for fixes, emails + files a GitHub bug issue → Mendi |
| **Marshal** (`hourlyAgentSupervisor`, runner `marshal.js`) | hourly | the watchdog-of-watchdogs: confirms every scheduled agent that writes a predictable rollup actually ran in its window, surfaces stuck jobs / tripped breakers / recent failures into a single company-health verdict for the `/admin/company` HQ (files an `awaiting_approval` job when something's wrong). Deterministic, no LLM |
| **Till** (`hourlyRevenueReconcile`) | hourly | re-queries Lenco for stale "pending" payments; finishes what a dropped webhook missed via the idempotent activation path |
| **Echo** (`supportTriage`) | every 2h | classifies + prioritises new feedback + public `contactMessages`, drafts replies (Haiku) — never sends |
| **Gate** (`contentAutoPublish`) | every 30m | auto-approves content jobs passing a strict bar; OFF unless `agentControl/content.autoPublish === true` |
| **Compass** (`weeklyProductSignal`) | Mon 06:00 | deterministic "what to build next" backlog from quiz/exam attempts |
| **Anchor** (`weeklyRetentionScan`) | Mon 07:00 | finds learners who went quiet 14–45d ago + drafts a win-back nudge |
| **Dawn** (`deliverDawnBriefings`/`runDawnBriefing`) | on-demand | Claude Managed Agent morning briefing; "Run Dawn now" button in `/admin/agents` |

**Vex** bypasses the whole pipeline (synchronous callable from the quiz editor); **Qix** (see above) runs off its own `questionBank` trigger rather than `agentJobs`. **Mendi** (bug-fixer) is a subagent invoked from CI on a `bug` label. **Ledger** (release notes) runs on a GitHub Actions **daily cron** (22:00 Africa/Lusaka) and **calls no model** — it assembles the changelog from commit subjects, so the workflow holds no Anthropic secret. Two things were fixed in 2026-08: it had been a silent no-op for months (`git log --merges` selects nothing on a squash-merged trunk, so it exited before its API call), and once fixed to walk `--first-parent` the model turned out not to be earning its keep — only 39% of commits carry a conventional prefix and 15 of those 21 were Dependabot, while the unprefixed 61% are already well-formed sentences, so it was paraphrasing good prose into different good prose. It now buckets what has a prefix, prints the rest VERBATIM under `Changed`, and collapses Dependabot to one line; the draft PR reports how many entries were classified versus merely listed. Invoke the `release-notes` subagent on a drafted section when a release actually wants polish. Rules + rendering are pure and tested in `scripts/agents/releaseNotesCore.mjs` (`test:release-notes`). **Rex** (code review) is on-demand ONLY — his per-PR GitHub Action was deleted in 2026-08 because it billed the Anthropic API on every push to a PR branch while never being a required check, and because required CI already enforces four of his five checks deterministically (`test:secret-hygiene`, `test:rules-text`, `test:ai-provider-inventory`, `test:ai-dev-guide`). Invoke the `code-reviewer` subagent when you want him; that runs on the session, not on the agents key. Do not re-add a per-PR action without a cost decision. **Security Review** (`security-review.yml`, Anthropic's `claude-code-security-review` action) went opt-in the same way in 2026-08: apply the **`security-review`** label to a PR to run it, or `workflow_dispatch` to re-run one; remove and re-apply the label to re-scan after a fix. Nothing else starts it, so an unlabelled PR costs nothing. `test:security-review-trigger` fails if an automatic trigger comes back or if the label in the workflow drifts from the one documented here.

**THE REPOSITORY IS PUBLIC AGAIN (since 2026-08-19).** It was private for one
day (2026-08-18 → 2026-08-19). Three consequences, and the reason the flip back
happened:

- **Actions minutes are FREE again.** Private billing is what forced the flip
  back: one CI run billed ~36 minutes across its ten jobs, so at the historical
  cadence (~30 runs/day) the 2,000-minute free allowance was exhausted inside
  two days, and every job account-wide then died in under 10 seconds against a
  $0 spending limit. On a public repository minutes are unmetered, so adding a
  job is a wall-clock decision again rather than a spend decision. **The Vitest
  sharding introduced while private (#2503) stays** — it is a straight
  wall-clock win at zero cost now, not a workaround.
- **Standard runners are 4-vCPU/16 GB again** (private drops to 2-vCPU/7 GB).
  That single change is what doubled CI: the Vitest job, the one that saturates
  every core, went 5m16s → ~13m40s and back. See `ci.yml`'s Vitest timeout
  comment — that job's wall time tracks the runner's core count and nothing
  else.
- **GitHub secret scanning and push protection are ON again.** They are free
  only on public repositories. `test:secret-hygiene` in CI is no longer the only
  backstop between a pasted key and `main` — but it is still the one that runs
  at commit time in spirit, so do not weaken it.

**`GITHUB_TOKEN` scopes: keep declaring them.** Every
`/repos/{owner}/{repo}/actions/...` endpoint is anonymously readable on a public
repository, so a job calling one is answered whatever its `permissions:` block
says. Privately the same call is 403 — which took production Hosting down for
two commits on the day of the private flip (`deploy-hosting.yml`'s "Wait for
Deploy Firebase run" step declared only `contents: read`, and being gated on
`firebase_changes.required` it failed only on pushes that also touched
`firestore.rules` / `firestore.indexes.json` / `functions/`, so runs #2160 and
#2161 looked like a new bug rather than a config gap of long standing).
`test:workflow-api-permissions` still fails the build if a workflow calls the
Actions REST API without granting `actions`, and it should: **an unstated
permission is not a grant, it is only unenforced while the repo is public.**
Going private again must not be able to break deploys a second time.

**Vulnerability scanning is automatic again.** `codeql.yml` (+
`.github/codeql/codeql-config.yml`, `test:codeql-scope`) was deleted when the
repo went private, because code scanning needs GitHub Advanced Security there
and the workflow failed to *start* on every PR — a permanently red check that
examines nothing is worse than no check. It is **restored** now that it is free
again. It is NOT a required check and must not become one: code scanning reports
against the whole repository, so a pre-existing alert unrelated to a PR would
block that PR. Read the Security tab; do not gate on it.

So the security surface is:

- **CodeQL** (`codeql.yml`) — automatic taint analysis on every PR to `main`,
  plus a Monday baseline refresh. Findings land in the Security tab.
- **`security-review` label** — Anthropic's reviewer (`security-review.yml`),
  opt-in per PR, complementary to CodeQL: it reads one diff and can reason about
  authorization semantics ("this callable never checks the caller's role") that
  taint analysis cannot. **Label anything touching auth, Firestore rules,
  payments, user input, or a new external surface.** Note it is triggered by
  `pull_request`, so a **fork** PR gets no secrets and the job cannot run — that
  is correct (it fails closed rather than leaking the key), but it means a
  contributor's PR is never AI-reviewed.
- **Deterministic CI** — `test:secret-hygiene`, `test:rules-text`,
  `test:storage-rules-text`, and the Firestore/Storage rules emulator jobs.
- **GitHub secret scanning + push protection** — free again, blocking a
  credential at push time.

**Public-repo hazard to keep in mind: fork PRs and issue triggers.** No workflow
uses `pull_request_target`, and both of `agent-bug-fixer.yml`'s paths are
guarded — the `/mendi` comment path by an `author_association` allowlist, and
the `bug` label path by GitHub's own permission model (labelling needs triage
access, which the public does not have). **Keep it that way**: any new workflow
that runs on `issue_comment`, `issues`, or `pull_request_target` is reachable by
anyone on the internet and must carry an equivalent guard before it touches a
secret or gets `contents: write`.

The full agent roster (including departments + invocation modes) is the single source of truth in `src/config/agents.js`; keep it and [`ORG.md`](./ORG.md) in sync when you add one.

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

**Sentry does NOT observe Cloud Functions, and is not going to (#2230).**
`Sentry.init` lives only in `src/utils/sentry.js`; nothing under `functions/`
references it. That gap was found the expensive way: `apiTrackVisit` burned 80
ERRORs in a 2h window — 100% of the server-side error volume — while Sentry
reported **zero** across the same window. So *"Sentry is clean, therefore the
backend is healthy"* is an unsupported inference; Sentry is frontend telemetry
and cannot see a Cloud Function failing.

**Nor does Sentry see an Android native crash or an ANR** — same shape of gap,
different edge. Sentry runs inside the Capacitor WebView, so it observes
JavaScript; a crash in the native wrapper/plugin layer, or an ANR where the
platform kills the process, never reaches a JS handler. **Firebase Crashlytics**
covers those on the Android build (added 2026-08-16, wiring and the reason the
Gradle plugin is applied conditionally are in
[`docs/ANDROID-RELEASE.md`](docs/ANDROID-RELEASE.md)). Note that **no required
check compiles the Android project** — the node CI jobs have no Android SDK — so
a change under `android/` is verified by dispatching `android-debug-apk.yml`,
not by a green PR.

The decision is that server-side errors reach ops through **Cloud Logging, not
Sentry**, watched by **`functionErrorWatch`** (`functions/monitoring/`, every 5
minutes over a 7-minute window, #2235). It is a monitoring function rather than
one of the `agents/` fleet, so it has no roster entry — see
`docs/architecture/13-cloud-functions-register.md`. Memory kills alert on a
SINGLE occurrence (a function over its limit is dead, not degraded); everything
else alerts on a sustained rate grouped by function, with a per-function
cooldown and a one-shot RECOVERED notice. Wiring
Sentry into `functions/` would not have caught this incident: an OOM kill is a
platform action, not a thrown error — the container is terminated, so no
`beforeSend` or `uncaughtException` handler ever runs. The same is true of a
hard timeout kill and of a 503 from an instance that never finished starting,
which between them were the whole outage. Only the platform's own log stream
sees those. (Secondary, and specific to this repo: every v2 instance already
loads all of `functions/index.js` at ~148 MiB RSS before serving a request, and
an always-on APM agent across 193 exports raises exactly the startup cost that
caused the bug.) If a future change wants per-exception backend tracing on top
of this, that is an addition to `functionErrorWatch`, not a replacement for it.

The rule it is built around, worth keeping if it is ever rewritten: **a query
failure is never reported as "no errors."** An unreadable log window alerts that
monitoring is BLIND and reports health UNKNOWN, because a tool that cannot see a
failure reporting silence is the bug, not the fix. A blind run also leaves the
state document untouched, so a failed read cannot reset every streak and
cooldown.

**Proving it end-to-end:** `sendTestFunctionErrorAlert` (admin drill, wired into
the `/admin` OpsAlertTester panel) injects a synthetic memory kill and runs the
REAL watch, so a pass proves classifier → thresholds → channel → secret
bindings, not merely that the mailer works. `firedThroughRealPath: true` is the
field that says the whole path fired.

A second watcher (Sift, `hourlyServerErrorWatch`) was built for the same issue in
parallel and retired the day it landed — do not re-add one. Two watchers on the
same log stream page twice for one incident.

**Proving it rings:** `/admin` → Developer tools → **Test the ops alarm**
(`sendTestOpsAlert` + `OpsAlertTester.jsx`) fires one real `info` alert down both
channels and reports each separately, naming the reason a silent channel was
silent. Three verdicts — `both` / `one` (delivered, but the redundancy is gone) /
`none`. Throttled to one per admin per 5 minutes. It is what caught #1991 on its
first press. Tests: `test:ops-alert`, `test:ops-alert-secrets`,
`test:ops-alert-test`, `OpsAlertTester.spec.jsx`.

### A cross-service read in a rules predicate cannot be validated by the emulator

**Any rules change that adds a `firestore.get` / `firestore.exists` to a SHARED
predicate cannot be proved safe by the emulator, and needs a post-deploy
production check.** The emulator runs Firestore locally, in-process, so a
cross-service read always resolves there. A green `Tests (Storage rules
emulator)` job says the rule is *logically* correct and says nothing at all
about whether the lookup resolves in production — which is the only way this
class of change fails.

That is not hypothetical. #2258 wired a `notBeingDeleted()` account-deletion
gate into `storage.rules`' `isVerified()`, which every path in that file runs
through, putting an unconditional cross-service `firestore.exists()` on 100% of
Storage rule evaluations. It stopped resolving, every arm collapsed closed, and
**uploads were down across the entire product for five days** — including on
paths that require no role at all. Both rules emulator jobs were green
throughout. #2399 took it off `isVerified()`; the follow-up removed the function
outright and replaced the guarantee with cleanup off the request path
(`functions/account/accountPurgeResweeper.js` — see below).

Three things now catch it:

- **A Cloud Monitoring alert, "Storage security rules erroring (Zedexams)"**,
  which fires within the hour. This is the backstop that would have turned five
  days into one, and it is the reason a post-deploy check is a check rather than
  a vigil.
- **`test:storage-rules-text`** pins `isVerified()`'s exact shape — `isAuthed()
  && (tokenEmailVerified() || inVerificationGrace())` — and fails on the
  tombstone lookup returning in any form. Text, not behaviour, precisely because
  the emulator cannot see this.
- **The short-circuit is the pattern to copy.** `inVerificationGrace()` DOES make
  a cross-service read and is fine, because it sits behind a `||` that a verified
  user never reaches. A term appended with `&&` executes on every request. If a
  new predicate genuinely needs cross-service state, put it behind a
  short-circuit that the common path skips — or move it off the request path
  entirely, which is usually the better answer.

**And a rules gate is often the wrong tool regardless of cost.** It can only
refuse a NEW write. The deletion gate above did nothing about objects already
written between the purge enumerating the bucket and the gate taking effect,
which was most of the leak it was written to stop. Cleanup after the fact covers
both ends of the window and cannot take the product down.

### Deleting an account: the Storage re-sweep

`revokeRefreshTokens` + `deleteUser` stop a session being RENEWED; neither
invalidates an ID token already minted, and those live **60 minutes**. So for up
to an hour after an account is destroyed, a tab still holding one can upload —
landing after the auth-delete cascade (`storageCleanup/onUserDeleted.js`) already
walked the bucket.

`openPurgeJob` therefore stamps every tombstone with `resweepAfter = now + 75
minutes` (60 min token + 15 min slack) and `resweepDone: false`, and the
`accountPurgeResweep` cron (every 15 min) re-enumerates that uid's Storage
prefixes and deletes whatever landed. Three things worth knowing:

- **`USER_KEYED_PREFIXES` (`functions/storageCleanup/helpers.js`) is the ONE
  list.** Three sweeps read it — the auth-delete cascade, the orphan reaper, and
  this re-sweep. Add a prefix there and all three cover it; a second list
  somewhere would leave one of them silently behind.
- **The re-sweep requires `phase === "irreversible"`**, and that guard is
  load-bearing rather than tidy. A tombstone can carry `resweepDone: false` and
  describe an account that was never deleted — a cancelled deletion, or one that
  crashed before the point of no return — both of which leave the user **signed
  in**. Without the marker the re-sweep would delete a live teacher's papers,
  images and invoices.
- **It is a separate function from `accountPurgeSweep`**, which retries failed
  *Firestore* purges daily on a `status == "pending"` query. This one queries
  `resweepDone == false` every 15 minutes and the jobs it wants are almost all
  `done`. Merging them would mean running the heavy purge retry 96× a day.

### Hosting + Functions wiring

`firebase.json` rewrites `/api/*` straight to specific `onRequest` Cloud Functions in `us-central1`. This is how SSE endpoints (lesson plan stream, worksheet stream) avoid CORS — the browser hits same-origin `/api/...`, Hosting proxies to the function. New API endpoints need both the function export in `functions/index.js` AND a rewrite entry here.

### Firestore offline + multi-tab

`firebase/config.js` enables `enableMultiTabIndexedDbPersistence` so the app survives offline and shares cache across tabs. Failures (Safari < 15, private mode, quota) are non-fatal — code paths must still handle a fresh-fetch round-trip. Firestore writes queue while offline and replay on reconnect.

### The SDK deletes a working session at boot, and we refuse it (2026-08-19)

On every cold start Firebase Auth re-verifies the persisted user before it will
hand it back, and `reloadAndSetCurrentUserOrClear` keeps the session for
**exactly one** error — `auth/network-request-failed`, which is raised only when
the `fetch` itself rejects. Every other outcome deletes
`firebase:authUser:*` from IndexedDB before `onAuthStateChanged` has fired once:
a 429 (`TOO_MANY_ATTEMPTS_TRY_LATER`, and the limit is **per project**), a 5xx,
a 403 from App Check or an API-key restriction, a 200 whose `users` array is
empty (`auth/internal-error`), or any server string the SDK has no mapping for.

None of those is a statement about the credential, all are transient, and
because the rate limit is project-wide they hit admins, teachers and learners in
the same window. That is the reported bug: reload signs you out, and a session
left alone drops on its own when the next refresh lands badly.

**The app's own policy never got to run.** `hooks/authInitRetryPolicy.js` argues
carefully that network failures, rate limits and timeouts must keep the stored
user — and the SDK had already destroyed it, so the failure arrived as an
ordinary `user === null`, indistinguishable from a real sign-out.

Note what #2480 (the `visibilitychange` persistence patch,
`authPersistenceLifecycle.js`) did and did not fix. PYTHON-K's stack is
`_openDb` throwing **inside `removeCurrentUser`** — the SDK had *already* decided
to clear. That patch stopped the crash during the removal; it turned a wedged
loader into a clean logout. The decision to clear is this section.

- **`firebase/authBootVerdict.js`** (pure, `test:auth-boot-verdict`) classifies
  the one exchange that decides it — `securetoken/v1/token` and
  `identitytoolkit/v1/accounts:lookup` — as `ok` / `terminal` /
  `infrastructural`. Only a recognised server verdict on the credential
  (`TOKEN_EXPIRED`, `USER_DISABLED`, `USER_NOT_FOUND`, …) is terminal;
  **unknown is not dead**, the same rule the retry ladder already states.
- **`firebase/authSessionGuard.js`** (`test:auth-session-guard`) is the
  mechanism: a fetch observer that classifies those responses (on a `clone()`,
  never the body the SDK needs), and a `_remove` guard on both persistence
  classes that no-ops a deletion of the persisted-user key when the verdict was
  not terminal. **Installed before `getAuth()`** in `firebase/config.js` — that
  order is load-bearing, since `getAuth()` starts the initialisation being
  guarded.
- **Both live only in the boot window** — module load to the first
  `onAuthStateChanged`. After it, ordinary sign-outs, another tab signing out
  and account deletion clear storage exactly as before, and `window.fetch` is
  the browser's own function again. `disarmAuthSessionGuard()` returns the
  outcome **and clears it**: a `preserved` flag left standing would still read
  true when the user later taps "Log out", and the provider would answer a
  deliberate sign-out by reloading them back in.
- **Refusing the removal does not put the user back** — the SDK's in-memory
  `currentUser` is already null. It keeps the session on disk so `AuthContext`
  can re-drive initialisation once (`SESSION_RESCUE_RELOAD_MS`, behind the same
  one-shot `auth:initRecoveryAttempted` flag the wedge recovery uses), holding
  the branded restoration screen rather than flashing /login. If the condition
  outlives that, the user signs in — which is today's behaviour. **The worst
  case is the status quo**, and that property is deliberate.
- Telemetry is its own event: `Auth boot check failed — stored session rescued`
  at `warning` with `auth.session_rescued`, so it never merges into PYTHON-N
  ("Auth initialisation never completed"), which is a different failure.

**The cause turned out to be our own App Check deferral, and two things now
answer it.** App Check enforcement is ON for Firebase Authentication, and
`scheduleAppCheckInit` put init on `requestIdleCallback` — so the boot check
`getAuth()` starts went out with **no `X-Firebase-AppCheck` header at all** and
earned `401 "Firebase App Check token is invalid."`. That 401 is not a verdict
on the credential, but the SDK reads it as one. Every reload is a cold load, so
every reload signed the user out.

- **A device holding a session does not defer App Check init.** `config.js`
  runs it synchronously when `hasAuthSessionHint()` is true. That works because
  `getAuth()` is synchronous but its initialisation resumes in microtasks, which
  cannot run until the module body finishes — and `initAppCheck()`'s **web path
  reaches `initializeAppCheck(app, …)` before its first `await`**, so the
  provider is registered before the boot request's headers are built. Adding an
  `await` above that call re-opens the bug silently. A signed-out visitor still
  defers: they make no verification request, so there is nothing to protect and
  no reason to put reCAPTCHA on their LCP path. The native path *does* await a
  dynamic import, which is why the second defence below is not optional.
- **`attestationDegraded()` counts MISSING attestation, not just a placeholder**
  (`setAttestationExpected` / `setAttestationArmed`). Before init there is no
  token, and an enforced backend answers that with the same 401 it gives a
  placeholder — so reporting "not degraded" there read a pre-init 401 as a dead
  session. Gated on a provider having been *expected* (a reCAPTCHA key shipped,
  or this is the native build) so a build with none configured is unaffected and
  its terminal auth errors still end a session. Both readers
  (`authRecoveryPolicy.shouldExpireSession`, `AuthContext`) use it only to AVOID
  ending a session, so widening it can only fail safe.
- **The observer AWAITS its classification** before handing the response back.
  It read the body on a `clone()` fire-and-forget, which raced the SDK's own
  error path to `_remove`; `shouldPreserveStoredSession` refuses a rescue on a
  null verdict, so losing that race deleted the session with no console line, no
  `preserved` flag and no telemetry. The cost is one JSON parse of a small body,
  on two URLs, during the boot window only.

### Passkey (WebAuthn) sign-in — REMOVED 2026-08-17

The passkey feature was removed in full on owner instruction: the login button, the Passkeys section in all three role security panels, the client service (`src/services/passkeyService.js` + `passkeyRegionCore.js`), the eleven callables (seven `us-central1` + four `africa-south1` twins), `functions/passkeys/`, the `@simplewebauthn/*` packages, the admin feature-flag toggle, and `docs/PASSKEYS.md`. Google + email/password sign-in are untouched. Three deliberate leftovers: (1) the four Firestore collections (`passkeyCredentials`, `webauthnChallenges`, `passkeyUserHandles`, `passkeyAuditLog`) keep their **deny-all match blocks** in `firestore.rules` so legacy data written while the feature was live stays server-only — do not open or delete those blocks while data remains; (2) `accountDeletion.js` still purges those collections so legacy credentials leave with their account; (3) the out-of-band GCP TTL policy on `webauthnChallenges.expiresAt` can be deleted at any time (challenges lived 5 minutes). Re-adding passkeys is a new design decision, not a revert.

### Service worker

VitePWA `generateSW` with `registerType: 'autoUpdate'` — the new SW activates + claims clients automatically. The already-rendered page crosses over at two safe moments (never a hard reload mid-operation): `public/sw-reload-clients.js` posts `SW_RELOAD_REQUEST` on activation → `usePwaUpdate` shows `<UpdatePrompt />`'s "Refresh now" toast; AND `<UpdatePrompt />` auto-applies the update on the user's next in-app navigation (`src/hooks/pwaAutoReload.js` — a route teardown point; imports/long ops don't navigate so they're never interrupted). `vite.config.js` has a post-build `firebaseMessagingSwConfig` plugin that substitutes `__FIREBASE_*__` tokens in `dist/firebase-messaging-sw.js` because the SW context can't read `import.meta.env`. On Capacitor the SW is not registered.

### App Check

Web uses reCAPTCHA Enterprise (via `ReCaptchaEnterpriseProvider`, silent unless score is low; migrated from reCAPTCHA v3). Android uses Play Integrity via `@capacitor-firebase/app-check`, looked up at runtime through `Capacitor.Plugins.FirebaseAppCheck` rather than `await import(...)` so the web build stays package-agnostic. Without `VITE_FIREBASE_APPCHECK_RECAPTCHA_KEY` (the reCAPTCHA Enterprise App Check key, distinct from the Android action-scoring key) the web init silently no-ops — fine for lint-only builds, dangerous for a real deploy.

**Init is deferred off the cold-start path for a signed-out visitor ONLY.** A device carrying the `auth:hasSession` hint initialises synchronously at module load, because App Check is enforced on Auth and the SDK's boot check would otherwise go out unattested and sign the user out — see "The SDK deletes a working session at boot" above before making that deferral unconditional again.

### Capacitor wrapper caveats

- Google sign-in popups don't work in Android WebView — use `signInWithRedirect` or `@capacitor-firebase/authentication`.
- Web reCAPTCHA App Check provider doesn't work in WebView; the Play Integrity provider must be configured before enforcement is turned on for Firebase AI Logic / Functions.
- `src/main.jsx` skips `registerSW()` on native — the bundled `capacitor://` origin makes the SW dead weight and `file://` blocks it.

### Schemas

Quiz/attempt/result Zod schemas live in `src/shared/schemas/` (moved there from `src/schemas/` on 2026-08-16 — the root directory is gone). There's also a parallel server-side schema at `scripts/test-quiz-attempt-schemas.mjs` for the migration tooling. The teacher-tool generators each have their own JSON schema in `functions/teacherTools/<tool>Schema.js` — they describe the LLM output shape, not Firestore docs.

## Conventions worth knowing

- **ESLint config is in `eslint.config.js`** (flat config). The file is heavily commented with the rationale for each rule. `no-unused-vars` exempts `caughtErrors` (lots of intentional `catch (err) {}`), `no-empty` allows empty catches, `eqeqeq` is `'smart'`. Tests + Cloud Functions get Node globals and `no-unused-vars` off.
- **Pre-commit hook** (`.husky/pre-commit`) only runs `scripts/check-file-integrity.mjs` against staged files — it does **not** run lint-staged or ESLint. The history of stash/restore cycles corrupting Windows-filesystem working trees is in the hook comments; don't switch it back without reading that. Run `npm run lint` manually before pushing if you care about CI-clean output.
- **lint-staged config exists in package.json** but is only invoked by lint-staged-aware tooling, not by the pre-commit hook.
- **Two test suites, split by filename.** (1) The original suite: every `*.test.js` / `test-*.mjs` file is a plain ES-module script invoked with `node` directly — throw on assertion failure, and add a `test:*` npm script whose command starts with `node`. **Do not edit `test:all` by hand** — it's `node scripts/run-all-tests.mjs`, which auto-discovers and runs every `test:*` script that is a `node` command (Vitest + emulator scripts are skipped because they aren't `node`). Adding the `test:*` key is enough; the runner picks it up. (This replaced the old single-line `&&`-chain that every test-adding PR appended to, which made any two such PRs collide on that one line.) This is still the right tool for pure logic, schemas, parsers, and Cloud Functions helpers. (2) Vitest (added for frontend coverage): files named `*.spec.{js,jsx}` run under `npm run test:unit` in jsdom — use these for React component/hook/behaviour tests via `@testing-library/react`. `npm run test:coverage` reports v8 line coverage of `src/` into `./coverage`. The two never collide: Vitest only collects `*.spec.*`, the node scripts are all `*.test.*`. Config is `vitest.config.js`; shared setup (jest-dom matchers + auto-cleanup) is `src/test/setup.js`.
- **Router is fully lazy.** Adding a new route in `App.jsx` means `lazy(() => import('...'))` + a `<Suspense fallback={<PageLoader />}>` if it's a new top-level branch. Don't import page components eagerly.
- **`<NavLink>` / `Navigate` use `getRoleLandingPath`** (`src/utils/navigation.js`) to send each role to the right landing page after auth.
- **The saved reading theme applies on every route, public pages included** (the old `PUBLIC_THEME_PATHS` pin was removed 2026-08 — it reset Midnight readers to the light brand default on /login, /papers, /pricing, …). Only the two internal review previews stay pinned (`isBrandPinnedPath` in `App.jsx`). Public/marketing surfaces must therefore stay Midnight-capable; `npm run contrast:routes` gates the key routes at WCAG AA in both dark themes.
- **A light reading palette VETOES the workspace dark seed — and a dark one imposes nothing.** The two palette systems are bridged one way: `html[data-theme='night'] body` in `index.css` restates every reading token in dark, and that selector beats `body.theme-<id>`, so whatever `data-theme` says wins. Both used to seed themselves from `prefers-color-scheme` independently, which meant that on any browser with neither key written and a dark OS (a second browser, Incognito, a fresh profile) the workspace attribute came up `night` for **learners too** — and a learner's only theme control writes the READING theme, so the Night toggle flipped the body class while the bridge kept overriding it: the page stayed dark with the toggle reading "day". **The rule is deliberately not symmetric, and #2524 → #2535 is why.** The first fix made an unchosen workspace theme *follow* the reading palette in both directions; that shipped, and because `<ReadingThemeSync>` syncs the reading palette to the ACCOUNT, anyone whose profile had ever recorded Midnight got a dark workspace on every browser whatever their OS said — teachers included. So `readingThemeCore.seededWorkspaceDarkness` can only ever turn a dark seed OFF: a light reading palette forces the workspace seed light; a dark one leaves the OS to decide exactly as it always did. A reading palette is a statement about the page a learner reads on, not a request to repaint the teacher workspace. `teacherThemeStore.syncSeededTeacherTheme` applies it on every reading-theme change and no-ops the moment a workspace theme is actually chosen — a teacher who picked Night keeps Night, which is what the bridge is for. The seed is never written to `localStorage`, so it keeps following rather than freezing. `boot.js` mirrors the same expression pre-paint. Tests: `test:reading-theme-core`, `test:teacher-theme-mirror`, `themeSeedLink.spec.jsx`.
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
