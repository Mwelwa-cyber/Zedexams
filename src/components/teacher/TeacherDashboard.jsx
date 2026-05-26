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

const STUDIOS = [
  {
    emoji: '🦁',
    mascotBg: '#faecb8',
    badge: 'NEW',
    libraryKey: 'scheme-of-work',
    title: 'Schemes of Work',
    tagline: 'Plan your whole term — week-by-week subject pacing.',
    to: '/teacher/generate/scheme-of-work',
    mascot: 'Adventure Lion',
  },
  {
    emoji: '🦊',
    mascotBg: '#fde2c4',
    badge: null,
    libraryKey: 'lesson-plan',
    title: 'Lesson Plans',
    tagline: 'Day-by-day CBC plans with stages, materials, and assessment.',
    to: '/teacher/generate/lesson-plan',
    mascot: 'Plan Fox',
  },
  {
    emoji: '🦉',
    mascotBg: '#dbe7f4',
    badge: 'NEW',
    libraryKey: 'notes',
    title: 'Notes Studio',
    tagline: 'Teacher delivery notes built from your lesson plans.',
    to: '/teacher/generate/notes',
    mascot: 'Story Owl',
  },
  {
    emoji: '🐢',
    mascotBg: '#d8ecd0',
    badge: 'NEW',
    libraryKey: 'worksheet',
    title: 'Worksheets',
    tagline: 'Practice activities and exercises for pupils.',
    to: '/teacher/generate/worksheet',
    mascot: 'Practice Turtle',
  },
  {
    emoji: '✏️',
    mascotBg: '#cfe9f5',
    badge: 'NEW',
    libraryKey: 'quiz',
    title: 'Quizzes',
    tagline: 'CBC-aligned quizzes drafted from a topic — review before publishing.',
    to: '/teacher/generate/quiz',
    mascot: 'Quiz Owl',
  },
  {
    emoji: '🎴',
    mascotBg: '#fde9b8',
    badge: 'NEW',
    libraryKey: 'flashcards',
    title: 'Flashcards',
    tagline: 'Bite-size revision cards built from any CBC topic.',
    to: '/teacher/generate/flashcards',
    mascot: 'Memory Robin',
  },
  {
    emoji: '📋',
    mascotBg: '#f0d6e0',
    badge: 'NEW',
    libraryKey: 'rubric',
    title: 'Rubrics',
    tagline: 'Marking guides with criteria and performance levels.',
    to: '/teacher/generate/rubric',
    mascot: 'Marking Mole',
  },
  {
    emoji: '🦅',
    mascotBg: '#e8d8f0',
    badge: 'NEW',
    title: 'Assessments',
    tagline: 'Topic, weekly, monthly, mid-term & end-of-term assessments.',
    to: '/teacher/assessments',
    mascot: 'Sharp Eagle',
  },
  {
    emoji: '📚',
    mascotBg: '#e3dcc8',
    badge: null,
    isLibrary: true,
    title: 'Library',
    tagline: 'All your saved lesson plans, schemes, notes, worksheets, and assessments.',
    to: '/teacher/library',
    mascot: 'Your saved work',
  },
  {
    emoji: '📅',
    mascotBg: '#e8e1f6',
    badge: 'NEW',
    title: 'School Calendar',
    tagline: 'Zambian MoE term dates, public holidays, and working days for 2026–2030.',
    to: '/teacher/calendar',
    mascot: 'Term Tracker',
  },
  {
    emoji: '📘',
    mascotBg: '#d9ecff',
    badge: 'NEW',
    title: 'Syllabi Studio',
    tagline: 'Browse all 20 CBC subjects — topics, competences, activities, and standards in one workspace.',
    to: '/teacher/syllabi',
    mascot: 'Curriculum Shelf',
  },
]

