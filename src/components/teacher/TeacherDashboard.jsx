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
import { SYLLABI_TOTAL_COUNT } from '../../data/syllabiCatalog'

const STUDIOS = [
  {
    emoji: '🦁',
    mascotBg: '#faecb8',
    badge: 'SOON',
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
    badge: 'SOON',
    title: 'Notes Studio',
    tagline: 'Teacher delivery notes built from your lesson plans.',
    to: null,
    mascot: 'Story Owl',
  },
  {
    emoji: '🐢',
    mascotBg: '#d8ecd0',
    badge: 'SOON',
    title: 'Worksheets',
    tagline: 'Practice activities and exercises for pupils.',
    to: '/teacher/generate/worksheet',
    mascot: 'Practice Turtle',
  },
  {
    emoji: '🦅',
    mascotBg: '#e8d8f0',
    badge: 'NEW',
    title: 'Assessments',
    tagline: 'Topic, weekly, monthly, mid-term & end-of-term assessments.',
    to: '/teacher/quizzes/new',
    mascot: 'Sharp Eagle',
  },
  {
    emoji: '🐘',
    mascotBg: '#fcd9c4',
    badge: 'FREE',
    title: 'Syllabi',
    tagline: 'Official CDC syllabi — view all Zambian curricula in one place.',
    to: '/teacher/syllabi',
    mascot: `${SYLLABI_TOTAL_COUNT} docs`,
  },
]

const LIBRARY_SECTIONS = [
  {
    key: 'lesson_plan',
    label: 'Lesson Plans',
    icon: '🦊',
    accent: '#fde2c4',
    createTo: '/teacher/generate/lesson-plan',
    emptyHint: 'Generate your first lesson plan to see it here.',
  },
  {
    key: 'assessments',
    label: 'Assessments',
    icon: '🦅',
    accent: '#e8d8f0',
    createTo: '/teacher/quizzes/new',
    emptyHint: 'Create a topic, monthly or end-of-term assessment.',
  },
  {
    key: 'scheme_of_work',
    label: 'Schemes of Work',
    icon: '🦁',
    accent: '#faecb8',
    createTo: '/teacher/generate/scheme-of-work',
    emptyHint: 'Plan a whole term with a scheme of work.',
  },
  {
    key: 'worksheet',
    label: 'Worksheets',
    icon: '🐢',
    accent: '#d8ecd0',
    createTo: '/teacher/generate/worksheet',
    emptyHint: 'Generate practice worksheets aligned to your lesson.',
  },
  {
    key: 'notes',
    label: 'Notes',
    icon: '🦉',
    accent: '#dbe7f4',
    createTo: null,
    emptyHint: 'Teacher delivery notes — coming soon.',
  },
]

function SectionLabel({ children }) {
  return (
    <div className="flex items-center gap-2.5 mb-2" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: '#ff7a2e' }}>
      <span style={{ width: 32, height: 3, background: '#ff7a2e', borderRadius: 2, display: 'inline-block', flexShrink: 0 }} />
      {children}
    </div>
  )
}

function SectionHeader({ kicker, title, action }) {
  return (
    <div className="mb-4">
      <SectionLabel>{kicker}</SectionLabel>
      <div className="flex justify-between items-end gap-3 flex-wrap">
        <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 28, color: '#0e2a32', margin: 0 }}>
          {title}
        </h2>
        {action}
      </div>
    </div>
  )
}

