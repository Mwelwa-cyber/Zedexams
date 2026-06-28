import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import {
  listMyGenerations,
  titleForGeneration,
  formatDate,
} from '../../utils/teacherLibraryService'
import { resolveTeacherPlan, PLAN_LABELS } from '../../utils/teacherPlans'
import SubscriptionReminderCard from '../subscription/SubscriptionReminderCard'
import UsageMeter from './UsageMeter'
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
  assessments: { icon: BarChart3, accent: '#e8d8f0', label: 'Test Paper' },
  // 'quiz' stays for generations saved before the studio was retired (#909).
  quiz: { icon: ClipboardList, accent: '#cfe9f5', label: 'Quiz' },
  full_lesson: { icon: Sparkles, accent: '#cfe9f5', label: 'Full Lesson' },
  exam_paper: { icon: GraduationCap, accent: '#dbdcf7', label: 'Exam Paper' },
  sba_task: { icon: GraduationCap, accent: '#d8e6f0', label: 'SBA Task' },
  sba_mark_sheet: { icon: Calculator, accent: '#dcefe2', label: 'SBA Mark Sheet' },
  sba_plan: { icon: Target, accent: '#dbe7f4', label: 'SBA Year Plan' },
}

function SectionLabel({ children }) {
  return (
    <div className="teacher-dashboard-eyebrow">
      {children}
    </div>
  )
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
      <p className="teacher-workspace-card__title">
        {title}
      </p>
      <p className="teacher-workspace-card__text">
        {tagline}
      </p>
    </>
  )

  if (isSoon) {
    return (
      <div
        className={cardClass}
        aria-disabled="true"
        title={`${title} - coming soon`}
      >
        {inner}
      </div>
    )
  }

  if (to) {
    return (
      <Link
        to={to}
        className={cardClass}
      >
        {inner}
      </Link>
    )
  }

  return (
    <div
      className={`${cardClass} is-inactive`}
    >
      {inner}
    </div>
  )
}

function StatPill({ value, label, accent }) {
  return (
    <div
      className="teacher-stat-pill"
      style={{ '--pill-accent': accent || '#ff7a2e' }}
    >
      <div className="flex items-center gap-2">
        <span className="teacher-stat-pill__bar" />
        <div>
          <p className="teacher-stat-pill__value">
            {value}
          </p>
          <p className="teacher-stat-pill__label">
            {label}
          </p>
        </div>
      </div>
    </div>
  )
}

function ProgressWidget({ generations, quizzes }) {
  const stats = useMemo(() => {
    const now = Date.now()
    const DAY = 24 * 60 * 60 * 1000
    const toMs = (t) => {
      if (!t) return 0
      if (typeof t.toDate === 'function') return t.toDate().getTime()
      return new Date(t).getTime() || 0
    }
    const last30 = (g) => (now - toMs(g.createdAt)) <= 30 * DAY
    const last7 = (g) => (now - toMs(g.createdAt)) <= 7 * DAY
    const lessonsThisMonth = generations.filter(g => g.tool === 'lesson_plan' && last30(g)).length
    const notesThisMonth = generations.filter(g => g.tool === 'notes' && last30(g)).length
    const assessmentsThisMonth = (quizzes || []).filter(last30).length
    const itemsThisWeek = generations.filter(last7).length + (quizzes || []).filter(last7).length
    const totalSaved = generations.length + (quizzes?.length || 0)
    return { lessonsThisMonth, notesThisMonth, assessmentsThisMonth, itemsThisWeek, totalSaved }
  }, [generations, quizzes])

  return (
    <div className="mb-8">
      <SectionLabel>Your activity</SectionLabel>
      <div className="flex flex-wrap gap-3">
        <StatPill value={stats.lessonsThisMonth} label="Lesson plans · 30 days" accent="#ff7a2e" />
        <StatPill value={stats.notesThisMonth}   label="Notes · 30 days"        accent="#16505d" />
        <StatPill value={stats.assessmentsThisMonth} label="Test papers · 30 days" accent="#10864e" />
        <StatPill value={stats.itemsThisWeek}    label="New this week"          accent="#b8651a" />
        <StatPill value={stats.totalSaved}       label="Total in library"       accent="#0e2a32" />
      </div>
    </div>
  )
}

