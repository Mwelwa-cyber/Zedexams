/**
 * THE teacher route table.
 *
 * Every /teacher/* route is declared here as data rather than as JSX buried
 * in App.jsx, for one reason: a page that ships outside the shared shell is
 * invisible in review — it looks like a route like any other, and the only
 * symptom is that a teacher who lands on it loses the sidebar. Declaring the
 * routes as a list lets teacherRoutes.spec.jsx render EVERY one of them and
 * fail if the shell is missing, and lets an exemption state its reason next
 * to the route instead of existing by omission.
 *
 * `shell: false` means the route deliberately renders without TeacherLayout;
 * it must carry a `shellExemptReason`. The spec asserts both directions — an
 * exempt route really has no shell, and everything else really has one.
 *
 * App.jsx maps this into <Route> elements. Page components stay React.lazy so
 * the router remains fully code-split.
 */
import { lazy } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import ProtectedRoute from '../layout/ProtectedRoute'
import PageLoader from '../ui/PageLoader'
import { usePlatformSettings } from '../../contexts/PlatformSettingsContext'
import { redirectTargetForTool } from '../../config/studioAvailability'
import useStudioAvailability from '../../hooks/useStudioAvailability'
// Lazy, like the pages: this module is statically imported by App.jsx (it is
// the route table), so a static import here would pull the shell — and the
// whole dashboard design system behind it — into the entry chunk for every
// learner who never sees a teacher page.
const TeacherLayout = lazy(() => import('./TeacherLayout'))
// Route-level gate: Free teachers can only open the Lesson Plan studio; every
// other studio renders a read-only sample behind a paywall. Imported eagerly
// (it must decide synchronously from the already-loaded plan).
import StudioGate from './StudioGate'
import { questionBankRedirectPath } from './questionBankDeepLink'

const TeacherDashboard = lazy(() => import('./TeacherDashboard'))
const TeacherDashboardLive = lazy(() => import('./dashboardV2/TeacherDashboardLive'))
const TeacherDashboardV2 = lazy(() => import('./dashboardV2/TeacherDashboardV2'))
const TeacherHelpSupport = lazy(() => import('./dashboardV2/HelpSupportPage'))
const WelcomeToPro = lazy(() => import('./WelcomeToPro'))
const MySubscriptionPage = lazy(() => import('../subscription/MySubscriptionPage'))

const ClassListRegisterPreview = lazy(() => import('../../features/classList/pages/ClassListRegisterPreview'))
const ImportReviewPreview = lazy(() =>
  import('../../features/classList/pages/ClassListRegisterPreview')
    .then((m) => ({ default: m.ImportReviewPreview })))
const CapturePreview = lazy(() => import('../../features/classList/pages/CapturePreview'))

const AssessmentStudio = lazy(() => import('./AssessmentStudio'))
const AssessmentList = lazy(() => import('./AssessmentList'))

const LessonDashboard = lazy(() => import('../lessons/LessonDashboard'))
const LessonEditor = lazy(() => import('../lessons/LessonEditor'))

const LessonPlanStudio = lazy(() => import('./generate/LessonPlanStudio'))
const HomeworkStudio = lazy(() => import('../../features/homework/pages/HomeworkStudio'))
const WorksheetGenerator = lazy(() => import('../../features/worksheet/pages/WorksheetGenerator'))
const FlashcardGenerator = lazy(() => import('../../features/flashcards/pages/FlashcardGenerator'))
const SchemeOfWorkGenerator = lazy(() => import('../../features/schemeOfWork/pages/SchemeOfWorkGenerator'))
const MarkScheduleStudio = lazy(() => import('./generate/MarkScheduleStudio'))
const WeeklyForecastStudio = lazy(() => import('./generate/WeeklyForecastStudio'))
const RecordOfWorkStudio = lazy(() => import('./generate/RecordOfWorkStudio'))
const ClassTimetableStudio = lazy(() => import('./generate/ClassTimetableStudio'))
// Rubric Studio is retired (2026-08) — no page is mounted for it any more.
// `src/features/rubric` stays for `RubricView`, which My Library still needs
// to render the rubrics teachers already saved.
const NotesStudio = lazy(() => import('../../features/teacherNotes/pages/NotesStudio'))
const SbaTaskStudio = lazy(() => import('./generate/SbaTaskStudio'))
const SbaMarkTracker = lazy(() => import('./generate/SbaMarkTracker'))
const SbaYearPlanner = lazy(() => import('./generate/SbaYearPlanner'))
const SbaHub = lazy(() => import('./SbaHub'))
const VisualStudioPage = lazy(() =>
  import('../../features/visualStudio').then((m) => ({ default: m.VisualStudioPage })))

