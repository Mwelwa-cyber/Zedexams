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
import { Link, useNavigate } from 'react-router-dom'
import {
  AcademicCapIcon,
  BarChart3,
  Battery,
  Bell,
  BookOpen,
  Bot,
  CheckCircleIcon,
  ChevronRight,
  FireIcon,
  Gamepad2,
  GraduationCap,
  LogOut,
  PencilLine,
  Settings,
  Sparkles,
  TrophyIcon,
  User,
} from '../ui/icons'
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
import MobileBottomNav          from '../layout/MobileBottomNav'
import { useSubscription }      from '../../hooks/useSubscription'

// ── Sub-components ─────────────────────────────────────────────────────────

const NOTIFICATION_STORAGE_PREFIX = 'zedexams:notifications:seen:v1'
// Dashboard character art. Each entry ships WebP (≈90% smaller than the
// original PNG, ~5 MB → ~500 KB total) with the PNG kept as a <picture>
// fallback for legacy browsers. Intrinsic pixel dimensions are passed to
// the <img> so the browser can reserve space and avoid CLS as images load.
const DASHBOARD_CHARACTERS = {
  hero:  { png: '/images/characters/zed-zara-reading.png?v=transparent-1', webp: '/images/characters/zed-zara-reading.webp?v=1', width: 1402, height: 1122 },
  exams: { png: '/images/characters/lina-study.png?v=transparent-1',       webp: '/images/characters/lina-study.webp?v=1',       width: 1313, height: 1198 },
  games: { png: '/images/characters/max-gaming.png?v=transparent-1',       webp: '/images/characters/max-gaming.webp?v=1',       width: 1254, height: 1254 },
  zed:   { png: '/images/characters/zedbot-help.png?v=transparent-1',      webp: '/images/characters/zedbot-help.webp?v=1',      width: 1254, height: 1254 },
}

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

function DashboardCharacter({ image, alt, variant = 'card', loading = 'lazy', className = '' }) {
  const sizeClass = {
    hero: 'h-40 sm:h-52 md:h-[220px]',
    card: 'h-24 sm:h-28',
    games: 'h-24 sm:h-[118px]',
    zed: 'h-28 sm:h-32',
  }[variant] || 'h-24 sm:h-28'

  // <picture> lets modern browsers fetch the WebP (≈90% smaller) while
  // older browsers fall back to the PNG. width/height attributes give the
  // browser the aspect ratio up-front so the page doesn't jump when the
  // image finishes loading (CLS). <picture> itself is a layout-transparent
  // shell — all sizing/positioning classes stay on the <img>.
  return (
    <picture>
      <source type="image/webp" srcSet={image.webp} />
      <img
        src={image.png}
        alt={alt}
        width={image.width}
        height={image.height}
        loading={loading}
        decoding="async"
        className={`pointer-events-none select-none object-contain drop-shadow-[0_14px_18px_rgba(15,23,42,0.16)] ${sizeClass} ${className}`}
      />
    </picture>
  )
}

function DashboardActionCard({
  to,
  className,
  icon: ActionIcon,
  iconClassName,
  kicker,
  kickerClassName = '',
  title,
  titleClassName = '',
  body,
  bodyClassName = '',
  action,
  actionClassName,
  image,
  imageAlt,
  imageVariant = 'card',
}) {
  return (
    <section>
      <Link
        to={to}
        className={`group relative block min-h-[128px] overflow-hidden rounded-3xl border-2 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${className}`}
      >
        <div className="relative z-10 flex min-h-[128px] items-center gap-3 p-4 pr-28 sm:gap-4 sm:p-5 sm:pr-36">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-sm ${iconClassName}`}>
            <Icon as={ActionIcon} size="lg" strokeWidth={2.1} />
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-black uppercase tracking-widest ${kickerClassName}`}>
              {kicker}
            </p>
            <h3 className={`mt-0.5 text-base font-black leading-tight ${titleClassName}`}>
              {title}
            </h3>
            <p className={`mt-0.5 hidden text-xs font-bold sm:block ${bodyClassName}`}>
              {body}
            </p>
          </div>
          <div className={`hidden shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-black text-white shadow-sm transition-transform group-hover:translate-x-0.5 sm:flex ${actionClassName}`}>
            {action}
            <Icon as={ChevronRight} size="xs" />
          </div>
        </div>
        <DashboardCharacter
          image={image}
          alt={imageAlt}
          variant={imageVariant}
          className="absolute bottom-0 right-1 z-0 sm:right-3"
        />
      </Link>
    </section>
  )
}

