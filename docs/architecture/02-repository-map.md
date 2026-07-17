# 02 — Repository Map

> Snapshot as of 2026-07-17 — verify before acting. Audited commit `0cd4c49`.

ZedExams is a single Git repository containing the web SPA, the Cloud Functions backend, the Android Capacitor wrapper, and all supporting scripts/config. Two root `package.json` files exist: the repo root (frontend + scripts) and `functions/` (Cloud Functions, Node 22, separate deps).

Scale at audit time: **~1,491 files under `src/`**, **~150 files under `functions/`**, **~265 files under `scripts/`**.

## Top-level layout

```
/
├── src/                     React 19 SPA (Vite). See §04, §05.
├── functions/               Cloud Functions v2, Node 22, codebase=default. See §13.
├── android/                 Generated Capacitor Android project. See §17.
├── public/                  Static assets, service-worker helpers, boot.js.
├── scripts/                 ~265 node scripts: data migration, integrity, tests, agent harnesses.
├── content/                 Bundled content (blog posts, seed data).
├── docs/                    Existing docs + THIS architecture set (docs/architecture/).
├── resources/, distribution/, output/, qa-samples/   Build/QA artefacts.
├── .github/workflows/       CI/CD (ci, deploy-hosting, deploy-firebase, android-*, agent-*, security-review).
├── firebase.json            Hosting rewrites/headers/redirects + functions + emulators config.
├── .firebaserc              Firebase project alias: examsprepzambia.
├── firestore.rules          ~152 KB hand-written security rules.
├── firestore.indexes.json   ~38 KB composite indexes.
├── storage.rules            Storage security rules (~16 KB).
├── cors.json                Storage CORS (GET/HEAD, origin *).
├── capacitor.config.json    appId com.zedexams.android, webDir dist.
├── vite.config.js           Vite + VitePWA + firebase-messaging SW token plugin (~26 KB).
├── vitest.config.js         Vitest (jsdom) config for *.spec.{js,jsx}.
├── eslint.config.js         Flat ESLint config (heavily commented).
├── tailwind.config.js       Tailwind theme.
├── index.html / (app.html)  SPA entry (hosting rewrites ** → /app.html).
├── CLAUDE.md                Binding project instructions for AI sessions.
├── AI_DEVELOPMENT_GUIDE.md  Definition of Done / coding standards (CI-enforced).
├── ORG.md                   Agent "AI company" org chart + budgets.
└── BUG_REPORT.md            Single curated "what's broken now" doc.
```

## `src/` structure

```
src/
├── App.jsx                  Router (all routes; §03).
├── main.jsx                 Entry: ErrorBoundary > AuthProvider > ThemeProvider > DataSaverProvider > PlatformSettingsProvider. Skips SW on native.
├── firebase/
│   ├── config.js            Firebase init: auth persistence, App Check, multi-tab IndexedDB, FCM.
│   └── ai.js                Firebase AI Logic (Gemini) client.
├── contexts/                AuthContext, ThemeContext, DataSaverContext, PlatformSettingsContext.
├── components/
│   ├── admin/               /admin/* pages + agents/ + company/ + users/ + settings/ + announcements/.
│   ├── ai/                  ZedChatLauncher, ZedChatPage.
│   ├── auth/                Login, Register, AuthAction, VerifyEmail, LearnerOnlyRoute, MissingProfileRecovery.
│   ├── layout/              Navbar, ProtectedRoute, TeacherLayout, ParentLayout, AdminLayout.
│   ├── dashboard/           GradeHub, StudentDashboard, MyResults, BadgesPage, ProfilePage, calendars, timetable viewer.
│   ├── exams/               Daily exams hub/runner/results/leaderboard.
│   ├── games/               Games hub + engines.
│   ├── lessons/             Slide lessons (editor/dashboard/player).
│   ├── quiz/                QuizList, EditQuizV2, QuizRunnerV2, QuizResultsV2, importers.
│   ├── teacher/             TeacherDashboard, studios, generate/*, classes/, register/ (+ attendance/), curriculum/, library/, templates/.
│   ├── papers/              Past papers hub/viewer/practice/history.
│   ├── parent/              Parent portal + family portal pages.
│   ├── classes/             Learner class join/list/detail.
│   ├── subscription/        PaywallHost, MySubscriptionPage, LockedFeatureModal, popups, NativePlayBillingSync.
│   ├── settings/            zedexams-settings (shared/admin settings).
│   ├── ui/                  Shared UI incl. LiveGenerationCanvas, PageLoader, ErrorBoundary.
│   ├── diagrams/            Diagram rendering + leader-line label layer.
│   └── banners/, native/, notifications/, marketing/, blog/, seo/, search/, feedback/, draft/
├── features/                Feature-folder pattern (pages/components/services/lib):
│   ├── notes/               Notes Studio (admin authoring + learner reader).
│   ├── lessons/             LearnerLessonsList etc.
│   ├── visualStudio/        Admin/teacher image authoring.
│   ├── drafts/              RecoveryCentre (draft recovery).
│   ├── teacherSettings/, learnerSettings/, flashcards/
├── editor/                  TipTap rich-content editor (extensions/, schema/, utils/).
├── documentEngine/          Client document-model helpers.
├── hooks/                   useFirestore, useSubscription, useTeacherUsage, useQuizPersistence, draft/, useActiveAssignmentSync, …
├── utils/                   ~210 modules: Firestore services, AI clients, DOCX/PDF exporters, Lenco payments, permissions, paywall, analytics, navigation, curriculum resolvers.
├── schemas/                 Zod schemas (quiz, attempt, result).
├── config/                  curriculum.js (SUBJECTS/GRADES), agents.js (agent roster).
├── offline/                 Offline-first library + indicators.
├── i18n/                    i18next locales.
├── data/                    Bundled data.
└── test/                    Vitest setup (jest-dom matchers + cleanup).
```

