/**
 * SubjectDrillDown — Course Map for a single subject + grade.
 *
 * Routes:
 *   /practise/:grade/:subjectId
 *
 * Renders a focused page for the learner who taps "Practise" on a
 * dashboard SubjectCardRich. Quizzes are grouped by their Topic so the
 * page reads like a structured course map rather than a flat library
 * list. Topics with no published quizzes still appear so the learner
 * sees the full journey for the subject.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeftIcon,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  Lock,
  PencilLine,
  Play,
  Sparkles,
  StarIcon,
} from '../ui/icons'
import { useFirestore }     from '../../hooks/useFirestore'
import { useSubscription }  from '../../hooks/useSubscription'
import { useAuth }          from '../../contexts/AuthContext'
import { SUBJECT_MAP, getTopics, getSubtopics, getTopicLabel } from '../../config/curriculum'
import Icon                 from '../ui/Icon'
import Skeleton             from '../ui/Skeleton'
import SeoHelmet            from '../seo/SeoHelmet'
import GameStickerStyles    from '../games/GameStickerStyles'
import MobileBottomNav      from '../layout/MobileBottomNav'
import UpgradeModal         from '../subscription/UpgradeModal'

// Subject palette — re-uses the dashboard's tone scheme so the drill-down
// inherits the colour the learner picked on the SubjectCardRich.
const SUBJECT_TONES = {
  mathematics:      { ring: 'ring-blue-100',   bg: 'bg-blue-50',   text: 'text-blue-700',   bar: 'bg-blue-600'   },
  english:          { ring: 'ring-green-100',  bg: 'bg-green-50',  text: 'text-green-700',  bar: 'bg-green-600'  },
  science:          { ring: 'ring-purple-100', bg: 'bg-purple-50', text: 'text-purple-700', bar: 'bg-purple-600' },
  'social-studies': { ring: 'ring-orange-100', bg: 'bg-orange-50', text: 'text-orange-700', bar: 'bg-orange-500' },
  technology:       { ring: 'ring-slate-200',  bg: 'bg-slate-100', text: 'text-slate-700',  bar: 'bg-slate-600'  },
  'expressive-arts':{ ring: 'ring-amber-100',  bg: 'bg-amber-50',  text: 'text-amber-700',  bar: 'bg-amber-500'  },
  cinyanja:         { ring: 'ring-pink-100',   bg: 'bg-pink-50',   text: 'text-pink-700',   bar: 'bg-pink-500'   },
  // legacy
  'home-economics': { ring: 'ring-pink-100',   bg: 'bg-pink-50',   text: 'text-pink-700',   bar: 'bg-pink-500'   },
}

function difficultyColor(count = 0) {
  if (count > 30) return 'text-red-500'
  if (count > 15) return 'text-amber-500'
  return 'text-emerald-600'
}

function QuizRow({ quiz, locked, onStart }) {
  return (
    <button
      type="button"
      onClick={() => onStart(quiz.id, locked)}
      aria-label={locked ? `Locked — upgrade to start ${quiz.title}` : `Start ${quiz.title}`}
      className="zx-card group flex w-full items-center justify-between gap-3 rounded-2xl theme-card px-3.5 py-3 text-left transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl theme-accent-bg theme-accent-text">
          <Icon as={locked ? Lock : Play} size="sm" strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h4 className="truncate text-sm font-black theme-text">{quiz.title}</h4>
            {quiz.isDemo && (
              <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-700">
                Demo
              </span>
            )}
            {locked && !quiz.isDemo && (
              <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
                <Icon as={Lock} size="xs" /> Locked
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-bold theme-text-muted">
            <span className={`inline-flex items-center gap-1 ${difficultyColor(quiz.questionCount)}`}>
              <Icon as={ClipboardList} size="xs" /> {quiz.questionCount ?? '?'} qs
            </span>
            {quiz.duration && (
              <span className="inline-flex items-center gap-1">
                <Icon as={Clock} size="xs" /> {quiz.duration} min
              </span>
            )}
            {quiz.term && (
              <span className="rounded-full theme-bg-subtle px-2 py-0.5 text-[10px] font-black uppercase tracking-wider">
                Term {quiz.term}
              </span>
            )}
            {quiz.totalMarks && (
              <span className="inline-flex items-center gap-1">
                <Icon as={StarIcon} size="xs" /> {quiz.totalMarks}
              </span>
            )}
          </div>
        </div>
      </div>
      <span className="shrink-0 inline-flex items-center gap-1 rounded-full theme-accent-fill theme-on-accent px-3 py-1.5 text-xs font-black shadow-sm transition group-hover:translate-x-0.5">
        {locked ? 'Unlock' : 'Start'}
        <Icon as={locked ? Lock : ChevronRight} size="xs" strokeWidth={2.4} />
      </span>
    </button>
  )
}

function TopicSection({ topic, quizzes, expanded, onToggle, onStart, isLocked, tone }) {
  const total = quizzes.length
  const empty = total === 0
  return (
    <div className="zx-card theme-card rounded-2xl border theme-border overflow-hidden">
      <button
        type="button"
        disabled={empty}
        onClick={() => !empty && onToggle(topic)}
        aria-expanded={expanded}
        aria-controls={`topic-${topic}`}
        className={`flex w-full items-center gap-3 p-4 text-left transition ${empty ? 'cursor-not-allowed opacity-65' : 'hover:theme-bg-subtle'}`}
      >
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ring-1 ${tone.bg} ${tone.ring} ${tone.text}`}>
          <Icon as={PencilLine} size="md" strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-black theme-text">{topic}</h3>
          <p className="mt-0.5 text-xs font-bold theme-text-muted">
            {empty ? 'No quizzes yet — coming soon' : `${total} ${total === 1 ? 'quiz' : 'quizzes'}`}
          </p>
        </div>
        {!empty && (
          <span
            aria-hidden="true"
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full theme-bg-subtle theme-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
          >
            <Icon as={ChevronDown} size="sm" />
          </span>
        )}
      </button>

      {expanded && !empty && (
        <div id={`topic-${topic}`} className="space-y-2.5 border-t theme-border theme-bg-subtle p-3.5 sm:p-4">
          {quizzes.map(quiz => (
            <QuizRow
              key={quiz.id}
              quiz={quiz}
              locked={isLocked(quiz)}
              onStart={onStart}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SubtopicRow({ subtopic, quizzes, expanded, onToggle, onStart, isLocked, tone }) {
  const total = quizzes.length
  const empty = total === 0
  return (
    <div className="zx-card rounded-xl border theme-border theme-card overflow-hidden">
      <button
        type="button"
        disabled={empty}
        onClick={() => !empty && onToggle(subtopic)}
        aria-expanded={expanded}
        aria-controls={`subtopic-${subtopic}`}
        className={`flex w-full items-center gap-3 px-3.5 py-3 text-left transition ${empty ? 'cursor-not-allowed opacity-65' : 'hover:theme-bg-subtle'}`}
      >
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 ${tone.bg} ${tone.ring} ${tone.text}`}>
          <Icon as={PencilLine} size="sm" strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-black theme-text">{subtopic}</h4>
          <p className="mt-0.5 text-[11px] font-bold theme-text-muted">
            {empty ? 'No quizzes yet — coming soon' : `${total === 1 ? '1 quiz' : `${total} quizzes`}`}
          </p>
        </div>
        {!empty && (
          <span
            aria-hidden="true"
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full theme-bg-subtle theme-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
          >
            <Icon as={ChevronDown} size="xs" />
          </span>
        )}
      </button>

      {expanded && !empty && (
        <div id={`subtopic-${subtopic}`} className="space-y-2 border-t theme-border p-3">
          {quizzes.map(quiz => (
            <QuizRow
              key={quiz.id}
              quiz={quiz}
              locked={isLocked(quiz)}
              onStart={onStart}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TopicTreeSection({ topic, subtopics, expanded, onToggleTopic, expandedSubtopics, onToggleSubtopic, onStart, isLocked, tone }) {
  const subtopicCount = subtopics.length
  const topicQuizCount = subtopics.reduce((sum, s) => sum + s.quizzes.length, 0)
  return (
    <div className="zx-card theme-card rounded-2xl border theme-border overflow-hidden">
      <button
        type="button"
        onClick={() => onToggleTopic(topic)}
        aria-expanded={expanded}
        aria-controls={`topic-${topic}`}
        className="flex w-full items-center gap-3 p-4 text-left transition hover:theme-bg-subtle"
      >
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ring-1 ${tone.bg} ${tone.ring} ${tone.text}`}>
          <Icon as={PencilLine} size="md" strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-black theme-text">{topic}</h3>
          <p className="mt-0.5 text-xs font-bold theme-text-muted">
            {subtopicCount} {subtopicCount === 1 ? 'subtopic' : 'subtopics'}
            {topicQuizCount > 0 ? ` · ${topicQuizCount === 1 ? '1 quiz' : `${topicQuizCount} quizzes`}` : ''}
          </p>
        </div>
        <span
          aria-hidden="true"
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full theme-bg-subtle theme-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <Icon as={ChevronDown} size="sm" />
        </span>
      </button>

      {expanded && (
        <div id={`topic-${topic}`} className="space-y-2.5 border-t theme-border theme-bg-subtle p-3.5 sm:p-4">
          {subtopics.map(s => (
            <SubtopicRow
              key={s.name}
              subtopic={s.name}
              quizzes={s.quizzes}
              expanded={expandedSubtopics.has(`${topic}::${s.name}`)}
              onToggle={(name) => onToggleSubtopic(topic, name)}
              onStart={onStart}
              isLocked={isLocked}
              tone={tone}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TopicSkeleton() {
  return (
    <div className="zx-card theme-card rounded-2xl border theme-border p-4 animate-pulse">
      <div className="flex items-center gap-3">
        <Skeleton shape="circle" size={44} />
        <div className="flex-1 space-y-2">
          <Skeleton height={14} width="55%" />
          <Skeleton height={10} width="35%" />
        </div>
        <Skeleton shape="circle" size={32} />
      </div>
    </div>
  )
}

export default function SubjectDrillDown() {
  const { grade: rawGrade, subjectId } = useParams()
  const navigate = useNavigate()
  const { getQuizzes } = useFirestore()
  const { isDemoOnly } = useSubscription()
  const { userProfile } = useAuth()

  const subject = SUBJECT_MAP[subjectId]
  const grade = String(rawGrade ?? '').trim()
  const tone = SUBJECT_TONES[subjectId] || SUBJECT_TONES.mathematics

  const [quizzes, setQuizzes]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [expandedTopics, setExpandedTopics] = useState(() => new Set())
  const [expandedSubtopics, setExpandedSubtopics] = useState(() => new Set())
  const [showUpgrade, setShowUpgrade] = useState(false)

  // Topic ordering comes from the canonical CBC curriculum so the page
  // reads like the syllabus even before any quizzes are published.
  const canonicalTopics = useMemo(() => (subject ? getTopics(subject.id, grade) : []), [subject, grade])
  const topicLabel = useMemo(() => (subject ? getTopicLabel(subject.id, grade) : getTopicLabel()), [subject, grade])
  const topicSubtopics = useMemo(() => {
    if (!subject) return new Map()
    const m = new Map()
    canonicalTopics.forEach(t => m.set(t, getSubtopics(subject.id, grade, t)))
    return m
  }, [subject, grade, canonicalTopics])
  const hasSubtopicTree = useMemo(() => {
    for (const list of topicSubtopics.values()) if (list.length) return true
    return false
  }, [topicSubtopics])
  const subtopicCount = useMemo(() => {
    let n = 0
    for (const list of topicSubtopics.values()) n += list.length
    return n
  }, [topicSubtopics])

  useEffect(() => {
    if (!subject || !grade) {
      setQuizzes([])
      setLoading(false)
      return undefined
    }
    let cancelled = false
    setLoading(true)
    getQuizzes({ grade, subject: subject.label }).then(rows => {
      if (cancelled) return
      setQuizzes(rows)
      setLoading(false)
    }).catch(err => {
      if (cancelled) return
      console.error('SubjectDrillDown:', err)
      setQuizzes([])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [subject, grade, getQuizzes])

  // Group by topic, preserving canonical order. When the subject/grade has a
  // subtopic tree (e.g. Grade 7 Science), quizzes match by quiz.topic ===
  // subtopic name; otherwise they match against the flat topic list. Any
  // quiz that doesn't match falls into the "Other quizzes" bucket.
  const grouped = useMemo(() => {
    if (hasSubtopicTree) {
      const buckets = new Map()
      const subtopicToTopic = new Map()
      canonicalTopics.forEach(t => {
        const subs = topicSubtopics.get(t) || []
        subs.forEach(s => {
          buckets.set(s, [])
          subtopicToTopic.set(s, t)
        })
      })
      const extras = []
      for (const quiz of quizzes) {
        const t = quiz.topic?.trim()
        if (t && buckets.has(t)) {
          buckets.get(t).push(quiz)
        } else {
          extras.push(quiz)
        }
      }
      const tree = canonicalTopics.map(t => ({
        topic: t,
        subtopics: (topicSubtopics.get(t) || []).map(s => ({ name: s, quizzes: buckets.get(s) || [] })),
      }))
      return { tree, extras }
    }

    const map = new Map()
    canonicalTopics.forEach(t => map.set(t, []))
    const extras = []
    for (const quiz of quizzes) {
      const t = quiz.topic?.trim()
      if (t && map.has(t)) {
        map.get(t).push(quiz)
      } else {
        extras.push(quiz)
      }
    }
    const rows = canonicalTopics.map(t => ({ topic: t, items: map.get(t) || [] }))
    if (extras.length) rows.push({ topic: 'Other quizzes', items: extras })
    return { rows }
  }, [quizzes, canonicalTopics, topicSubtopics, hasSubtopicTree])

  const totalQuizzes = quizzes.length
  const demoOnlyAvailable = isDemoOnly ? quizzes.filter(q => q.isDemo).length : null

  function handleToggle(topic) {
    setExpanded(prev => (prev === topic ? null : topic))
  }

  function handleToggleTopic(topic) {
    setExpandedTopics(prev => {
      const next = new Set(prev)
      if (next.has(topic)) next.delete(topic); else next.add(topic)
      return next
    })
  }

  function handleToggleSubtopic(topic, subtopic) {
    const key = `${topic}::${subtopic}`
    setExpandedSubtopics(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  function handleStart(quizId, locked) {
    if (locked) { setShowUpgrade(true); return }
    navigate(`/quiz/${quizId}`)
  }

  function isLocked(quiz) {
    return isDemoOnly && !quiz.isDemo
  }

  // Bad URL — subject slug we don't know about. Bounce back to the
  // dashboard rather than render an empty shell.
  if (!subject) {
    return (
      <div className="min-h-screen theme-bg flex items-center justify-center p-4">
        <div className="zx-card theme-card rounded-3xl border theme-border p-6 max-w-md text-center">
          <div className="text-3xl mb-2">😕</div>
          <p className="font-black theme-text mb-1">Subject not found</p>
          <p className="theme-text-muted text-sm mb-4">We couldn&rsquo;t find a subject called &ldquo;{subjectId}&rdquo;.</p>
          <Link to="/dashboard" className="inline-flex items-center gap-1 rounded-full theme-accent-fill theme-on-accent px-4 py-2 text-sm font-black">
            <Icon as={ArrowLeftIcon} size="xs" /> Back to dashboard
          </Link>
        </div>
      </div>
    )
  }

  const profileGrade = userProfile?.grade ? String(userProfile.grade) : null
  const isOwnGrade = profileGrade && profileGrade === grade

  // CBC exam policy: a learner may revise their own grade and grades below,
  // but never above. If the URL points to a higher grade, send them back to
  // their own dashboard rather than leak quizzes from a future grade.
  if (profileGrade && Number(grade) > Number(profileGrade)) {
    return (
      <div className="min-h-screen theme-bg flex items-center justify-center p-4">
        <div className="zx-card theme-card rounded-3xl border theme-border p-6 max-w-md text-center">
          <div className="text-3xl mb-2">🔒</div>
          <p className="font-black theme-text mb-1">Grade {grade} isn&rsquo;t open yet</p>
          <p className="theme-text-muted text-sm mb-4">
            You can revise your own grade and any grade below. Grade {grade} quizzes unlock once you move up.
          </p>
          <Link to="/dashboard" className="inline-flex items-center gap-1 rounded-full theme-accent-fill theme-on-accent px-4 py-2 text-sm font-black">
            <Icon as={ArrowLeftIcon} size="xs" /> Back to dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="learner-game-theme min-h-screen theme-bg flex flex-col">
      <SeoHelmet
        title={`${subject.label} · Grade ${grade}`}
        path={`/practise/${grade}/${subjectId}`}
        noIndex
      />
      <GameStickerStyles />
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}

      {/* ──────────── HEADER ─────────────────────────────────── */}
      <header className="learner-dashboard-header sticky top-0 z-30 theme-card border-b theme-border shadow-sm">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="zx-card theme-card theme-border learner-chrome-icon flex h-10 w-10 items-center justify-center rounded-2xl border shadow-elev-sm transition-all hover:theme-accent-bg hover:theme-accent-text min-h-0"
          >
            <Icon as={ArrowLeftIcon} size="md" strokeWidth={2.2} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-widest theme-text-muted">Course Map</p>
            <h1 className="truncate text-sm font-black theme-text">{subject.label} · Grade {grade}</h1>
          </div>
        </div>
      </header>

      {/* ──────────── MAIN CONTENT ───────────────────────────── */}
      <main className="relative z-10 flex-1 max-w-4xl mx-auto w-full px-4 py-5 pb-28 space-y-6 theme-text">

        {/* ── Subject hero ─────────────────────────────────── */}
        <section className={`zx-card relative overflow-hidden rounded-3xl ${tone.bg} ring-1 ${tone.ring} p-5 sm:p-6`}>
          <div className="flex items-start gap-4">
            <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white text-3xl shadow-sm sm:h-20 sm:w-20 sm:text-4xl`}>
              {subject.icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className={`text-[10px] font-black uppercase tracking-widest ${tone.text}`}>
                {isOwnGrade ? 'Your grade' : 'Course map'}
              </p>
              <h2 className={`mt-1 text-2xl font-black sm:text-3xl ${tone.text}`}>
                {subject.label}
              </h2>
              <p className="mt-1 text-sm font-bold theme-text">
                Grade {grade} · {canonicalTopics.length} {canonicalTopics.length === 1 ? topicLabel.singular : topicLabel.plural}
                {hasSubtopicTree ? ` · ${subtopicCount} subtopic${subtopicCount === 1 ? '' : 's'}` : ''}
                {!loading ? ` · ${totalQuizzes} quiz${totalQuizzes === 1 ? '' : 'zes'}` : ''}
              </p>
              {isDemoOnly && demoOnlyAvailable !== null && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1 text-xs font-black text-slate-700 ring-1 ring-slate-200">
                  <Icon as={Sparkles} size="xs" /> {demoOnlyAvailable} demo quiz{demoOnlyAvailable === 1 ? '' : 'zes'} available
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ── Topic sections ───────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="learner-page-heading text-display-md flex items-center gap-2">
              <Icon as={ClipboardList} size="lg" strokeWidth={2.1} /> {topicLabel.titlePlural}
            </h2>
            <p className="text-xs font-bold theme-text-muted">
              {loading ? 'Loading…' : `${totalQuizzes} quiz${totalQuizzes === 1 ? '' : 'zes'}`}
            </p>
          </div>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <TopicSkeleton key={i} />)}
            </div>
          ) : hasSubtopicTree ? (
            <>
              {grouped.tree.map(({ topic, subtopics }) => (
                <TopicTreeSection
                  key={topic}
                  topic={topic}
                  subtopics={subtopics}
                  expanded={expandedTopics.has(topic)}
                  onToggleTopic={handleToggleTopic}
                  expandedSubtopics={expandedSubtopics}
                  onToggleSubtopic={handleToggleSubtopic}
                  onStart={handleStart}
                  isLocked={isLocked}
                  tone={tone}
                />
              ))}
              {grouped.extras.length > 0 && (
                <TopicSection
                  topic="Other quizzes"
                  quizzes={grouped.extras}
                  expanded={expanded === 'Other quizzes'}
                  onToggle={handleToggle}
                  onStart={handleStart}
                  isLocked={isLocked}
                  tone={tone}
                />
              )}
            </>
          ) : (grouped.rows || []).length === 0 ? (
            <div className="zx-card theme-card rounded-2xl border theme-border p-6 text-center">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl theme-accent-bg theme-accent-text">
                <Icon as={PencilLine} size="lg" strokeWidth={2.1} />
              </div>
              <p className="font-black theme-text">No {topicLabel.plural} yet</p>
              <p className="theme-text-muted text-sm mt-1">
                We&rsquo;re still building this subject for Grade {grade}. Check back soon.
              </p>
            </div>
          ) : (
            grouped.rows.map(({ topic, items }) => (
              <TopicSection
                key={topic}
                topic={topic}
                quizzes={items}
                expanded={expanded === topic}
                onToggle={handleToggle}
                onStart={handleStart}
                isLocked={isLocked}
                tone={tone}
              />
            ))
          )}
        </section>
      </main>

      <MobileBottomNav className="learner-bottom-nav" />
    </div>
  )
}
