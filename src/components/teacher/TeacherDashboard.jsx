import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { useSubscription } from '../../hooks/useSubscription'
import {
  listMyGenerations,
  titleForGeneration,
  formatDate,
} from '../../utils/teacherLibraryService'
import UpgradeModal from '../subscription/UpgradeModal'
import UsageMeter from './UsageMeter'
import SeoHelmet from '../seo/SeoHelmet'
import TeacherOnboardingTour from './TeacherOnboardingTour'
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
  PencilLine,
  Sparkles,
  Target,
} from '../ui/icons'

const STUDIOS = [
  {
    icon: CalendarDays,
    tone: 'amber',
    badge: 'NEW',
    libraryKey: 'scheme-of-work',
    title: 'Schemes of Work',
    tagline: 'Map term pacing, outcomes, and weekly checkpoints.',
    to: '/teacher/generate/scheme-of-work',
    meta: 'Term planning',
  },
  {
    icon: Clock,
    tone: 'blue',
    badge: 'NEW',
    libraryKey: 'weekly-forecast',
    title: 'Weekly Forecast',
    tagline: "Pull a week from your scheme and plan it day by day.",
    to: '/teacher/generate/weekly-forecast',
    meta: 'Weekly prep',
  },
  {
    icon: ClipboardList,
    tone: 'cyan',
    badge: 'NEW',
    libraryKey: 'record-of-work',
    title: 'Record of Work',
    tagline: 'Log what you actually taught each week, checked against your scheme.',
    to: '/teacher/generate/record-of-work',
    meta: 'Weekly log',
  },
  {
    icon: Calculator,
    tone: 'green',
    badge: 'NEW',
    libraryKey: 'mark-schedule',
    title: 'Mark Schedule',
    tagline: 'Marks in — totals, class positions and report comments out.',
    to: '/teacher/generate/mark-schedule',
    meta: 'After tests',
  },
  {
    icon: PencilLine,
    tone: 'orange',
    badge: null,
    libraryKey: 'lesson-plan',
    title: 'Lesson Plans',
    tagline: 'Prepare CBC lessons with stages, resources, and assessment.',
    to: '/teacher/generate/lesson-plan',
    meta: 'Daily prep',
  },
  {
    icon: DocumentTextIcon,
    tone: 'blue',
    badge: 'NEW',
    libraryKey: 'notes',
    title: 'Notes Studio',
    tagline: 'Turn a lesson plan into delivery notes and examples.',
    to: '/teacher/generate/notes',
    meta: 'Instruction support',
  },
  {
    icon: FileText,
    tone: 'green',
    badge: 'NEW',
    libraryKey: 'worksheet',
    title: 'Worksheets',
    tagline: 'Create classroom practice, exercises, and consolidation tasks.',
    to: '/teacher/generate/worksheet',
    meta: 'Practice material',
  },
  {
    icon: Layers,
    tone: 'yellow',
    badge: 'NEW',
    libraryKey: 'flashcards',
    title: 'Flashcards',
    tagline: 'Build short revision prompts for recall and practice.',
    to: '/teacher/generate/flashcards',
    meta: 'Revision',
  },
  {
    icon: ClipboardCheckList,
    tone: 'rose',
    badge: 'NEW',
    libraryKey: 'rubric',
    title: 'Rubrics',
    tagline: 'Define criteria, levels, and marking guidance.',
    to: '/teacher/generate/rubric',
    meta: 'Marking guide',
  },
  {
    icon: BarChart3,
    tone: 'violet',
    badge: 'NEW',
    title: 'Assessments',
    tagline: 'Manage topic, monthly, mid-term, and end-of-term assessments.',
    to: '/teacher/assessments',
    meta: 'Assessment bank',
  },
  {
    icon: FolderOpen,
    tone: 'slate',
    badge: null,
    isLibrary: true,
    title: 'Library',
    tagline: 'Browse saved plans, notes, worksheets, rubrics, and assessments.',
    to: '/teacher/library',
    meta: 'Saved work',
  },
  {
    icon: CalendarDays,
    tone: 'indigo',
    badge: 'NEW',
    title: 'School Calendar',
    tagline: 'Check MoE terms, public holidays, and working days.',
    to: '/teacher/calendar',
    meta: 'Academic year',
  },
  {
    icon: BookOpen,
    tone: 'sky',
    badge: 'NEW',
    title: 'Syllabi Studio',
    tagline: 'Browse CBC subjects, topics, competences, and standards.',
    to: '/teacher/syllabi',
    meta: 'Curriculum reference',
  },
]

