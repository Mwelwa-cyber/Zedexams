import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { listMyGenerations } from '../../utils/teacherLibraryService'
import { buildReminders, SEEN_REMINDERS_KEY } from '../../utils/teacherReminders'
import {
  Bell,
  Plus,
  X,
  PencilLine,
  BookOpen,
  FileText,
  Sparkles,
} from '../ui/icons'
import Icon from '../ui/Icon'

const QUICK_CREATE = [
  { to: '/teacher/generate/lesson-plan', icon: BookOpen,    label: 'Lesson Plan',    accent: '#fde2c4' },
  { to: '/teacher/generate/notes',       icon: FileText,    label: 'Teacher Notes',  accent: '#dbe7f4' },
  { to: '/teacher/test-papers/new',      icon: PencilLine,  label: 'Test Paper',     accent: '#e8d8f0' },
  { to: '/teacher/generate/flashcards',  icon: Sparkles,    label: 'Flashcards',     accent: '#fde9b8' },
]

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

  const [generations, setGenerations] = useState([])
  const [quizzes, setQuizzes] = useState([])
  const [seenReminderIds, setSeenReminderIds] = useState(() => new Set())

  const [bellOpen, setBellOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const bellRef = useRef(null)
  const createRef = useRef(null)

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
      if (e.key === 'Escape') {
        setBellOpen(false); setCreateOpen(false)
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

  return (
    <div
      className="lg:sticky lg:top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2.5 mb-4 hidden lg:flex items-center justify-end gap-2 backdrop-blur"
      style={{ background: 'rgba(245,239,225,.92)', borderBottom: '1px solid rgba(14,42,50,.08)' }}
    >
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
