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
  CheckCircleIcon,
  ChevronRight,
  FileText,
  FireIcon,
  Gamepad2,
  GraduationCap,
  Lock,
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
import { GRADE_META, SUBJECTS, getTopics } from '../../config/curriculum'
import ProfessorPako            from '../ui/ProfessorPako'
import DataSaverToggle          from '../ui/DataSaverToggle'
import BadgeCard                from '../ui/BadgeCard'
import Logo                     from '../ui/Logo'
import OnboardingOverlay        from '../ui/OnboardingOverlay'
import Icon                     from '../ui/Icon'
import Button                   from '../ui/Button'
import Skeleton                 from '../ui/Skeleton'
import ThemeSelector            from '../ui/ThemeSelector'
import MobileBottomNav          from '../layout/MobileBottomNav'
import { useSubscription }      from '../../hooks/useSubscription'
import GameStickerStyles        from '../games/GameStickerStyles'
import { getTodaysExam, checkDailyLock } from '../../utils/examService'

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
}

// Subject palette tuned for the light surfaces shown in the product
// screenshot: subtle tinted backgrounds + bold subject-coloured text +
// matching practise CTA. Midnight pulls in a darker remap below via
// the body.theme-midnight selector.
const SUBJECT_TONES = {
  mathematics: {
    text: 'text-blue-700',
    tile: 'bg-blue-50 text-blue-700 ring-1 ring-blue-100',
    action: 'bg-blue-50 text-blue-700 ring-1 ring-blue-100 hover:bg-blue-100',
  },
  english: {
    text: 'text-green-700',
    tile: 'bg-green-50 text-green-700 ring-1 ring-green-100',
    action: 'bg-green-50 text-green-700 ring-1 ring-green-100 hover:bg-green-100',
  },
  science: {
    text: 'text-purple-700',
    tile: 'bg-purple-50 text-purple-700 ring-1 ring-purple-100',
    action: 'bg-purple-50 text-purple-700 ring-1 ring-purple-100 hover:bg-purple-100',
  },
  'social-studies': {
    text: 'text-orange-700',
    tile: 'bg-orange-50 text-orange-700 ring-1 ring-orange-100',
    action: 'bg-orange-50 text-orange-700 ring-1 ring-orange-100 hover:bg-orange-100',
  },
  technology: {
    text: 'text-slate-700',
    tile: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200',
    action: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200',
  },
  'home-economics': {
    text: 'text-pink-700',
    tile: 'bg-pink-50 text-pink-700 ring-1 ring-pink-100',
    action: 'bg-pink-50 text-pink-700 ring-1 ring-pink-100 hover:bg-pink-100',
  },
  'expressive-arts': {
    text: 'text-amber-700',
    tile: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100',
    action: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100 hover:bg-amber-100',
  },
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
  // Some callers omit the character image (text-only cards). Render nothing
  // rather than crashing on `image.webp` / `image.png`.
  if (!image) return null

  const sizeClass = {
    hero: 'h-40 sm:h-52 md:h-[220px]',
    card: 'h-24 sm:h-28',
    games: 'h-24 sm:h-[118px]',
  }[variant] || 'h-24 sm:h-28'

  // <picture> lets modern browsers fetch the WebP (≈90% smaller) while
  // older browsers fall back to the PNG. width/height attributes give the
  // browser the aspect ratio up-front so the page doesn't jump when the
  // image finishes loading (CLS). <picture> itself is a layout-transparent
  // shell — all sizing/positioning classes stay on the <img>.
  //
  // `w-auto` is load-bearing: the HTML `width` attribute doubles as a CSS
  // presentational hint (`width: 1402px` for the hero, etc.) which without
  // an explicit CSS width rule would blow out the absolute-positioned
  // layout and shift/clip the art. `w-auto` forces the rendered width to
  // come from the CSS height × aspect-ratio instead.
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
        className={`pointer-events-none select-none object-contain drop-shadow-[0_14px_18px_rgba(15,23,42,0.16)] w-auto ${sizeClass} ${className}`}
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
        className={`zx-card group relative block min-h-[128px] overflow-hidden rounded-3xl border-2 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${className}`}
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
      <span className="zx-card theme-card theme-border learner-chrome-icon flex h-11 w-11 items-center justify-center rounded-2xl border shadow-elev-sm transition-all group-hover/tt:theme-accent-bg group-hover/tt:theme-accent-text">
        <Icon as={ActionIcon} size="md" strokeWidth={2.1} />
      </span>
      <span className="learner-chrome-label mt-1 text-[10px] font-black leading-none">{label}</span>
    </Link>
  )
}

