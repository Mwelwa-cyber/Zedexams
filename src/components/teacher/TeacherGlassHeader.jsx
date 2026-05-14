import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { listMyGenerations } from '../../utils/teacherLibraryService'
import { buildReminders, SEEN_REMINDERS_KEY } from '../../utils/teacherReminders'
import Logo from '../ui/Logo'
import Icon from '../ui/Icon'
import ThemeSelector from '../ui/ThemeSelector'
import { HeaderIconLink, HeaderIconButton } from '../ui/HeaderIconButton'
import {
  BarChart3,
  Bell,
  User,
  Settings,
  LogOut,
  GraduationCap,
} from '../ui/icons'

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

export default function TeacherGlassHeader() {
  const { currentUser, userProfile, isAdmin, logout } = useAuth()
  const { getMyQuizzes } = useFirestore()
  const navigate = useNavigate()

  const [generations, setGenerations] = useState([])
  const [quizzes, setQuizzes] = useState([])
  const [seenReminderIds, setSeenReminderIds] = useState(() => new Set())
  const [bellOpen, setBellOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)

  const bellRef = useRef(null)
  const accountRef = useRef(null)

  useClickAway(bellRef, () => setBellOpen(false))
  useClickAway(accountRef, () => setAccountOpen(false))

  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    Promise.all([
      listMyGenerations({ uid: currentUser.uid }).catch(() => []),
      getMyQuizzes(currentUser.uid).catch(() => []),
    ]).then(([g, q]) => {
      if (cancelled) return
      setGenerations(g || [])
      setQuizzes(q || [])
    })
    return () => { cancelled = true }
  }, [currentUser, getMyQuizzes])

  const reminders = useMemo(
    () => buildReminders({ generations, quizzes }),
    [generations, quizzes],
  )

  useEffect(() => {
    if (!currentUser) { setSeenReminderIds(new Set()); return }
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
    } catch { /* localStorage unavailable; badge resets on refresh */ }
  }, [bellOpen, reminders, currentUser, seenReminderIds])

  const unreadCount = reminders.reduce(
    (n, r) => (seenReminderIds.has(r.id) ? n : n + 1),
    0,
  )

  async function handleSignOut() {
    setAccountOpen(false)
    await logout()
    navigate('/login')
  }

  return (
    <header className="zx-glass-nav fixed inset-x-0 top-0 z-40 lg:hidden">
      <div className="app-container flex min-h-16 items-center justify-between gap-2 px-3 py-2 sm:px-4">
        <Link to="/teacher" className="zx-logo-pill no-underline" aria-label="Teacher home">
          <Logo variant="full" size="sm" />
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          <HeaderIconLink to="/teacher" label="Progress" icon={BarChart3} />

          <ThemeSelector dashboardStyle />

          <div ref={bellRef} className="relative">
            <HeaderIconButton
              label="Alerts"
              icon={Bell}
              onClick={() => { setBellOpen(o => !o); setAccountOpen(false) }}
              aria-label={unreadCount > 0 ? `Alerts, ${unreadCount} unread` : 'Alerts'}
              aria-expanded={bellOpen}
              aria-haspopup="true"
              important={unreadCount > 0}
              active={bellOpen}
              badge={unreadCount > 0 ? (unreadCount > 9 ? '9+' : unreadCount) : null}
            >
              {bellOpen && (
                <div
                  className="theme-card theme-border absolute right-0 top-16 z-50 w-80 max-w-[calc(100vw-1rem)] rounded-2xl border shadow-xl"
                  style={{ maxHeight: 420, overflowY: 'auto' }}
                >
                  <div className="theme-border border-b px-4 py-3">
                    <p className="theme-text text-sm font-black" style={{ fontFamily: "'Fraunces', serif" }}>
                      Reminders
                    </p>
                    <p className="theme-text-muted text-xs">
                      Personalised nudges based on your activity.
                    </p>
                  </div>
                  {reminders.length === 0 ? (
                    <div className="theme-text-muted p-6 text-center text-sm">
                      <div className="mb-2" style={{ fontSize: 28, opacity: 0.5 }}>🔔</div>
                      You're all caught up.
                    </div>
                  ) : (
                    <ul>
                      {reminders.map((r) => {
                        const dot = r.tone === 'warn' ? '#ff7a2e' : r.tone === 'good' ? '#10864e' : '#16505d'
                        return (
                          <li key={r.id} className="theme-border border-t first:border-t-0">
                            <Link
                              to={r.to}
                              onClick={() => setBellOpen(false)}
                              className="hover:theme-bg-subtle flex items-start gap-3 px-4 py-3 no-underline transition-colors"
                            >
                              <span
                                className="mt-1 flex-shrink-0 rounded-full"
                                style={{ background: dot, width: 8, height: 8 }}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="theme-text block text-sm font-bold">{r.title}</span>
                                <span className="theme-text-muted mt-0.5 block text-xs" style={{ lineHeight: 1.4 }}>{r.body}</span>
                                <span className="mt-1.5 inline-block text-xs font-bold" style={{ color: '#ff7a2e' }}>{r.cta} →</span>
                              </span>
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )}
            </HeaderIconButton>
          </div>

          <div ref={accountRef} className="relative">
            <HeaderIconButton
              label="Account"
              icon={User}
              onClick={() => { setAccountOpen(o => !o); setBellOpen(false) }}
              aria-label={`Account menu for ${userProfile?.displayName || 'your account'}`}
              aria-expanded={accountOpen}
              aria-haspopup="true"
              active={accountOpen}
            >
              {accountOpen && (
                <div className="theme-card theme-border absolute right-0 top-16 z-50 min-w-[200px] rounded-2xl border py-2 shadow-xl">
                  <p className="theme-border theme-text border-b px-4 py-2 text-xs font-black">
                    {userProfile?.displayName || 'Teacher'}
                  </p>
                  {isAdmin && (
                    <Link
                      to="/admin"
                      onClick={() => setAccountOpen(false)}
                      className="theme-text hover:theme-bg-subtle flex items-center gap-2 px-4 py-2 text-sm font-bold no-underline"
                    >
                      <Icon as={Settings} size="sm" strokeWidth={2.1} /> Admin Panel
                    </Link>
                  )}
                  <Link
                    to="/profile"
                    onClick={() => setAccountOpen(false)}
                    className="theme-text hover:theme-bg-subtle flex items-center gap-2 px-4 py-2 text-sm font-bold no-underline"
                  >
                    <Icon as={User} size="sm" strokeWidth={2.1} /> My Profile
                  </Link>
                  <Link
                    to="/dashboard"
                    onClick={() => setAccountOpen(false)}
                    className="theme-text hover:theme-bg-subtle flex items-center gap-2 px-4 py-2 text-sm font-bold no-underline"
                  >
                    <Icon as={GraduationCap} size="sm" strokeWidth={2.1} /> Student View
                  </Link>
                  <Link
                    to="/settings"
                    onClick={() => setAccountOpen(false)}
                    className="theme-text hover:theme-bg-subtle flex items-center gap-2 px-4 py-2 text-sm font-bold no-underline"
                  >
                    <Icon as={Settings} size="sm" strokeWidth={2.1} /> Settings
                  </Link>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-2 rounded-none bg-transparent px-4 py-2 text-left text-sm font-bold text-red-500 shadow-none hover:bg-red-50 min-h-0"
                  >
                    <Icon as={LogOut} size="sm" strokeWidth={2.1} /> Sign Out
                  </button>
                </div>
              )}
            </HeaderIconButton>
          </div>
        </div>
      </div>
    </header>
  )
}
