import { useState, useEffect, useMemo, lazy, Suspense } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { useTeacherUsage } from '../../hooks/useTeacherUsage'
import {
  listMyGenerations,
  summarizeGenerations,
  titleForGeneration,
  formatDate,
  duplicateGeneration,
  CLIENT_CREATED_TOOLS,
  TOOL_META as LIB_TOOL_META,
} from '../../utils/teacherLibraryService'
import { getDocumentActions } from '../../utils/documentActions'
import { useToast } from '../ui/Toast'
import { resolveTeacherPlan, PLAN_LABELS } from '../../utils/teacherPlans'
import { isExamPaperType, assessmentEditPath } from './paperTaxonomy'
import {
  getTimeGreeting,
  buildAiMessage,
  buildActivityStats,
  buildCelebrations,
  formatTrend,
} from '../../utils/teacherDashboardIntel'
import { buildRecommendations } from '../../utils/teacherRecommendations'
import { buildWeekPrep } from '../../utils/prepareThisWeek'
import { daysUntil, fmtDate, getActiveTerm, getCurrentForecastWeek, getNextTerm } from '../../utils/moeCalendar'
import { capture } from '../../utils/analytics'
import SeoHelmet from '../seo/SeoHelmet'
import AiRecommendations from './AiRecommendations'
import PrepareThisWeek from './PrepareThisWeek'
import QuickCreate from './QuickCreate'
import RecentDocuments from './RecentDocuments'
import TeacherOnboardingTour from './TeacherOnboardingTour'
import FeedbackButton from '../feedback/FeedbackButton'
import SuggestionNudge from '../feedback/SuggestionNudge'
import PushPermissionPrompt from '../ui/PushPermissionPrompt'
import Icon from '../ui/Icon'
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Calculator,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardCheckList,
  ClipboardList,
  DocumentTextIcon,
  FileText,
  FolderOpen,
  GraduationCap,
  Layers,
  LayoutGrid,
  PencilLine,
  Play,
  Search,
  Sparkles,
  Target,
} from '../ui/icons'
// 3D studio tile icons (optimised WebP, ~2KB each). Replaces the flat line
// icons on the workspace grid; one per tile, keyed to each studio below.
import iconClassRegister from '../../assets/teacher-icons/class-register.webp'
import iconVisualStudio from '../../assets/teacher-icons/visual-studio.webp'
import iconSchemeOfWork from '../../assets/teacher-icons/scheme-of-work.webp'
import iconWeeklyForecast from '../../assets/teacher-icons/weekly-forecast.webp'
import iconRecordOfWork from '../../assets/teacher-icons/record-of-work.webp'
import iconMarkSchedule from '../../assets/teacher-icons/mark-schedule.webp'
import iconClassTimetable from '../../assets/teacher-icons/class-timetable.webp'
import iconLessonPlan from '../../assets/teacher-icons/lesson-plan.webp'
import iconNotesStudio from '../../assets/teacher-icons/notes-studio.webp'
import iconWorksheet from '../../assets/teacher-icons/worksheet.webp'
import iconFlashcards from '../../assets/teacher-icons/flashcards.webp'
import iconRubric from '../../assets/teacher-icons/rubric.webp'
import iconAssessments from '../../assets/teacher-icons/assessments.webp'
import iconSbaStudio from '../../assets/teacher-icons/sba-studio.webp'
import iconLibrary from '../../assets/teacher-icons/library.webp'
import iconSchoolCalendar from '../../assets/teacher-icons/school-calendar.webp'
import iconSyllabiStudio from '../../assets/teacher-icons/syllabi-studio.webp'
// Premium hero illustration — 3D study-desk scene that matches the brand teal,
// so it blends straight into the hero gradient. Compressed to ~20KB WebP.
import heroDesk from '../../assets/teacher/hero-desk.webp'

// The full usage meter is heavy (its own data hook + big inline stylesheet) and
// lives behind the collapsed "View details" card, so it's lazy-loaded — the
// dashboard's first paint never pays for it.
const UsageMeter = lazy(() => import('./UsageMeter'))