function StudioCard({ emoji, mascotBg, badge, libraryKey, title, tagline, mascot, to, librarySummary }) {
  const count = libraryKey ? (librarySummary?.byTool?.[libraryKey] ?? 0) : null
  const badgeText = badge !== null ? badge : `${count} SAVED`
  const badgeStyle = badge === 'FREE'
    ? { background: '#10864e', color: '#fff' }
    : { background: '#0e2a32', color: '#fde9b8' }

  const inner = (
    <>
      <div className="flex items-start justify-between mb-3">
        <div style={{ width: 58, height: 58, borderRadius: 14, background: mascotBg, display: 'grid', placeItems: 'center', fontSize: 32, flexShrink: 0 }}>
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
        {mascot}
      </p>
    </>
  )

  if (to) {
    return (
      <Link
        to={to}
        className="flex flex-col p-5 rounded-[18px] border-2 transition-all duration-200 no-underline hover:-translate-y-1"
        style={{ background: '#fff', borderColor: '#0e2a32', minHeight: 210, boxShadow: 'none' }}
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

function LibraryCard({ icon, accent, title, subtitle, meta, to }) {
  const card = (
    <div
      className="flex flex-col h-full p-4 rounded-2xl border-2 transition-all"
      style={{ background: '#fff', borderColor: '#0e2a32', minHeight: 150 }}
    >
      <div style={{ width: 44, height: 44, borderRadius: 12, background: accent, display: 'grid', placeItems: 'center', fontSize: 22, marginBottom: 10, flexShrink: 0 }}>
        {icon}
      </div>
      <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 15, color: '#0e2a32', margin: '0 0 4px', lineHeight: 1.25 }} className="line-clamp-2">
        {title}
      </p>
      {subtitle && (
        <p style={{ fontSize: 12, color: '#566f76', margin: 0, lineHeight: 1.4 }} className="line-clamp-2">
          {subtitle}
        </p>
      )}
      <p style={{ fontSize: 11, color: '#8a9aa1', margin: '10px 0 0', fontWeight: 600 }}>
        {meta}
      </p>
    </div>
  )

  if (to) {
    return (
      <Link
        to={to}
        className="block no-underline transition-transform hover:-translate-y-0.5"
        onMouseEnter={e => { e.currentTarget.firstChild.style.boxShadow = '0 8px 20px rgba(14,42,50,.1)' }}
        onMouseLeave={e => { e.currentTarget.firstChild.style.boxShadow = 'none' }}
      >
        {card}
      </Link>
    )
  }
  return card
}

function LibrarySection({ section, items, totalCount }) {
  const meta = section
  const remaining = Math.max(0, totalCount - items.length)

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex items-center gap-2.5">
          <div style={{ width: 36, height: 36, borderRadius: 10, background: meta.accent, display: 'grid', placeItems: 'center', fontSize: 20, flexShrink: 0 }}>
            {meta.icon}
          </div>
          <div>
            <h3 style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 18, color: '#0e2a32', margin: 0, lineHeight: 1.1 }}>
              {meta.label}
            </h3>
            <p style={{ fontSize: 11, color: '#8a9aa1', margin: '2px 0 0', fontWeight: 600 }}>
              {totalCount} saved
            </p>
          </div>
        </div>
        <Link
          to={`/teacher/library?tool=${meta.key}`}
          style={{ fontSize: 13, fontWeight: 600, color: '#0e2a32', opacity: 0.6, textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          View all ›
        </Link>
      </div>

      {items.length === 0 ? (
        <div
          className="flex items-center justify-between gap-3 py-4 px-4 rounded-2xl border-2 border-dashed flex-wrap"
          style={{ background: '#fff', borderColor: '#d4cab2' }}
        >
          <p style={{ fontSize: 13, color: '#8a9aa1', margin: 0 }}>
            {meta.emptyHint}
          </p>
          {meta.createTo && (
            <Link
              to={meta.createTo}
              className="rounded-xl font-bold transition-colors no-underline"
              style={{ background: '#0e2a32', color: '#fff', padding: '7px 14px', fontSize: 12 }}
            >
              + Create
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {items.map(item => (
            <LibraryCard
              key={item.id}
              icon={meta.icon}
              accent={meta.accent}
              title={item.title}
              subtitle={item.subtitle}
              meta={item.metaLabel}
              to={item.to}
            />
          ))}
          {remaining > 0 && (
            <Link
              to={`/teacher/library?tool=${meta.key}`}
              className="flex items-center justify-center rounded-2xl border-2 border-dashed no-underline transition-all hover:-translate-y-0.5"
              style={{ background: '#fff', borderColor: '#0e2a32', minHeight: 150, color: '#0e2a32' }}
            >
              <div className="text-center px-4">
                <div style={{ fontSize: 22, marginBottom: 6 }}>+{remaining}</div>
                <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 13, margin: 0 }}>
                  View all
                </p>
              </div>
            </Link>
          )}
        </div>
      )}
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
  }, [currentUser])

  const librarySummary = useMemo(() => {
    const byTool = generations.reduce((acc, g) => {
      const key = (g.tool || '').replace(/_/g, '-')
      if (!key) return acc
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
    return { total: generations.length, byTool }
  }, [generations])

  const sectionedItems = useMemo(() => {
    const result = {}
    LIBRARY_SECTIONS.forEach(s => { result[s.key] = { items: [], total: 0 } })

    generations.forEach(g => {
      const bucket = result[g.tool]
      if (!bucket) return
      bucket.total += 1
      if (bucket.items.length < 3) {
        bucket.items.push({
          id: g.id,
          title: titleForGeneration(g),
          subtitle: genSubtitle(g),
          metaLabel: formatDate(g.createdAt),
          to: `/teacher/library/${g.id}`,
        })
      }
    })

    quizzes.forEach(q => {
      const bucket = result.assessments
      if (!bucket) return
      bucket.total += 1
      if (bucket.items.length < 3) {
        bucket.items.push({
          id: q.id,
          title: quizTitle(q),
          subtitle: quizSubtitle(q),
          metaLabel: q.createdAt ? formatDate(q.createdAt) : '',
          to: `/teacher/quizzes/${q.id}`,
        })
      }
    })

    return result
  }, [generations, quizzes])

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
        to: `/teacher/quizzes/${q.id}`,
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

  const totalSaved = librarySummary.total + quizzes.length

  return (
    <div>
      {/* Subscription banner */}
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

      {/* Hero */}
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
            Plan with confidence
          </h1>
          <p style={{ fontSize: 14.5, opacity: .88, marginBottom: 16, maxWidth: 500, lineHeight: 1.55 }}>
            Build CBC-aligned lesson plans, schemes of work, teaching notes, and worksheets — all from one place.
          </p>
          <div className="flex gap-4 flex-wrap mb-5" style={{ fontSize: 13, opacity: .78, fontWeight: 500 }}>
            <span>📚 Zambian CBC</span>
            <span>📋 New &amp; Old syllabi</span>
            <span>⭐ 7 grades</span>
          </div>
          <Link
            to="/teacher/generate/lesson-plan"
            className="inline-flex items-center gap-2.5 rounded-2xl font-bold no-underline transition-colors"
            style={{ background: '#ff7a2e', color: '#fff', padding: '13px 22px', fontSize: 14.5 }}
            onMouseEnter={e => { e.currentTarget.style.background = '#e6651a' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#ff7a2e' }}
          >
            ▶ Start a new plan
          </Link>
        </div>
        <div
          className="flex-shrink-0 hidden sm:grid place-items-center"
          style={{ width: 150, height: 150, borderRadius: '50%', background: '#fff', fontSize: 68, boxShadow: '0 8px 28px rgba(0,0,0,.25)' }}
        >
          🦊
        </div>
      </div>

      {/* Library — at the top, organised by tool type */}
      <SectionHeader
        kicker="📚 Library"
        title="Your library"
        action={(
          <Link
            to="/teacher/library"
            style={{ fontSize: 13, fontWeight: 600, color: '#0e2a32', opacity: 0.6, textDecoration: 'none' }}
          >
            View all ›
          </Link>
        )}
      />

      {loading ? (
        <div className="rounded-2xl border-2 border-dashed p-10 text-center mb-10" style={{ background: '#fff', borderColor: '#d4cab2' }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>📚</div>
          <p style={{ fontSize: 13, color: '#8a9aa1', margin: 0 }}>Loading your library…</p>
        </div>
      ) : totalSaved === 0 ? (
        <div className="rounded-2xl border-2 border-dashed p-10 text-center mb-10" style={{ background: '#fff', borderColor: '#d4cab2' }}>
          <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.5 }}>📂</div>
          <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 17, color: '#0e2a32', marginBottom: 6 }}>
            Nothing saved yet
          </p>
          <p style={{ fontSize: 13, color: '#8a9aa1', margin: 0 }}>
            Pick a studio below — your saved items will appear here organised by type.
          </p>
        </div>
      ) : (
        <div className="mb-10">
          {LIBRARY_SECTIONS.map(section => (
            <LibrarySection
              key={section.key}
              section={section}
              items={sectionedItems[section.key].items}
              totalCount={sectionedItems[section.key].total}
            />
          ))}
        </div>
      )}

      {/* Studios */}
      <SectionHeader kicker="Studios" title="Pick your studio" />
      <div className="grid gap-4 mb-10" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        {STUDIOS.map(s => (
          <StudioCard key={s.title} {...s} librarySummary={librarySummary} />
        ))}
      </div>

      {/* Recents — at the bottom */}
      <SectionHeader
        kicker="🕒 Recents"
        title="Continue where you left off"
        action={recentItems.length > 0 && (
          <Link to="/teacher/library" style={{ fontSize: 13, fontWeight: 600, color: '#0e2a32', opacity: 0.6, textDecoration: 'none' }}>
            View all ›
          </Link>
        )}
      />

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
            Once you create a plan or assessment it'll show up here.
          </p>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {recentItems.map(item => {
            const sectionMeta = LIBRARY_SECTIONS.find(s => s.key === item.tool) || {
              icon: '📄', accent: '#f0eee8', label: 'Item',
            }
            return (
              <Link
                key={`${item.kind}-${item.id}`}
                to={item.to}
                className="flex items-center gap-3 p-4 rounded-2xl border-2 transition-all no-underline hover:-translate-y-0.5"
                style={{ background: '#fff', borderColor: '#0e2a32' }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 20px rgba(14,42,50,.1)' }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
              >
                <div style={{ width: 44, height: 44, borderRadius: 12, background: sectionMeta.accent, display: 'grid', placeItems: 'center', fontSize: 22, flexShrink: 0 }}>
                  {sectionMeta.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 14, color: '#0e2a32', margin: '0 0 3px', lineHeight: 1.25 }} className="line-clamp-1">
                    {item.title}
                  </p>
                  <p style={{ fontSize: 11.5, color: '#566f76', margin: 0 }} className="line-clamp-1">
                    {sectionMeta.label}{item.subtitle ? ` · ${item.subtitle}` : ''} · {formatDate(item.timestamp)}
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
