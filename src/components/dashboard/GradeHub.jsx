/**
 * GradeHub — Zambia CBC Upper Primary Hub Dashboard
 *
 * Replaces StudentDashboard as the main learner landing page.
 * Structure:
 *   Header (logo, data-saver, user avatar)
 *   Hero   (Professor Pako + welcome + streak/stats)
 *   Grade Selection Cards (4, 5, 6)
 *   Subject Grid (expands when a grade is selected)
 *   Recent Activity
 *   Badges Strip
 *   Mobile Bottom Navigation
 */
import { useState, useEffect, useRef }  from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { Home, PencilLine, BookOpen, BarChart3, Bell, ChevronRight, Bot, Sparkles } from 'lucide-react'
import { useAuth }              from '../../contexts/AuthContext'
import { useFirestore }         from '../../hooks/useFirestore'
import { useBadges }            from '../../hooks/useBadges'
import { useDataSaver }         from '../../contexts/DataSaverContext'
import { GRADE_META, SUBJECTS } from '../../config/curriculum'
import ProfessorPako            from '../ui/ProfessorPako'
import DataSaverToggle          from '../ui/DataSaverToggle'
import BadgeCard                from '../ui/BadgeCard'
import Logo                     from '../ui/Logo'
import ThemeSelector            from '../ui/ThemeSelector'
import OnboardingOverlay        from '../ui/OnboardingOverlay'
import Icon                     from '../ui/Icon'
import Button                   from '../ui/Button'
import Skeleton                 from '../ui/Skeleton'
import { useSubscription }      from '../../hooks/useSubscription'

// ── Sub-components ─────────────────────────────────────────────────────────

const NOTIFICATION_STORAGE_PREFIX = 'zedexams:notifications:seen:v1'

function getNotificationStorageKey(userId) {
  return `${NOTIFICATION_STORAGE_PREFIX}:${userId || 'guest'}`
}

function readSeenNotificationIds(userId) {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(getNotificationStorageKey(userId))
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeSeenNotificationIds(userId, ids) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(getNotificationStorageKey(userId), JSON.stringify(ids))
  } catch {
    // Ignore storage failures so notifications still render.
  }
}

function FloatingStar({ style }) {
  return (
    <span
      className="absolute text-white/20 select-none pointer-events-none animate-float"
      style={style}
    >★</span>
  )
}

function GradeCard({ grade, meta, active, onClick, quizCount = 0 }) {
  const { dataSaver } = useDataSaver()
  return (
    <button
      onClick={onClick}
      className={`relative w-full rounded-2xl p-4 sm:p-5 text-left transition-all duration-200 min-h-0 shadow-sm hover:shadow-md active:scale-95 overflow-hidden ${
        active
          ? `${meta.tailwind.bg} text-white ring-4 ${meta.tailwind.ring} scale-105`
          : `theme-card border-2 ${meta.tailwind.border} theme-text hover:opacity-90`
      }`}
    >
      {/* Background accent blob */}
      {!dataSaver && active && (
        <div className="absolute top-0 right-0 w-20 h-20 rounded-full opacity-20 bg-white -translate-y-6 translate-x-6" />
      )}

      {/* Grade number */}
      <div className={`text-3xl sm:text-4xl font-black mb-1 ${active ? 'text-white' : meta.tailwind.text}`}>
        {grade}
      </div>
      <div className={`text-xs font-black uppercase tracking-wide mb-0.5 ${active ? 'text-white/80' : 'theme-text-muted'}`}>
        Grade
      </div>
      <div className={`text-xs font-bold leading-snug ${active ? 'text-white/90' : 'theme-text-muted'}`}>
        {meta.tagline}
      </div>

      {/* Subject count pill */}
      <div className={`mt-3 inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${
        active ? 'bg-white/20 text-white' : `${meta.tailwind.light} ${meta.tailwind.text}`
      }`}>
        📚 7 subjects
      </div>

      {/* Active indicator */}
      {active && (
        <div className="absolute bottom-2 right-3 text-white/60 text-xs font-bold">Selected ✓</div>
      )}
    </button>
  )
}