const TOOL_META = {
  lesson_plan: { icon: '🦊', accent: '#fde2c4', label: 'Lesson Plan' },
  scheme_of_work: { icon: '🦁', accent: '#faecb8', label: 'Scheme of Work' },
  worksheet: { icon: '🐢', accent: '#d8ecd0', label: 'Worksheet' },
  flashcards: { icon: '🎴', accent: '#fde9b8', label: 'Flashcards' },
  rubric: { icon: '📋', accent: '#f0d6e0', label: 'Rubric' },
  notes: { icon: '🦉', accent: '#dbe7f4', label: 'Teacher Notes' },
  assessments: { icon: '🦅', accent: '#e8d8f0', label: 'Assessment' },
  quiz: { icon: '✏️', accent: '#cfe9f5', label: 'Quiz' },
}

function SectionLabel({ children }) {
  return (
    <div className="flex items-center gap-2.5 mb-2" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: '#ff7a2e' }}>
      <span style={{ width: 32, height: 3, background: '#ff7a2e', borderRadius: 2, display: 'inline-block', flexShrink: 0 }} />
      {children}
    </div>
  )
}

function StudioCard({ emoji, mascotBg, badge, libraryKey, isLibrary, title, tagline, mascot, to, librarySummary }) {
  const isSoon = badge === 'SOON'
  const count = libraryKey
    ? (librarySummary?.byTool?.[libraryKey] ?? 0)
    : isLibrary
    ? (librarySummary?.total ?? 0)
    : null
  const badgeText = badge !== null ? badge : `${count} SAVED`
  const badgeStyle = badge === 'FREE'
    ? { background: '#10864e', color: '#fff' }
    : badge === 'SOON'
    ? { background: '#e7e1cf', color: '#7a6a4a' }
    : badge === 'NEW'
    ? { background: '#ff7a2e', color: '#fff' }
    : { background: '#0e2a32', color: '#fde9b8' }

  const cardOpacity = isSoon ? 0.62 : 1
  const cardBorder = isSoon ? '#cdc4ad' : '#0e2a32'
  const cardBg = isSoon ? '#faf6ea' : '#fff'

  const inner = (
    <>
      <div className="flex items-start justify-between mb-3">
        <div
          style={{
            width: 58, height: 58, borderRadius: 14, background: mascotBg,
            display: 'grid', placeItems: 'center', fontSize: 32, flexShrink: 0,
            filter: isSoon ? 'grayscale(.5)' : 'none',
          }}
        >
          {emoji}
        </div>
        <span style={{ ...badgeStyle, padding: '4px 10px', borderRadius: 99, fontSize: 10, fontWeight: 700, letterSpacing: '.5px', whiteSpace: 'nowrap' }}>
          {badgeText}
        </span>
      </div>
      <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 17, color: '#0e2a32', margin: '0 0 5px', lineHeight: 1.2 }}>
        {title}
      </p>
      <p style={{ fontSize: 12.5, color: '#566f76', lineHeight: 1.45, flex: 1, margin: 0 }}>
        {tagline}
      </p>
      <p style={{ fontSize: 11, color: '#566f76', marginTop: 12, fontWeight: 600, margin: '12px 0 0' }}>
        {isSoon ? 'Coming soon' : mascot}
      </p>
    </>
  )

  if (isSoon) {
    return (
      <div
        className="flex flex-col p-5 rounded-[18px] border-2 border-dashed"
        style={{ background: cardBg, borderColor: cardBorder, minHeight: 210, opacity: cardOpacity, cursor: 'not-allowed' }}
        aria-disabled="true"
        title={`${title} — coming soon`}
      >
        {inner}
      </div>
    )
  }

  if (to) {
    return (
      <Link
        to={to}
        className="flex flex-col p-5 rounded-[18px] border-2 transition-all duration-200 no-underline hover:-translate-y-1"
        style={{ background: cardBg, borderColor: cardBorder, minHeight: 210, boxShadow: 'none' }}
        onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 10px 24px rgba(14,42,50,.12)' }}
        onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
      >
        {inner}
      </Link>
    )
  }

  return (
    <div
      className="flex flex-col p-5 rounded-[18px] border-2"
      style={{ background: '#fff', borderColor: '#b8ad96', minHeight: 210, opacity: 0.78, cursor: 'default' }}
    >
      {inner}
    </div>
  )
}