// Tiles are grouped into the teacher workflows the "Teacher Workspace" renders
// as labelled sections (each with a header icon + "View all" link, matching the
// app design). `NEW` is reserved for genuinely recent tools so the badge keeps
// its signal; every other tile shows either its saved-count or no badge. Keep
// each group's items in their display order.
const STUDIO_GROUPS = [
  {
    label: 'Planning',
    icon: ClipboardList,
    accent: 'amber',
    viewAll: '/teacher/library',
    items: [
      {
        img: iconSyllabiStudio,
        tone: 'sky',
        badge: null,
        title: 'Syllabus Studio',
        tagline: 'Browse CBC subjects, topics, competences, and standards.',
        to: '/teacher/syllabi',
      },
      {
        img: iconSchemeOfWork,
        tone: 'amber',
        badge: null,
        libraryKey: 'scheme-of-work',
        title: 'Schemes of Work',
        tagline: 'Map term pacing, outcomes, and weekly checkpoints.',
        to: '/teacher/generate/scheme-of-work',
      },
      {
        img: iconSchoolCalendar,
        tone: 'indigo',
        badge: null,
        title: 'School Calendar',
        tagline: 'Check MoE terms, public holidays, and working days.',
        to: '/teacher/calendar',
      },
      {
        img: iconWeeklyForecast,
        tone: 'blue',
        badge: null,
        libraryKey: 'weekly-forecast',
        title: 'Weekly Forecast',
        tagline: 'Plan the week day by day from your scheme, syllabus and timetable.',
        to: '/teacher/generate/weekly-forecast',
      },
      {
        img: iconLessonPlan,
        tone: 'orange',
        badge: null,
        libraryKey: 'lesson-plan',
        title: 'Lesson Plans',
        tagline: 'Prepare CBC lessons with stages, resources, and assessment.',
        to: '/teacher/generate/lesson-plan',
      },
      {
        img: iconLessonPlan,
        tone: 'amber',
        badge: 'NEW',
        libraryKey: null,
        title: 'Template Bank',
        tagline: 'Find, copy and customise ready-made, curriculum-aligned lesson plan templates.',
        to: '/teacher/templates',
      },
      {
        img: iconRecordOfWork,
        tone: 'cyan',
        badge: null,
        libraryKey: 'record-of-work',
        title: 'Record of Work',
        tagline: 'Log what you actually taught each week, checked against your scheme.',
        to: '/teacher/generate/record-of-work',
      },
      {
        img: iconClassRegister,
        tone: 'green',
        badge: 'NEW',
        libraryKey: null,
        title: 'Class Register',
        tagline: 'Build one class list per class — SBA, marks and reports load every learner.',
        to: '/teacher/register',
      },
      {
        img: iconClassTimetable,
        tone: 'violet',
        badge: null,
        libraryKey: 'class-timetable',
        title: 'Class Timetable',
        tagline: 'Auto-fill a balanced week from the curriculum subjects.',
        to: '/teacher/generate/class-timetable',
      },
    ],
  },
  {
    label: 'Content & Teaching Materials',
    icon: BookOpen,
    accent: 'blue',
    viewAll: '/teacher/library',
    items: [
      {
        img: iconNotesStudio,
        tone: 'blue',
        badge: null,
        libraryKey: 'notes',
        title: 'Notes Studio',
        tagline: 'Turn a lesson plan into delivery notes and examples.',
        to: '/teacher/generate/notes',
      },
      {
        img: iconWorksheet,
        tone: 'green',
        badge: null,
        libraryKey: 'worksheet',
        title: 'Worksheets',
        tagline: 'Create classroom practice, exercises, and consolidation tasks.',
        to: '/teacher/generate/worksheet',
      },
      {
        img: iconFlashcards,
        tone: 'yellow',
        badge: null,
        libraryKey: 'flashcards',
        title: 'Flashcards',
        tagline: 'Build short revision prompts for recall and practice.',
        to: '/teacher/generate/flashcards',
      },
      {
        img: iconWorksheet,
        tone: 'sky',
        badge: null,
        libraryKey: 'homework',
        title: 'Homework Studio',
        tagline: 'Short take-home practice with an answer key and a parent note.',
        to: '/teacher/generate/homework',
      },
      {
        img: iconVisualStudio,
        tone: 'orange',
        badge: 'NEW',
        libraryKey: null,
        title: 'Visual Studio',
        tagline: 'Make labelled diagrams & test pictures, then send to a studio.',
        to: '/teacher/visual-studio',
      },
    ],
  },
  {
    label: 'Assessment & Marking',
    icon: ClipboardCheckList,
    accent: 'violet',
    viewAll: '/teacher/library',
    items: [
      {
        img: iconAssessments,
        tone: 'violet',
        badge: null,
        title: 'Test Papers',
        tagline: 'Build topic, weekly, mid-term, and end-of-term test papers.',
        to: '/teacher/test-papers',
      },
      {
        img: iconLibrary,
        tone: 'indigo',
        badge: 'NEW',
        title: 'Question Bank',
        tagline: 'Search your saved questions and the platform Master Bank. Reuse, duplicate, favourite.',
        to: '/teacher/question-bank',
      },
      {
        img: iconAssessments,
        tone: 'indigo',
        badge: 'NEW',
        libraryKey: 'exam-paper',
        title: 'Exam Studio',
        tagline: 'Build mock, examination, and exam papers at full exam standard.',
        to: '/teacher/exam-papers',
      },
      {
        img: iconRubric,
        tone: 'rose',
        badge: null,
        libraryKey: 'rubric',
        title: 'Rubrics',
        tagline: 'Define criteria, levels, and marking guidance.',
        to: '/teacher/generate/rubric',
      },
      {
        img: iconMarkSchedule,
        tone: 'green',
        badge: null,
        libraryKey: 'mark-schedule',
        title: 'Mark Schedule',
        tagline: 'Marks in — totals, class positions and report comments out.',
        to: '/teacher/generate/mark-schedule',
      },
    ],
  },
  {
    // All three SBA tools live together here so teachers can see at a glance
    // that they belong to the ECZ School Based Assessment workflow — not the
    // general test/exam tools above. The `description` spells out what SBA is
    // and who it's for; "View all" opens the SBA Hub, which carries the
    // step-by-step guide for each tool.
    label: 'School Based Assessment (SBA)',
    icon: GraduationCap,
    accent: 'blue',
    viewAll: '/teacher/sba',
    description:
      'ECZ School Based Assessment — Grades 5–7 only, worth 30% of the final Grade 7 mark (10% banked per grade). Create tasks, record marks and track coverage. These are not for ordinary class tests — use Test Papers or Exam Studio for those. New to SBA? Tap “View all” for a short how-to guide.',
    items: [
      {
        img: iconSbaStudio,
        tone: 'sky',
        badge: null,
        libraryKey: 'sba-task',
        title: 'SBA Studio',
        tagline: 'Step 1 · Create an ECZ-compliant SBA task — the right task type, Bloom level and marking scheme. Never multiple-choice.',
        to: '/teacher/generate/sba',
      },
      {
        img: iconSbaStudio,
        tone: 'cyan',
        badge: null,
        title: 'SBA Mark Tracker',
        tagline: 'Step 2 · Enter each pupil’s task marks; the 10%-per-grade SBA mark converts for you, ready for the ECZ OMES portal.',
        to: '/teacher/generate/sba-tracker',
      },
      {
        img: iconSbaStudio,
        tone: 'green',
        badge: null,
        title: 'SBA Year Planner',
        tagline: 'Step 3 · Plan every required task across the year and track each one Planned → Administered → Marked.',
        to: '/teacher/generate/sba-planner',
      },
    ],
  },
  {
    label: 'Library',
    icon: FolderOpen,
    accent: 'slate',
    viewAll: '/teacher/library',
    items: [
      {
        img: iconLibrary,
        tone: 'slate',
        badge: null,
        isLibrary: true,
        title: 'My Library',
        tagline: 'All saved plans, notes, worksheets, rubrics, and assessments.',
        to: '/teacher/library',
      },
      {
        img: iconLibrary,
        tone: 'slate',
        badge: null,
        title: 'Recovery Centre',
        tagline: 'Every unfinished draft across your studios — resume or clear it out.',
        to: '/teacher/drafts',
      },
    ],
  },
]

