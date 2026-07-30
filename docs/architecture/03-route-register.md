# 03 — Route Register

> Snapshot as of 2026-07-17 — verify before acting. Audited commit `0cd4c49`.
> Source of truth: [`src/App.jsx`](../../src/App.jsx) (single `<Routes>` block) **plus
> [`src/components/teacher/teacherRoutes.jsx`](../../src/components/teacher/teacherRoutes.jsx)**,
> which since 2026-07-30 holds every `/teacher/*` route as data that App.jsx maps
> into `<Route>` elements. `/my-subscription` now forwards teachers to
> `/teacher/subscription` (learners and admins keep the standalone page).
> Hosting-layer redirects/rewrites: [`firebase.json`](../../firebase.json).

Every route in the SPA is declared in `src/App.jsx` or the teacher route table. Nearly every page component is `React.lazy()`-imported and rendered inside one `<Suspense fallback={<PageLoader/>}>`. A single `<RouteErrorBoundary>` (inline, keyed on pathname) wraps all routes.

## Guards and layouts (the wrappers)

| Wrapper | File | Effect |
|---|---|---|
| `ProtectedRoute` | `src/components/layout/ProtectedRoute.jsx` | Requires auth; `requiredRole` prop enforces a role *level* (learner=1, teacher=2, admin=3). |
| `LearnerOnlyRoute` | `src/components/auth/LearnerOnlyRoute.jsx` | Restricts a route to learner-role users (bounces teacher/admin to their landing). |
| `AdminRoute` (local) | `App.jsx:334` | `ProtectedRoute requiredRole="admin"` + `AdminLayout`. |
| `TeacherRoute` (local) | `App.jsx:342` | `ProtectedRoute requiredRole="teacher"` + `TeacherLayout`. |
| `ParentRoute` (local) | `App.jsx:354` | Explicit `isParent \|\| isAdmin` check (role *levels* can't tell parent from learner) + `ParentLayout`. |
| `StudioGate` | `src/components/teacher/StudioGate.jsx` | Eagerly imported. Free teachers get a read-only sample + paywall for gated tools; Pro/Max pass through. |
| `LearnerGate` | `src/features/notes/components/LearnerGate.jsx` | Entitlement gate around notes/lessons reading. |
| `RootRedirect` | `App.jsx:273` | `/` — resolves signed-in users to their role landing via `getRoleLandingPath` (`src/utils/navigation.js`); shows `<Marketing/>` to signed-out. Handles cold-start session-restore race and email-verification gate. |

Theme pinning: `PUBLIC_THEME_PATHS` + `isPublicThemePath()` (`App.jsx:39–55`) force brand-default theme on public/auth/legal routes.

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
| `/dashboard`, `/dashboard-preview` | `GradeHub` | CBC-aligned primary dashboard. |
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
| `/quiz/:quizId` | `QuizRunnerV2` | |
| `/results/:resultId` | `QuizResultsV2` | |
| `/search` | `LearnerSearch` | |
| `/notes`, `/notes/:id` | `LearnerNotesList`, `LearnerNoteRead` | Wrapped in `LearnerGate`. |
| `/lessons`, `/lessons/:lessonId` | `LearnerLessonsList`, `LessonPlayer` | Slide lessons, `LearnerGate`. |
| `/my-results` | `MyResults` | |
| `/my-badges` | `BadgesPage` | |
| `/classes`, `/classes/join`, `/classes/:classId` | `LearnerClassesList`, `LearnerClassJoin`, `LearnerClassDetail` | Learner side of invite-code classes. |

Shared-auth (any signed-in role): `/profile` (`ProfilePage`), `/offline` (`OfflineLibraryPage`), `/my-subscription` (`MySubscriptionPage`), `/settings/*` (`SettingsPage` — role-branched chrome), `/ask-zed` (`ZedChatPage`).

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
| `/admin/generate/{worksheet,flashcards,scheme-of-work,class-timetable,rubric,notes}` | Admin-side reuse of teacher generator studios |
| `/admin/company` | `CompanyHQ` (Marshal fleet-health HQ) |
| `/admin/agents` (+ `/jobs`, `/jobs/:jobId`, `/:agentId`) | `AgentsHome`, `AgentsAllJobs`, `AgentJobDetail`, `AgentProfile` |

## Teacher routes (`TeacherRoute` = teacher role + `TeacherLayout`; studios wrapped in `StudioGate`)

| Path | Component | Gate |
|---|---|---|
| `/teacher/welcome-to-pro` | `WelcomeToPro` | teacher (outside layout) |
| `/teacher` | `TeacherDashboard` | teacher |
| `/teacher/test-papers` (+ `/new`, `/:paperId/edit`) | `AssessmentList`, `AssessmentStudio` | `StudioGate tool="assessment"` |
| `/teacher/assessments/*` | same as test-papers | Legacy aliases (functional). |
| `/teacher/exam-papers` (+ `/new`, `/:paperId/edit`) | `AssessmentList/Studio variant="exam"` | `StudioGate tool="assessment"` (shares assessment quota) |
| `/teacher/lessons` (+ `/new`, `/:lessonId/edit`) | `LessonDashboard`, `LessonEditor` | teacher |
| `/teacher/generate/lesson-plan` | `LessonPlanStudio` | **Ungated** — the one studio every plan can use (bare `ProtectedRoute`). |
| `/teacher/generate/homework` | `HomeworkStudio` | `StudioGate tool="homework"` |
| `/teacher/generate/exam-paper` | → `/teacher/exam-papers` (redirect) | Legacy. |
| `/teacher/generate/worksheet` | `WorksheetGenerator` | `tool="worksheet"` |
| `/teacher/generate/flashcards` | `FlashcardGenerator` | `tool="flashcards"` |
| `/teacher/generate/scheme-of-work` | `SchemeOfWorkGenerator` | `tool="scheme_of_work"` |
| `/teacher/generate/mark-schedule` | `MarkScheduleStudio` | `tool="mark_schedule"` |
| `/teacher/generate/weekly-forecast` | `WeeklyForecastStudio` | `tool="weekly_forecast"` |
| `/teacher/generate/record-of-work` | `RecordOfWorkStudio` | `tool="record_of_work"` |
| `/teacher/generate/class-timetable` | `ClassTimetableStudio` | `tool="class_timetable"` |
| `/teacher/generate/rubric` | `RubricGenerator` | `tool="rubric"` |
| `/teacher/generate/notes` | `NotesStudio` | `tool="notes"` |
| `/teacher/visual-studio` (`/teacher/generate/visual-studio` → redirect) | `VisualStudioPage` | teacher |
| `/teacher/generate/sba`, `/sba-tracker`, `/sba-planner` | `SbaTaskStudio`, `SbaMarkTracker`, `SbaYearPlanner` | `StudioGate tool="sba_*"` |
| `/teacher/sba` | `SbaHub` | teacher |
| `/teacher/templates`, `/teacher/templates/:id` | `TemplateBank`, `TemplateBankDetail` | teacher |
| `/teacher/library`, `/teacher/library/:id` | `TeacherLibrary`, `LibraryItemDetail` | teacher |
| `/teacher/drafts` | `RecoveryCentre` (`features/drafts`) | teacher |
| `/teacher/question-bank` | `CentralQuestionBank` | teacher |
| `/teacher/syllabi` | `SyllabiLibrary` | teacher |
| `/teacher/calendar` | `SchoolCalendar` | teacher |
| `/teacher/curriculum` (+ `/ece`, `/primary`, `/secondary`, `/2013`, `/2013/ece`, `/2013/primary`, `/2013/secondary`) | `CurriculumHome` + variants | teacher |
| `/teacher/classes` (+ `/new`, `/:classId`) | `TeacherClassesList`, `TeacherClassEditor`, `TeacherClassDetail` | teacher |
| `/teacher/attendance` | `ClassRegisterStudio` | teacher (ungated) |
| `/teacher/register` (+ `/new`, `/:classId`, `/:classId/edit`, `/:classId/:tab`) | `ClassRegisterList/Editor/Detail` | teacher (ungated) |

Fallback: `path="*"` → `NotFound`.

## Route-level observations (verified from `App.jsx`)

- **Legacy / redirect routes:** `/welcome`, `/plans`, `/teachers/*`, `/teacher/generate/exam-paper`, `/teacher/generate/visual-studio`, `/teacher/assessments/*` (aliases). Hosting-layer 301s in `firebase.json` for `/welcome`, `/plans`, `/teachers/**`.
- **Duplicate component mounts:** `GradeHub` mounted at both `/dashboard` and `/dashboard-preview`. `AssessmentStudio`/`AssessmentList` reached via `/teacher/test-papers`, `/teacher/assessments`, and `/teacher/exam-papers` (the last with `variant="exam"`).
- **Admin ↔ teacher studio reuse:** `WorksheetGenerator`, `FlashcardGenerator`, `SchemeOfWorkGenerator`, `ClassTimetableStudio`, `RubricGenerator`, `NotesStudio` are mounted under both `/admin/generate/*` and `/teacher/generate/*` — same components, different chrome/gating. Confirm both entry points stay in sync when changing a studio.
- **Inconsistent role protection to verify:** `/admin/generate/class-timetable` appears twice in the admin block region — the same path string is declared once; the teacher `class-timetable` also exists. Cross-check there is no accidental shadowing.
- **Verification gate design:** `/verify-email` is intentionally outside `ProtectedRoute` to avoid guard ping-pong; `RootRedirect` also short-circuits unverified users (`App.jsx:290`).
- **Parent role nuance:** parent and learner share role-level 1, so `ParentRoute` checks role explicitly rather than by level.