function StatPill({ value, label, accent }) {
  return (
    <div
      className="flex-1 min-w-[130px] rounded-2xl px-4 py-3 border-2"
      style={{ background: '#fff', borderColor: '#0e2a32' }}
    >
      <div className="flex items-center gap-2">
        <span style={{ width: 6, height: 24, borderRadius: 3, background: accent || '#ff7a2e', display: 'inline-block', flexShrink: 0 }} />
        <div>
          <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 22, color: '#0e2a32', margin: 0, lineHeight: 1 }}>
            {value}
          </p>
          <p style={{ fontSize: 11.5, color: '#566f76', margin: '2px 0 0', fontWeight: 600 }}>
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
    <div>
      <SeoHelmet title="Teacher dashboard" noIndex />
      <TeacherOnboardingTour />
      {!isPremium && (
        <div
          className="flex items-center justify-between gap-4 mb-5 px-5 py-3.5 rounded-2xl"
          style={{ background: '#fff5e6', border: '1.5px solid #ff7a2e' }}
        >
          <div>
            <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 14, color: '#0e2a32', margin: '0 0 2px' }}>
              Activate your teacher subscription
            </p>
            <p style={{ fontSize: 12, color: '#566f76', margin: 0 }}>
              Pay with MTN MoMo and unlock AI lesson plan tools automatically.
            </p>
          </div>
          <button
            onClick={() => setShowUpgrade(true)}
            className="flex-shrink-0 rounded-xl font-bold text-sm transition-colors"
            style={{ background: '#ff7a2e', color: '#fff', border: 'none', cursor: 'pointer', padding: '9px 16px' }}
          >
            Pay with MTN
          </button>
        </div>
      )}

      <div
        className="rounded-3xl p-7 sm:p-9 mb-8 flex items-center gap-6 flex-wrap"
        style={{ background: 'linear-gradient(135deg, #0e2a32 0%, #16505d 100%)', color: '#fff', boxShadow: '0 12px 32px rgba(14,42,50,.18)' }}
      >
        <div style={{ flex: 1, minWidth: 260 }}>
          <span
            className="inline-flex items-center gap-2 mb-3 rounded-full text-xs font-bold uppercase tracking-wider"
            style={{ background: '#ff7a2e', color: '#fff', padding: '7px 14px' }}
          >
            ✨ Today's Workspace
          </span>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 36, lineHeight: 1.05, margin: '0 0 8px', letterSpacing: '-.3px' }}>
            {lastLessonPlan ? 'Welcome back' : 'Plan with confidence'}
          </h1>
          <p style={{ fontSize: 14.5, opacity: .88, marginBottom: 16, maxWidth: 520, lineHeight: 1.55 }}>
            {lastLessonPlan ? (
              <>
                Pick up where you left off — your last plan was{' '}
                <strong style={{ fontWeight: 700 }}>
                  {lastLessonPlan.inputs?.subject ? formatSubject(lastLessonPlan.inputs.subject) : 'a lesson plan'}
                </strong>
                {lastLessonPlan.inputs?.grade && (
                  <> for <strong style={{ fontWeight: 700 }}>{lastLessonPlan.inputs.grade}</strong></>
                )}
                {lastLessonPlan.output?.header?.topic && (
                  <>: {lastLessonPlan.output.header.topic}</>
                )}.
              </>
            ) : (
              <>Build CBC-aligned lesson plans, schemes of work, teaching notes, and worksheets — all from one place.</>
            )}
          </p>
          {lastLessonPlan ? (
            <div className="flex gap-4 flex-wrap mb-5" style={{ fontSize: 13, opacity: .78, fontWeight: 500 }}>
              <span>🕐 {formatDate(lastLessonPlan.createdAt)}</span>
              {lastLessonPlan.inputs?.subject && <span>📘 {formatSubject(lastLessonPlan.inputs.subject)}</span>}
              {lastLessonPlan.inputs?.grade && <span>🎓 {lastLessonPlan.inputs.grade}</span>}
            </div>
          ) : (
            <div className="flex gap-4 flex-wrap mb-5" style={{ fontSize: 13, opacity: .78, fontWeight: 500 }}>
              <span>📚 Zambian CBC</span>
              <span>📋 New &amp; Old syllabi</span>
              <span>⭐ 7 grades</span>
            </div>
          )}
          <Link
            to={lastLessonPlan ? `/teacher/library/${lastLessonPlan.id}` : '/teacher/generate/lesson-plan'}
            className="inline-flex items-center gap-2.5 rounded-2xl font-bold no-underline transition-colors"
            style={{ background: '#ff7a2e', color: '#fff', padding: '13px 22px', fontSize: 14.5 }}
            onMouseEnter={e => { e.currentTarget.style.background = '#e6651a' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#ff7a2e' }}
          >
            ▶ {lastLessonPlan ? 'Continue your latest plan' : 'Start a new plan'}
          </Link>
        </div>
        <div
          className="flex-shrink-0 hidden sm:grid place-items-center"
          style={{ width: 150, height: 150, borderRadius: '50%', background: '#fff', fontSize: 68, boxShadow: '0 8px 28px rgba(0,0,0,.25)' }}
        >
          🦊
        </div>
      </div>

      <UsageMeter />

      {!loading && <ProgressWidget generations={generations} quizzes={quizzes} />}

      <SectionLabel>Studios</SectionLabel>
      <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 28, color: '#0e2a32', margin: '0 0 16px' }}>
        Pick your studio
      </h2>
      <div className="grid gap-4 mb-10" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        {STUDIOS.map(s => (
          <StudioCard key={s.title} {...s} librarySummary={librarySummary} />
        ))}
      </div>

      <SectionLabel>🕒 Recents</SectionLabel>
      <div className="flex justify-between items-end mb-4">
        <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 28, color: '#0e2a32', margin: 0 }}>
          Continue where you left off
        </h2>
      </div>

      {loading ? (
        <div style={{ height: 80 }} />
      ) : recentItems.length === 0 ? (
        <div
          className="text-center py-10 rounded-2xl border-2 border-dashed"
          style={{ background: '#fff', borderColor: '#b8ad96' }}
        >
          <div style={{ fontSize: 40, marginBottom: 12, opacity: .5 }}>📂</div>
          <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 17, color: '#0e2a32', marginBottom: 6 }}>
            Nothing recent yet
          </p>
          <p style={{ fontSize: 13, color: '#8a9aa1', margin: 0 }}>
            Pick a studio above — your most recent items will appear here.
          </p>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {recentItems.map(item => {
            const meta = TOOL_META[item.tool] || { icon: '📄', accent: '#f0eee8', label: 'Item' }
            return (
              <Link
                key={`${item.kind}-${item.id}`}
                to={item.to}
                className="flex items-center gap-3 p-4 rounded-2xl border-2 transition-all no-underline hover:-translate-y-0.5"
                style={{ background: '#fff', borderColor: '#0e2a32' }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 20px rgba(14,42,50,.1)' }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
              >
                <div style={{ width: 44, height: 44, borderRadius: 12, background: meta.accent, display: 'grid', placeItems: 'center', fontSize: 22, flexShrink: 0 }}>
                  {meta.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 14, color: '#0e2a32', margin: '0 0 3px', lineHeight: 1.25 }} className="line-clamp-1">
                    {item.title}
                  </p>
                  <p style={{ fontSize: 11.5, color: '#566f76', margin: 0 }} className="line-clamp-1">
                    {meta.label}{item.subtitle ? ` · ${item.subtitle}` : ''} · {formatDate(item.timestamp)}
                  </p>
                </div>
                <span style={{ fontSize: 18, color: '#566f76', flexShrink: 0 }}>→</span>
              </Link>
            )
          })}
        </div>
      )}

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  )
}