function HeaderIconLink({ to, label, icon: ActionIcon }) {
  return (
    <Link to={to} className="group/tt relative flex flex-col items-center">
      <span className="theme-card theme-border theme-text-muted flex h-11 w-11 items-center justify-center rounded-2xl border shadow-elev-sm transition-all group-hover/tt:theme-accent-bg group-hover/tt:theme-accent-text">
        <Icon as={ActionIcon} size="md" strokeWidth={2.1} />
      </span>
      <span className="mt-1 text-[10px] font-black leading-none theme-text-muted">{label}</span>
    </Link>
  )
}

function HeaderIconButton({ label, icon: ActionIcon, active = false, important = false, badge, children, ...buttonProps }) {
  return (
    <div className="group/tt relative flex flex-col items-center">
      <button
        type="button"
        className={`relative flex h-11 w-11 items-center justify-center rounded-2xl border shadow-elev-sm transition-all min-h-0 ${
          active
            ? 'border-blue-200 bg-blue-50 text-blue-700'
            : important
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'theme-card theme-border theme-text-muted hover:theme-accent-bg hover:theme-accent-text'
        }`}
        {...buttonProps}
      >
        <Icon as={ActionIcon} size="md" strokeWidth={2.1} />
        {badge ? (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black leading-none text-white ring-2 ring-white"
          >
            {badge}
          </span>
        ) : null}
      </button>
      <span className="mt-1 text-[10px] font-black leading-none theme-text-muted">{label}</span>
      {children}
    </div>
  )
}