// Studio tile routes that are Pro/Max only — a Free teacher who opens one sees a
// read-only sample (StudioGate), so the tile is badged "Sample" for them. The
// Lesson Plan tile and the non-generator utilities (Syllabus, Calendar,
// Register, Visual Studio, SBA hub, Library) stay open and are absent here.
const LOCKED_STUDIO_PATHS = new Set([
  '/teacher/generate/scheme-of-work',
  '/teacher/generate/weekly-forecast',
  '/teacher/generate/record-of-work',
  '/teacher/generate/class-timetable',
  '/teacher/generate/notes',
  '/teacher/generate/worksheet',
  '/teacher/generate/flashcards',
  '/teacher/generate/homework',
  '/teacher/generate/rubric',
  '/teacher/generate/mark-schedule',
  '/teacher/test-papers',
  '/teacher/exam-papers',
  '/teacher/generate/sba',
  '/teacher/generate/sba-tracker',
  '/teacher/generate/sba-planner',
])

const TOOL_META = {
  lesson_plan: { icon: PencilLine, accent: '#fde2c4', label: 'Lesson Plan' },
  scheme_of_work: { icon: CalendarDays, accent: '#faecb8', label: 'Scheme of Work' },
  class_timetable: { icon: CalendarDays, accent: '#e3dcf5', label: 'Class Timetable' },
  worksheet: { icon: FileText, accent: '#d8ecd0', label: 'Worksheet' },
  flashcards: { icon: Layers, accent: '#fde9b8', label: 'Flashcards' },
  rubric: { icon: ClipboardCheckList, accent: '#f0d6e0', label: 'Rubric' },
  notes: { icon: DocumentTextIcon, accent: '#dbe7f4', label: 'Teacher Notes' },
  assessment: { icon: BarChart3, accent: '#e8d8f0', label: 'Test Paper' },
  assessments: { icon: BarChart3, accent: '#e8d8f0', label: 'Test Paper' },
  // 'quiz' stays for generations saved before the studio was retired (#909).
  quiz: { icon: ClipboardList, accent: '#cfe9f5', label: 'Quiz' },
  // 'full_lesson' stays for lessons saved before the studio was retired.
  full_lesson: { icon: Sparkles, accent: '#cfe9f5', label: 'Full Lesson' },
  exam_paper: { icon: GraduationCap, accent: '#dbdcf7', label: 'Exam Paper' },
  sba_task: { icon: GraduationCap, accent: '#d8e6f0', label: 'SBA Task' },
  sba_mark_sheet: { icon: Calculator, accent: '#dcefe2', label: 'SBA Mark Sheet' },
  sba_plan: { icon: Target, accent: '#dbe7f4', label: 'SBA Year Plan' },
}

// Per-activity-card icon + colour tone for the coloured badges on the
// "Your activity" stat cards.
const ACTIVITY_META = {
  plans: { icon: FileText, tone: 'green' },
  notes: { icon: BookOpen, tone: 'purple' },
  tests: { icon: ClipboardList, tone: 'blue' },
  week: { icon: BarChart3, tone: 'orange' },
  library: { icon: FolderOpen, tone: 'blue' },
}

function toMs(t) {
  if (!t) return 0
  if (typeof t.toDate === 'function') return t.toDate().getTime()
  return new Date(t).getTime() || 0
}

function formatSubject(s) {
  return String(s || '').replace(/_/g, ' ')
}

function SectionLabel({ children }) {
  return <div className="teacher-dashboard-eyebrow">{children}</div>
}

function WorkspaceSectionHead({ icon, accent, label, viewAll, description }) {
  return (
    <div className="teacher-workspace-section__head">
      <span className={`teacher-workspace-section__icon teacher-workspace-section__icon--${accent || 'amber'}`}>
        <Icon as={icon} size="sm" />
      </span>
      <div className="teacher-workspace-section__titles">
        <span className="teacher-workspace-section__label">{label}</span>
        {description && (
          <span className="teacher-workspace-section__desc">{description}</span>
        )}
      </div>
      {viewAll && (
        <Link to={viewAll} className="teacher-workspace-section__viewall">
          View all
          <Icon as={ArrowRight} size="xs" />
        </Link>
      )}
    </div>
  )
}

