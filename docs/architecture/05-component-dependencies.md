# 05 — Component Dependencies

> Snapshot as of 2026-07-17 — verify before acting. Audited commit `0cd4c49`.

This maps the major feature surfaces to their child components, hooks, contexts, services, schemas, and shared utilities — so you can see what a change ripples into. Shared building blocks used by *many* features are listed first.

## Shared building blocks (used across features)

| Block | File(s) | Used by |
|---|---|---|
| Auth context | `contexts/AuthContext.jsx` | every authed surface |
| Firestore access | `hooks/useFirestore.js`, `utils/*Service.js` | all data reads/writes |
| Subscription/entitlement | `hooks/useSubscription.js`, `utils/subscriptionConfig.js`, `subscriptionStatus.js`, `teacherPlans.js`, `permissions.js` | paywalls, studios, gates |
| Paywall host + popups | `components/subscription/PaywallHost.jsx`, `LockedFeatureModal`, `QuizLimitPopup` | all gated surfaces |
| Studio gate + usage | `components/teacher/StudioGate.jsx`, `hooks/useTeacherUsage.js`, `hooks/useGenerationGate.js` | all teacher studios |
| Curriculum selector | `StudioCurriculumSelector`, `config/curriculum.js`, `config/teacherTaxonomy.js` | 8 selector studios ([`06`](./06-curriculum-architecture.md)) |
| Live reveal | `components/ui/LiveGenerationCanvas.jsx`, `liveGenerationSections.js`, `hooks/useLiveReveal.js` | document studios |
| Draft manager | `hooks/draft/*` | 14 studios ([`15`](./15-drafts-and-autosave.md)) |
| Rich editor | `editor/*` (TipTap) | quiz, notes, lessons, assessment |
| Exporters | `utils/*To{Docx,Pdf,Xlsx}.js`, `htmlToPdf.js`, `saveBlob.js` | every studio output ([`16`](./16-document-generation.md)) |
| Toast/notifications | `components/ui/Toast.jsx`, `contexts/NotificationContext.jsx` | app-wide |
| Error reporting | `utils/clientErrorReporting.js`, `utils/sentry.js` | ErrorBoundary, services |

## Feature dependency maps

### Teacher dashboard
`components/teacher/TeacherDashboard.jsx` → `TeacherLayout` (sidebar) · `useTeachingProfile` + `resolveActiveAssignmentId` (active assignment; **writer** of the sync signal) · `useTeacherUsage` (quota tiles) · `useSubscription` · studio launcher cards · `teacherRecommendations.js` (calendar-derived). Depends on: `teacherProfiles/{uid}` + `teachingAssignments`, `usageMeters`, `aiGenerations`.

### Learner dashboard
`components/dashboard/GradeHub.jsx` (also `/dashboard-preview`) → `Navbar` · `useFirestore` (quizzes/results) · `config/curriculum.js` (SUBJECTS/GRADES) · `SubjectDrillDown` · badges/streaks (`gamificationService.js`, `learnerStats`). Legacy `StudentDashboard` at `/my-stats`.

### Admin dashboard
`components/admin/AdminLayout.jsx` + `AdminDashboard.jsx` → users/content/results/agents/company/payments/ai-costs panels · `adminUsers`/`adminPayments` callables · `AdminAnalytics` (7 collection reads). Every `/admin/*` route is wrapped in `AdminRoute` (role + layout).

### Teaching Profile → studios
See [`07`](./07-teaching-profile.md). `useActiveAssignmentSync` (headless) feeds `active-seed` localStorage → `resolveStudioSeed` → `StudioCurriculumSelector` in the 8 selector studios.

### Lesson Plan Studio
`teacher/studio/LessonPlanStudio.jsx` → `StudioCanvas`/`LiveLessonPlanPreview` · `useActiveAssignmentContext` · `useStudioState` + reference syllabi cascade hooks · `useDraftManager` · `useGenerationGate('lesson_plan')` · `utils/teacherTools.studioGenerateLessonPlan` → CF `studioGenerateLessonPlan` · `saveLessonPlanGeneration` · exporters `lessonPlanToDocx/Pdf`.

### Assessment (Test/Exam) Studio
`teacher/AssessmentStudio.jsx` → `assessmentStudioMeta.js` (STUDIO_GRADES/SUBJECTS — **own lists**) · `AssessmentQuestionBlock` · `CreatePaperModal` (AI slide-over, `ensureCanGenerate('assessment')` → CF `generateAssessment`) · `useAssessmentDraft` (singleton) · `assessmentToDocx/Pdf` · Storage `assessment-images/`.

### Quiz Studio (admin/teacher)
`quiz/EditQuizV2.jsx` / `admin/CreateQuizV2.jsx` → `editor/*` · `schemas/quiz.js` (Zod) · CF `generateQuizQuestions`/`editQuizQuestion`/`verifyQuiz` (Vex)/`suggestQuizAnswers` · Storage `quiz-images/` · `useCreateQuizDraft` (localStorage only — [`15`](./15-drafts-and-autosave.md) gap).

### Other studios
Worksheet/Notes/Homework/Flashcard/Scheme/Rubric/Weekly/MarkSchedule → `StudioCurriculumSelector` + `useStudioInputDraft`/`useDraftManager` + `useGenerationGate` + `generate<Tool>` CF + exporter. SBA trio → `config/sba.js`. Class Timetable → `curriculumFramework.js` (no AI/meter). See [`08`](./08-studio-flows.md).

### Class Register (attendance)
`teacher/register/attendance/ClassRegisterStudio.jsx` → `attendanceService.js`, `attendanceCalendarResolver.js`, `classRoster.js` · `classRegisters/{id}/{roster,attendance,attendanceTerms,attendanceAudit}` · `attendanceToDocx`.

### Subscription & payments
`subscription/MySubscriptionPage.jsx`, `PaywallHost`, `UpgradeModal`, `PlayUpgradePanel` → `subscriptionConfig.js`/`teacherPlans.js`/`permissions.js` · `utils/lenco*`/`playBilling.js` · CF payment functions ([`14`](./14-payment-and-subscriptions.md)).

### Saved documents & exports
`features/teacherLibrary/pages/TeacherLibrary.jsx` + `LibraryItemDetail.jsx` → `teacherLibraryService.js` · `aiGenerations` · view components (`views/AssessmentPaperView`, `FullLessonView`) · exporters · `serverLibraryDownload.js` → CF `apiLibraryDownload` (lesson_plan only).

## Coupling notes (highest-fan-in)

- **`AuthContext`** — read by nearly every component; a change to role/subscription shape ripples everywhere ([`20`](./20-change-impact-register.md)).
- **`useFirestore` + `*Service.js`** — the only data path; no `COLLECTIONS` constants module, so path strings are inlined across ~65 files ([`21`](./21-duplication-register.md) D5).
- **Curriculum config** — imported directly by learner surfaces but bypassed/duplicated by many teacher/admin surfaces ([`06`](./06-curriculum-architecture.md)).
- **Exporters** — ~42 files re-build the same DOCX/PDF boilerplate ([`21`](./21-duplication-register.md) D7).