const TeacherLibrary = lazy(() => import('./library/TeacherLibrary'))
const LibraryItemDetail = lazy(() => import('./library/LibraryItemDetail'))
const RecoveryCentre = lazy(() => import('../../features/drafts/RecoveryCentre'))
const TemplateBank = lazy(() => import('../../features/templateBank/pages/TemplateBank'))
const TemplateBankDetail = lazy(() => import('../../features/templateBank/pages/TemplateBankDetail'))

const SchoolCalendar = lazy(() => import('./SchoolCalendar'))
const SyllabiLibrary = lazy(() => import('./SyllabiLibrary'))
const CurriculumHome = lazy(() => import('./curriculum/CurriculumHome'))
const ECECurriculum = lazy(() => import('./curriculum/ECECurriculum'))
const PrimaryCurriculum = lazy(() => import('./curriculum/PrimaryCurriculum'))
const SecondaryCurriculum = lazy(() => import('./curriculum/SecondaryCurriculum'))
const Curriculum2013Home = lazy(() => import('./curriculum/Curriculum2013Home'))
const ECE2013Curriculum = lazy(() => import('./curriculum/ECE2013Curriculum'))
const Primary2013Curriculum = lazy(() => import('./curriculum/Primary2013Curriculum'))
const Secondary2013Curriculum = lazy(() => import('./curriculum/Secondary2013Curriculum'))

const TeacherClassesList = lazy(() => import('./classes/TeacherClassesList'))
const TeacherClassEditor = lazy(() => import('./classes/TeacherClassEditor'))
const TeacherClassDetail = lazy(() => import('./classes/TeacherClassDetail'))
const ClassRegisterList = lazy(() => import('./register/ClassRegisterList'))
const ClassRegisterStudio = lazy(() => import('./register/attendance/ClassRegisterStudio'))
const ClassRegisterEditor = lazy(() => import('./register/ClassRegisterEditor'))
const ClassRegisterDetail = lazy(() => import('./register/ClassRegisterDetail'))

/**
 * Auth + shell for a teacher page. `variant` selects the content container
 * (see TeacherLayout); it never changes the navigation.
 */
export function TeacherRoute({ children, variant }) {
  return (
    <ProtectedRoute requiredRole="teacher">
      <TeacherLayout variant={variant}>{children}</TeacherLayout>
    </ProtectedRoute>
  )
}

// Legacy /teacher/test-papers, /teacher/exam-papers and /teacher/assessments
// paths redirect to the canonical /teacher/assessment-papers route family —
// same paper id, same query string (e.g. ?view=builder), so a bookmark, a
// dashboard deep-link or a saved notification link keeps landing on the
// exact same paper it always did. `suffix` is '/new', '/edit' or ''.
function LegacyAssessmentPaperRedirect({ suffix = '' }) {
  const { paperId } = useParams()
  const { search } = useLocation()
  const target = paperId
    ? `/teacher/assessment-papers/${paperId}${suffix}${search}`
    : `/teacher/assessment-papers${suffix}${search}`
  return <Navigate to={target} replace />
}