function StudioCard({ img, tone, badge, libraryKey, isLibrary, title, tagline, to, librarySummary, locked }) {
  const isSoon = badge === 'SOON'
  // STUDIOS uses dash-cased libraryKeys ('lesson-plan') but byTool is keyed
  // by the snake_cased Firestore tool ids ('lesson_plan') — normalize or the
  // saved count never matches.
  const count = libraryKey
    ? (librarySummary?.byTool?.[libraryKey.replace(/-/g, '_')] ?? 0)
    : isLibrary
    ? (librarySummary?.total ?? 0)
    : null
  // Only show a badge when there's something real to show: an explicit badge
  // (NEW/FREE/SOON) or a saved-count for library-backed tiles. Without this
  // guard, a badge-less tile with no count would render the literal "null saved".
  // A locked (Free-plan, Pro/Max-only) tile shows a "🔒 Sample" badge that
  // takes priority over the saved-count / NEW badge — it's the more useful
  // signal: clicking opens a read-only sample, not the studio.
  const showBadge = locked || badge !== null || count !== null
  const badgeText = locked ? '🔒 Sample' : badge !== null ? badge : `${count} saved`
  const badgeClass = locked
    ? 'teacher-workspace-card__badge--muted'
    : badge === 'FREE'
    ? 'teacher-workspace-card__badge--success'
    : badge === 'SOON'
    ? 'teacher-workspace-card__badge--muted'
    : badge === 'NEW'
    ? 'teacher-workspace-card__badge--accent'
    : 'teacher-workspace-card__badge--saved'
  const cardClass = [
    'teacher-workspace-card',
    `teacher-workspace-card--${tone || 'slate'}`,
    isSoon ? 'is-disabled' : '',
  ].filter(Boolean).join(' ')

  const inner = (
    <>
      <div className="teacher-workspace-card__top">
        <span className="teacher-workspace-card__icon">
          <img
            className="teacher-workspace-card__icon-img"
            src={img}
            alt=""
            aria-hidden="true"
            width="44"
            height="44"
            loading="lazy"
            decoding="async"
          />
        </span>
        {showBadge && (
          <span className={`teacher-workspace-card__badge ${badgeClass}`}>
            {badgeText}
          </span>
        )}
      </div>
      <p className="teacher-workspace-card__title">{title}</p>
      <p className="teacher-workspace-card__text">{tagline}</p>
    </>
  )

  if (isSoon) {
    return (
      <div className={cardClass} aria-disabled="true" title={`${title} - coming soon`}>
        {inner}
      </div>
    )
  }

  if (to) {
    return (
      <Link to={to} className={cardClass}>
        {inner}
      </Link>
    )
  }

  return <div className={`${cardClass} is-inactive`}>{inner}</div>
}

/* ── Compact monthly usage (collapsed by default) ─────────────────────────
   Replaces the always-open UsageMeter block with a slim summary card: a
   lesson-plan gauge, today's AI, and the next daily reset, plus the plan
   chip. Tapping "View details" lazy-mounts the full UsageMeter beneath it. */
function msToUtcMidnight(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.max(0, next - now.getTime())
}

function formatResetIn(ms) {
  const totalMin = Math.max(1, Math.round(ms / 60000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h <= 0) return `${m}m`
  return `${h}h ${String(m).padStart(2, '0')}m`
}

// Caps at or above this are treated as "unlimited" — the meter stores a
// sentinel rather than a real ceiling for the Max plan's uncapped studios.
const UNLIMITED_CAP = 99999

// SVG ring gauge for the lesson-plan allowance. The caller supplies the fill
// fraction: finite plans pass real used/cap (an empty ring at 0 usage),
// unlimited plans pass a gentle decorative arc. No floor here, so a finite
// plan at 0% genuinely reads as empty.
function UsageGauge({ value, pct }) {
  const r = 24
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, pct))
  return (
    <div className="teacher-usage-gauge">
      <svg viewBox="0 0 60 60" aria-hidden="true">
        <circle cx="30" cy="30" r={r} fill="none" stroke="#efe7d5" strokeWidth="7" />
        <circle
          cx="30" cy="30" r={r} fill="none" stroke="#2f7d5f" strokeWidth="7"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - clamped)}
          transform="rotate(-90 30 30)"
        />
      </svg>
      <span className="teacher-usage-gauge__value">{value}</span>
    </div>
  )
}

function CompactUsage() {
  const { currentUser } = useAuth()
  const { loading, data } = useTeacherUsage(currentUser?.uid)
  const [expanded, setExpanded] = useState(false)

  if (loading || !data) {
    // role="status" (a polite live region) + visually-hidden text tell screen
    // readers a load is pending; the skeleton shimmer stays decorative.
    return (
      <div className="teacher-usage-card teacher-usage-card--skeleton" role="status">
        <span className="sr-only">Loading your usage summary…</span>
      </div>
    )
  }

  const isMax = data.plan === 'max'
  const planCap = data.caps?.plans || 0
  const planUsed = data.used?.plans || 0
  const unlimited = isMax || planCap >= UNLIMITED_CAP
  // Finite plans show real used/cap; unlimited shows a gentle decorative arc.
  const gaugePct = unlimited ? Math.min(0.85, 0.18 + planUsed / 60) : planCap ? planUsed / planCap : 0
  const resetIn = formatResetIn(msToUtcMidnight())

  return (
    <div className="teacher-usage-wrap">
      <div className="teacher-usage-card">
        <div className="teacher-usage-card__row">
          <div className="teacher-usage-card__metric">
            <UsageGauge value={planUsed} pct={gaugePct} />
            <div className="teacher-usage-card__metric-body">
              <span className="teacher-usage-card__big">
                {planUsed}<span className="teacher-usage-card__den"> / {unlimited ? '∞' : planCap}</span>
              </span>
              <span className="teacher-usage-card__k">Lesson plans</span>
            </div>
          </div>

          <div className="teacher-usage-card__divider" aria-hidden="true" />

          <div className="teacher-usage-card__metric">
            <span className="teacher-usage-card__spark" aria-hidden="true">
              <Icon as={Sparkles} size="md" />
            </span>
            <div className="teacher-usage-card__metric-body">
              <span className="teacher-usage-card__big">
                {data.today}<span className="teacher-usage-card__den"> / {data.daily >= UNLIMITED_CAP ? '∞' : data.daily}</span>
              </span>
              <span className="teacher-usage-card__k">AI generations today</span>
              <span className="teacher-usage-card__reset">Resets in {resetIn}</span>
            </div>
          </div>

          <button
            type="button"
            className="teacher-usage-card__toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => {
              // Measures whether teachers still find the usage section now
              // that it lives at the bottom of the dashboard (redesign §11).
              if (!v) capture('usage_details_expanded', { placement: 'dashboard-bottom' })
              return !v
            })}
          >
            View details
            <Icon as={ChevronDown} size="xs" className={expanded ? 'teacher-usage-card__chevron is-open' : 'teacher-usage-card__chevron'} />
          </button>
        </div>
      </div>
      {expanded && (
        <Suspense
          fallback={
            <div className="teacher-usage-card teacher-usage-card--skeleton" role="status">
              <span className="sr-only">Loading usage details…</span>
            </div>
          }
        >
          <UsageMeter />
        </Suspense>
      )}
    </div>
  )
}