function HeaderIconButton({ label, icon: ActionIcon, active = false, important = false, badge, children, ...buttonProps }) {
  return (
    <div className="group/tt relative flex flex-col items-center">
      <button
        type="button"
        className={`zx-card relative flex h-11 w-11 items-center justify-center rounded-2xl border shadow-elev-sm transition-all min-h-0 ${
          active
            ? 'border-blue-200 bg-blue-50 text-blue-700'
            : important
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'theme-card theme-border learner-chrome-icon hover:theme-accent-bg hover:theme-accent-text'
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
      <span className="learner-chrome-label mt-1 text-[10px] font-black leading-none">{label}</span>
      {children}
    </div>
  )
}

// Rich subject card used inside the grade-personalised hub. Matches the
// product mockup: large coloured icon tile, name + percentage chip, a
// "X topics · Y quizzes" stats line, and a coloured progress bar fed by
// per-subject performance. Topic count is free (in-memory curriculum);
// quiz count is optional — passes through `quizCount` when known.
function SubjectCardRich({ subject, grade, perf, quizCount, dimmed = false, locked = false, ctaHref, ctaLabel = 'Practise' }) {
  const topicCount = getTopics(subject.id, grade).length
  const tone = SUBJECT_TONES[subject.id] || SUBJECT_TONES.mathematics
  const score = typeof perf === 'number' ? perf : 0
  const quizPath = ctaHref || `/quizzes?grade=${grade}&subject=${subject.id}`

  return (
    <div className={`zx-card theme-card rounded-2xl p-4 transition-all hover:shadow-md ${dimmed ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-12 h-12 ${tone.tile} rounded-2xl flex items-center justify-center text-2xl flex-shrink-0`}>
          {subject.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="font-black theme-text text-sm leading-tight truncate">{subject.shortLabel || subject.label}</p>
            <span className={`text-xs font-black px-2 py-0.5 rounded-full ${tone.tile}`}>{score}%</span>
          </div>
          <p className="theme-text-muted text-[11px] font-bold mt-0.5">
            {topicCount} Topic{topicCount === 1 ? '' : 's'}
            {typeof quizCount === 'number' ? ` · ${quizCount} Quiz${quizCount === 1 ? '' : 'zes'}` : ''}
          </p>
        </div>
      </div>

      <div className="theme-bg-subtle h-2 rounded-full overflow-hidden mb-3">
        <div
          className={`h-2 rounded-full ${subject.tailwind.bg} transition-[width] duration-500`}
          style={{ width: `${Math.min(Math.max(score, 0), 100)}%` }}
        />
      </div>

      <Link
        to={locked ? '#' : quizPath}
        onClick={locked ? (e) => e.preventDefault() : undefined}
        className={`flex items-center justify-center gap-1 text-xs font-black py-2 rounded-lg transition-opacity ${locked ? 'theme-bg-subtle theme-text-muted cursor-not-allowed' : tone.action}`}
      >
        {locked ? (
          <>
            <Icon as={Lock} size="xs" strokeWidth={2.4} /> Locked
          </>
        ) : (
          <>
            <Icon as={PencilLine} size="xs" strokeWidth={2.1} /> {ctaLabel}
            <Icon as={ChevronRight} size="xs" strokeWidth={2.4} />
          </>
        )}
      </Link>
    </div>
  )
}

// Tab nav matching the screenshot: filled accent pill on the active tab,
// flat muted text on the others. Whole row sits inside a soft track so
// it reads as a segmented control. `accentClass` is unused for now — the
// active pill picks up the user's chosen theme via theme-accent-bg /
// theme-accent-text — but kept in the signature for future grade-tinted
// tabs.
function TabButton({ active, onClick, icon, label, subtitle, accentClass: _accentClass, locked = false, disabled = false }) {
  const tabSurface = active
    ? 'theme-accent-fill theme-on-accent shadow-sm'
    : disabled
      ? 'bg-transparent theme-text-muted'
      : 'bg-transparent theme-text-muted hover:theme-text hover:theme-bg-subtle'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-0 flex-1 flex flex-col items-center justify-center gap-0.5 px-3 py-2 rounded-full transition-colors ${tabSurface} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-black">
        {locked ? <Icon as={Lock} size="xs" strokeWidth={2.4} /> : <Icon as={icon} size="xs" strokeWidth={2.4} />}
        {label}
      </span>
      {subtitle && (
        <span className={`text-[10px] font-bold leading-tight truncate max-w-full ${active ? 'opacity-80' : ''}`}>
          {subtitle}
        </span>
      )}
    </button>
  )
}

function RecentResultRow({ result }) {
  const pctColor = p => p >= 70 ? 'text-green-600' : p >= 50 ? 'text-amber-600' : 'text-red-500'
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

function StreakBadge({ streak, tone = 'page' }) {
  if (!streak || streak < 2) return null
  // The hero is always a dark gradient, so the badge keeps the
  // translucent-white look there. Anywhere on a light surface we use a
  // warm orange tile that reads on white cards.
  const heroPalette = {
    wrap: 'bg-orange-500/15 border-orange-300/40',
    icon: 'text-orange-200',
    text: 'text-orange-100',
  }
  const pagePalette = {
    wrap: 'bg-orange-50 border-orange-200',
    icon: 'text-orange-600',
    text: 'text-orange-700',
  }
  const p = tone === 'hero' ? heroPalette : pagePalette
  return (
    <div className={`flex items-center gap-1 border rounded-full px-2.5 py-1 ${p.wrap}`}>
      <Icon as={FireIcon} size="sm" strokeWidth={2.1} className={p.icon} />
      <span className={`text-xs font-black ${p.text}`}>{streak} day streak!</span>
    </div>
  )
}

function SkeletonCard() {
  return <Skeleton height={96} width={'100%'} className="rounded-2xl" />
}

function NotificationPanel({ notifications, unreadCount, onClose }) {
  return (
    <div className="zx-card fixed right-3 top-20 z-50 w-[min(92vw,22rem)] theme-card rounded-2xl border theme-border p-3 shadow-xl animate-scale-in">
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
  const { getUserResults, getWeaknessAnalysis } = useFirestore()
  const { earned: earnedBadges, loading: badgesLoading } = useBadges(currentUser?.uid)
  const { dataSaver }                        = useDataSaver()
  const navigate                             = useNavigate()

  // Learner's own grade as a number, validated against the supported set.
  // Null when the profile has no grade (e.g. teacher/admin viewing the
  // dashboard) — the My Grade panel renders a "set your grade" prompt.
  const defaultGrade = userProfile?.grade ? parseInt(userProfile.grade, 10) : null
  const validGrade   = [4, 5, 6].includes(defaultGrade) ? defaultGrade : null

  // Grade-personalised tabs: My Grade (default), Next Level, Challenge.
  // No routing — local state only, content swaps in place.
  const [activeTab, setActiveTab] = useState('myGrade')

  // Per-subject performance keyed by subject.id. Sourced from
  // userProfile.performance if present (future-proof for a server-side
  // aggregation), otherwise derived from the last 50 quiz results.
  const [perfBySubject, setPerfBySubject] = useState({})

  // Weakest topics across the learner's recent results — fed to the
  // "Personalized For You" chip strip. Empty until results exist.
  const [weakTopics, setWeakTopics] = useState([])

  const [recentResults, setRecentResults] = useState([])
  const [stats, setStats]                 = useState({ quizzes: 0, streak: 0 })
  const [loading, setLoading]             = useState(true)
  const [menuOpen, setMenuOpen]           = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [seenNotificationIds, setSeenNotificationIds] = useState([])
  const notificationsRef = useRef(null)
  const notificationUserId = currentUser?.uid || userProfile?.id || 'guest'

  // Today's Goal pill — counts daily-exam progress across the learner's
  // grade. `total` = subjects with an exam scheduled today; `done` = how
  // many of those have been submitted. Hidden when total === 0.
  const [dailyGoal, setDailyGoal] = useState({ done: 0, total: 0 })

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

  // Per-subject performance: prefer pre-aggregated userProfile.performance
  // when available, otherwise derive from the last 50 results. One extra
  // Firestore read per session in the derived path.
  useEffect(() => {
    if (!currentUser) {
      setPerfBySubject({})
      return undefined
    }
    if (userProfile?.performance && typeof userProfile.performance === 'object') {
      setPerfBySubject(userProfile.performance)
      return undefined
    }

    let cancelled = false
    getUserResults(currentUser.uid, 50).then(results => {
      if (cancelled) return
      const acc = {}
      results.forEach(r => {
        if (!r.subject || typeof r.percentage !== 'number') return
        acc[r.subject] ??= { sum: 0, n: 0 }
        acc[r.subject].sum += r.percentage
        acc[r.subject].n   += 1
      })
      const out = {}
      Object.entries(acc).forEach(([s, v]) => { out[s] = Math.round(v.sum / v.n) })
      setPerfBySubject(out)
    }).catch(err => {
      if (cancelled) return
      console.error('GradeHub performance:', err)
      setPerfBySubject({})
    })
    return () => { cancelled = true }
  }, [currentUser, userProfile])

  // Weakest 3 topics across the learner's last 50 results (any topic with
  // < 70% mastery). Drives the "Personalized For You" chip row.
  useEffect(() => {
    if (!currentUser) {
      setWeakTopics([])
      return undefined
    }
    let cancelled = false
    getWeaknessAnalysis(currentUser.uid).then(rows => {
      if (cancelled) return
      const weak = rows.filter(r => r.percentage < 70).slice(0, 3)
      setWeakTopics(weak)
    }).catch(() => { if (!cancelled) setWeakTopics([]) })
    return () => { cancelled = true }
  }, [currentUser])

  useEffect(() => {
    setSeenNotificationIds(readSeenNotificationIds(notificationUserId))
  }, [notificationUserId])

  // Today's Goal — fan out across the 7 CBC subjects to pull each one's
  // scheduled exam + lock status, identical to DailyExamsHub. The pill in
  // the hero shows X/Y where Y is "subjects with an exam today" and X is
  // "of those, how many you've already submitted." We re-run when the
  // learner's grade changes (parents may switch profiles) and every time
  // the page mounts so a freshly-submitted exam reflects on return.
  useEffect(() => {
    if (!currentUser) {
      setDailyGoal({ done: 0, total: 0 })
      return undefined
    }
    let cancelled = false
    const grade = userProfile?.grade || '5'
    Promise.all(SUBJECTS.map(async subject => {
      const [exam, lock] = await Promise.all([
        getTodaysExam(subject.label, grade),
        checkDailyLock(currentUser.uid, subject.label),
      ])
      return { exam, lock }
    })).then(rows => {
      if (cancelled) return
      const scheduled = rows.filter(r => r.exam)
      const submitted = scheduled.filter(r => r.lock?.status === 'submitted')
      setDailyGoal({ done: submitted.length, total: scheduled.length })
    }).catch(() => { if (!cancelled) setDailyGoal({ done: 0, total: 0 }) })
    return () => { cancelled = true }
  }, [currentUser, userProfile?.grade])

  // ── Grade-personalised derived values ────────────────────────────────────
  // userGrade is the learner's own grade (number); nextGrade is +1, capped
  // at 6 (CBC Upper Primary tops out there).
  const userGrade = validGrade
  const nextGrade = userGrade ? userGrade + 1 : null
  const hasNextGrade = nextGrade !== null && nextGrade <= 6

  // Average across the 7 CBC subjects, using only those with recorded scores.
  const subjectScoreList = SUBJECTS
    .map(s => perfBySubject[s.id])
    .filter(v => typeof v === 'number')
  const avgPerformance = subjectScoreList.length
    ? Math.round(subjectScoreList.reduce((a, b) => a + b, 0) / subjectScoreList.length)
    : 0

  const nextLevelUnlocked = avgPerformance >= 70 && hasNextGrade
  const challengeSubjects = SUBJECTS.filter(s => (perfBySubject[s.id] ?? 0) >= 80)
  // Challenge tab APPEARS only when the learner has earned it — per spec,
  // the section is performance-gated rather than always-visible-but-locked.
  const showChallenge = challengeSubjects.length > 0
  const gradeAccentBg = userGrade ? GRADE_META[userGrade]?.tailwind.bg : 'bg-blue-600'
  // Text-color version of the grade accent — used by the tab underline so
  // the active tab carries the same blue/green/orange as the user's grade.
  const gradeAccentText = userGrade ? GRADE_META[userGrade]?.tailwind.text?.replace('-700', '-300') : 'text-blue-300'

  // If Challenge is hidden (or becomes unavailable mid-session), don't leave
  // an orphan tab selected.
  useEffect(() => {
    if (activeTab === 'challenge' && !showChallenge) setActiveTab('myGrade')
  }, [activeTab, showChallenge])

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
    <div className="learner-game-theme min-h-screen theme-bg flex flex-col">
      <GameStickerStyles />
      <OnboardingOverlay />
      {/* ──────────── HEADER ─────────────────────────────────── */}
      <header className="learner-dashboard-header sticky top-0 z-30 theme-card border-b theme-border shadow-sm">
        <div className="max-w-4xl mx-auto px-4 h-20 flex items-center justify-between gap-3">
          <Logo variant="full" size="sm" />

          <div className="flex items-center gap-1.5 sm:gap-2">
            <HeaderIconLink to="/my-results" label="Progress" icon={BarChart3} />

            <ThemeSelector dashboardStyle={true} />

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
      <main className="relative z-10 flex-1 max-w-4xl mx-auto w-full px-4 py-5 pb-28 space-y-6 theme-text">

        {/* ── HERO / WELCOME BANNER ───────────────────────────── */}
        <section
          className={`zx-card relative min-h-[230px] overflow-hidden rounded-3xl ${
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

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {userProfile?.grade && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-white/20 px-2.5 py-1 text-xs font-black text-white">
                    <Icon as={BookOpen} size="xs" strokeWidth={2.1} />
                    Grade {userProfile.grade}
                  </span>
                )}
                {dailyGoal.total > 0 && (
                  <Link
                    to="/exams"
                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/50 bg-amber-400/20 px-2.5 py-1 text-xs font-black text-amber-50 transition-colors hover:bg-amber-400/30"
                  >
                    <Icon as={TrophyIcon} size="xs" strokeWidth={2.1} />
                    Today&rsquo;s Goal · {dailyGoal.done}/{dailyGoal.total} activities
                  </Link>
                )}
              </div>

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
                    <StreakBadge streak={stats.streak} tone="hero" />
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
                  className="flex items-center gap-1.5 rounded-full border border-white/40 bg-white/30 px-3 py-1.5 text-xs font-black text-white transition-colors hover:bg-white/40"
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
          className="border-amber-300 bg-[linear-gradient(135deg,#FEF3C7_0%,#FCD34D_55%,#F59E0B_100%)]"
          icon={TrophyIcon}
          iconClassName="bg-amber-500 text-white"
          kicker="Daily · Once per subject"
          kickerClassName="text-amber-800"
          title="Today's Exams"
          titleClassName="text-amber-950"
          body="Timed competitive exams · Live leaderboard · One attempt per subject per day"
          bodyClassName="text-amber-900/80"
          action="Start"
          actionClassName="bg-amber-600 text-white"
          image={DASHBOARD_CHARACTERS.exams}
          imageAlt="Lina studying"
          imageVariant="card"
        />

        <DashboardActionCard
          to="/games"
          className="border-emerald-300 bg-[linear-gradient(135deg,#D1FAE5_0%,#6EE7B7_55%,#10B981_100%)]"
          icon={Gamepad2}
          iconClassName="bg-emerald-600 text-white"
          kicker="CBC · Grades 1-6"
          kickerClassName="text-emerald-800"
          title="Zed Games"
          titleClassName="text-emerald-950"
          body="Maths, English, Science & Social Studies - earn badges and climb the leaderboard"
          bodyClassName="text-emerald-900/80"
          action="Play"
          actionClassName="bg-emerald-600 text-white"
          image={DASHBOARD_CHARACTERS.games}
          imageAlt="Max playing a learning game"
          imageVariant="games"
        />

        <DashboardActionCard
          to="/notes"
          className="border-sky-300 bg-[linear-gradient(135deg,#E0F2FE_0%,#7DD3FC_55%,#0EA5E9_100%)]"
          icon={FileText}
          iconClassName="bg-sky-600 text-white"
          kicker={userGrade ? `Grade ${userGrade} · CBC` : 'CBC notes'}
          kickerClassName="text-sky-800"
          title="Notes Studio"
          titleClassName="text-sky-950"
          body="Read teacher-written notes and study guides for every subject in your grade"
          bodyClassName="text-sky-900/80"
          action="Read"
          actionClassName="bg-sky-600 text-white"
        />

        {/* ── GRADE-PERSONALISED HUB ──────────────────────────────
              Layout (matches product mockup):
                · Tab bar (My Grade / Next Level / Challenge Mode) with
                  underline on the active tab.
                · Subject grid for the active tab.
                · Always-visible Next Level summary card.
                · Challenge Mode card (active when any subject ≥ 80%,
                  greyed-out CTA otherwise so learners know it exists).
                · Personalized For You — chips of the learner's weakest
                  topics, fed by the existing weakness-analysis hook.
        ──────────────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="learner-page-heading text-display-md flex items-center gap-2">
              <Icon as={AcademicCapIcon} size="lg" strokeWidth={2.1} /> Primary Hub
            </h2>
          </div>

          {/* Segmented-pill tab nav (active tab is the theme accent fill,
              the row sits in a soft theme-bg-subtle track). */}
          <div className="flex items-stretch gap-1 mb-4 p-1 rounded-full theme-bg-subtle border theme-border">
            <TabButton
              active={activeTab === 'myGrade'}
              accentClass={gradeAccentText}
              icon={BookOpen}
              label={userGrade ? `My Grade (${userGrade})` : 'My Grade'}
              subtitle="Your learning path"
              onClick={() => setActiveTab('myGrade')}
            />
            <TabButton
              active={activeTab === 'nextLevel'}
              accentClass={gradeAccentText}
              icon={GraduationCap}
              label="Next Level"
              subtitle={hasNextGrade ? `Grade ${nextGrade} preview` : 'Top grade reached'}
              locked={!nextLevelUnlocked && hasNextGrade}
              onClick={() => setActiveTab('nextLevel')}
            />
            <TabButton
              active={activeTab === 'challenge'}
              accentClass={gradeAccentText}
              icon={TrophyIcon}
              label="Challenge"
              subtitle={showChallenge ? 'For advanced learners' : 'Earn at 80%+'}
              locked={!showChallenge}
              disabled={!showChallenge}
              onClick={() => showChallenge && setActiveTab('challenge')}
            />
          </div>

          {/* ── Active tab subject grid ───────────────────────── */}
          {activeTab === 'myGrade' && (
            userGrade ? (
              <div className="mb-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h3 className="learner-page-heading text-sm font-black">
                      My Grade {userGrade}
                    </h3>
                    <span className="rounded-full bg-emerald-100 ring-1 ring-emerald-200 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                      Current
                    </span>
                  </div>
                  <Link to="/quizzes" className="text-xs font-black theme-accent-text hover:underline">
                    View All →
                  </Link>
                </div>
                <p className="theme-text-muted text-xs font-bold mb-3">
                  Subjects and topics for your current grade
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {SUBJECTS.map(subject => (
                    <SubjectCardRich
                      key={subject.id}
                      subject={subject}
                      grade={userGrade}
                      perf={perfBySubject[subject.id]}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="zx-card theme-card rounded-2xl border theme-border p-4 flex items-center gap-3 mb-5">
                {!dataSaver && <ProfessorPako size={48} mood="tip" animate={false} />}
                <div className="min-w-0 flex-1">
                  <p className="font-black theme-text text-sm">Set your grade to personalise your hub</p>
                  <p className="theme-text-muted text-xs mt-0.5">
                    Update your profile so we can show your Grade 4, 5, or 6 subjects.
                  </p>
                </div>
                <Link
                  to="/profile"
                  className="flex items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-xs font-black theme-accent-text hover:opacity-90"
                >
                  Profile <Icon as={ChevronRight} size="xs" strokeWidth={2.1} />
                </Link>
              </div>
            )
          )}

          {activeTab === 'nextLevel' && hasNextGrade && (
            <div className="mb-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="learner-page-heading text-sm font-black">
                  Grade {nextGrade} — {nextLevelUnlocked ? 'Unlocked' : 'Preview'}
                </h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SUBJECTS.map(subject => (
                  <SubjectCardRich
                    key={subject.id}
                    subject={subject}
                    grade={nextGrade}
                    perf={nextLevelUnlocked ? perfBySubject[subject.id] : 0}
                    dimmed={!nextLevelUnlocked}
                    locked={!nextLevelUnlocked}
                  />
                ))}
              </div>
            </div>
          )}

          {activeTab === 'nextLevel' && !hasNextGrade && (
            <div className="zx-card theme-card rounded-2xl border theme-border p-5 flex items-center gap-3 mb-5">
              {!dataSaver && <ProfessorPako size={52} mood="proud" animate={false} />}
              <div>
                <p className="font-black theme-text text-sm">You&rsquo;ve completed CBC Upper Primary!</p>
                <p className="theme-text-muted text-xs mt-0.5">
                  Grade 6 is the top grade in this hub. Keep practising to maintain mastery.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'challenge' && showChallenge && (
            <div className="mb-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h3 className="learner-page-heading text-sm font-black">Challenge Subjects</h3>
                  <span className="rounded-full bg-amber-100 ring-1 ring-amber-200 px-2 py-0.5 text-[10px] font-black text-amber-700">
                    For You
                  </span>
                </div>
              </div>
              <p className="theme-text-muted text-xs font-bold mb-3">
                Harder questions in your strongest subjects
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {challengeSubjects.map(subject => (
                  <SubjectCardRich
                    key={subject.id}
                    subject={subject}
                    grade={userGrade}
                    perf={perfBySubject[subject.id]}
                    ctaLabel="Start Challenge"
                    ctaHref={`/quizzes?grade=${userGrade}&subject=${subject.id}&difficulty=hard`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Always-visible: Next Level summary card ──────── */}
          {hasNextGrade && (
            <div className="zx-card theme-card rounded-2xl border theme-border p-4 mb-3">
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${nextLevelUnlocked ? 'bg-emerald-100 ring-1 ring-emerald-200 text-emerald-700' : 'theme-bg-subtle theme-text-muted'}`}>
                  <Icon as={nextLevelUnlocked ? CheckCircleIcon : Lock} size="lg" strokeWidth={2.2} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-black theme-text text-sm">Next Level: Grade {nextGrade}</p>
                    <span className="rounded-full theme-bg-subtle theme-text-muted px-2 py-0.5 text-[10px] font-black">
                      {nextLevelUnlocked ? 'Unlocked' : 'Preview'}
                    </span>
                  </div>
                  <p className="theme-text-muted text-xs font-bold mt-0.5">
                    {nextLevelUnlocked
                      ? `Average ${avgPerformance}% — you're ready!`
                      : `Unlock at 70% average · currently ${avgPerformance}%`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('nextLevel')}
                  className={`min-h-0 inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-black shadow-sm ${nextLevelUnlocked ? `${gradeAccentBg} text-white hover:opacity-90` : 'theme-bg-subtle theme-text-muted hover:opacity-90'}`}
                >
                  {nextLevelUnlocked ? `Enter Grade ${nextGrade}` : `Preview Grade ${nextGrade}`}
                  <Icon as={ChevronRight} size="xs" strokeWidth={2.4} />
                </button>
              </div>
              {!nextLevelUnlocked && (
                <div className="theme-bg-subtle h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-2 rounded-full ${gradeAccentBg} transition-[width] duration-500`}
                    style={{ width: `${Math.min(Math.round((avgPerformance / 70) * 100), 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Always-visible: Challenge Mode summary card ──── */}
          <div className="zx-card theme-card rounded-2xl border theme-border p-4 mb-3 relative overflow-hidden">
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${showChallenge ? 'bg-amber-100 ring-1 ring-amber-200 text-amber-700' : 'theme-bg-subtle theme-text-muted'}`}>
                <Icon as={TrophyIcon} size="lg" strokeWidth={2.2} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-black theme-text text-sm">Challenge Mode</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${showChallenge ? 'bg-amber-100 ring-1 ring-amber-200 text-amber-700' : 'theme-bg-subtle theme-text-muted'}`}>
                    {showChallenge ? 'For You' : 'Locked'}
                  </span>
                </div>
                <p className="theme-text-muted text-xs font-bold mt-0.5">
                  {showChallenge
                    ? `Recommended in ${challengeSubjects.length} subject${challengeSubjects.length === 1 ? '' : 's'} where you score 80%+`
                    : 'Reach 80% in any subject to unlock harder questions'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => showChallenge && setActiveTab('challenge')}
                disabled={!showChallenge}
                className={`min-h-0 inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-black shadow-sm ${showChallenge ? 'bg-amber-500 text-slate-950 hover:opacity-90' : 'theme-bg-subtle theme-text-muted cursor-not-allowed'}`}
              >
                Start Challenge
                <Icon as={ChevronRight} size="xs" strokeWidth={2.4} />
              </button>
            </div>
          </div>

          {/* ── Personalized For You (weak-topic chips) ──────── */}
          {weakTopics.length > 0 && (
            <div className="zx-card theme-card rounded-2xl border theme-border p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Icon as={Sparkles} size="sm" strokeWidth={2.1} className="theme-accent-text" />
                  <h3 className="learner-page-heading text-sm font-black">Personalized For You</h3>
                </div>
                <Link to="/my-results" className="text-xs font-black theme-accent-text hover:underline">
                  View All →
                </Link>
              </div>
              <p className="theme-text-muted text-xs font-bold mb-3">
                Practise what you need the most
              </p>
              <div className="flex flex-wrap gap-2">
                {weakTopics.map(topic => {
                  const tone = SUBJECT_TONES[topic.subject] || SUBJECT_TONES.mathematics
                  return (
                    <Link
                      key={`${topic.subject}:${topic.topic}`}
                      to={`/quizzes?grade=${userGrade || ''}&subject=${topic.subject}`}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black ${tone.tile} hover:opacity-90 transition-opacity`}
                    >
                      {topic.topic}
                      <span className="opacity-75">{topic.percentage}%</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        {/* ── RECENT ACTIVITY ─────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="learner-page-heading text-display-md flex items-center gap-2">
              <Icon as={BarChart3} size="lg" strokeWidth={2.1} /> Recent Activity
            </h2>
            <Link to="/my-results" className="text-xs font-bold theme-accent-text hover:underline">
              View all →
            </Link>
          </div>

          <div className="zx-card surface rounded-radius-lg px-4">
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
            <h2 className="learner-page-heading text-display-md flex items-center gap-2">
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
            <div className="zx-card theme-card rounded-2xl border theme-border p-5 flex items-center gap-3">
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
          <div className="zx-card bg-green-50 border border-green-200 rounded-2xl p-4 flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-green-200 bg-green-100 text-green-700">
              <Icon as={Battery} size="lg" strokeWidth={2.1} />
            </div>
            <div>
              <p className="font-black text-green-800 text-sm">Data Saver is ON</p>
              <p className="text-green-700/80 text-xs mt-0.5">
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
      <MobileBottomNav className="learner-bottom-nav" />
    </div>
  )
}