function SubjectCard({ subject, grade }) {
  const quizPath    = `/quizzes?grade=${grade}&subject=${subject.id}`
  const lessonPath  = `/lessons?grade=${grade}&subject=${subject.id}`

  return (
    <div className={`theme-card rounded-2xl border-2 ${subject.tailwind.border} p-4 hover:shadow-sm transition-all`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 ${subject.tailwind.light} rounded-xl flex items-center justify-center text-xl flex-shrink-0`}>
          {subject.icon}
        </div>
        <div className="min-w-0">
          <p className="font-black theme-text text-sm leading-tight truncate">{subject.label}</p>
          <p className={`text-xs font-bold ${subject.tailwind.text} mt-0.5`}>Grade {grade}</p>
        </div>
      </div>

      {/* Quick action buttons */}
      <div className="flex gap-1.5">
        <Link
          to={quizPath}
          className={`flex-1 text-center text-xs font-bold py-1.5 rounded-lg ${subject.tailwind.light} ${subject.tailwind.text} hover:opacity-80 transition-opacity`}
        >
          ✏️ Quiz
        </Link>
        <Link
          to={lessonPath}
          className="flex-1 text-center text-xs font-bold py-1.5 rounded-lg theme-bg-subtle theme-text-muted hover:opacity-80 transition-opacity"
        >
          📖 Notes
        </Link>
      </div>
    </div>
  )
}

function RecentResultRow({ result }) {
  const pctColor = p => p >= 70 ? 'text-green-600' : p >= 50 ? 'text-yellow-600' : 'text-red-500'
  function fmt(ts) {
    if (!ts) return ''
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    const now = new Date()
    const days = Math.floor((now - d) / 86400000)
    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  }
  return (
    <div className="flex items-center gap-3 py-3 border-b theme-border last:border-0">
      <div className="w-10 h-10 theme-accent-bg rounded-xl flex items-center justify-center text-lg flex-shrink-0">
        📝
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold theme-text text-sm truncate">{result.quizTitle || 'Quiz'}</p>
        <p className="theme-text-muted text-xs">{result.subject} · Grade {result.grade} · {fmt(result.completedAt)}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`font-black text-lg ${pctColor(result.percentage)}`}>{result.percentage}%</p>
        <p className="theme-text-muted text-xs">{result.score}/{result.totalMarks}</p>
      </div>
    </div>
  )
}

function StreakBadge({ streak }) {
  if (!streak || streak < 2) return null
  return (
    <div className="flex items-center gap-1 bg-orange-50 border border-orange-200 rounded-full px-2.5 py-1">
      <span className="text-sm">🔥</span>
      <span className="text-xs font-black text-orange-700">{streak} day streak!</span>
    </div>
  )
}

function MobileNav() {
  const items = [
    { to: '/dashboard', icon: Home,       label: 'Home',    end: true },
    { to: '/quizzes',   icon: PencilLine, label: 'Quizzes', end: false },
    { to: '/lessons',   icon: BookOpen,   label: 'Lessons', end: false },
    { to: '/my-results',icon: BarChart3,  label: 'Results', end: false },
    { to: '/study',     icon: Bot,        label: 'Zed',     end: false },
  ]
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 theme-card border-t theme-border shadow-elev-lg safe-area-bottom">
      <div className="flex">
        {items.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-all duration-base ease-out ${
                isActive ? 'theme-accent-text' : 'theme-text-muted hover:theme-accent-text'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`inline-flex items-center justify-center leading-none transition-transform duration-base ease-spring ${isActive ? 'scale-110' : ''}`}>
                  <Icon as={item.icon} size="md" strokeWidth={isActive ? 2.5 : 2.25} />
                </span>
                <span className={`text-xs font-bold ${isActive ? 'font-black' : ''}`}>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

function SkeletonCard() {
  return <Skeleton height={96} width={'100%'} className="rounded-2xl" />
}

function NotificationPanel({ notifications, unreadCount, onClose }) {
  return (
    <div className="absolute right-0 top-11 z-50 w-[min(92vw,22rem)] theme-card rounded-2xl border theme-border p-3 shadow-xl animate-scale-in">
      <div className="flex items-center justify-between gap-3 border-b theme-border px-1 pb-2">
        <div>
          <p className="theme-text text-sm font-black">Notifications</p>
          <p className="theme-text-muted text-xs font-bold">
            {notifications.length === 0
              ? 'You are all caught up'
              : unreadCount > 0
                ? `${unreadCount} new update${unreadCount === 1 ? '' : 's'}`
                : 'You are all caught up'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="theme-text-muted min-h-0 bg-transparent px-2 py-1 text-xs font-black shadow-none hover:theme-text"
        >
          Close
        </button>
      </div>

      {notifications.length === 0 ? (
        <div className="px-1 py-6 text-center">
          <p className="text-2xl">🎉</p>
          <p className="theme-text mt-2 text-sm font-black">No new notifications</p>
          <p className="theme-text-muted mt-1 text-xs">Keep learning and your next update will appear here.</p>
        </div>
      ) : (
        <div className="max-h-80 space-y-2 overflow-y-auto pt-3">
          {notifications.map(note => (
            <Link
              key={note.id}
              to={note.to}
              onClick={onClose}
              className="theme-bg-subtle block rounded-2xl border theme-border px-3 py-3 transition-colors hover:theme-card-hover"
            >
              <div className="flex items-start gap-3">
                <div className="theme-card flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border theme-border text-lg">
                  {note.icon}
                </div>
                <div className="min-w-0">
                  <p className="theme-text text-sm font-black leading-snug">{note.title}</p>
                  <p className="theme-text-muted mt-1 text-xs font-bold leading-relaxed">{note.body}</p>
                  <p className="theme-accent-text mt-1 text-xs font-black">{note.cta}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function GradeHub() {
  const { currentUser, userProfile, logout, isAdmin, isTeacher } = useAuth()
  const { getUserResults }                   = useFirestore()
  const { earned: earnedBadges, loading: badgesLoading } = useBadges(currentUser?.uid)
  const { dataSaver }                        = useDataSaver()
  const navigate                             = useNavigate()

  // Grade selection (null = show all 3 cards; 4|5|6 = show subject grid)
  const defaultGrade = userProfile?.grade ? parseInt(userProfile.grade, 10) : null
  const validGrade   = [4, 5, 6].includes(defaultGrade) ? defaultGrade : null
  const [selectedGrade, setSelectedGrade] = useState(validGrade)

  const [recentResults, setRecentResults] = useState([])
  const [stats, setStats]                 = useState({ quizzes: 0, streak: 0 })
  const [loading, setLoading]             = useState(true)
  const [menuOpen, setMenuOpen]           = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [seenNotificationIds, setSeenNotificationIds] = useState([])
  const notificationsRef = useRef(null)
  const notificationUserId = currentUser?.uid || userProfile?.id || 'guest'

  useEffect(() => {
    if (!currentUser) return
    getUserResults(currentUser.uid, 5).then(results => {
      setRecentResults(results)
      // Calculate streak from lastActiveDate pattern
      const streak = userProfile?.currentStreak ?? 0
      setStats({ quizzes: results.length, streak })
      setLoading(false)
    })
  }, [currentUser, userProfile])

  useEffect(() => {
    setSeenNotificationIds(readSeenNotificationIds(notificationUserId))
  }, [notificationUserId])

  function handleGradeSelect(grade) {
    setSelectedGrade(prev => prev === grade ? null : grade)
  }

  const { accessBadge, isDemoOnly } = useSubscription()
  const firstName = userProfile?.displayName?.split(' ')[0] ?? 'Learner'
  const pakoMood  = stats.streak >= 3 ? 'excited' : stats.quizzes > 0 ? 'happy' : 'normal'
  const latestResult = recentResults[0] || null
  const notifications = [
    earnedBadges.length > 0
      ? {
          id: `badges:${earnedBadges.map(badge => badge.id || badge.name).join('|')}`,
          icon: '🏆',
          title: `You have earned ${earnedBadges.length} badge${earnedBadges.length === 1 ? '' : 's'}`,
          body: earnedBadges.length === 1
            ? `${earnedBadges[0].name} is waiting in your badge shelf.`
            : 'Open your badge shelf to see the latest achievements you have unlocked.',
          cta: 'View badges →',
          to: '/my-badges',
        }
      : null,
    stats.streak >= 2
      ? {
          id: `streak:${stats.streak}`,
          icon: '🔥',
          title: `${stats.streak}-day learning streak`,
          body: 'Keep practising daily to protect your streak and unlock more badges.',
          cta: 'Keep the streak alive →',
          to: '/quizzes',
        }
      : null,
    latestResult
      ? {
          id: `latest-result:${latestResult.id || latestResult.quizId || latestResult.completedAt?.seconds || latestResult.completedAt || latestResult.quizTitle || 'latest'}`,
          icon: latestResult.percentage >= 70 ? '✅' : '📘',
          title: latestResult.percentage >= 70 ? 'Nice work on your latest quiz' : 'Your latest result is ready',
          body: `${latestResult.quizTitle || 'Your quiz'} · ${latestResult.percentage}%`,
          cta: 'Review your results →',
          to: '/my-results',
        }
      : {
          id: 'first-quiz',
          icon: '✏️',
          title: 'Take your first quiz',
          body: 'Your recent activity will appear here after your first attempt.',
          cta: 'Start a quiz →',
          to: '/quizzes',
        },
    isDemoOnly
      ? {
          id: `demo-access:${accessBadge.label}`,
          icon: accessBadge.icon,
          title: 'Demo access is active',
          body: 'You can keep practising free content, and premium content unlocks when your access level changes.',
          cta: 'See your account →',
          to: '/profile',
        }
      : null,
  ].filter(Boolean)
  const activeNotificationIds = notifications.map(note => note.id)
  const activeNotificationIdsKey = activeNotificationIds.join('||')
  const unreadNotifications = notifications.filter(note => !seenNotificationIds.includes(note.id))

  useEffect(() => {
    setSeenNotificationIds(previousSeenIds => {
      const nextSeenIds = previousSeenIds.filter(id => activeNotificationIds.includes(id))
      const changed = nextSeenIds.length !== previousSeenIds.length || nextSeenIds.some((id, index) => id !== previousSeenIds[index])
      if (!changed) {
        return previousSeenIds
      }
      writeSeenNotificationIds(notificationUserId, nextSeenIds)
      return nextSeenIds
    })
  }, [activeNotificationIdsKey, notificationUserId])

  function markNotificationsSeen(ids) {
    if (!ids.length) return

    setSeenNotificationIds(previousSeenIds => {
      const unseenIds = ids.filter(id => !previousSeenIds.includes(id))
      if (!unseenIds.length) {
        return previousSeenIds
      }
      const nextSeenIds = [...previousSeenIds, ...unseenIds]
      writeSeenNotificationIds(notificationUserId, nextSeenIds)
      return nextSeenIds
    })
  }

  function closeNotifications(markSeen = false) {
    if (markSeen) {
      markNotificationsSeen(activeNotificationIds)
    }
    setNotificationsOpen(false)
  }

  function handleNotificationsToggle() {
    setMenuOpen(false)
    if (notificationsOpen) {
      closeNotifications(true)
      return
    }
    setNotificationsOpen(true)
  }

  useEffect(() => {
    function handlePointerDown(event) {
      if (!notificationsRef.current?.contains(event.target)) {
        closeNotifications(true)
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        closeNotifications(true)
      }
    }

    if (!notificationsOpen) return undefined
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [notificationsOpen, activeNotificationIdsKey])

  return (
    <div className="min-h-screen theme-bg flex flex-col">
      <OnboardingOverlay />
      {/* ──────────── HEADER ─────────────────────────────────── */}
      <header className="sticky top-0 z-30 theme-card border-b theme-border shadow-sm">
        <div className="max-w-4xl mx-auto px-4 h-20 flex items-center justify-between gap-3">
          <Logo variant="full" size="sm" />

          <div className="flex items-center gap-2">
            <DataSaverToggle />
            <ThemeSelector compact quizStyle />

            <div ref={notificationsRef} className="relative">
              <button
                type="button"
                onClick={handleNotificationsToggle}
                aria-label="View notifications"
                aria-expanded={notificationsOpen}
                className="relative flex h-9 w-9 items-center justify-center rounded-lg theme-text-muted hover:theme-bg-subtle hover:theme-text min-h-0 bg-transparent shadow-none"
              >
                🔔
                {unreadNotifications.length > 0 && (
                  <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black leading-none text-white">
                    {unreadNotifications.length > 9 ? '9+' : unreadNotifications.length}
                  </span>
                )}
              </button>
              {notificationsOpen && (
                <NotificationPanel
                  notifications={notifications}
                  unreadCount={unreadNotifications.length}
                  onClose={() => closeNotifications(true)}
                />
              )}
            </div>

            {/* User avatar */}
            <div className="relative">
              <button
                onClick={() => {
                  closeNotifications(notificationsOpen)
                  setMenuOpen(o => !o)
                }}
                className="w-8 h-8 theme-accent-fill theme-on-accent rounded-full flex items-center justify-center font-black text-sm min-h-0 shadow-none hover:opacity-90"
              >
                {(userProfile?.displayName?.[0] ?? '?').toUpperCase()}
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-10 theme-card rounded-2xl shadow-xl border theme-border py-2 min-w-[180px] z-50 animate-scale-in">
                  <p className="px-4 py-2 text-xs font-black theme-text border-b theme-border">{userProfile?.displayName}</p>
                  {/* Access badge in menu */}
                  <div className="px-4 py-1.5">
                    <span className={`text-xs font-black px-2 py-0.5 rounded-full ${
                      accessBadge.color === 'green'  ? 'bg-green-100 text-green-700' :
                      accessBadge.color === 'blue'   ? 'bg-blue-100 text-blue-700' :
                      accessBadge.color === 'yellow' ? 'bg-yellow-100 text-yellow-700' :
                      'theme-bg-subtle theme-text-muted'
                    }`}>
                      {accessBadge.icon} {accessBadge.label}
                    </span>
                  </div>
                  {isAdmin && (
                    <Link to="/admin" onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2 text-sm theme-text hover:theme-bg-subtle font-bold">⚙️ Admin Panel</Link>
                  )}
                  {!isAdmin && isTeacher && (
                    <Link to="/teacher" onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2 text-sm theme-text hover:theme-bg-subtle font-bold">🎓 Teacher Panel</Link>
                  )}
                  <Link to="/profile" onClick={() => setMenuOpen(false)}
                    className="block px-4 py-2 text-sm theme-text hover:theme-bg-subtle font-bold">👤 My Profile</Link>
                  <Link to="/my-results" onClick={() => setMenuOpen(false)}
                    className="block px-4 py-2 text-sm theme-text hover:theme-bg-subtle font-bold">📊 My Results</Link>
                  <Link to="/my-badges" onClick={() => setMenuOpen(false)}
                    className="block px-4 py-2 text-sm theme-text hover:theme-bg-subtle font-bold">🏆 My Badges</Link>
                  <button
                    onClick={() => { setMenuOpen(false); logout().then(() => navigate('/login')) }}
                    className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 font-bold min-h-0 bg-transparent shadow-none rounded-none">
                    🚪 Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ──────────── MAIN CONTENT ───────────────────────────── */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-5 pb-28 space-y-6 theme-text">

        {/* ── HERO / WELCOME BANNER ───────────────────────────── */}
        <section
          className={`relative overflow-hidden rounded-3xl ${
            dataSaver
              ? 'theme-accent-fill p-5'
              : 'theme-hero p-5 sm:p-6'
          }`}
          data-bg-gradient={!dataSaver ? 'true' : undefined}
        >
          {/* Floating star decorations */}
          {!dataSaver && (
            <>
              <FloatingStar style={{ top: '12%', left: '6%',  fontSize: 18, animationDelay: '0s'  }} />
              <FloatingStar style={{ top: '65%', left: '2%',  fontSize: 12, animationDelay: '1s'  }} />
              <FloatingStar style={{ top: '25%', left: '45%', fontSize: 10, animationDelay: '2s'  }} />
              <FloatingStar style={{ top: '80%', left: '52%', fontSize: 8,  animationDelay: '0.5s'}} />
            </>
          )}

          <div className="relative flex items-end justify-between gap-4">
            {/* Text content */}
            <div className="flex-1 min-w-0">
              <p className="text-eyebrow text-white/75 mb-1.5" style={{ color: 'rgba(255,255,255,0.75)' }}>
                Welcome back <span aria-hidden="true">👋</span>
              </p>
              <h1 className="text-display-xl text-white">{firstName}!</h1>
              <p className="theme-hero-muted text-body-sm mt-1 italic">"Practise smart." — Prof. Pako 🦉</p>

              {/* Stats row */}
              <div className="flex items-center gap-4 mt-4 flex-wrap">
                <div>
                  <p className="text-white font-black text-xl leading-none">{stats.quizzes}</p>
                  <p className="theme-hero-muted text-xs font-bold">Quizzes</p>
                </div>
                <div className="w-px h-8 bg-white/25" />
                <div>
                  <p className="text-white font-black text-xl leading-none">{earnedBadges.length}</p>
                  <p className="theme-hero-muted text-xs font-bold">Badges</p>
                </div>
                {stats.streak >= 2 && (
                  <>
                    <div className="w-px h-8 bg-white/25" />
                    <StreakBadge streak={stats.streak} />
                  </>
                )}
              </div>

              {/* Quick links */}
              <div className="flex gap-2 mt-4 flex-wrap">
                <Link
                  to="/quizzes"
                  className="text-xs font-black bg-white/95 theme-accent-text px-3 py-1.5 rounded-full hover:bg-white transition-colors"
                >
                  ✏️ Start Quiz
                </Link>
                <Link
                  to="/my-results"
                  className="text-xs font-black bg-white/15 text-white px-3 py-1.5 rounded-full hover:bg-white/25 transition-colors border border-white/20"
                >
                  📊 My Results
                </Link>
              </div>
            </div>

            {/* Professor Pako mascot */}
            {!dataSaver && (
              <div className="flex-shrink-0 -mb-5 hidden sm:block">
                <ProfessorPako size={120} mood={pakoMood} animate />
              </div>
            )}
          </div>
        </section>

        {/* ── DAILY EXAMS CARD ────────────────────────────────── */}
        <section>
          <Link
            to="/exams"
            className="group relative block overflow-hidden rounded-3xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex items-center gap-4 p-4 sm:p-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-400 text-2xl shadow-sm">
                🏆
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black uppercase tracking-widest text-amber-600">
                  Daily · Once per subject
                </p>
                <h3 className="mt-0.5 text-base font-black text-amber-900 leading-tight">
                  Today's Exams
                </h3>
                <p className="mt-0.5 text-xs font-bold text-amber-700 hidden sm:block">
                  Timed competitive exams · Live leaderboard · One attempt per subject per day
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-full bg-amber-400 px-3 py-1.5 text-xs font-black text-white shadow-sm shrink-0 transition-transform group-hover:translate-x-0.5">
                Start →
              </div>
            </div>
          </Link>
        </section>

        {/* ── ASK ZED CARD ────────────────────────────────────── */}
        <section>
          <Link
            to="/study"
            className="group relative block overflow-hidden rounded-3xl border border-[rgba(212,175,55,0.2)] shadow-elev-md transition-all duration-base ease-out hover:-translate-y-0.5 hover:shadow-elev-lg"
            style={{ background: 'linear-gradient(135deg, #0A1128 0%, #1A2B48 60%, #132039 100%)' }}
          >
            {/* Decorative gold glow */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full opacity-30 transition-opacity group-hover:opacity-50"
              style={{ background: 'radial-gradient(circle, #D4AF37 0%, transparent 70%)' }}
            />
            <div className="relative flex items-center gap-4 p-4 sm:p-5">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl overflow-hidden p-1.5 shadow-elev-inner-hl transition-transform duration-base ease-spring group-hover:scale-105"
                style={{
                  background: 'rgba(255,255,255,0.96)',
                  boxShadow: '0 0 18px rgba(212, 175, 55, 0.4)',
                }}
              >
                <img
                  src="/zedexams-logo.png?v=4"
                  alt=""
                  aria-hidden="true"
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className="text-eyebrow"
                  style={{ color: '#D4AF37' }}
                >
                  Study assistant · Beta
                </p>
                <h3
                  className="text-display-md mt-0.5"
                  style={{ color: '#F8F9FA', fontSize: 17 }}
                >
                  Ask Zed anything
                </h3>
                <p
                  className="text-body-sm mt-1 hidden sm:block"
                  style={{ color: '#94A3B8' }}
                >
                  CBC-aligned explanations, practice questions, and study plans — tailored to your grade.
                </p>
              </div>
              <div
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 shrink-0 transition-transform duration-fast ease-out group-hover:translate-x-0.5"
                style={{
                  background: 'rgba(212,175,55,0.12)',
                  border: '1px solid rgba(212,175,55,0.28)',
                  color: '#D4AF37',
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                <Icon as={Sparkles} size="xs" />
                <span className="hidden sm:inline">Start</span>
                <Icon as={ChevronRight} size="xs" />
              </div>
            </div>
          </Link>
        </section>

        {/* ── GRADE SELECTION ─────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-display-md theme-text flex items-center gap-2">
              <span aria-hidden="true">🎓</span> Primary Hub
            </h2>
            {selectedGrade && (
              <button
                onClick={() => setSelectedGrade(null)}
                className="text-xs font-bold theme-accent-text hover:opacity-80 min-h-0 bg-transparent shadow-none px-2 py-1"
              >
                ← All Grades
              </button>
            )}
          </div>

          {/* Grade cards */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[4, 5, 6].map(g => (
              <GradeCard
                key={g}
                grade={g}
                meta={GRADE_META[g]}
                active={selectedGrade === g}
                onClick={() => handleGradeSelect(g)}
              />
            ))}
          </div>

          {/* Subject grid — shown when a grade is selected */}
          {selectedGrade && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-6 h-6 ${GRADE_META[selectedGrade].tailwind.bg} rounded-lg flex items-center justify-center text-white text-xs font-black`}>
                  {selectedGrade}
                </div>
                <h3 className="font-black theme-text text-sm">
                  Grade {selectedGrade} — Choose a Learning Area
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SUBJECTS.map(subject => (
                  <SubjectCard key={subject.id} subject={subject} grade={selectedGrade} />
                ))}
              </div>
            </div>
          )}

          {/* Prompt when no grade selected */}
          {!selectedGrade && (
            <div className="theme-card rounded-2xl border theme-border p-4 flex items-center gap-3">
              {!dataSaver && <ProfessorPako size={48} mood="tip" animate={false} />}
              <div>
                <p className="font-black theme-text text-sm">Select your grade above</p>
                <p className="theme-text-muted text-xs mt-0.5">
                  Choose Grade 4, 5, 6, or 7 to see your subjects and start practising.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* ── RECENT ACTIVITY ─────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-display-md theme-text flex items-center gap-2">
              <span aria-hidden="true">📊</span> Recent Activity
            </h2>
            <Link to="/my-results" className="text-xs font-bold theme-accent-text hover:underline">
              View all →
            </Link>
          </div>

          <div className="theme-card rounded-2xl border theme-border px-4">
            {loading ? (
              <div className="py-4 space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex gap-3 items-center">
                    <Skeleton shape="circle" size={40} />
                    <div className="flex-1 space-y-2">
                      <Skeleton height={12} width="66%" />
                      <Skeleton height={10} width="33%" />
                    </div>
                    <Skeleton height={28} width={48} />
                  </div>
                ))}
              </div>
            ) : recentResults.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-3xl mb-2" aria-hidden="true">📭</p>
                <p className="text-display-md theme-text">No quizzes yet!</p>
                <p className="theme-text-muted text-body-sm mt-1">Take your first quiz to see results here.</p>
                <div className="mt-4 inline-flex">
                  <Button
                    as={Link}
                    to="/quizzes"
                    variant="primary"
                    size="md"
                    trailingIcon={<Icon as={ChevronRight} size="sm" />}
                  >
                    Start a Quiz
                  </Button>
                </div>
              </div>
            ) : (
              recentResults.map(r => <RecentResultRow key={r.id} result={r} />)
            )}
          </div>
        </section>

        {/* ── BADGES ──────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-display-md theme-text flex items-center gap-2">
              <span aria-hidden="true">🏆</span> Your Badges
            </h2>
            <Link to="/my-badges" className="text-xs font-bold theme-accent-text hover:underline">
              View all →
            </Link>
          </div>

          {badgesLoading ? (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : earnedBadges.length === 0 ? (
            <div className="theme-card rounded-2xl border theme-border p-5 flex items-center gap-3">
              {!dataSaver && <ProfessorPako size={52} mood="normal" animate={false} />}
              <div>
                <p className="font-black theme-text text-sm">No badges yet — go earn one!</p>
                <p className="theme-text-muted text-xs mt-0.5">
                  Complete quizzes to unlock competency badges. Your first badge is just one quiz away!
                </p>
              </div>
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
              {earnedBadges.slice(0, 8).map(badge => (
                <BadgeCard
                  key={badge.id}
                  badge={badge}
                  earned
                  earnedAt={badge.earnedAt}
                  compact
                />
              ))}
              {earnedBadges.length > 8 && (
                <Link
                  to="/my-badges"
                  className="flex-shrink-0 flex flex-col items-center justify-center gap-1 px-4 rounded-2xl theme-bg-subtle border theme-border theme-text-muted hover:theme-card-hover transition-colors min-w-[64px]"
                >
                  <span className="text-xl">+{earnedBadges.length - 8}</span>
                  <span className="text-xs font-bold">More</span>
                </Link>
              )}
            </div>
          )}
        </section>

        {/* ── DATA SAVER INFO BANNER (only shown when on) ─────── */}
        {dataSaver && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex items-center gap-3">
            <span className="text-2xl">🔋</span>
            <div>
              <p className="font-black text-green-800 text-sm">Data Saver is ON</p>
              <p className="text-green-700 text-xs mt-0.5">
                Images and animations are hidden to save your mobile data. Tap the 🔋 in the header to turn off.
              </p>
            </div>
          </div>
        )}
      </main>

      {/* ──────────── MOBILE BOTTOM NAV ──────────────────────── */}
      <MobileNav />
    </div>
  )
}