/* ── Continue cards: recent work with a real progress signal ──────────────
   A saved generation is a finished artifact ("Ready"); a draft test paper
   reflects how far it actually is (has questions vs empty). No fabricated
   percentages on finished work. */
function progressFor(resource) {
  if (resource.status !== 'draft') return { pct: 100, label: 'Ready' }
  if (resource.questionCount > 0) return { pct: 65, label: 'Draft' }
  return { pct: 25, label: 'Started' }
}

/* ── Compact plan card ────────────────────────────────────────────────────
   Slim replacement for the old large promotional SubscriptionReminderCard
   banner. Renders only for Free-plan teachers — it self-hides once they're on
   a paid plan, the same way the old banner did. Shows the current plan on the
   left and a quick Upgrade to Pro action on the right. */
function PlanQuickCard({ plan }) {
  const navigate = useNavigate()
  // Self-hide for paying teachers (Pro/Max) — only Free sees the upgrade card.
  if (plan !== 'free') return null

  return (
    <section className="zx-card flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm">
      <span className="inline-flex items-center gap-2 text-sm font-black text-slate-900">
        <span aria-hidden="true">⭐</span>
        {`${PLAN_LABELS.free} Plan`}
      </span>
      <button
        type="button"
        onClick={() => {
          capture('plan_upgrade_clicked', { source: 'dashboard-plan-card', placement: 'dashboard-bottom' })
          navigate('/my-subscription')
        }}
        className="inline-flex items-center gap-1 bg-transparent text-sm font-black text-amber-700 shadow-none min-h-0 hover:text-amber-900"
      >
        Upgrade to Pro
        <Icon as={ArrowRight} size="xs" />
      </button>
    </section>
  )
}