function quizSubtitle(q) {
  const grade = q.grade || q.targetGrade || ''
  const subject = q.subject ? String(q.subject).replace(/_/g, ' ') : ''
  return [grade, subject].filter(Boolean).join(' · ')
}

function quizTitle(q) {
  return q.title || q.topic || 'Untitled assessment'
}

function genSubtitle(g) {
  const grade = g.inputs?.grade || ''
  const subject = g.inputs?.subject ? String(g.inputs.subject).replace(/_/g, ' ') : ''
  return [grade, subject].filter(Boolean).join(' · ')
}

function formatSubject(s) {
  return String(s || '').replace(/_/g, ' ')
}

export default function TeacherDashboard() {
  const { currentUser, userProfile } = useAuth()
  const { getMyQuizzes } = useFirestore()

  // "Current plan" reflects the teacher's actual studio entitlement
  // (users.teacherPlan, same field the usage meter + server gate on), not the
  // learner-style isPremium flag — otherwise a premium learner with no Pro
  // teacher plan would falsely read "Pro" while the meter still showed Free.
  const teacherPlan = resolveTeacherPlan(userProfile)
  const teacherPlanLabel = PLAN_LABELS[teacherPlan] || 'Free'
  // Free teachers can only open the Lesson Plan studio; other tiles open a
  // read-only sample, so they're badged "Sample" on the workspace grid.
  const isFreePlan = teacherPlan === 'free'

  const [generations, setGenerations] = useState([])
  const [quizzes, setQuizzes] = useState([])
  const [loading, setLoading] = useState(true)

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

  const lastLessonPlan = useMemo(
    () => generations.find(g => g.tool === 'lesson_plan'),
    [generations],
  )

  const recentItems = useMemo(() => {
    const all = [
      ...generations.map(g => ({
        id: g.id,
        title: titleForGeneration(g),
        subtitle: genSubtitle(g),
        timestamp: g.createdAt,
        kind: 'generation',
        tool: g.tool,
        to: `/teacher/library/${g.id}`,
      })),
      ...quizzes.map(q => ({
        id: q.id,
        title: quizTitle(q),
        subtitle: quizSubtitle(q),
        timestamp: q.createdAt,
        kind: 'assessment',
        tool: 'assessments',
        to: `/teacher/test-papers/${q.id}/edit`,
      })),
    ]
    const toMs = (t) => {
      if (!t) return 0
      if (typeof t.toDate === 'function') return t.toDate().getTime()
      return new Date(t).getTime() || 0
    }
    return all
      .sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp))
      .slice(0, 4)
  }, [generations, quizzes])

  return (
    <div className="teacher-dashboard-surface">
      <SeoHelmet title="Teacher dashboard" noIndex />
      <TeacherOnboardingTour />
      {/* Subscription reminder — Free/Expired teachers get an upgrade card
          listing their Pro toolkit; self-hides once they're on Pro/Max. */}
      <SubscriptionReminderCard audience="teacher" />

      <section className="teacher-dashboard-hero">
        <div className="teacher-dashboard-hero__content">
          <span className="teacher-dashboard-hero__eyebrow">
            <Icon as={Sparkles} size="sm" />
            Today's workspace
          </span>
          <h1 className="teacher-dashboard-hero__title">
            {lastLessonPlan ? 'Welcome back' : 'Plan with confidence'}
          </h1>
          <p className="teacher-dashboard-hero__text">
            {lastLessonPlan ? (
              <>
                Pick up where you left off. Your last plan was{' '}
                <strong>
                  {lastLessonPlan.inputs?.subject ? formatSubject(lastLessonPlan.inputs.subject) : 'a lesson plan'}
                </strong>
                {lastLessonPlan.inputs?.grade && (
                  <> for <strong>{lastLessonPlan.inputs.grade}</strong></>
                )}
                {lastLessonPlan.output?.header?.topic && (
                  <>: {lastLessonPlan.output.header.topic}</>
                )}.
              </>
            ) : (
              <>Build CBC-aligned lesson plans, schemes of work, teacher notes, and worksheets from one reliable workspace.</>
            )}
          </p>
          {lastLessonPlan ? (
            <div className="teacher-dashboard-hero__facts">
              <span><Icon as={Clock} size="sm" /> {formatDate(lastLessonPlan.createdAt)}</span>
              {lastLessonPlan.inputs?.subject && <span><Icon as={BookOpen} size="sm" /> {formatSubject(lastLessonPlan.inputs.subject)}</span>}
              {lastLessonPlan.inputs?.grade && <span><Icon as={GraduationCap} size="sm" /> {lastLessonPlan.inputs.grade}</span>}
            </div>
          ) : (
            <div className="teacher-dashboard-hero__facts">
              <span><Icon as={BookOpen} size="sm" /> Zambian CBC</span>
              <span><Icon as={ClipboardList} size="sm" /> New and old syllabi</span>
              <span><Icon as={Target} size="sm" /> 7 grades</span>
            </div>
          )}
          <Link
            to={lastLessonPlan ? `/teacher/library/${lastLessonPlan.id}` : '/teacher/generate/lesson-plan'}
            className="teacher-dashboard-hero__cta"
          >
            <Icon as={PencilLine} size="sm" />
            {lastLessonPlan ? 'Continue latest plan' : 'Start a new plan'}
            <Icon as={ArrowRight} size="sm" />
          </Link>
        </div>
        <div className="teacher-dashboard-hero__panel">
          <div>
            <span>{librarySummary.total + quizzes.length}</span>
            <p>Saved resources</p>
          </div>
          <div>
            <span>{recentItems.length}</span>
            <p>Recent items</p>
          </div>
          <div>
            <span>{teacherPlanLabel}</span>
            <p>Current plan</p>
          </div>
        </div>
      </section>

      <UsageMeter />

      {!loading && <ProgressWidget generations={generations} quizzes={quizzes} />}

      <div className="teacher-workspace-header">
        <span className="teacher-workspace-header__icon">
          <Icon as={LayoutGrid} size="md" />
        </span>
        <div>
          <h2 className="teacher-workspace-header__title">Teacher Workspace</h2>
          <p className="teacher-workspace-header__text">Everything you need in one place</p>
        </div>
      </div>

      {STUDIO_GROUPS.map(group => (
        <section key={group.label} className="teacher-workspace-section">
          <WorkspaceSectionHead
            icon={group.icon}
            accent={group.accent}
            label={group.label}
            viewAll={group.viewAll}
          />
          <div className="teacher-workspace-grid">
            {group.items.map(s => (
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

      <SectionLabel>Recents</SectionLabel>
      <div className="flex justify-between items-end mb-4">
        <h2 className="teacher-dashboard-heading teacher-dashboard-heading--compact">
          Continue where you left off
        </h2>
      </div>

      {loading ? (
        <div style={{ height: 80 }} />
      ) : recentItems.length === 0 ? (
        <div
          className="teacher-empty-state"
        >
          <span className="teacher-empty-state__icon">
            <Icon as={FolderOpen} size="xl" />
          </span>
          <p className="teacher-empty-state__title">
            Nothing recent yet
          </p>
          <p className="teacher-empty-state__text">
            Choose a workspace above. Your most recent items will appear here.
          </p>
        </div>
      ) : (
        <div className="teacher-recent-grid">
          {recentItems.map(item => {
            const meta = TOOL_META[item.tool] || { icon: DocumentTextIcon, accent: '#f0eee8', label: 'Item' }
            return (
              <Link
                key={`${item.kind}-${item.id}`}
                to={item.to}
                className="teacher-recent-card"
              >
                <span className="teacher-recent-card__icon" style={{ '--recent-bg': meta.accent }}>
                  <Icon as={meta.icon} size="md" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="teacher-recent-card__title line-clamp-1">
                    {item.title}
                  </p>
                  <p className="teacher-recent-card__meta line-clamp-1">
                    {meta.label}{item.subtitle ? ` · ${item.subtitle}` : ''} · {formatDate(item.timestamp)}
                  </p>
                </div>
                <Icon as={ArrowRight} size="sm" className="teacher-recent-card__arrow" />
              </Link>
            )
          })}
        </div>
      )}

      <SuggestionNudge source="teacher-dashboard" />
    </div>
  )
}
