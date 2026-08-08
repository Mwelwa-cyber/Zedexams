# 03 — Route Register

> Snapshot as of 2026-08-04 — verify before acting. Audited commit `7e5df4b`.
> Regenerated for the Phase 0B migration baseline (`docs/architecture.md` §13);
> the previous snapshot was audited at `0cd4c49` (2026-07-17) and 17 commits had
> touched the route sources since.
> Source of truth: [`src/App.jsx`](../../src/App.jsx) (single `<Routes>` block) **plus
> [`src/components/teacher/teacherRoutes.jsx`](../../src/components/teacher/teacherRoutes.jsx)**,
> which since 2026-07-30 holds every `/teacher/*` route as data that App.jsx maps
> into `<Route>` elements.
> Hosting-layer redirects/rewrites: [`firebase.json`](../../firebase.json).

**Counts at the audited commit: 203 declared routes — 133 in `App.jsx`, 70 in `teacherRoutes.jsx`, no overlap.**
These are parsed by [`scripts/lib/declaredRoutes.mjs`](../../scripts/lib/declaredRoutes.mjs), the one
module that knows where routes are declared; the route-target guards
(`test:route-targets`, `test:public-routes`, `test:dashboard-v2-links`, …) read the
same module, so a future move of the declaration site updates one file and every
guard keeps working.

Every route in the SPA is declared in `src/App.jsx` or the teacher route table. Nearly every page component is `React.lazy()`-imported and rendered inside one `<Suspense fallback={<PageLoader/>}>`. A single `<RouteErrorBoundary>` (inline, keyed on pathname) wraps all routes.

## Guards and layouts (the wrappers)