// The Question Bank stopped being a page of its own: it is a view inside the
// Assessment Paper Studio, because a bank you can search but not insert from
// made the teacher copy questions out by hand. The route stays as a redirect so
// bookmarks, dashboard links and anything already sent to a teacher keep
// working — with the query string carried across, so a link that arrived
// filtered opens filtered.
function LegacyQuestionBankRedirect() {
  const { search } = useLocation()
  return <Navigate to={questionBankRedirectPath(search)} replace />
}

// Legacy Lesson Plan Studio path → the canonical /teacher/lesson-plans/new
// route. The query string is preserved so Teaching-Kit prefills,
// dashboard deep-links and saved bookmarks keep landing on the same
// pre-filled studio.
function LegacyLessonPlanStudioRedirect() {
  const { search } = useLocation()
  return <Navigate to={`/teacher/lesson-plans/new${search}`} replace />
}

/**
 * A studio that is no longer offered: send the teacher to the studios list
 * with the reason in the URL (StudioUnavailableNotice renders it there).
 */
function UnavailableStudioRedirect({ tool }) {
  return <Navigate to={redirectTargetForTool(tool)} replace />
}

/**
 * A studio held behind a feature flag — Worksheet Studio, withdrawn for launch
 * and due back once the curated Diagram Library exists.
 *
 * The wait on `loaded` is not decoration. `settings/global` arrives over a
 * snapshot, so for the first frames of a cold load the flags are the context's
 * defaults and the studio resolves, correctly and fail-closed, to unavailable.
 * Redirecting on that answer would bounce a teacher who legitimately has the
 * flag on, and the redirect is `replace` — they would not even be able to go
 * back. A skeleton frame is the cheaper mistake.
 */
export function FlaggedStudioRoute({ tool, children }) {
  const { loaded } = usePlatformSettings()
  const { isAvailable } = useStudioAvailability()
  if (!loaded) return <PageLoader />
  if (!isAvailable(tool)) return <UnavailableStudioRedirect tool={tool} />
  return children
}

/** Shell-wrapped route. */
const page = (path, element, variant) => ({
  path,
  shell: true,
  element: <TeacherRoute variant={variant}>{element}</TeacherRoute>,
})

/** A studio behind the Free-plan gate. */
const studio = (path, tool, element) => page(path, <StudioGate tool={tool}>{element}</StudioGate>)

/** Deliberately outside the shell — the reason is required, not optional. */
const bare = (path, element, shellExemptReason) => ({
  path,
  element,
  shell: false,
  shellExemptReason,
})

/** A pure redirect: no page, so no shell to assert either way. */
const redirect = (path, element) =>
  bare(path, element, 'Redirect only — renders no page, so there is no shell to put it in.')

