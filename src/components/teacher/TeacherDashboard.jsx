import { useState, useEffect, useMemo, lazy, Suspense } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { useTeacherUsage } from '../../hooks/useTeacherUsage'
import {
  listMyGenerations,
  titleForGeneration,
  formatDate,
} from '../../utils/teacherLibraryService'
import { resolveTeacherPlan } from '../../utils/teacherPlans'
import {
  getTimeGreeting,
  buildAiMessage,
  buildInsights,
  rotateInsights,
  buildActivityStats,
  buildCelebrations,
} from '../../utils/teacherDashboardIntel'
import SubscriptionReminderCard from '../subscription/SubscriptionReminderCard'
import SeoHelmet from '../seo/SeoHelmet'
import TeacherOnboardingTour from './TeacherOnboardingTour'
import FeedbackButton from '../feedback/FeedbackButton'
import SuggestionNudge from '../feedback/SuggestionNudge'
import Icon from '../ui/Icon'
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Calculator,
  CalendarDays,
  ChevronDown,
  ClipboardCheckList,
  ClipboardList,
  Clock,
  DocumentTextIcon,
  FileText,
  FolderOpen,
  GraduationCap,
  Layers,
  LayoutGrid,
  PencilLine,
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
        img: iconSbaStudio,
        tone: 'sky',
        badge: null,
        libraryKey: 'sba',
        title: 'SBA Studio',
        tagline: 'ECZ School Based Assessment — create tasks, record marks, track coverage.',
        to: '/teacher/sba',
      },
      {
        img: iconSbaStudio,
        tone: 'cyan',
        badge: null,
        title: 'SBA Mark Tracker',
        tagline: 'Record SBA marks and watch task coverage build up over the term.',
        to: '/teacher/generate/sba-tracker',
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
    label: 'SBA Planning',
    icon: Target,
    accent: 'green',
    viewAll: '/teacher/sba',
    items: [
      {
        img: iconSbaStudio,
        tone: 'sky',
        badge: null,
        title: 'SBA Year Planner',
        tagline: 'Plan SBA tasks across the year and track planned vs marked.',
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
  '/teacher/generate/rubric',
  '/teacher/generate/mark-schedule',
  '/teacher/test-papers',
  '/teacher/exam-papers',
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
  full_lesson: { icon: Sparkles, accent: '#cfe9f5', label: 'Full Lesson' },
  exam_paper: { icon: GraduationCap, accent: '#dbdcf7', label: 'Exam Paper' },
  sba_task: { icon: GraduationCap, accent: '#d8e6f0', label: 'SBA Task' },
  sba_mark_sheet: { icon: Calculator, accent: '#dcefe2', label: 'SBA Mark Sheet' },
  sba_plan: { icon: Target, accent: '#dbe7f4', label: 'SBA Year Plan' },
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

function WorkspaceSectionHead({ icon, accent, label, viewAll }) {
  return (
    <div className="teacher-workspace-section__head">
      <span className={`teacher-workspace-section__icon teacher-workspace-section__icon--${accent || 'amber'}`}>
        <Icon as={icon} size="sm" />
      </span>
      <span className="teacher-workspace-section__label">{label}</span>
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
   Replaces the always-open UsageMeter block with a slim summary card: plan,
   lesson-plan allowance, today's AI, and the next reset. Tapping "View
   details" lazy-mounts the full UsageMeter beneath it. */
function hoursToUtcMidnight(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.max(1, Math.ceil((next - now.getTime()) / (1000 * 60 * 60)))
}

function CompactUsage() {
  const { currentUser } = useAuth()
  const { loading, data } = useTeacherUsage(currentUser?.uid)
  const [expanded, setExpanded] = useState(false)

  if (loading || !data) {
    return <div className="teacher-usage-compact teacher-usage-compact--skeleton" aria-hidden="true" />
  }

  const isMax = data.plan === 'max'
  const planCap = data.caps?.plans || 0
  const planUsed = data.used?.plans || 0
  const resetHours = hoursToUtcMidnight()

  return (
    <div className="teacher-usage-wrap">
      <div className="teacher-usage-compact">
        <div className="teacher-usage-compact__cells">
          <div className="teacher-usage-compact__cell">
            <span className="teacher-usage-compact__k">Plan</span>
            <span className="teacher-usage-compact__v">{data.planLabel}</span>
          </div>
          <div className="teacher-usage-compact__cell">
            <span className="teacher-usage-compact__k">Lesson plans</span>
            <span className="teacher-usage-compact__v">
              {planUsed} / {isMax || planCap >= 99999 ? 'Unlimited' : planCap}
            </span>
          </div>
          <div className="teacher-usage-compact__cell">
            <span className="teacher-usage-compact__k">Today's AI</span>
            <span className="teacher-usage-compact__v">
              {data.today} / {data.daily >= 99999 ? '∞' : data.daily}
            </span>
          </div>
          <div className="teacher-usage-compact__cell">
            <span className="teacher-usage-compact__k">Resets in</span>
            <span className="teacher-usage-compact__v">{resetHours} hour{resetHours === 1 ? '' : 's'}</span>
          </div>
        </div>
        <button
          type="button"
          className="teacher-usage-compact__toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Hide details' : 'View details'}
          <Icon as={ChevronDown} size="xs" className={expanded ? 'teacher-usage-compact__chevron is-open' : 'teacher-usage-compact__chevron'} />
        </button>
      </div>
      {expanded && (
        <Suspense fallback={<div className="teacher-usage-compact teacher-usage-compact--skeleton" aria-hidden="true" />}>
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

export default function TeacherDashboard() {
  const { currentUser, userProfile } = useAuth()
  const { getMyQuizzes } = useFirestore()
  const navigate = useNavigate()

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
  const [quizzes, setQuizzes] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    async function load() {
      const [gens, qs] = await Promise.all([
        listMyGenerations({ uid: currentUser.uid }).catch(() => []),
        getMyQuizzes(currentUser.uid).catch(() => []),
      ])
      if (cancelled) return
      setGenerations(gens)
      setQuizzes(qs)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [currentUser, getMyQuizzes])

  const librarySummary = useMemo(() => {
    const byTool = generations.reduce((acc, g) => {
      const key = (g.tool || '').replace(/_/g, '-')
      if (!key) return acc
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
    return { total: generations.length, byTool }
  }, [generations])

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
      title: titleForGeneration(g),
      to: `/teacher/library/${g.id}`,
      status: 'ready',
      questionCount: 0,
    }))
    const fromQuizzes = quizzes.map((q) => ({
      id: q.id,
      kind: 'quiz',
      tool: 'assessment',
      subject: q.subject || '',
      grade: q.grade || q.targetGrade || '',
      topic: q.topic || '',
      createdAt: toMs(q.createdAt),
      title: q.title || q.topic || 'Untitled test paper',
      to: `/teacher/test-papers/${q.id}/edit`,
      status: q.published === false || q.status === 'draft' ? 'draft' : 'ready',
      questionCount: Array.isArray(q.questions) ? q.questions.length : 0,
    }))
    return [...fromGens, ...fromQuizzes].sort((a, b) => b.createdAt - a.createdAt)
  }, [generations, quizzes])

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
  const insights = useMemo(
    () => rotateInsights(buildInsights({ resources, usage, now: Date.now() }), Date.now(), 3),
    [resources, usage],
  )
  const activityStats = useMemo(
    () => buildActivityStats({ resources, now: Date.now() }),
    [resources],
  )
  const celebration = useMemo(
    () => buildCelebrations({ resources })[0] || null,
    [resources],
  )

  const continueItems = useMemo(() => {
    // Drafts (genuinely unfinished) first, then the most recent saved work.
    const drafts = resources.filter((r) => r.status === 'draft')
    const rest = resources.filter((r) => r.status !== 'draft')
    return [...drafts, ...rest].slice(0, 4)
  }, [resources])

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
      {/* Subscription reminder — Free/Expired teachers get an upgrade card
          listing their Pro toolkit; self-hides once they're on Pro/Max. */}
      <SubscriptionReminderCard audience="teacher" />

      {celebration && (
        <div className="teacher-celebrate" role="status">
          <span className="teacher-celebrate__emoji" aria-hidden="true">{celebration.emoji}</span>
          <span className="teacher-celebrate__text">{celebration.text}</span>
        </div>
      )}

      {/* ── AI Workspace hero ─────────────────────────────────────── */}
      <section className={`teacher-hero teacher-hero--${greeting.part}`}>
        <div className="teacher-hero__art" aria-hidden="true">
          <span className="teacher-hero__art-emoji">{greeting.emoji}</span>
        </div>
        <div className="teacher-hero__content">
          <span className="teacher-hero__eyebrow">
            <Icon as={Sparkles} size="sm" />
            Your AI workspace
          </span>
          <h1 className="teacher-hero__greeting">
            {greeting.emoji} {greeting.text}
          </h1>
          <p className="teacher-hero__message">{aiMessage}</p>

          {lastItem ? (
            <div className="teacher-hero__continue">
              <div className="teacher-hero__continue-info">
                <span className="teacher-hero__continue-label">Continue working</span>
                <p className="teacher-hero__continue-title">{lastItem.title}</p>
                <div className="teacher-hero__continue-facts">
                  {lastItem.subject && <span>{formatSubject(lastItem.subject)}</span>}
                  {lastItem.grade && <span>{lastItem.grade}</span>}
                  {lastItem.topic && lastItem.topic !== lastItem.title && <span>{lastItem.topic}</span>}
                  <span><Icon as={Clock} size="xs" /> {formatDate(lastItem.createdAt)}</span>
                </div>
              </div>
              <Link to={lastItem.to} className="teacher-hero__cta">
                {lastItem.kind === 'generation' ? 'Continue' : 'Continue editing'}
                <Icon as={ArrowRight} size="sm" />
              </Link>
            </div>
          ) : (
            <div className="teacher-hero__continue">
              <div className="teacher-hero__continue-info">
                <span className="teacher-hero__continue-label">Get started</span>
                <p className="teacher-hero__continue-title">Create your first lesson</p>
                <div className="teacher-hero__continue-facts">
                  <span>CBC-aligned</span>
                  <span>Under a minute</span>
                </div>
              </div>
              <Link to="/teacher/generate/lesson-plan" className="teacher-hero__cta">
                <Icon as={PencilLine} size="sm" />
                Create Your First Lesson
              </Link>
            </div>
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
          placeholder="Search lessons, notes, worksheets, tests, schemes…"
          aria-label="Search all your teaching materials"
          className="teacher-universal-search__input"
        />
        <button type="submit" className="teacher-universal-search__btn">Search</button>
      </form>

      {/* ── AI insights ───────────────────────────────────────────── */}
      {!loading && insights.length > 0 && (
        <section className="teacher-insights">
          <SectionLabel>AI insights</SectionLabel>
          <div className="teacher-insights__grid">
            {insights.map((it) => (
              <div key={it.id} className="teacher-insight-card">
                <span className="teacher-insight-card__icon" aria-hidden="true">{it.icon}</span>
                <p className="teacher-insight-card__text">{it.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Continue where you left off ───────────────────────────── */}
      <section className="teacher-continue">
        <SectionLabel>Continue where you left off</SectionLabel>
        {loading ? (
          <div className="teacher-continue__grid">
            {[0, 1, 2].map((i) => <div key={i} className="teacher-continue-card teacher-continue-card--skeleton" />)}
          </div>
        ) : continueItems.length === 0 ? (
          <div className="teacher-empty-state">
            <span className="teacher-empty-state__icon"><Icon as={FolderOpen} size="xl" /></span>
            <p className="teacher-empty-state__title">Nothing recent yet</p>
            <p className="teacher-empty-state__text">Choose a workspace below — your most recent work will appear here.</p>
          </div>
        ) : (
          <div className="teacher-continue__grid">
            {continueItems.map((item) => {
              const meta = TOOL_META[item.tool] || { icon: DocumentTextIcon, accent: '#f0eee8', label: 'Item' }
              const prog = progressFor(item)
              return (
                <Link key={`${item.kind}-${item.id}`} to={item.to} className="teacher-continue-card">
                  <div className="teacher-continue-card__head">
                    <span className="teacher-continue-card__icon" style={{ '--c-bg': meta.accent }}>
                      <Icon as={meta.icon} size="sm" />
                    </span>
                    <span className={`teacher-continue-card__chip teacher-continue-card__chip--${prog.label.toLowerCase()}`}>
                      {prog.label}
                    </span>
                  </div>
                  <p className="teacher-continue-card__title line-clamp-2">{item.title}</p>
                  <p className="teacher-continue-card__meta">
                    {[meta.label, item.grade, formatSubject(item.subject)].filter(Boolean).join(' · ')}
                  </p>
                  <div className="teacher-continue-card__bar">
                    <div className="teacher-continue-card__fill" style={{ width: `${prog.pct}%` }} />
                  </div>
                  <div className="teacher-continue-card__foot">
                    <span>{prog.pct}% {prog.label === 'Ready' ? 'complete' : 'done'}</span>
                    <span>{formatDate(item.createdAt)}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Activity ──────────────────────────────────────────────── */}
      {!loading && (
        <section className="teacher-activity">
          <SectionLabel>Activity</SectionLabel>
          <div className="teacher-activity__grid">
            {activityStats.map((s) => (
              <div key={s.key} className="teacher-activity-card">
                <p className="teacher-activity-card__value">{s.total}</p>
                <p className="teacher-activity-card__label">{s.label}</p>
                <span className={`teacher-activity-card__trend teacher-activity-card__trend--${s.trend.dir}`}>
                  {s.trend.dir === 'up' ? '↑' : s.trend.dir === 'down' ? '↓' : '→'}{' '}
                  {s.trend.dir === 'flat' ? 'No change' : `${s.trend.pct}%`}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Monthly usage (compact, collapsed) ────────────────────── */}
      <section className="teacher-usage-section">
        <SectionLabel>Monthly usage</SectionLabel>
        <CompactUsage />
      </section>

      {/* ── Teacher workspace (studios) ───────────────────────────── */}
      <div className="teacher-workspace-header teacher-defer">
        <span className="teacher-workspace-header__icon">
          <Icon as={LayoutGrid} size="md" />
        </span>
        <div>
          <h2 className="teacher-workspace-header__title">Teacher Workspace</h2>
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

      <div className="mt-6">
        <FeedbackButton source="teacher-dashboard" />
      </div>

      <SuggestionNudge source="teacher-dashboard" />
    </div>
  )
}