const TOOL_META = {
  lesson_plan: { icon: PencilLine, accent: '#fde2c4', label: 'Lesson Plan' },
  scheme_of_work: { icon: CalendarDays, accent: '#faecb8', label: 'Scheme of Work' },
  worksheet: { icon: FileText, accent: '#d8ecd0', label: 'Worksheet' },
  flashcards: { icon: Layers, accent: '#fde9b8', label: 'Flashcards' },
  rubric: { icon: ClipboardCheckList, accent: '#f0d6e0', label: 'Rubric' },
  notes: { icon: DocumentTextIcon, accent: '#dbe7f4', label: 'Teacher Notes' },
  assessments: { icon: BarChart3, accent: '#e8d8f0', label: 'Assessment' },
  // 'quiz' stays for generations saved before the studio was retired (#909).
  quiz: { icon: ClipboardList, accent: '#cfe9f5', label: 'Quiz' },
  full_lesson: { icon: Sparkles, accent: '#cfe9f5', label: 'Full Lesson' },
  exam_paper: { icon: GraduationCap, accent: '#dbdcf7', label: 'Exam Paper' },
}

function SectionLabel({ children }) {
  return (
    <div className="teacher-dashboard-eyebrow">
      {children}
    </div>
  )
}

function StudioCard({ icon, tone, badge, libraryKey, isLibrary, title, tagline, meta, to, librarySummary }) {
  const isSoon = badge === 'SOON'
  const count = libraryKey
    ? (librarySummary?.byTool?.[libraryKey] ?? 0)
    : isLibrary
    ? (librarySummary?.total ?? 0)
    : null
  const badgeText = badge !== null ? badge : `${count} saved`
  const badgeClass = badge === 'FREE'
    ? 'teacher-studio-card__badge--success'
    : badge === 'SOON'
    ? 'teacher-studio-card__badge--muted'
    : badge === 'NEW'
    ? 'teacher-studio-card__badge--accent'
    : 'teacher-studio-card__badge--saved'
  const cardClass = [
    'teacher-studio-card',
    `teacher-studio-card--${tone || 'slate'}`,
    isSoon ? 'is-disabled' : '',
  ].filter(Boolean).join(' ')

  const inner = (
    <>
      <div className="teacher-studio-card__top">
        <span className="teacher-studio-card__icon">
          <Icon as={icon} size="lg" />
        </span>
        <span className={`teacher-studio-card__badge ${badgeClass}`}>
          {badgeText}
        </span>
      </div>
      <p className="teacher-studio-card__title">
        {title}
      </p>
      <p className="teacher-studio-card__text">
        {tagline}
      </p>
      <p className="teacher-studio-card__meta">
        {isSoon ? 'Coming soon' : meta}
        {!isSoon && <Icon as={ArrowRight} size="xs" />}
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
        <StatPill value={stats.assessmentsThisMonth} label="Assessments · 30 days" accent="#10864e" />
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
  const { currentUser } = useAuth()
  const { getMyQuizzes } = useFirestore()
  const { isPremium } = useSubscription()

  const [generations, setGenerations] = useState([])
  const [quizzes, setQuizzes] = useState([])
  const [loading, setLoading] = useState(true)
  const [showUpgrade, setShowUpgrade] = useState(false)

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
        to: `/teacher/assessments/${q.id}/edit`,
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
      {!isPremium && (
        <div
          className="teacher-subscription-banner"
        >
          <div>
            <p className="teacher-subscription-banner__title">
              Activate your teacher subscription
            </p>
            <p className="teacher-subscription-banner__text">
              Pay with MTN MoMo and unlock AI lesson plan tools automatically.
            </p>
          </div>
          <button
            onClick={() => setShowUpgrade(true)}
            className="teacher-subscription-banner__button"
          >
            Pay with MTN
          </button>
        </div>
      )}

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
            <span>{isPremium ? 'Pro' : 'Free'}</span>
            <p>Current plan</p>
          </div>
        </div>
      </section>

      <UsageMeter />

      {!loading && <ProgressWidget generations={generations} quizzes={quizzes} />}

      <SectionLabel>Tools</SectionLabel>
      <h2 className="teacher-dashboard-heading">
        Choose a workspace
      </h2>
      <div className="teacher-studio-grid">
        {STUDIOS.map(s => (
          <StudioCard key={s.title} {...s} librarySummary={librarySummary} />
        ))}
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

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  )
}