export const TEACHER_ROUTES = [
  // ── Dashboard, help, subscription ─────────────────────────────────
  // The dashboard brings its own grid and header but NOT its own
  // navigation — hence variant, not an exemption.
  page('/teacher', <TeacherDashboardLive />, 'dashboard'),
  page('/teacher/help', <TeacherHelpSupport />, 'dashboard'),
  // Subscription moved here from /my-subscription so it sits in the teacher
  // area like every other teacher destination (App.jsx forwards teachers).
  page('/teacher/subscription', <MySubscriptionPage inShell />),
  // Legacy dashboard kept reachable during the V2 transition
  page('/teacher/classic', <TeacherDashboard />),

  bare(
    '/teacher/welcome-to-pro',
    <ProtectedRoute requiredRole="teacher"><WelcomeToPro /></ProtectedRoute>,
    'Full-bleed post-upgrade celebration — a deliberate interstitial, not a '
    + 'destination in the teacher map. Reminder banners are suppressed here too '
    + '(reminderVisibility.js).',
  ),

  // ── Preview routes ────────────────────────────────────────────────
  // Mock data only; nothing here reads or writes Firestore, which is why
  // they are unguarded. The dashboard preview keeps the shell because the
  // shell is part of what it previews.
  {
    path: '/teacher/dashboard-preview',
    shell: true,
    element: <TeacherLayout variant="dashboard"><TeacherDashboardV2 /></TeacherLayout>,
  },
  bare('/teacher/register-preview', <ClassListRegisterPreview />,
    'Component fixture for pre-deployment review of the Class List / Register '
    + 'screens in isolation; the surrounding chrome is not what is under review.'),
  bare('/teacher/register-preview/capture', <CapturePreview />,
    'Component fixture — see /teacher/register-preview.'),
  bare('/teacher/register-preview/review', <ImportReviewPreview />,
    'Component fixture — see /teacher/register-preview.'),

  // ── Assessment Paper Studio ───────────────────────────────────────
  // Teacher-only, private. One studio for every assessment type:
  // topic/weekly/mid-term/end-of-term tests AND mock/examination/final
  // examinations — which type a paper is comes from its own assessmentType,
  // never from the route used to open it. Both create and edit run through
  // the same studio so a saved paper reopens in the full, type-complete
  // builder. Free sees a sample (StudioGate).
  studio('/teacher/assessment-papers', 'assessment', <AssessmentList />),
  studio('/teacher/assessment-papers/new', 'assessment', <AssessmentStudio />),
  studio('/teacher/assessment-papers/:paperId/edit', 'assessment', <AssessmentStudio />),

  // Legacy Test Paper Studio / Exam Studio / pre-rename Assessment paths —
  // the two studios were merged into one Assessment Paper Studio (paper id +
  // query string preserved); kept as redirects so old bookmarks, dashboard
  // deep-links and saved notification links keep resolving.
  redirect('/teacher/test-papers', <LegacyAssessmentPaperRedirect />),
  redirect('/teacher/test-papers/new', <LegacyAssessmentPaperRedirect suffix="/new" />),
  redirect('/teacher/test-papers/:paperId/edit', <LegacyAssessmentPaperRedirect suffix="/edit" />),
  redirect('/teacher/exam-papers', <LegacyAssessmentPaperRedirect />),
  redirect('/teacher/exam-papers/new', <LegacyAssessmentPaperRedirect suffix="/new" />),
  redirect('/teacher/exam-papers/:paperId/edit', <LegacyAssessmentPaperRedirect suffix="/edit" />),
  redirect('/teacher/assessments', <LegacyAssessmentPaperRedirect />),
  redirect('/teacher/assessments/new', <LegacyAssessmentPaperRedirect suffix="/new" />),
  redirect('/teacher/assessments/:paperId/edit', <LegacyAssessmentPaperRedirect suffix="/edit" />),

  // ── Lessons + Lesson Plan Studio ──────────────────────────────────
  page('/teacher/lessons', <LessonDashboard />),
  page('/teacher/lessons/new', <LessonEditor />),
  page('/teacher/lessons/:lessonId/edit', <LessonEditor />),
  // Lesson Plan Studio stays open on Free (the one studio every plan can
  // use). Canonical routes: list (library filtered to lesson plans),
  // create, edit-by-id.
  redirect('/teacher/lesson-plans', <Navigate to="/teacher/library?type=lesson_plans" replace />),
  page('/teacher/lesson-plans/new', <LessonPlanStudio />),
  page('/teacher/lesson-plans/:lessonPlanId/edit', <LessonPlanStudio />),
  redirect('/teacher/generate/lesson-plan', <LegacyLessonPlanStudioRedirect />),

  // ── Generator studios (Pro/Max — Free sees a read-only sample) ─────
  studio('/teacher/generate/homework', 'homework', <HomeworkStudio />),
  // Worksheet Studio is WITHDRAWN for launch, not deleted: its
  // picture-dependent output cannot be generated reliably yet. The module
  // still builds and this route still mounts it — behind
  // featureFlags.worksheetStudioEnabled (default off, admin-toggleable).
  studio('/teacher/generate/worksheet', 'worksheet', (
    <FlaggedStudioRoute tool="worksheet"><WorksheetGenerator /></FlaggedStudioRoute>
  )),
  studio('/teacher/generate/flashcards', 'flashcards', <FlashcardGenerator />),
  studio('/teacher/generate/scheme-of-work', 'scheme_of_work', <SchemeOfWorkGenerator />),
  studio('/teacher/generate/mark-schedule', 'mark_schedule', <MarkScheduleStudio />),
  studio('/teacher/generate/weekly-forecast', 'weekly_forecast', <WeeklyForecastStudio />),
  studio('/teacher/generate/record-of-work', 'record_of_work', <RecordOfWorkStudio />),
  studio('/teacher/generate/class-timetable', 'class_timetable', <ClassTimetableStudio />),
  // Rubric Studio is RETIRED — 4-level descriptor rubrics are not part of the
  // Zambian curriculum or the school teaching file. Saved rubrics stay in My
  // Library, read-only; the studio itself is gone and the path is kept only so
  // an old bookmark lands somewhere useful instead of on the SPA fallback.
  redirect('/teacher/generate/rubric', <UnavailableStudioRedirect tool="rubric" />),
  studio('/teacher/generate/notes', 'notes', <NotesStudio />),
  studio('/teacher/generate/sba', 'sba_task', <SbaTaskStudio />),
  studio('/teacher/generate/sba-tracker', 'sba_tracker', <SbaMarkTracker />),
  studio('/teacher/generate/sba-planner', 'sba_planner', <SbaYearPlanner />),
  page('/teacher/sba', <SbaHub />),
  page('/teacher/visual-studio', <VisualStudioPage />),
  redirect('/teacher/generate/visual-studio', <Navigate to="/teacher/visual-studio" replace />),
  // The old exam generator was upgraded to the block-based Assessment Paper
  // Studio; keep the path so saved links still land in the studio.
  redirect('/teacher/generate/exam-paper', <Navigate to="/teacher/assessment-papers" replace />),

  // ── Library, templates, question bank ─────────────────────────────
  page('/teacher/templates', <TemplateBank />),
  page('/teacher/templates/:id', <TemplateBankDetail />),
  page('/teacher/library', <TeacherLibrary />),
  page('/teacher/library/:id', <LibraryItemDetail />),
  page('/teacher/drafts', <RecoveryCentre />),
  redirect('/teacher/question-bank', <LegacyQuestionBankRedirect />),

  // ── Syllabi, curriculum, calendar ─────────────────────────────────
  page('/teacher/syllabi', <SyllabiLibrary />),
  page('/teacher/calendar', <SchoolCalendar />),
  page('/teacher/curriculum', <CurriculumHome />),
  page('/teacher/curriculum/ece', <ECECurriculum />),
  page('/teacher/curriculum/primary', <PrimaryCurriculum />),
  page('/teacher/curriculum/secondary', <SecondaryCurriculum />),
  // Previous (2013) curriculum reference — some grades are still taught on it.
  page('/teacher/curriculum/2013', <Curriculum2013Home />),
  page('/teacher/curriculum/2013/ece', <ECE2013Curriculum />),
  page('/teacher/curriculum/2013/primary', <Primary2013Curriculum />),
  page('/teacher/curriculum/2013/secondary', <Secondary2013Curriculum />),

  // ── Classes ───────────────────────────────────────────────────────
  page('/teacher/classes', <TeacherClassesList />),
  page('/teacher/classes/new', <TeacherClassEditor />),
  page('/teacher/classes/:classId', <TeacherClassDetail />),

  // ── Class Register — official class lists that feed SBA, mark
  //    schedules, results, reports and progress (one roster, no retyping).
  //    Separate from the invite-code classes above. The Class Register
  //    Studio adds daily attendance + official A4 register printing; it is
  //    ungated like the rest of the register (organisational tool, not a
  //    generator). ─────────────────────────────────────────────────
  page('/teacher/attendance', <ClassRegisterStudio />),
  page('/teacher/register', <ClassRegisterList />),
  page('/teacher/register/new', <ClassRegisterEditor />),
  page('/teacher/register/:classId', <ClassRegisterDetail />),
  page('/teacher/register/:classId/edit', <ClassRegisterEditor />),
  page('/teacher/register/:classId/:tab', <ClassRegisterDetail />),
]