## `functions/` structure

```
functions/
├── index.js                 ~156 exports (~4,255 lines). Every function export. See §13.
├── aiService.js             Anthropic client (streaming/non-streaming/prompt-caching) + limits/roles/parsers.
├── anthropicFetch.js        Low-level Anthropic fetch.
├── openaiClient.js          OpenAI (short-answer marking, Zed chat).
├── openaiEmbeddings.js      OpenAI embeddings (semantic dedup).
├── geminiClient.js          Gemini REST (structureImportedQuiz).
├── geminiImageClient.js     Gemini image generation.
├── aiCostTracking.js        Cost rollup + budget gate.
├── aiBudget*.js             Reservation / enforcement / reclaim / revenue-linked treasury.
├── treasury.js              Revenue-linked AI budget cap.
├── aiPromptPolicy.js        Prompt safety policy.
├── visualSafety*.js         Generated-image safety gate.
├── teacherTools/            One folder per generator (prompt + schema + generate*/run* runner) + cbcKnowledge.js/cbcTopics.js + usageMeter.js + assessment/exam/SBA schemas.
├── agents/                  Internal agent pipeline: dispatcher.js, cron.js, runners/ (aria/cala/reva/pubo/vex/monitor/marshal/bonga/…), questionReview.js (Qix), learnerAi/, circuitBreaker.js.
├── grading/                 Daily-exam grading.
├── classManagement.js, classAnalytics.js   Teacher classes/rosters/assignments/stats.
├── parentPortal.js, familyPortal*.js, weeklyParentDigest.js   Parent surfaces.
├── lencoService.js, lencoWebhookProcessor.js, paymentInitiationCore.js, invoiceGenerator.js, subscription*.js, plans.js   Payments/subscriptions.
├── googlePlayBilling*.js    Android in-app billing verification.
├── fxRate.js                FX refresh.
├── metaWhatsApp*.js         WhatsApp (Bonga) channel + core helpers.
├── newsletter.js, referral*.js   Growth.
├── storageCleanup/          Firestore-triggered Storage cascade deletes.
├── notifications/, quizSummary/, documentEngine/, grading/, data/, scripts/
├── authGuard.js, appCheckEnforcement.js, recaptcha*.js, rateLimit*.js, auditLog.js   Security.
├── accountDeletion.js, adminUsers.js, adminPayments*.js   Account/admin.
└── *.test.js                Co-located node assertion tests.
```

## Two package.json / two dependency trees

| | Root (`package.json`) | `functions/package.json` |
|---|---|---|
| Runtime | Browser (Vite bundle) / Capacitor WebView | Node 22 (`engines.node: "22"`) |
| Key deps | react@19, react-dom@19, react-router-dom@7, firebase@12, zod@4, docx@9, jspdf@4, html2canvas, pdfjs-dist@6, @tiptap/*@3, @sentry/react, posthog-js, @capacitor/*@8, @capacitor-firebase/*@8, @capgo/native-purchases | firebase-admin@13, firebase-functions@7, docx@9, pdfkit, pdf-parse, mammoth, exceljs, nodemailer, google-auth-library, @google-cloud/text-to-speech, @octokit/rest |

> **Accuracy note:** `CLAUDE.md` describes the stack as "Vite/React 18 SPA" with react-router v6 comments; the installed versions are **React 19.2** and **react-router-dom v7**. Document/verify against `package.json`, not the prose.

See [`01-system-overview.md`](./01-system-overview.md) for how these pieces connect and [`13-cloud-functions-register.md`](./13-cloud-functions-register.md) for the function-by-function backend register.
