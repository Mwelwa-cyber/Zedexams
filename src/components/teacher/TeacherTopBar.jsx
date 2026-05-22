import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import {
  listMyGenerations,
  titleForGeneration,
} from '../../utils/teacherLibraryService'
import { buildReminders, SEEN_REMINDERS_KEY } from '../../utils/teacherReminders'
import {
  Search,
  Bell,
  Plus,
  X,
  PencilLine,
  BookOpen,
  Presentation,
  FileText,
  Sparkles,
  FolderOpen,
} from '../ui/icons'
import Icon from '../ui/Icon'

const QUICK_CREATE = [
  { to: '/teacher/generate/lesson-plan', icon: BookOpen,    label: 'Lesson Plan',    accent: '#fde2c4' },
  { to: '/teacher/generate/notes',       icon: FileText,    label: 'Teacher Notes',  accent: '#dbe7f4' },
  { to: '/teacher/assessments/new',      icon: PencilLine,  label: 'Assessment',     accent: '#e8d8f0' },
  { to: '/teacher/lessons/new',          icon: Presentation, label: 'Lesson Slide',  accent: '#fde9b8' },
  { to: '/teacher/generate/flashcards',  icon: Sparkles,    label: 'Flashcards',     accent: '#fde9b8' },
]

const TOOL_ICON = {
  lesson_plan:   { emoji: '🦊', label: 'Lesson Plan' },
  scheme_of_work:{ emoji: '🦁', label: 'Scheme of Work' },
  worksheet:     { emoji: '🐢', label: 'Worksheet' },
  flashcards:    { emoji: '🎴', label: 'Flashcards' },
  rubric:        { emoji: '📋', label: 'Rubric' },
  notes:         { emoji: '🦉', label: 'Notes' },
}