export default function TeacherDashboard() {
  const { currentUser, userProfile } = useAuth()
  const { getMyAssessments, updateAssessment } = useFirestore()
  const navigate = useNavigate()
  const toast = useToast()

  // "Current plan" reflects the teacher's actual studio entitlement
  // (users.teacherPlan, same field the usage meter + server gate on), not the
  // learner-style isPremium flag — otherwise a premium learner with no Pro
  // teacher plan would falsely read "Pro" while the meter still showed Free.
  const teacherPlan = resolveTeacherPlan(userProfile)
  // Free teachers can only open the Lesson Plan studio; other tiles open a
  // read-only sample, so they're badged "Sample" on the workspace grid.
  const isFreePlan = teacherPlan === 'free'

  const { data: usage } = useTeacherUsage(currentUser?.uid)

  const [generations, setGenerations] = useState([])
  const [assessments, setAssessments] = useState([])
  const [loading, setLoading] = useState(true)
  // True when the generations fetch itself failed (not merely returned
  // empty) — Prepare This Week shows its error state with a retry instead
  // of a misleading "set up your week" empty state.
  const [gensError, setGensError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [searchTerm, setSearchTerm] = useState('')
  const [activityRange, setActivityRange] = useState('week')
  // Activity statistics live behind a collapsed disclosure at the bottom of
  // the page (redesign §7) — Quick Create owns their old slot.
  const [activityOpen, setActivityOpen] = useState(false)

  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    async function load() {
      let gensFailed = false
      const [gens, papers] = await Promise.all([
        listMyGenerations({ uid: currentUser.uid }).catch(() => { gensFailed = true; return [] }),
        getMyAssessments(currentUser.uid).catch(() => []),
      ])
      if (cancelled) return
      setGenerations(gens)
      setAssessments(papers)
      setGensError(gensFailed)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [currentUser, getMyAssessments, reloadKey])

  // byTool keys stay snake_cased (the Firestore tool ids) — StudioCard
  // normalizes its dash-cased libraryKey before looking up.
  const librarySummary = useMemo(() => summarizeGenerations(generations), [generations])

  // One normalised list of everything the teacher has made — the single input
  // the intelligence helpers (greeting message, insights, stats, celebrations,
  // continue cards) all read from. Sorted newest-first.
  const resources = useMemo(() => {
    const fromGens = generations.map((g) => ({
      id: g.id,
      kind: 'generation',
      tool: g.tool,
      subject: g.inputs?.subject || g.output?.header?.subject || '',
      grade: g.inputs?.grade || g.output?.header?.grade || '',
      topic: g.output?.header?.topic || g.inputs?.topic || '',
      createdAt: toMs(g.createdAt),
      modifiedAt: 0, // generations carry no updatedAt — createdAt is the truth
      title: titleForGeneration(g),
      to: `/teacher/library/${g.id}`,
      status: 'ready',
      questionCount: 0,
      // The raw doc, kept for duplicateGeneration (it needs inputs/output/library).
      raw: g,
    }))
    // Test papers + exam papers both live in the `assessments` collection and
    // are edited by AssessmentStudio. The studio is split by paper type across
    // two routes (/teacher/test-papers vs /teacher/exam-papers), so the
    // continue-card link must match the type — otherwise the edit page loads
    // the wrong studio (or, when sourced from the wrong collection entirely,
    // 404s with "Test paper not found").
    const fromAssessments = assessments.map((a) => {
      const isExam = isExamPaperType(a.assessmentType)
      return {
        id: a.id,
        kind: 'assessment',
        tool: 'assessment',
        subject: a.subject || '',
        grade: a.grade || a.targetGrade || '',
        topic: a.topic || '',
        createdAt: toMs(a.createdAt),
        modifiedAt: toMs(a.updatedAt), // stamped by updateAssessment on every edit
        title: a.title || a.topic || `Untitled ${isExam ? 'exam' : 'test'} paper`,
        to: assessmentEditPath(a),
        // Papers with at least one question are ready artifacts; only empty
        // papers are genuinely unfinished drafts.
        status: (typeof a.questionCount === 'number' && a.questionCount > 0) ? 'ready' : 'draft',
        questionCount: typeof a.questionCount === 'number' ? a.questionCount : 0,
      }
    })
    return [...fromGens, ...fromAssessments].sort((a, b) => b.createdAt - a.createdAt)
  }, [generations, assessments])

  const firstName = useMemo(() => {
    const name = (userProfile?.displayName || '').trim()
    if (!name) return 'Teacher'
    // Keep an honorific if present ("Mr. Mwelwa"), else first token.
    const parts = name.split(/\s+/)
    if (/^(mr|mrs|ms|miss|dr|sir|madam)\.?$/i.test(parts[0]) && parts.length > 1) {
      return `${parts[0]} ${parts[1]}`
    }
    return parts[0]
  }, [userProfile])

  const greeting = useMemo(() => getTimeGreeting(Date.now(), firstName), [firstName])
  const aiMessage = useMemo(
    () => buildAiMessage({ resources, usage, now: Date.now() }),
    [resources, usage],
  )
  const activityStats = useMemo(
    () => buildActivityStats({ resources, now: Date.now(), range: activityRange }),
    [resources, activityRange],
  )
  const celebration = useMemo(
    () => buildCelebrations({ resources })[0] || null,
    [resources],
  )

  // The last subject context the dashboard resolved for this teacher —
  // persisted so Prepare This Week + AI Recommendations never silently
  // switch subject just because a document in another subject was edited
  // more recently. Replaced by Teaching Profile assignments when those land.
  const prepContextKey = currentUser ? `zedexams:prep-context:${currentUser.uid}` : null
  const preferredSubject = useMemo(() => {
    if (!prepContextKey) return ''
    try { return localStorage.getItem(prepContextKey) || '' } catch { return '' }
  }, [prepContextKey])

  // The MoE calendar context both weekly-preparation surfaces share. During
  // holidays the calendar points at Week 1 of the next term; isActiveTermNow
  // + the opening-date extras switch the cards into "next term" behaviour.
  const prepCalendar = useMemo(() => {
    const wk = getCurrentForecastWeek()
    if (!wk) return null
    const calendar = { ...wk, isActiveTermNow: Boolean(getActiveTerm()) }
    if (!calendar.isActiveTermNow) {
      const next = getNextTerm()
      if (next) {
        calendar.openLabel = fmtDate(next.term.open, 'full')
        calendar.daysToOpen = daysUntil(next.term.open)
      }
    }
    return calendar
  }, [])

  // Weekly preparation model — derived from the SAME generations fetch the
  // rest of the dashboard uses (no extra Firestore reads).
  const weekPrep = useMemo(
    () => buildWeekPrep({
      generations,
      calendar: prepCalendar,
      profileSubject: userProfile?.subject || '',
      preferredSubject,
      now: Date.now(),
    }),
    [generations, userProfile, prepCalendar, preferredSubject],
  )

  // Persist whatever context was resolved so the next visit sticks with it.
  useEffect(() => {
    const subject = weekPrep?.context?.subject
    if (!prepContextKey || !subject) return
    try { localStorage.setItem(prepContextKey, subject) } catch { /* storage unavailable */ }
  }, [weekPrep, prepContextKey])

  // Actionable AI Recommendations (replaces the passive insights) — same
  // inputs, no extra reads; every card's condition is verified in data.
  const recommendations = useMemo(
    () => buildRecommendations({
      generations,
      assessments,
      calendar: prepCalendar,
      profileSubject: userProfile?.subject || '',
      preferredSubject,
    }),
    [generations, assessments, userProfile, prepCalendar, preferredSubject],
  )

  const continueItems = useMemo(() => {
    // Drafts (genuinely unfinished) first, then the most recent saved work.
    const drafts = resources.filter((r) => r.status === 'draft')
    const rest = resources.filter((r) => r.status !== 'draft')
    return [...drafts, ...rest].slice(0, 4)
  }, [resources])

  // Recent documents — newest first by last edit (assessments carry
  // updatedAt; generations only createdAt), shaped for the RecentDocuments
  // rows. Capabilities come from the central resolver so the menu never
  // offers an action this document type can't honour.
  const recentItems = useMemo(() => {
    return [...resources]
      .sort((a, b) => (b.modifiedAt || b.createdAt) - (a.modifiedAt || a.createdAt))
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        tool: r.tool,
        icon: LIB_TOOL_META[r.tool]?.icon || '📄',
        title: r.title,
        typeLabel: LIB_TOOL_META[r.tool]?.label || TOOL_META[r.tool]?.label || 'Document',
        grade: r.grade,
        subject: formatSubject(r.subject),
        timeLabel: `${r.modifiedAt && r.modifiedAt !== r.createdAt ? 'Edited' : 'Created'} ${formatDate(r.modifiedAt || r.createdAt)}`,
        status: r.status === 'draft' ? 'draft' : 'ready',
        to: r.to,
        actions: getDocumentActions(r, { clientCreatedTools: CLIENT_CREATED_TOOLS }),
        raw: r.raw,
      }))
  }, [resources])

  async function handleDuplicateRecent(item) {
    try {
      await duplicateGeneration(item.raw, currentUser?.uid)
      toast.success('Document duplicated — a copy has been added to Recent documents.')
      // One server-confirmed refetch of the existing limited query; no new
      // listeners, no full-page reload, scroll position untouched.
      setLoading(true)
      setReloadKey((k) => k + 1)
    } catch (err) {
      toast.error(err?.message || 'We could not duplicate this document. The original document was not changed.')
    }
  }

  async function handleRenameRecent(item, title) {
    try {
      await updateAssessment(item.id, { title })
      setAssessments((prev) => prev.map((a) => (a.id === item.id ? { ...a, title } : a)))
      toast.success('Renamed.')
    } catch {
      toast.error('Could not rename. Try again.')
    }
  }

  const lastItem = continueItems[0] || null

  function handleSearch(e) {
    e.preventDefault()
    const term = searchTerm.trim()
    navigate(term ? `/teacher/library?q=${encodeURIComponent(term)}` : '/teacher/library')
  }

  return (
    <div className="teacher-dashboard-surface">
      <SeoHelmet title="Teacher dashboard" noIndex />
      <TeacherOnboardingTour />

      {celebration && (
        <div className="teacher-celebrate" role="status">
          <span className="teacher-celebrate__emoji" aria-hidden="true">{celebration.emoji}</span>
          <span className="teacher-celebrate__text">{celebration.text}</span>
        </div>
      )}

      {/* Audit A5.1 — push opt-in for teachers (self-gates on push support +
          unasked + permission 'default', so it renders nothing once handled). */}
      <PushPermissionPrompt variant="teacher" />

      {/* ── AI Workspace hero ─────────────────────────────────────── */}
      <section className={`teacher-hero teacher-hero--${greeting.part}`}>
        <img
          className="teacher-hero__illus"
          src={heroDesk}
          alt=""
          aria-hidden="true"
          width="880"
          height="660"
          fetchPriority="high"
          decoding="async"
        />
        <div className="teacher-hero__content">
          <h1 className="teacher-hero__greeting">
            <span className="teacher-hero__greeting-top">
              <span className="teacher-hero__time-icon" aria-hidden="true">{greeting.emoji}</span>
              {greeting.label},
            </span>
            <span className="teacher-hero__greeting-name">
              {firstName} <span aria-hidden="true">👋</span>
            </span>
          </h1>
          <p className="teacher-hero__message">{aiMessage}</p>

          {lastItem ? (
            <Link to={lastItem.to} className="teacher-hero__continue">
              <span
                className="teacher-hero__continue-icon"
                style={{ '--c-bg': (TOOL_META[lastItem.tool]?.accent) || '#dcefe2' }}
              >
                <Icon as={(TOOL_META[lastItem.tool]?.icon) || DocumentTextIcon} size="sm" />
              </span>
              <div className="teacher-hero__continue-info">
                <span className="teacher-hero__continue-label">Last opened</span>
                <p className="teacher-hero__continue-title">
                  {formatSubject(lastItem.subject) || lastItem.title}
                </p>
                <span className="teacher-hero__continue-sub">
                  {[lastItem.grade, lastItem.topic ? `Lesson: ${lastItem.topic}` : '']
                    .filter(Boolean).join(' • ') || (TOOL_META[lastItem.tool]?.label || '')}
                </span>
              </div>
              <span className="teacher-hero__continue-time">{formatDate(lastItem.createdAt)}</span>
              <span className="teacher-hero__cta">
                Continue plan
                <Icon as={ArrowRight} size="sm" />
              </span>
            </Link>
          ) : (
            <Link to="/teacher/generate/lesson-plan" className="teacher-hero__continue teacher-hero__continue--empty">
              <div className="teacher-hero__continue-info">
                <span className="teacher-hero__continue-label">Get started</span>
                <p className="teacher-hero__continue-title">Create your first lesson</p>
                <span className="teacher-hero__continue-sub">CBC-aligned • under a minute</span>
              </div>
              <span className="teacher-hero__cta">
                <Icon as={PencilLine} size="sm" />
                Create Your First Lesson
              </span>
            </Link>
          )}
        </div>
      </section>

      {/* ── Universal search ──────────────────────────────────────── */}
      <form className="teacher-universal-search" onSubmit={handleSearch} role="search">
        <Icon as={Search} size="sm" className="teacher-universal-search__icon" />
        <input
          type="search"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search lessons, notes, tests, worksheets…"
          aria-label="Search all your teaching materials"
          className="teacher-universal-search__input"
        />
        <button type="submit" className="teacher-universal-search__filter" aria-label="Search your library">
          <Icon as={ArrowRight} size="sm" />
        </button>
      </form>

      {/* ── Prepare This Week (weekly preparation guide) ──────────── */}
      <PrepareThisWeek
        loading={loading}
        error={gensError}
        prep={weekPrep}
        onRetry={() => { setLoading(true); setReloadKey((k) => k + 1) }}
      />

      {/* ── Continue where you left off ───────────────────────────── */}
      <section className="teacher-continue">
        <div className="teacher-section-head">
          <SectionLabel>Continue where you left off</SectionLabel>
          {lastItem && (
            <Link to="/teacher/library" className="teacher-section-head__link">View all</Link>
          )}
        </div>
        {loading ? (
          <div className="teacher-continue-feature teacher-continue-feature--skeleton" />
        ) : !lastItem ? (
          <div className="teacher-empty-state">
            <span className="teacher-empty-state__icon"><Icon as={FolderOpen} size="xl" /></span>
            <p className="teacher-empty-state__title">Nothing recent yet</p>
            <p className="teacher-empty-state__text">Choose a workspace below — your most recent work will appear here.</p>
          </div>
        ) : (
          (() => {
            const meta = TOOL_META[lastItem.tool] || { icon: DocumentTextIcon, accent: '#f0eee8', label: 'Item' }
            const prog = progressFor(lastItem)
            const steps = lastItem.tool === 'lesson_plan' ? 6 : null
            const curStep = steps ? Math.max(1, Math.round((prog.pct / 100) * steps)) : null
            return (
              <div className="teacher-continue-feature">
                <span className="teacher-continue-feature__icon" style={{ '--c-bg': meta.accent }}>
                  <Icon as={meta.icon} size="md" />
                </span>
                <div className="teacher-continue-feature__body">
                  <p className="teacher-continue-feature__title">{lastItem.topic || lastItem.title}</p>
                  <p className="teacher-continue-feature__meta">
                    {[formatSubject(lastItem.subject), lastItem.grade].filter(Boolean).join(' • ') || meta.label}
                  </p>
                  <div className="teacher-continue-feature__bar">
                    <div className="teacher-continue-feature__fill" style={{ width: `${prog.pct}%` }} />
                  </div>
                  <div className="teacher-continue-feature__foot">
                    <span>{curStep ? `Step ${curStep} of ${steps}` : meta.label}</span>
                    <span>{prog.pct}% complete</span>
                  </div>
                </div>
                <Link to={lastItem.to} className="teacher-continue-feature__cta">
                  <Icon as={Play} size="sm" />
                  Continue
                </Link>
              </div>
            )
          })()
        )}
      </section>

      {/* ── Quick create (the four primary studio actions) ────────── */}
      <QuickCreate />

      {/* ── AI Recommendations (actionable; replaces AI insights) ─── */}
      {!loading && <AiRecommendations recommendations={recommendations} />}

      {/* ── Recent documents ──────────────────────────────────────── */}
      <RecentDocuments
        items={recentItems}
        loading={loading}
        onDuplicate={handleDuplicateRecent}
        onRename={handleRenameRecent}
      />

      {/* ── Teacher workspace (studios) ───────────────────────────── */}
      <div id="teacher-workspace" className="teacher-workspace-header teacher-defer">
        <span className="teacher-workspace-header__icon">
          <Icon as={LayoutGrid} size="md" />
        </span>
        <div>
          {/* Focus target for Quick Create's "View all teacher tools" —
              tabIndex={-1} lets the button move keyboard focus here. */}
          <h2 id="teacher-workspace-title" tabIndex={-1} className="teacher-workspace-header__title">
            Teacher Workspace
          </h2>
          <p className="teacher-workspace-header__text">Everything you need in one place</p>
        </div>
      </div>

      {STUDIO_GROUPS.map((group) => (
        <section key={group.label} className="teacher-workspace-section teacher-defer">
          <WorkspaceSectionHead
            icon={group.icon}
            accent={group.accent}
            label={group.label}
            viewAll={group.viewAll}
            description={group.description}
          />
          <div className="teacher-workspace-grid">
            {group.items.map((s) => (
              <StudioCard
                key={s.title}
                {...s}
                librarySummary={librarySummary}
                locked={isFreePlan && LOCKED_STUDIO_PATHS.has(s.to)}
              />
            ))}
          </div>
        </section>
      ))}

      {/* ── Your activity (collapsed disclosure — the stats moved out of
          the main flow when Quick Create took their slot; the numbers and
          honest trends stay one tap away) ──────────────────────────── */}
      {!loading && (
        <section className="teacher-activity teacher-defer">
          <button
            type="button"
            className="teacher-activity__toggle"
            aria-expanded={activityOpen}
            onClick={() => {
              setActivityOpen((v) => {
                if (!v) capture('dashboard_activity_expanded', {})
                return !v
              })
            }}
          >
            <span className="teacher-dashboard-eyebrow">Your activity</span>
            <span className="teacher-activity__toggle-hint">
              {activityOpen ? 'Hide' : 'View'}
              <Icon
                as={ChevronDown}
                size="xs"
                className={activityOpen ? 'teacher-usage-card__chevron is-open' : 'teacher-usage-card__chevron'}
              />
            </span>
          </button>
          {activityOpen && (
            <>
              <div className="teacher-section-head">
                <span className="sr-only">Activity statistics</span>
                <label className="teacher-range">
                  <select
                    value={activityRange}
                    onChange={(e) => setActivityRange(e.target.value)}
                    aria-label="Activity range"
                  >
                    <option value="week">This week</option>
                    <option value="month">This month</option>
                  </select>
                  <Icon as={ChevronDown} size="xs" />
                </label>
              </div>
              <div className="teacher-activity__grid">
                {activityStats.filter((s) => s.key !== 'library').map((s) => {
                  const am = ACTIVITY_META[s.key] || { icon: DocumentTextIcon, tone: 'slate' }
                  // 'new' shares the positive (green) styling with 'up'.
                  const toneDir = s.trend.dir === 'new' ? 'up' : s.trend.dir
                  return (
                    <div key={s.key} className="teacher-activity-card">
                      <div className="teacher-activity-card__top">
                        <span className={`teacher-activity-card__badge teacher-activity-card__badge--${am.tone}`}>
                          <Icon as={am.icon} size="sm" />
                        </span>
                        <p className="teacher-activity-card__value">{s.period}</p>
                      </div>
                      <p className="teacher-activity-card__label">{s.label}</p>
                      <span className={`teacher-activity-card__trend teacher-activity-card__trend--${toneDir}`}>
                        {formatTrend(s.trend, s.basis)}
                      </span>
                    </div>
                  )
                })}
              </div>
              {(() => {
                const lib = activityStats.find((s) => s.key === 'library')
                if (!lib) return null
                return (
                  <Link to="/teacher/library" className="teacher-activity-total">
                    <span className="teacher-activity-card__badge teacher-activity-card__badge--blue">
                      <Icon as={FolderOpen} size="sm" />
                    </span>
                    <div className="teacher-activity-total__body">
                      <p className="teacher-activity-total__value">{lib.total}</p>
                      <p className="teacher-activity-total__label">Total in library</p>
                    </div>
                    <Icon as={ChevronRight} size="sm" className="teacher-activity-total__arrow" />
                  </Link>
                )
              })()}
            </>
          )}
        </section>
      )}

      {/* ── Compact plan + usage (bottom of the page by design: the dashboard
          leads with teaching work, not usage statistics; the full breakdown
          stays one tap away behind "View details") ─────────────────── */}
      <PlanQuickCard plan={teacherPlan} />

      <section className="teacher-usage-section teacher-defer">
        <div className="teacher-section-head">
          <SectionLabel>Your usage this month</SectionLabel>
          {usage && usage.plan !== 'free' && (
            <span className={`teacher-plan-chip teacher-plan-chip--${usage.plan}`}>
              <span aria-hidden="true">👑</span> {usage.planLabel} Plan
            </span>
          )}
        </div>
        <CompactUsage />
      </section>

      <div className="mt-6">
        <FeedbackButton source="teacher-dashboard" />
      </div>

      <SuggestionNudge source="teacher-dashboard" />
    </div>
  )
}