| Wrapper | File | Effect |
|---|---|---|
| `ProtectedRoute` | `src/components/layout/ProtectedRoute.jsx` | Requires auth; `requiredRole` prop enforces a role *level* (learner=1, teacher=2, admin=3). |
| `LearnerOnlyRoute` | `src/components/auth/LearnerOnlyRoute.jsx` | Restricts a route to learner-role users (bounces teacher/admin to their landing). |
| `AdminRoute` (local) | `App.jsx` | `ProtectedRoute requiredRole="admin"` + `AdminLayout`. |
| `AdminMfaGate` | `src/components/admin/security/AdminMfaGate` | 30-minute step-up TOTP gate; wraps `/dev/ui` and the admin destructive surfaces. |
| `TeacherRoute` | expanded by `page()`/`studio()` in `teacherRoutes.jsx` | `ProtectedRoute requiredRole="teacher"` + `TeacherLayout`. |
| `ParentRoute` (local) | `App.jsx` | Explicit `isParent \|\| isAdmin` check (role *levels* can't tell parent from learner) + `ParentLayout`. |
| `StudioGate` | `src/components/teacher/StudioGate.jsx` | Eagerly imported. Free teachers get a read-only sample + paywall for gated tools; Pro/Max pass through. |
| `LearnerGate` | `src/features/notes/components/LearnerGate.jsx` | Entitlement gate around notes/lessons reading. |
| `RootRedirect` | `App.jsx` | `/` — resolves signed-in users to their role landing via `getRoleLandingPath` (`src/utils/navigation.js`); shows `<Marketing/>` to signed-out. Handles cold-start session-restore race and email-verification gate. |

**Teacher route constructors** (`teacherRoutes.jsx`) are the guard, declared as data:
`page(path, element, variant?)` and `studio(path, tool, element)` both expand to
`TeacherRoute` (shell + role guard), `studio()` adding `StudioGate tool=…`;
`bare(path, element, shellExemptReason)` opts out of the shell and **must** state why;
`redirect(path, element)` is a `bare()` whose reason is "renders no page".

Theme pinning: `PUBLIC_THEME_PATHS` + `isPublicThemePath()` (`App.jsx`) force brand-default theme on public/auth/legal routes.

## Public / marketing / auth routes (no auth)

| Path | Component | Notes |
|---|---|---|
| `/` | `RootRedirect`→`Marketing` (`components/marketing/Marketing`) | Signed-in → role landing. |
| `/welcome` | → `/` (redirect) | Legacy; also 301'd in `firebase.json`. |
| `/pricing` | `Plans` (`components/marketing/Plans`) | Canonical pricing. |
| `/plans` | → `/pricing` (redirect) | Legacy; 301 in hosting. |
| `/teachers` | `TeachersLanding` | Teacher marketing funnel. |
| `/teachers/*` | → `/teachers` | Legacy splat; 301 in hosting. |
| `/company` | `AiTeam` | AI-team marketing page. |
| `/grade-7` | `GradePackLanding gradeSlug="7"` | Grade landing (ECZ exam grade). |
| `/grade-12` | `GradePackLanding gradeSlug="12"` | Grade landing. `/grade-9` intentionally 404s (grade phased out). |
| `/privacy` | `PrivacyPolicy` | |
| `/terms` | `Terms` | |
| `/child-safety` | `ChildSafety` | Public child-safety policy page. |
| `/delete-account` | `DeleteAccountRequest` | Public account-deletion request (Play data-safety requirement). |
| `/preferences` | `CookiePreferences` | Public consent page (cookie banner target). |
| `/status` | `StatusPage` | |
| `/blog`, `/blog/:slug` | `BlogIndex`, `BlogPost` | SEO blog, markdown-in-bundle. |
| `/login` | `Login` | |
| `/register` | `Register` | |
| `/auth/action` | `AuthAction` | Firebase email action handler (reset/verify). |
| `/verify-email` | `VerifyEmail` | **Deliberately outside `ProtectedRoute`** — renders for signed-in-but-unverified. |
| `/share/:token` | `PublicShareView` | Read-only frozen snapshot of a teacher doc. |
| `/parent/:token` | `ParentProgressView` | Public token-based parent progress read. |

## Past papers (public hub, gated download)

| Path | Component | Auth |
|---|---|---|
| `/papers` | `PastPapersHub` | Public (indexable). |
| `/papers/:paperId`, `/papers/:paperId/:slug` | `PastPaperViewer` | Public view; download requires sign-in (in-component). |
| `/papers/:paperId/practice` | `PastPaperPractice` | Auth-gated in-component. |
| `/papers/:paperId/quiz` | `PublicQuizRunner` | Public; 30-question free preview then paywall. |
| `/my-papers` | `MyPapersHistory` | `ProtectedRoute` (any role). |

## Public games (no auth)

`/games` → `GamesHub`; `/games/leaderboard` → `GlobalLeaderboard`; `/games/g/:grade` → `SubjectSelector`; `/games/g/:grade/:subject` → `GameList`; `/games/play/:gameId` → `PlayGame`. (`components/games/*`)

## Learner routes (`ProtectedRoute` + `LearnerOnlyRoute`)

| Path | Component | Notes |
|---|---|---|
| `/dashboard`, `/dashboard-preview` | `LearnerHomePage` (`features/learnerHome`) | **Changed since the previous snapshot** — the learner home is now the feature-module page, not `GradeHub`. |
| `/dashboard/classic` | `GradeHub` | The pre-`learnerHome` dashboard, kept reachable during the transition. |
| `/learn` | `LearnPage` | |
| `/practice` | `PracticePage` | |
| `/practice/daily-exams` | → `/exams` (redirect) | |
| `/subjects/:subjectId` | `LearnerSubjectPage` | |
| `/my-stats` | `StudentDashboard` | Legacy stats page (Navbar chrome). |
| `/study-plan` | `StudyPlanPage` | |
| `/calendar` | `LearnerCalendar` | |
| `/timetable` | `ExamTimetablePage` | Interactive exam schedule (Firestore + bundled fallback). |
| `/timetable/pdf` | `TimetableViewerPage` | Inline official ECZ PDF (Android WebView drops external PDF links). |
| `/exams` | `DailyExamsHub` | |
| `/exams/leaderboard` | `ExamLeaderboardPage` | |
| `/exam/:examId` | `DailyExamRunner` | |
| `/exam-results/:attemptId` | `ExamResultsPage` | |
| `/quizzes` | `QuizList` | |
| `/practise/:grade/:subjectId` | `SubjectDrillDown` | Course-map drill-down. |
| `/quiz/:quizId` | `QuizRunnerV2` (imported as `QuizRunner`) | |
| `/results/:resultId` | `QuizResultsV2` (imported as `QuizResults`) | |
| `/search` | `LearnerSearch` | |
| `/notes`, `/notes/:id` | `LearnerNotesList`, `LearnerNoteRead` | Wrapped in `LearnerGate`. |
| `/lessons`, `/lessons/:lessonId` | `LearnerLessonsList`, `LessonPlayer` | Slide lessons, `LearnerGate`. |
| `/my-results` | `MyResults` | |
| `/my-badges` | `BadgesPage` | |
| `/classes`, `/classes/join`, `/classes/:classId` | `LearnerClassesList`, `LearnerClassJoin`, `LearnerClassDetail` | Learner side of invite-code classes. |

**`/learner/*` legacy redirects** (the prefix exists only as redirects — learner routes are flat, per `docs/architecture.md` §2):
`/learner` → `/dashboard`, `/learner/learn` → `/learn`, `/learner/papers` → `/papers`,
`/learner/practice` → `/practice`, `/learner/games` → `/games`, `/learner/profile` → `/profile`.

Shared-auth (any signed-in role): `/profile` (`ProfilePage`), `/offline` (`OfflineLibraryPage`),
`/my-subscription` (`MySubscriptionRoute` — forwards **teachers** to `/teacher/subscription`;
learners and admins get the standalone page), `/subscription` → `/my-subscription` (redirect),
`/settings/*` (`SettingsPage` — role-branched chrome), `/ask-zed` (`ZedChatPage`).

## Family portal (authenticated parents — `ParentRoute`)

`/family` → `FamilyHome`; `/family/child/:childUid` → `ChildProgressPage`. (`components/parent/*`, layout `components/layout/ParentLayout`.)

## Admin routes (`AdminRoute` = admin role + `AdminLayout`)

| Path | Component |
|---|---|
| `/admin` | `AdminDashboard` |
| `/admin/lessons` (+ `/new`, `/import`, `/visual/new`, `/:id/edit`) | Notes Studio: `AdminNotesList`, `AdminNoteEditor`, `AdminNoteImport`, `AdminVisualNotesGenerator` |
| `/admin/quizzes/new`, `/admin/quizzes/:quizId/edit` | `CreateQuizV2`, `EditQuizV2` |
| `/admin/import/csv` | `AdminCsvImport` |
| `/admin/content` | `ManageContent` |
| `/admin/approvals` | `ContentApprovals` (agent content-line approvals) |
| `/admin/question-review` | `QuestionReviewQueue` (Qix / Central Question Bank) |
| `/admin/import-questions` | `ImportQuestionBankPanel` |
| `/admin/feedback` | `FeedbackInbox` |
| `/admin/generations`, `/admin/generations/:id` | `GenerationsAdmin`, `LibraryItemDetail` |
| `/admin/cbc-kb` | `CbcKbAdmin` |
| `/admin/picture-bank` | `PictureBankAdmin` |
| `/admin/visuals` | `VisualStudioAdmin` |
| `/admin/curriculum/replace` | `CurriculumReplaceStudio` |
| `/admin/curriculum-upload` | `CurriculumUploadPanel` |
| `/admin/ai-costs` | `AdminAiCosts` |
| `/admin/app-check` | `AdminAppCheck` |
| `/admin/papers` (+ `/new`, `/:paperId/edit`) | `AdminPastPapers`, `PastPaperStudio` |
| `/admin/games-seed` | `GamesSeedAdmin` |
| `/admin/users`, `/admin/users/:userId`, `/admin/teachers`, `/admin/admins` | `AdminUsersList`, `AdminUserProfile` |
| `/admin/settings` | `AdminSettings` |
| `/admin/announcements` | `AnnouncementsAdmin` |
| `/admin/activity` | `AdminActivityLog` |
| `/admin/analytics` | `AdminAnalytics` |
| `/admin/visitors` | `AdminVisitors` |
| `/admin/learners`, `/admin/learners/:learnerId` | `AdminLearners`, `AdminLearnerProfile` |
| `/admin/results` | `AdminResults` |
| `/admin/payments` | `PaymentsPanel` |
| `/admin/demo-trials` | `BulkGrantTrialsPanel` |
| `/admin/generate/{worksheet,flashcards,scheme-of-work,class-timetable,notes}` | Admin-side reuse of teacher generator studios (worksheet rides the same feature flag as the teacher route; the rubric route was removed with the studio, 2026-08) |
| `/admin/company` | `CompanyHQ` (Marshal fleet-health HQ) |
| `/admin/agents` (+ `/jobs`, `/jobs/:jobId`, `/:agentId`) | `AgentsHome`, `AgentsAllJobs`, `AgentJobDetail`, `AgentProfile` |

**Admin-role routes declared outside `AdminRoute`** (deliberately no `AdminLayout`):

| Path | Component | Guard |
|---|---|---|
| `/admin/security/mfa-setup` | `MfaSetupPage` | `ProtectedRoute requiredRole="admin"` — the MFA enrolment page cannot sit behind the MFA gate it enrols for. |
| `/dev/ui` | `UiAuditPage` (`components/dev/uiAudit`) | `ProtectedRoute requiredRole="admin"` + `AdminMfaGate`. Internal design-token/primitive audit page; owns its own `.studio-theme` scope, so admin chrome would nest a second themed container. Not linked from any navigation — direct URL only. |

## Teacher routes (`teacherRoutes.jsx` — `TeacherRoute` = teacher role + `TeacherLayout`)

### Dashboard, help, subscription

| Path | Component | Construct |
|---|---|---|
| `/teacher` | `TeacherDashboardLive` | `page(…, 'dashboard')` |
| `/teacher/help` | `HelpSupportPage` | `page(…, 'dashboard')` |
| `/teacher/subscription` | `MySubscriptionPage inShell` | `page` |
| `/teacher/classic` | `TeacherDashboard` | `page` — pre-V2 dashboard, transition fallback |
| `/teacher/welcome-to-pro` | `WelcomeToPro` | `bare` — full-bleed post-upgrade interstitial, not a destination in the teacher map |

### Preview routes (mock data only; no Firestore, hence unguarded)

| Path | Component | Construct |
|---|---|---|
| `/teacher/dashboard-preview` | `TeacherDashboardV2` in `TeacherLayout variant="dashboard"` | object literal, `shell: true` — the shell is part of what it previews |
| `/teacher/register-preview` | `ClassListRegisterPreview` | `bare` |
| `/teacher/register-preview/capture` | `CapturePreview` | `bare` |
| `/teacher/register-preview/review` | `ImportReviewPreview` | `bare` |

### Assessment Paper Studio — canonical + legacy redirects

| Path | Component | Gate |
|---|---|---|
| `/teacher/assessment-papers` (+ `/new`, `/:paperId/edit`) | `AssessmentList`, `AssessmentStudio` | `studio(…, 'assessment')` |
| `/teacher/test-papers` (+ `/new`, `/:paperId/edit`) | `LegacyAssessmentPaperRedirect` | **redirect only** |
| `/teacher/exam-papers` (+ `/new`, `/:paperId/edit`) | `LegacyAssessmentPaperRedirect` | **redirect only** |
| `/teacher/assessments` (+ `/new`, `/:paperId/edit`) | `LegacyAssessmentPaperRedirect` | **redirect only** |
| `/teacher/generate/exam-paper` | → `/teacher/assessment-papers` | **redirect only** |

**Changed since the previous snapshot.** `/teacher/assessment-papers` is now the canonical
studio; `test-papers` / `exam-papers` / `assessments` are pure redirects, and the studio no
longer branches on a route-level `variant` — which assessment type a paper is comes from its
own `assessmentType` (`paperTaxonomy.js`).

### Lessons and lesson plans

| Path | Component | Gate |
|---|---|---|
| `/teacher/lessons` (+ `/new`, `/:lessonId/edit`) | `LessonDashboard`, `LessonEditor` | `page` |
| `/teacher/lesson-plans` | → `/teacher/library?type=lesson_plans` | **redirect only** |
| `/teacher/lesson-plans/new`, `/teacher/lesson-plans/:lessonPlanId/edit` | `LessonPlanStudio` | `page` — **ungated**, the one studio every plan can use |
| `/teacher/generate/lesson-plan` | `LegacyLessonPlanStudioRedirect` | **redirect only** — changed since the previous snapshot |

### Generator studios (`studio()` = `StudioGate tool=…`)

| Path | Component | `tool` |
|---|---|---|
| `/teacher/generate/homework` | `HomeworkStudio` | `homework` |
| `/teacher/generate/worksheet` | `WorksheetGenerator` | `worksheet` — **withdrawn**: gated on `featureFlags.worksheetStudioEnabled` (default off); redirects to `/teacher` with a notice while off |
| `/teacher/generate/flashcards` | `FlashcardGenerator` | `flashcards` |
| `/teacher/generate/scheme-of-work` | `SchemeOfWorkGenerator` | `scheme_of_work` |
| `/teacher/generate/mark-schedule` | `MarkScheduleStudio` | `mark_schedule` |
| `/teacher/generate/weekly-forecast` | `WeeklyForecastStudio` | `weekly_forecast` |
| `/teacher/generate/record-of-work` | `RecordOfWorkStudio` | `record_of_work` |
| `/teacher/generate/class-timetable` | `ClassTimetableStudio` | `class_timetable` |
| `/teacher/generate/rubric` | *(redirect)* | **retired** 2026-08 — no page; redirects to `/teacher` with a notice |
| `/teacher/generate/notes` | `NotesStudio` | `notes` |
| `/teacher/generate/sba` | `SbaTaskStudio` | `sba_task` |
| `/teacher/generate/sba-tracker` | `SbaMarkTracker` | `sba_tracker` |
| `/teacher/generate/sba-planner` | `SbaYearPlanner` | `sba_planner` |

The SBA tracker/planner moved under `/teacher/generate/*` since the previous snapshot
(they were listed as `/teacher/sba-tracker` / `/teacher/sba-planner`).

### Library, bank, curriculum, classes, register

| Path | Component | Gate |
|---|---|---|
| `/teacher/sba` | `SbaHub` | `page` |
| `/teacher/visual-studio` | `VisualStudioPage` | `page` (`/teacher/generate/visual-studio` → redirect) |
| `/teacher/templates`, `/teacher/templates/:id` | `TemplateBank`, `TemplateBankDetail` | `page` |
| `/teacher/library`, `/teacher/library/:id` | `TeacherLibrary`, `LibraryItemDetail` | `page` |
| `/teacher/drafts` | `RecoveryCentre` (`features/drafts`) | `page` |
| `/teacher/question-bank` | — | `redirect` → `/teacher/assessment-papers/new?view=bank` (query preserved). The Question Bank is a view INSIDE the Assessment Paper Studio; there is no standalone page. |
| `/teacher/syllabi` | `SyllabiLibrary` | `page` |
| `/teacher/calendar` | `SchoolCalendar` | `page` |
| `/teacher/curriculum` (+ `/ece`, `/primary`, `/secondary`, `/2013`, `/2013/ece`, `/2013/primary`, `/2013/secondary`) | `CurriculumHome` + variants | `page` |
| `/teacher/classes` (+ `/new`, `/:classId`) | `TeacherClassesList`, `TeacherClassEditor`, `TeacherClassDetail` | `page` |
| `/teacher/attendance` | `ClassRegisterStudio` | `page` |
| `/teacher/register` (+ `/new`, `/:classId`, `/:classId/edit`, `/:classId/:tab`) | `ClassRegisterList/Editor/Detail` | `page` |

Fallback: `path="*"` → `NotFound`.

## Route-level observations (verified at `7e5df4b`)

- **Legacy / redirect routes:** `/welcome`, `/plans`, `/teachers/*`, `/subscription`,
  `/practice/daily-exams`, the six `/learner/*` aliases, `/teacher/test-papers`,
  `/teacher/exam-papers`, `/teacher/assessments`, `/teacher/generate/exam-paper`,
  `/teacher/generate/lesson-plan`, `/teacher/generate/visual-studio`,
  `/teacher/lesson-plans`. Hosting-layer 301s in `firebase.json` for `/welcome`,
  `/plans`, `/teachers/**`.
- **Duplicate component mounts:** `LearnerHomePage` at both `/dashboard` and
  `/dashboard-preview`. `MySubscriptionPage` reachable as `/my-subscription`
  (via `MySubscriptionRoute`) and `/teacher/subscription` (`inShell`).
  `LibraryItemDetail` mounted at both `/admin/generations/:id` and `/teacher/library/:id`.
- **Admin ↔ teacher studio reuse:** `WorksheetGenerator`, `FlashcardGenerator`,
  `SchemeOfWorkGenerator`, `ClassTimetableStudio`, `NotesStudio` are
  mounted under both `/admin/generate/*` and `/teacher/generate/*` — same components,
  different chrome/gating. The admin mounts carry no `StudioGate`. Confirm both entry
  points stay in sync when changing a studio.
- **Unguarded routes that render teacher chrome:** the four preview routes
  (`/teacher/dashboard-preview`, `/teacher/register-preview{,/capture,/review}`) are
  deliberately unauthenticated because they read mock data only. Any change that gives
  one of them a Firestore read must add a guard in the same PR.
- **Verification gate design:** `/verify-email` is intentionally outside `ProtectedRoute`
  to avoid guard ping-pong; `RootRedirect` also short-circuits unverified users.
- **Parent role nuance:** parent and learner share role-level 1, so `ParentRoute` checks
  role explicitly rather than by level.
- **Migration note (`docs/architecture.md` §2, §13):** learner routes are flat and stay
  flat — do not introduce a `/learner` prefix. `DailyExamRunner` (`/exam/:examId`) is one
  of the four parallel runners Phase 3 retires onto the shared Assessment Engine; it must
  keep working until its consumer is switched.