function useClickAway(ref, onAway) {
  useEffect(() => {
    function handler(e) {
      if (!ref.current) return
      if (!ref.current.contains(e.target)) onAway()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [ref, onAway])
}

export default function TeacherTopBar() {
  const { currentUser } = useAuth()
  const { getMyQuizzes } = useFirestore()
  const navigate = useNavigate()

  const [generations, setGenerations] = useState([])
  const [quizzes, setQuizzes] = useState([])
  const [seenReminderIds, setSeenReminderIds] = useState(() => new Set())

  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const searchRef = useRef(null)
  const bellRef = useRef(null)
  const createRef = useRef(null)

  useClickAway(searchRef, () => setSearchOpen(false))
  useClickAway(bellRef, () => setBellOpen(false))
  useClickAway(createRef, () => setCreateOpen(false))

  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    Promise.all([
      listMyGenerations({ uid: currentUser.uid }).catch(() => []),
      getMyQuizzes(currentUser.uid).catch(() => []),
    ])
      .then(([g, q]) => {
        if (cancelled) return
        setGenerations(g || [])
        setQuizzes(q || [])
      })
      .catch(err => console.error('TeacherTopBar load:', err))
    return () => { cancelled = true }
  }, [currentUser, getMyQuizzes])

  useEffect(() => {
    function onKey(e) {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
      if (e.key === 'Escape') {
        setSearchOpen(false); setBellOpen(false); setCreateOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const reminders = useMemo(
    () => buildReminders({ generations, quizzes }),
    [generations, quizzes],
  )

  useEffect(() => {
    if (!currentUser) {
      setSeenReminderIds(new Set())
      return
    }
    try {
      const raw = localStorage.getItem(SEEN_REMINDERS_KEY(currentUser.uid))
      setSeenReminderIds(raw ? new Set(JSON.parse(raw)) : new Set())
    } catch {
      setSeenReminderIds(new Set())
    }
  }, [currentUser])

  useEffect(() => {
    if (!bellOpen || !currentUser || reminders.length === 0) return
    let changed = false
    const next = new Set(seenReminderIds)
    for (const r of reminders) {
      if (!next.has(r.id)) { next.add(r.id); changed = true }
    }
    if (!changed) return
    setSeenReminderIds(next)
    try {
      localStorage.setItem(SEEN_REMINDERS_KEY(currentUser.uid), JSON.stringify([...next]))
    } catch { /* localStorage unavailable; badge will reset on next refresh */ }
  }, [bellOpen, reminders, currentUser, seenReminderIds])

  const unreadCount = reminders.reduce(
    (n, r) => (seenReminderIds.has(r.id) ? n : n + 1),
    0,
  )

  const searchResults = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return []
    const fromGens = generations
      .map(g => ({
        id: `g-${g.id}`,
        kind: 'generation',
        title: titleForGeneration(g),
        subtitle: [g.inputs?.grade, g.inputs?.subject ? String(g.inputs.subject).replace(/_/g, ' ') : ''].filter(Boolean).join(' · '),
        meta: TOOL_ICON[g.tool] || { emoji: '📄', label: 'Item' },
        to: `/teacher/library/${g.id}`,
        haystack: [titleForGeneration(g), g.inputs?.topic, g.inputs?.subtopic, g.inputs?.grade, g.inputs?.subject, TOOL_ICON[g.tool]?.label].filter(Boolean).join(' ').toLowerCase(),
      }))
    const fromQuizzes = quizzes.map(q => ({
      id: `q-${q.id}`,
      kind: 'assessment',
      title: q.title || q.topic || 'Untitled assessment',
      subtitle: [q.grade || q.targetGrade, q.subject ? String(q.subject).replace(/_/g, ' ') : ''].filter(Boolean).join(' · '),
      meta: { emoji: '🦅', label: 'Assessment' },
      to: `/teacher/assessments/${q.id}/edit`,
      haystack: [q.title, q.topic, q.subject, q.grade, 'assessment'].filter(Boolean).join(' ').toLowerCase(),
    }))
    return [...fromGens, ...fromQuizzes]
      .filter(r => r.haystack.includes(term))
      .slice(0, 8)
  }, [query, generations, quizzes])

  function handleSubmitSearch(e) {
    e.preventDefault()
    const term = query.trim()
    if (!term) return
    setSearchOpen(false)
    navigate(`/teacher/library?q=${encodeURIComponent(term)}`)
  }

  return (
    <div
      className="sticky top-20 lg:top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2.5 mb-4 flex items-center gap-2 backdrop-blur"
      style={{ background: 'rgba(245,239,225,.92)', borderBottom: '1px solid rgba(14,42,50,.08)' }}
    >
      {/* Search */}
      <div ref={searchRef} className="relative flex-1 min-w-0 max-w-xl">
        <form onSubmit={handleSubmitSearch}>
          <div
            className="flex items-center gap-2 rounded-xl border-2 px-3 py-2 transition-colors"
            style={{ background: '#fff', borderColor: searchOpen ? '#ff7a2e' : '#0e2a32' }}
          >
            <Icon as={Search} size="sm" />
            <input
              type="search"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSearchOpen(true) }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search lessons, notes, assessments…"
              className="flex-1 bg-transparent outline-none text-sm font-medium min-w-0"
              aria-label="Search your teaching materials"
            />
            <kbd
              className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0"
              style={{ background: '#f5efe1', color: '#566f76', border: '1px solid #d4cab2' }}
            >
              ⌘K
            </kbd>
          </div>
        </form>
        {searchOpen && query.trim() && (
          <div
            className="absolute left-0 right-0 mt-2 rounded-xl border-2 shadow-elev-xl overflow-hidden"
            style={{ background: '#fff', borderColor: '#0e2a32', maxHeight: 360, overflowY: 'auto' }}
          >
            {searchResults.length === 0 ? (
              <div className="p-4 text-center" style={{ fontSize: 13, color: '#8a9aa1' }}>
                No matches. Press Enter to search the full library.
              </div>
            ) : (
              <ul className="py-1">
                {searchResults.map((r) => (
                  <li key={r.id}>
                    <Link
                      to={r.to}
                      onClick={() => setSearchOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 no-underline hover:bg-[#fff5e6] transition-colors"
                    >
                      <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{r.meta.emoji}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-bold text-sm truncate" style={{ color: '#0e2a32' }}>{r.title}</span>
                        <span className="block text-xs truncate" style={{ color: '#566f76' }}>
                          {r.meta.label}{r.subtitle ? ` · ${r.subtitle}` : ''}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
                <li className="border-t" style={{ borderColor: '#f0eee8' }}>
                  <button
                    type="button"
                    onClick={handleSubmitSearch}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm font-bold hover:bg-[#fff5e6] transition-colors"
                    style={{ color: '#0e2a32' }}
                  >
                    <Icon as={FolderOpen} size="sm" />
                    See all results in Library →
                  </button>
                </li>
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Notifications — desktop only (mobile/tablet use Alerts in TeacherGlassHeader) */}
      <div ref={bellRef} className="relative flex-shrink-0 hidden lg:block">
        <button
          type="button"
          onClick={() => { setBellOpen(o => !o); setCreateOpen(false) }}
          aria-label={`Notifications${unreadCount ? `, ${unreadCount} new` : ''}`}
          aria-expanded={bellOpen}
          className="relative flex items-center justify-center rounded-xl border-2 transition-colors"
          style={{ background: '#fff', borderColor: '#0e2a32', width: 40, height: 40 }}
        >
          <Icon as={Bell} size="sm" />
          {unreadCount > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 flex items-center justify-center rounded-full text-[10px] font-black"
              style={{ background: '#ff7a2e', color: '#fff', minWidth: 18, height: 18, padding: '0 5px', border: '2px solid #fff' }}
            >
              {unreadCount}
            </span>
          )}
        </button>
        {bellOpen && (
          <div
            className="absolute right-0 mt-2 w-80 rounded-xl border-2 shadow-elev-xl"
            style={{ background: '#fff', borderColor: '#0e2a32', maxHeight: 420, overflowY: 'auto' }}
          >
            <div className="px-4 py-3 border-b" style={{ borderColor: '#f0eee8' }}>
              <p className="text-sm font-black" style={{ color: '#0e2a32', fontFamily: "'Fraunces', serif" }}>
                Reminders
              </p>
              <p className="text-xs" style={{ color: '#8a9aa1' }}>
                Personalised nudges based on your activity.
              </p>
            </div>
            {reminders.length === 0 ? (
              <div className="p-6 text-center" style={{ fontSize: 13, color: '#8a9aa1' }}>
                <div className="mb-2" style={{ fontSize: 28, opacity: 0.5 }}>🔔</div>
                You're all caught up.
              </div>
            ) : (
              <ul>
                {reminders.map((r) => {
                  const dot = r.tone === 'warn' ? '#ff7a2e' : r.tone === 'good' ? '#10864e' : '#16505d'
                  return (
                    <li key={r.id} className="border-t first:border-t-0" style={{ borderColor: '#f0eee8' }}>
                      <Link
                        to={r.to}
                        onClick={() => setBellOpen(false)}
                        className="flex items-start gap-3 px-4 py-3 no-underline hover:bg-[#fff5e6] transition-colors"
                      >
                        <span
                          className="mt-1 rounded-full flex-shrink-0"
                          style={{ background: dot, width: 8, height: 8 }}
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block font-bold text-sm" style={{ color: '#0e2a32' }}>{r.title}</span>
                          <span className="block text-xs mt-0.5" style={{ color: '#566f76', lineHeight: 1.4 }}>{r.body}</span>
                          <span className="inline-block mt-1.5 text-xs font-bold" style={{ color: '#ff7a2e' }}>{r.cta} →</span>
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Quick Create */}
      <div ref={createRef} className="relative flex-shrink-0">
        <button
          type="button"
          onClick={() => { setCreateOpen(o => !o); setBellOpen(false) }}
          aria-label="Quick create"
          aria-expanded={createOpen}
          className="flex items-center gap-1.5 rounded-xl font-bold transition-colors"
          style={{ background: '#ff7a2e', color: '#fff', padding: '0 14px', height: 40, fontSize: 13.5 }}
          onMouseEnter={e => { e.currentTarget.style.background = '#e6651a' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#ff7a2e' }}
        >
          <Icon as={createOpen ? X : Plus} size="sm" />
          <span className="hidden sm:inline">Create</span>
        </button>
        {createOpen && (
          <div
            className="absolute right-0 mt-2 w-64 rounded-xl border-2 shadow-elev-xl overflow-hidden"
            style={{ background: '#fff', borderColor: '#0e2a32' }}
          >
            <div className="px-4 py-3 border-b" style={{ borderColor: '#f0eee8' }}>
              <p className="text-xs font-black uppercase tracking-wider" style={{ color: '#ff7a2e' }}>
                Quick create
              </p>
            </div>
            <ul>
              {QUICK_CREATE.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    onClick={() => setCreateOpen(false)}
                    className="flex items-center gap-3 px-4 py-2.5 no-underline hover:bg-[#fff5e6] transition-colors"
                  >
                    <span
                      style={{ width: 32, height: 32, borderRadius: 9, background: item.accent, display: 'grid', placeItems: 'center', flexShrink: 0 }}
                    >
                      <Icon as={item.icon} size="sm" />
                    </span>
                    <span className="text-sm font-bold" style={{ color: '#0e2a32' }}>{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