function GradeCard({ grade, meta, active, onClick }) {
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
        <Icon as={BookOpen} size="xs" strokeWidth={2.1} /> 7 subjects
      </div>

      {/* Active indicator */}
      {active && (
        <div className="absolute bottom-2 right-3 flex items-center gap-1 text-xs font-bold text-white/70">
          <Icon as={CheckCircleIcon} size="xs" strokeWidth={2.1} /> Selected
        </div>
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
          className={`flex flex-1 items-center justify-center gap-1 text-xs font-bold py-1.5 rounded-lg ${subject.tailwind.light} ${subject.tailwind.text} hover:opacity-80 transition-opacity`}
        >
          <Icon as={PencilLine} size="xs" strokeWidth={2.1} /> Quiz
        </Link>
        <Link
          to={lessonPath}
          className="flex flex-1 items-center justify-center gap-1 text-xs font-bold py-1.5 rounded-lg theme-bg-subtle theme-text-muted hover:opacity-80 transition-opacity"
        >
          <Icon as={BookOpen} size="xs" strokeWidth={2.1} /> Notes
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
        <Icon as={PencilLine} size="md" strokeWidth={2.1} />
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
      <Icon as={FireIcon} size="sm" strokeWidth={2.1} className="text-orange-600" />
      <span className="text-xs font-black text-orange-700">{streak} day streak!</span>
    </div>
  )
}

function SkeletonCard() {
  return <Skeleton height={96} width={'100%'} className="rounded-2xl" />
}

function NotificationPanel({ notifications, unreadCount, onClose }) {
  return (
    <div className="absolute right-0 top-16 z-50 w-[min(92vw,22rem)] theme-card rounded-2xl border theme-border p-3 shadow-xl animate-scale-in">
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
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl border theme-border theme-bg-subtle theme-accent-text">
            <Icon as={Sparkles} size="lg" strokeWidth={2.1} />
          </div>
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
                <div className="theme-card theme-accent-text flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border theme-border">
                  <Icon as={note.icon} size="md" strokeWidth={2.1} />
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
    document.title = currentUser ? 'Dashboard — ZedExams' : 'Dashboard Preview — ZedExams'
  }, [currentUser])

  useEffect(() => {
    if (!currentUser) {
      setRecentResults([])
      setStats({ quizzes: 0, streak: 0 })
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)

    getUserResults(currentUser.uid, 5).then(results => {
      if (cancelled) return
      setRecentResults(results)
      // Calculate streak from lastActiveDate pattern
      const streak = userProfile?.currentStreak ?? 0
      setStats({ quizzes: results.length, streak })
      setLoading(false)
    }).catch(err => {
      if (cancelled) return
      console.error('GradeHub results:', err)
      setRecentResults([])
      setStats({ quizzes: 0, streak: 0 })
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [currentUser, userProfile])

  useEffect(() => {
    setSeenNotificationIds(readSeenNotificationIds(notificationUserId))
  }, [notificationUserId])

  function handleGradeSelect(grade) {
    setSelectedGrade(prev => prev === grade ? null : grade)
  }

  const { accessBadge, isDemoOnly } = useSubscription()
  const firstName = userProfile?.displayName?.split(' ')[0] ?? 'Learner'
  const latestResult = recentResults[0] || null
  const notifications = [
    earnedBadges.length > 0
      ? {
          id: `badges:${earnedBadges.map(badge => badge.id || badge.name).join('|')}`,
          icon: TrophyIcon,
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
          icon: FireIcon,
          title: `${stats.streak}-day learning streak`,
          body: 'Keep practising daily to protect your streak and unlock more badges.',
          cta: 'Keep the streak alive →',
          to: '/quizzes',
        }
      : null,
    // Only show result-based notifications after data has fully loaded.
    // While loading=true the notification ID would be 'first-quiz'; once
    // loading=false it flips to 'latest-result:xxx'. That ID change triggers
    // the cleanup effect which wipes seenNotificationIds — so we suppress
    // the entry entirely until we have stable data.
    !loading && (latestResult
      ? {
          id: `latest-result:${latestResult.id || latestResult.quizId || latestResult.completedAt?.seconds || latestResult.completedAt || latestResult.quizTitle || 'latest'}`,
          icon: latestResult.percentage >= 70 ? CheckCircleIcon : BookOpen,
          title: latestResult.percentage >= 70 ? 'Nice work on your latest quiz' : 'Your latest result is ready',
          body: `${latestResult.quizTitle || 'Your quiz'} · ${latestResult.percentage}%`,
          cta: 'Review your results →',
          to: '/my-results',
        }
      : {
          id: 'first-quiz',
          icon: PencilLine,
          title: 'Take your first quiz',
          body: 'Your recent activity will appear here after your first attempt.',
          cta: 'Start a quiz →',
          to: '/quizzes',
        }),
    isDemoOnly
      ? {
          id: `demo-access:${accessBadge.label}`,
          icon: Sparkles,
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
    // Skip pruning while data is still loading. The notification IDs are not
    // stable yet — running the cleanup now would evict IDs from a previous
    // stable state (e.g. 'first-quiz' or a prior 'latest-result') and reset
    // the unread badge incorrectly. Wait until loading=false and the final
    // ID set is known.
    if (loading) return
    setSeenNotificationIds(previousSeenIds => {
      const nextSeenIds = previousSeenIds.filter(id => activeNotificationIds.includes(id))
      const changed = nextSeenIds.length !== previousSeenIds.length || nextSeenIds.some((id, index) => id !== previousSeenIds[index])
      if (!changed) {
        return previousSeenIds
      }
      writeSeenNotificationIds(notificationUserId, nextSeenIds)
      return nextSeenIds
    })
  }, [activeNotificationIdsKey, notificationUserId, loading])

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

          <div className="flex items-center gap-1.5 sm:gap-2">
            <HeaderIconLink to="/my-results" label="Progress" icon={BarChart3} />
            <ThemeSelector compact dashboardStyle />

            <div ref={notificationsRef} className="relative">
              <HeaderIconButton
                onClick={handleNotificationsToggle}
                aria-label={
                  unreadNotifications.length > 0
                    ? `Alerts, ${unreadNotifications.length} unread`
                    : 'Alerts'
                }
                aria-expanded={notificationsOpen}
                aria-haspopup="true"
                label="Alerts"
                icon={Bell}
                important={unreadNotifications.length > 0}
                active={notificationsOpen}
                badge={unreadNotifications.length > 0 ? (unreadNotifications.length > 9 ? '9+' : unreadNotifications.length) : null}
              >
                {notificationsOpen && (
                  <NotificationPanel
                    notifications={notifications}
                    unreadCount={unreadNotifications.length}
                    onClose={() => closeNotifications(true)}
                  />
                )}
              </HeaderIconButton>
            </div>

            <div className="relative">
              <HeaderIconButton
                onClick={() => {
                  closeNotifications(notificationsOpen)
                  setMenuOpen(o => !o)
                }}
                aria-label={`Account menu for ${userProfile?.displayName || 'your account'}`}
                aria-expanded={menuOpen}
                aria-haspopup="true"
                label="Account"
                icon={User}
                active={menuOpen}
              >
                {menuOpen && (
                  <div className="absolute right-0 top-16 z-50 min-w-[190px] animate-scale-in rounded-2xl border theme-border theme-card py-2 shadow-xl">
                    <p className="border-b theme-border px-4 py-2 text-xs font-black theme-text">{userProfile?.displayName}</p>
                    <div className="px-4 py-1.5">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-black ${
                        accessBadge.color === 'green'  ? 'bg-green-100 text-green-700' :
                        accessBadge.color === 'blue'   ? 'bg-blue-100 text-blue-700' :
                        accessBadge.color === 'yellow' ? 'bg-yellow-100 text-yellow-700' :
                        'theme-bg-subtle theme-text-muted'
                      }`}>
                        <Icon as={Sparkles} size="xs" strokeWidth={2.1} /> {accessBadge.label}
                      </span>
                    </div>
                    {isAdmin && (
                      <Link to="/admin" onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-bold theme-text hover:theme-bg-subtle">
                        <Icon as={Settings} size="sm" strokeWidth={2.1} /> Admin Panel
                      </Link>
                    )}
                    {!isAdmin && isTeacher && (
                      <Link to="/teacher" onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-bold theme-text hover:theme-bg-subtle">
                        <Icon as={GraduationCap} size="sm" strokeWidth={2.1} /> Teacher Panel
                      </Link>
                    )}
                    <Link to="/profile" onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-bold theme-text hover:theme-bg-subtle">
                      <Icon as={User} size="sm" strokeWidth={2.1} /> My Profile
                    </Link>
                    <Link to="/my-results" onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-bold theme-text hover:theme-bg-subtle">
                      <Icon as={BarChart3} size="sm" strokeWidth={2.1} /> My Results
                    </Link>
                    <Link to="/my-badges" onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-bold theme-text hover:theme-bg-subtle">
                      <Icon as={TrophyIcon} size="sm" strokeWidth={2.1} /> My Badges
                    </Link>
                    <button
                      type="button"
                      aria-label="Sign out of your account"
                      onClick={() => { setMenuOpen(false); logout().then(() => navigate('/login')) }}
                      className="flex w-full items-center gap-2 rounded-none bg-transparent px-4 py-2 text-left text-sm font-bold text-red-500 shadow-none hover:bg-red-50 min-h-0">
                      <Icon as={LogOut} size="sm" strokeWidth={2.1} /> Sign Out
                    </button>
                  </div>
                )}
              </HeaderIconButton>
            </div>
          </div>
        </div>
      </header>

      {/* ──────────── MAIN CONTENT ───────────────────────────── */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-5 pb-28 space-y-6 theme-text">

        {/* ── HERO / WELCOME BANNER ───────────────────────────── */}
        <section
          className={`relative min-h-[230px] overflow-hidden rounded-3xl ${
            dataSaver
              ? 'theme-accent-fill p-5'
              : 'theme-hero p-5 sm:p-6'
          }`}
          data-bg-gradient={!dataSaver ? 'true' : undefined}
        >
          {!dataSaver && (
            <>
              <FloatingStar style={{ top: '12%', left: '6%',  fontSize: 18, animationDelay: '0s'  }} />
              <FloatingStar style={{ top: '65%', left: '2%',  fontSize: 12, animationDelay: '1s'  }} />
              <FloatingStar style={{ top: '25%', left: '45%', fontSize: 10, animationDelay: '2s'  }} />
              <FloatingStar style={{ top: '80%', left: '52%', fontSize: 8,  animationDelay: '0.5s'}} />
            </>
          )}

          <div className="relative flex min-h-[198px] items-end">
            <div className="relative z-10 max-w-[58%] min-w-0 pb-1 sm:max-w-[56%]">
              <p className="mb-1.5 text-eyebrow text-white/75" style={{ color: 'rgba(255,255,255,0.75)' }}>
                Welcome back
              </p>
              <h1 className="text-display-xl text-white">{firstName}!</h1>
              <p className="theme-hero-muted mt-1 text-body-sm italic">Practise smart with ZedExams.</p>

              {userProfile?.grade && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-white/20 px-2.5 py-1 text-xs font-black text-white">
                  <Icon as={BookOpen} size="xs" strokeWidth={2.1} />
                  Grade {userProfile.grade}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-4">
                <div>
                  <p className="text-xl font-black leading-none text-white">{stats.quizzes}</p>
                  <p className="theme-hero-muted text-xs font-bold">Quizzes</p>
                </div>
                <div className="h-8 w-px bg-white/25" />
                <div>
                  <p className="text-xl font-black leading-none text-white">{earnedBadges.length}</p>
                  <p className="theme-hero-muted text-xs font-bold">Badges</p>
                </div>
                {stats.streak >= 2 && (
                  <>
                    <div className="h-8 w-px bg-white/25" />
                    <StreakBadge streak={stats.streak} />
                  </>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to="/quizzes"
                  className="flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-black theme-accent-text transition-colors hover:bg-white"
                >
                  <Icon as={PencilLine} size="xs" strokeWidth={2.1} />
                  Start Quiz
                </Link>
                <Link
                  to="/my-results"
                  className="flex items-center gap-1.5 rounded-full border border-white/20 bg-white/15 px-3 py-1.5 text-xs font-black text-white transition-colors hover:bg-white/25"
                >
                  <Icon as={BarChart3} size="xs" strokeWidth={2.1} />
                  My Results
                </Link>
              </div>
            </div>

            <DashboardCharacter
              image={DASHBOARD_CHARACTERS.hero}
              alt="Zed and Zara reading together"
              variant="hero"
              loading="eager"
              className="absolute bottom-0 right-0 z-0 max-w-[48%] sm:max-w-none"
            />
          </div>
        </section>

        <DashboardActionCard
          to="/exams"
          className="border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50"
          icon={TrophyIcon}
          iconClassName="bg-amber-400 text-white"
          kicker="Daily · Once per subject"
          kickerClassName="text-amber-600"
          title="Today's Exams"
          titleClassName="text-amber-900"
          body="Timed competitive exams · Live leaderboard · One attempt per subject per day"
          bodyClassName="text-amber-700"
          action="Start"
          actionClassName="bg-amber-400"
          image={DASHBOARD_CHARACTERS.exams}
          imageAlt="Lina studying"
          imageVariant="card"
        />

        <DashboardActionCard
          to="/games"
          className="border-emerald-300 bg-gradient-to-br from-emerald-50 to-teal-50"
          icon={Gamepad2}
          iconClassName="bg-emerald-500 text-white"
          kicker="CBC · Grades 1-6"
          kickerClassName="text-emerald-600"
          title="Zed Games"
          titleClassName="text-emerald-900"
          body="Maths, English, Science & Social Studies - earn badges and climb the leaderboard"
          bodyClassName="text-emerald-700"
          action="Play"
          actionClassName="bg-emerald-500"
          image={DASHBOARD_CHARACTERS.games}
          imageAlt="Max playing a learning game"
          imageVariant="games"
        />

        <DashboardActionCard
          to="/study"
          className="border-[rgba(212,175,55,0.2)] bg-[linear-gradient(135deg,#0A1128_0%,#1A2B48_60%,#132039_100%)] shadow-elev-md hover:shadow-elev-lg"
          icon={Bot}
          iconClassName="bg-white/95 text-[#D4AF37] ring-1 ring-[rgba(212,175,55,0.28)]"
          kicker="Study assistant · Beta"
          kickerClassName="text-[#D4AF37]"
          title="Ask Zed anything"
          titleClassName="text-[#F8F9FA]"
          body="CBC-aligned explanations, practice questions, and study plans tailored to your grade."
          bodyClassName="text-[#A8B6C9]"
          action="Start"
          actionClassName="border border-[rgba(212,175,55,0.28)] bg-[rgba(212,175,55,0.12)] text-[#D4AF37]"
          image={DASHBOARD_CHARACTERS.zed}
          imageAlt="ZedBot ready to help"
          imageVariant="zed"
        />

        {/* ── GRADE SELECTION ─────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-display-md theme-text flex items-center gap-2">
              <Icon as={AcademicCapIcon} size="lg" strokeWidth={2.1} /> Primary Hub
            </h2>
            {selectedGrade && (
              <button
                onClick={() => setSelectedGrade(null)}
                className="flex items-center gap-1 text-xs font-bold theme-accent-text hover:opacity-80 min-h-0 bg-transparent shadow-none px-2 py-1"
              >
                All Grades
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
                  Choose Grade 4, 5, or 6 to see your subjects and start practising.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* ── RECENT ACTIVITY ─────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-display-md theme-text flex items-center gap-2">
              <Icon as={BarChart3} size="lg" strokeWidth={2.1} /> Recent Activity
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
                <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl border theme-border theme-bg-subtle theme-accent-text">
                  <Icon as={PencilLine} size="lg" strokeWidth={2.1} />
                </div>
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
              <Icon as={TrophyIcon} size="lg" strokeWidth={2.1} /> Your Badges
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
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-green-200 bg-white text-green-700">
              <Icon as={Battery} size="lg" strokeWidth={2.1} />
            </div>
            <div>
              <p className="font-black text-green-800 text-sm">Data Saver is ON</p>
              <p className="text-green-700 text-xs mt-0.5">
                Larger motion is reduced to save mobile data. Use the control below to turn it off.
              </p>
              <div className="mt-2">
                <DataSaverToggle showLabel />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ──────────── MOBILE BOTTOM NAV ──────────────────────── */}
      <MobileBottomNav />
    </div>
  )
}
