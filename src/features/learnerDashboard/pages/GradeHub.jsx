/**
 * GradeHub — Zambia CBC Upper Primary Hub Dashboard
 *
 * Replaces StudentDashboard as the main learner landing page.
 * Structure:
 *   Header (logo, data-saver, user avatar)
 *   Hero   (Professor Pako + welcome + streak/stats)
 *   Grade Selection Cards (4, 5, 6, 7)
 *   Subject Grid (expands when a grade is selected)
 *   Recent Activity
 *   Badges Strip
 *   Mobile Bottom Navigation
 */
import { useState, useEffect, useRef, useMemo }  from 'react'
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
  Files,
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
} from '../../../shared/components/icons'
import { useAuth }              from '../../../contexts/AuthContext'
import { usePlatformSettings }  from '../../../contexts/PlatformSettingsContext'
import { useLearnerFirestore }  from '../../../hooks/useLearnerFirestore'
import { useBadges }            from '../../../hooks/useBadges'
import { useDataSaver }         from '../../../contexts/DataSaverContext'
import { GRADE_META, SUBJECTS } from '../../../config/curriculum'
import ProfessorPako            from '../../../shared/components/ProfessorPako'
import DataSaverToggle          from '../../../shared/components/DataSaverToggle'
import BadgeCard                from '../../../shared/components/BadgeCard'
import Logo                     from '../../../shared/components/Logo'
import { HeaderIconLink, HeaderIconButton } from '../../../shared/components/HeaderIconButton'
import useHideOnScroll from '../../../hooks/useHideOnScroll'
import OnboardingOverlay        from '../../../shared/components/OnboardingOverlay'
import PushPermissionPrompt     from '../../../components/ui/PushPermissionPrompt'
import VerifyEmailBanner        from '../../../components/ui/VerifyEmailBanner'
import { SubscriptionReminderCard } from '../../subscription'
import StudyPlanCard            from '../components/StudyPlanCard'
import Icon                     from '../../../shared/components/Icon'
import Button                   from '../../../shared/components/Button'
import Skeleton                 from '../../../shared/components/Skeleton'
import ThemeSelector            from '../../../shared/components/ThemeSelector'
import LanguageToggle           from '../../../shared/components/LanguageToggle'
import AnalyticsConsentToggle   from '../../../components/ui/AnalyticsConsentToggle'
import ReplayTourCard           from '../../../components/ui/ReplayTourCard'
import MobileBottomNav          from '../../../shared/components/MobileBottomNav'
import { SuggestionNudge } from '../../feedback'
import { useSubscription }      from '../../../hooks/useSubscription'
import GameStickerStyles       from '../../../shared/components/GameStickerStyles'
import SeoHelmet                from '../../../shared/components/SeoHelmet'
import { computeStreak }        from '../../../utils/streak'
import { getTodaysExamsBySubject, checkTodaysLocks } from '../../../utils/examService'
// The dashboard's own presentational pieces. They were all declared in this
// file — 539 lines of leaf components above a 1,300-line page — and every one
// is prop-driven, so the move is a relocation, not a redesign.
import DashboardActionCard from '../components/gradeHub/DashboardActionCard'
import ExamTimetableCard from '../components/gradeHub/ExamTimetableCard'
import FloatingStar from '../components/gradeHub/FloatingStar'
import NotificationPanel from '../components/gradeHub/NotificationPanel'
import RecentResultRow from '../components/gradeHub/RecentResultRow'
import SkeletonCard from '../components/gradeHub/SkeletonCard'
import StreakBadge from '../components/gradeHub/StreakBadge'
import SubjectCardRich from '../components/gradeHub/SubjectCardRich'
import TabButton from '../components/gradeHub/TabButton'
import { DASHBOARD_CHARACTERS, FLOATING_STAR_STYLES } from '../components/gradeHub/dashboardArt'
import { SUBJECT_TONES, resolveSubject } from '../components/gradeHub/subjectTones'
import { readSeenNotificationIds, writeSeenNotificationIds } from '../components/gradeHub/seenNotifications'

// ── Sub-components ─────────────────────────────────────────────────────────

// ── Main Component ─────────────────────────────────────────────────────────

export default function GradeHub() {
  const { currentUser, userProfile, logout, isAdmin, isTeacher } = useAuth()
  const { settings: platformSettings } = usePlatformSettings()
  const { getUserResults, getWeaknessAnalysis, getQuizzes } = useLearnerFirestore()
  const { earned: earnedBadges, loading: badgesLoading } = useBadges(currentUser?.uid)
  const { dataSaver }                        = useDataSaver()
  const navigate                             = useNavigate()
  // LinkedIn-style: slide the dashboard header away on scroll-down for more
  // reading space, reveal it on scroll-up.
  const headerHidden = useHideOnScroll()

  // Learner's own grade as a number, validated against the supported set.
  // Null when the profile has no grade (e.g. teacher/admin viewing the
  // dashboard) — the My Grade panel renders a "set your grade" prompt.
  const defaultGrade = userProfile?.grade ? parseInt(userProfile.grade, 10) : null
  const validGrade   = [4, 5, 6, 7].includes(defaultGrade) ? defaultGrade : null

  // Grade-personalised tabs: My Grade (default), Next Level, Challenge.
  // No routing — local state only, content swaps in place.
  const [activeTab, setActiveTab] = useState('myGrade')

  // Per-subject performance keyed by the canonical subject label. Sourced from
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

  // Per-grade published-quiz counts so the subject cards mirror the Quiz
  // Library (/quizzes). Without this the hub only knew the static topic
  // count and was blind to which subjects actually have quizzes — the
  // library showed "16 quizzes / 1 demo" while the matching hub card showed
  // nothing. Shape: { [grade]: { [subjectLabel]: { total, demo } } }. A grade
  // key is present only once its fetch resolves, which lets the card tell
  // "still loading" apart from "genuinely zero (coming soon)".
  const [quizCounts, setQuizCounts] = useState({})

  // One results read drives the streak count, the recent-results strip, AND
  // (when not pre-aggregated) the per-subject performance bars. These were two
  // separate effects firing getUserResults(30) + getUserResults(50) on every
  // mount; merged into a single getUserResults(50). The first 30 are sliced off
  // for the streak/recent count so those numbers stay identical to before, and
  // the full 50 feed the per-subject averages exactly as the old derived path
  // did.
  useEffect(() => {
    if (!currentUser) {
      setRecentResults([])
      setStats({ quizzes: 0, streak: 0 })
      setPerfBySubject({})
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)

    // Prefer pre-aggregated userProfile.performance when present; re-key onto
    // the canonical subject label so the subject cards (which read
    // perfBySubject[subject.label]) line up no matter whether the source keyed
    // by id, label, or a legacy spelling. When absent, we derive it from the
    // fetched results below.
    const haveAggregatedPerf =
      userProfile?.performance && typeof userProfile.performance === 'object'
    if (haveAggregatedPerf) {
      const norm = {}
      Object.entries(userProfile.performance).forEach(([s, v]) => {
        if (typeof v !== 'number') return
        const key = resolveSubject(s)?.label ?? s
        norm[key] = v
      })
      setPerfBySubject(norm)
    }

    getUserResults(currentUser.uid, 50).then(results => {
      if (cancelled) return
      // First 30 → streak + count (identical to the old getUserResults(30)).
      const recent = results.slice(0, 30)
      setRecentResults(recent)
      // Streak is computed client-side from the loaded attempt timestamps;
      // userProfile.currentStreak isn't written by the app today, so this
      // replaces the previous always-0 fallback. Once a Cloud Function /
      // user document field is added (audit A5), prefer that and keep this
      // as the offline / first-load fallback.
      const streak = computeStreak(recent.map(r => r.completedAt ?? r.createdAt))
      setStats({ quizzes: recent.length, streak })
      setLoading(false)

      // Full 50 → per-subject averages (identical to the old derived path).
      if (!haveAggregatedPerf) {
        const acc = {}
        results.forEach(r => {
          if (!r.subject || typeof r.percentage !== 'number') return
          const key = resolveSubject(r.subject)?.label ?? r.subject
          acc[key] ??= { sum: 0, n: 0 }
          acc[key].sum += r.percentage
          acc[key].n   += 1
        })
        const out = {}
        Object.entries(acc).forEach(([s, v]) => { out[s] = Math.round(v.sum / v.n) })
        setPerfBySubject(out)
      }
    }).catch(err => {
      if (cancelled) return
      console.error('GradeHub results:', err)
      setRecentResults([])
      setStats({ quizzes: 0, streak: 0 })
      // Leave a pre-aggregated perf map intact on a results-fetch failure.
      if (!haveAggregatedPerf) setPerfBySubject({})
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [currentUser, userProfile, getUserResults])

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
  }, [currentUser, getWeaknessAnalysis])

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
    Promise.all([
      getTodaysExamsBySubject(grade),
      checkTodaysLocks(currentUser.uid),
    ]).then(([examMap, lockMap]) => {
      if (cancelled) return
      const rows = SUBJECTS.map(subject => ({
        exam: examMap.get(subject.label) || null,
        lock: lockMap.get(subject.label) || null,
      }))
      const scheduled = rows.filter(r => r.exam)
      const submitted = scheduled.filter(r => r.lock?.status === 'submitted')
      setDailyGoal({ done: submitted.length, total: scheduled.length })
    }).catch(() => { if (!cancelled) setDailyGoal({ done: 0, total: 0 }) })
    return () => { cancelled = true }
  }, [currentUser, userProfile?.grade])

  // ── Grade-personalised derived values ────────────────────────────────────
  // userGrade is the learner's own grade (number); nextGrade is +1, capped
  // at 7 (CBC Upper Primary tops out there).
  const userGrade = validGrade
  const nextGrade = userGrade ? userGrade + 1 : null
  const hasNextGrade = nextGrade !== null && nextGrade <= 7

  // TEMPORARY (2026 exams) — the Grade-7 PSLE timetable card is shown to every
  // learner, regardless of grade or subscription tier: the national exam
  // calendar is public information every learner should be able to reach.
  const showExamTimetable = true

  // Average across the 7 CBC subjects, using only those with recorded scores.
  // Both derivations only depend on perfBySubject, so memoise them — they feed
  // the render on every parent state change (menu, notifications, tab) and
  // challengeSubjects backs a subject grid.
  const avgPerformance = useMemo(() => {
    const scores = SUBJECTS
      .map(s => perfBySubject[s.label])
      .filter(v => typeof v === 'number')
    return scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0
  }, [perfBySubject])

  const nextLevelUnlocked = avgPerformance >= 70 && hasNextGrade
  const challengeSubjects = useMemo(
    () => SUBJECTS.filter(s => (perfBySubject[s.label] ?? 0) >= 80),
    [perfBySubject],
  )
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

  // Load published practice-quiz counts for the grades the hub can show
  // (the learner's own grade + the next-level preview grade). Reuses the
  // very same getQuizzes() query the Quiz Library runs, so the per-subject
  // tallies stay identical between the two surfaces. getQuizzes wants the
  // grade as the wire string ('7'), matching how the library passes it.
  useEffect(() => {
    const grades = []
    if (userGrade) grades.push(userGrade)
    if (hasNextGrade && nextGrade) grades.push(nextGrade)
    // No grade yet (profile still loading, or a transient auth/profile blip
    // that briefly nulls userProfile). Do NOT clear quizCounts here: this
    // effect re-runs whenever the grade flickers, and wiping good counts on a
    // momentary null is exactly what made the cards go blank on a long-open
    // dashboard until a full reload. Leave the last good map in place.
    if (!grades.length) return undefined

    let cancelled = false
    Promise.all(
      grades.map(g => getQuizzes({ grade: String(g) }).then(rows => [g, rows])),
    ).then(pairs => {
      if (cancelled) return
      const out = {}
      let totalRows = 0
      for (const [g, rows] of pairs) {
        totalRows += rows.length
        const bySubject = {}
        for (const quiz of rows) {
          // Match the library exactly: group by the quiz's subject wire value
          // (the canonical label, e.g. "Integrated Science"). total counts
          // every published practice quiz; demo is the subset flagged isDemo.
          const key = quiz.subject
          if (!key) continue
          bySubject[key] ??= { total: 0, demo: 0 }
          bySubject[key].total += 1
          if (quiz.isDemo) bySubject[key].demo += 1
        }
        out[g] = bySubject
      }
      // getQuizzes() swallows Firestore errors and returns [] (see
      // the learner data module), so a failed read is indistinguishable from a real
      // "zero quizzes" result here. A long-lived dashboard re-runs this in the
      // background (e.g. on the ~hourly auth-token refresh); if that read
      // transiently fails we'd cache an all-empty map and every card would
      // flip to "Coming soon" until reload. Guard: when the whole fetch comes
      // back empty but we already have populated counts, keep the good ones.
      setQuizCounts(prev => {
        const hadCounts = Object.values(prev).some(
          g => g && Object.keys(g).length > 0,
        )
        if (totalRows === 0 && hadCounts) return prev
        return out
      })
    }).catch(err => {
      if (cancelled) return
      // A genuine rejection (not the swallowed-empty path above). Keep the
      // last good counts rather than blanking the cards.
      console.error('GradeHub quiz counts:', err)
    })
    return () => { cancelled = true }
  }, [userGrade, nextGrade, hasNextGrade, getQuizzes])

  const { accessBadge, isDemoOnly } = useSubscription()

  // Resolve the Quiz-Library-style counts for one subject card. Returns
  // quizCount=undefined while that grade is still loading so the card shows
  // no badge (rather than a premature "Coming soon"); once loaded a subject
  // with no quizzes resolves to 0 → "Coming soon", matching the library.
  function subjectCounts(grade, subject) {
    const gradeStats = quizCounts[grade]
    if (!gradeStats) return { quizCount: undefined, demoCount: 0 }
    const stat = gradeStats[subject.label]
    return { quizCount: stat?.total ?? 0, demoCount: stat?.demo ?? 0 }
  }

  const aiNotesOn = !!(platformSettings && platformSettings.learnerAi &&
    platformSettings.learnerAi.showAiNotesToLearners)
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
          id: 'streak',
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
    // activeNotificationIds is tracked via activeNotificationIdsKey so the
    // effect only re-runs when the joined-string identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // closeNotifications is recreated each render; rebinding listeners on
    // every render would be wasteful — the dep set below is the actual
    // observable input to the listener attach/detach cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notificationsOpen, activeNotificationIdsKey])

  return (
    <div className="learner-game-theme min-h-screen theme-bg flex flex-col">
      <SeoHelmet
        title={currentUser ? 'Dashboard' : 'Dashboard Preview'}
        path="/dashboard"
        noIndex
      />
      <GameStickerStyles />
      <OnboardingOverlay />
      {/* ──────────── HEADER ─────────────────────────────────── */}
      <header className={`learner-dashboard-header safe-top sticky top-0 z-30 zx-nav-autohide ${headerHidden ? 'zx-nav-hidden-top' : ''}`}>
        <div className="max-w-4xl mx-auto px-3 sm:px-4 min-h-16 sm:min-h-20 py-2 flex items-center justify-between gap-2 sm:gap-3">
          <div className="min-w-0 shrink">
            <Logo variant="full" size="sm" />
          </div>

          <div className="flex shrink-0 flex-nowrap items-center gap-1 sm:gap-2">
            <HeaderIconLink to="/my-results" label="Progress" icon={BarChart3} size="sm" />

            <ThemeSelector dashboardStyle={true} dashboardSize="sm" />

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
                size="sm"
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
                size="sm"
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
                    <Link to="/settings" onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-bold theme-text hover:theme-bg-subtle">
                      <Icon as={Settings} size="sm" strokeWidth={2.1} /> Settings
                    </Link>
                    <Link to="/my-subscription" onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-bold theme-text hover:theme-bg-subtle">
                      <Icon as={Sparkles} size="sm" strokeWidth={2.1} /> My Subscription
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
                      onClick={() => {
                        setMenuOpen(false)
                        logout()
                          .then(() => navigate('/login'))
                          .catch(err => console.error('GradeHub logout:', err))
                      }}
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
      <main
        className="relative z-10 flex-1 max-w-4xl mx-auto w-full px-3 sm:px-4 py-5 space-y-4 theme-text"
        // Clear the fixed bottom nav AND the transparent Android system nav bar
        // (edge-to-edge): the bar's own safe-area padding makes it taller by
        // env(safe-area-inset-bottom), so the scroll content needs the same
        // extra room or the last section tucks under the nav buttons.
        style={{ paddingBottom: 'calc(7rem + env(safe-area-inset-bottom, 0px))' }}
      >

        {/* ── HERO / WELCOME BANNER ───────────────────────────── */}
        <section
          className={`zx-card relative overflow-hidden rounded-3xl ${
            dataSaver
              ? 'theme-accent-fill p-5'
              : 'theme-hero p-4 sm:p-5'
          }`}
          data-bg-gradient={!dataSaver ? 'true' : undefined}
        >
          {/* Ambient sparkle. The big character art used to be a half-card
              background layer here (with a gradient "wash" for text contrast),
              which forced the welcome content into a narrow left column so the
              stats, buttons and pills each wrapped onto their own line and made
              the hero very tall. The art now lives as a compact top-right
              thumbnail (see below) and the content spans the full width, so it
              collapses onto far fewer rows. Skipped in data-saver. */}
          {!dataSaver && (
            <>
              {/* Kept clear of the left-hand welcome copy / button column so
                  they read as ambient sparkle rather than artifacts sitting on
                  top of the text. Anchored to the upper band and right edge. */}
              <FloatingStar style={FLOATING_STAR_STYLES[0]} />
              <FloatingStar style={FLOATING_STAR_STYLES[1]} />
              <FloatingStar style={FLOATING_STAR_STYLES[2]} />
            </>
          )}

          {/* Character art as a right-anchored background layer. It bleeds to
              the card edge and sits behind the z-10 content (the welcome copy,
              stats, buttons and pills all read on the left), so the art can be
              large and immersive without forcing the card taller or squeezing
              the copy into a narrow column. Skipped in data-saver. */}
          {!dataSaver && (
            <img
              src={DASHBOARD_CHARACTERS.hero.src}
              alt=""
              aria-hidden="true"
              width={DASHBOARD_CHARACTERS.hero.width}
              height={DASHBOARD_CHARACTERS.hero.height}
              loading="eager"
              decoding="async"
              className="zx-hero-art"
            />
          )}

          <div className="relative z-10 zx-hero-body">
            <div className="min-w-0">
              <p className="mb-1 text-eyebrow text-white/75" style={{ color: 'rgba(255,255,255,0.75)' }}>
                Welcome back
              </p>
              <h1 className="text-display-xl text-white">{firstName}!</h1>
              <p className="theme-hero-muted mt-1 text-body-sm italic">Practise smart with ZedExams.</p>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-4">
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

            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                to="/quizzes"
                className="inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full bg-white/95 px-2.5 py-1.5 text-xs font-black theme-accent-text transition-colors hover:bg-white"
              >
                <Icon as={PencilLine} size="xs" strokeWidth={2.1} />
                Start Quiz
              </Link>
              <Link
                to="/my-results"
                className="inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full border border-white/70 bg-white/15 px-2.5 py-1.5 text-xs font-black text-white transition-colors hover:bg-white/25"
              >
                <Icon as={BarChart3} size="xs" strokeWidth={2.1} />
                My Results
              </Link>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {userProfile?.grade && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/55 bg-white/15 px-2.5 py-1 text-xs font-black text-white">
                  <Icon as={BookOpen} size="xs" strokeWidth={2.1} />
                  Grade {userProfile.grade}
                </span>
              )}
              {dailyGoal.total > 0 && (
                <Link
                  to="/exams"
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/70 bg-amber-500/35 px-2.5 py-1 text-xs font-black text-white transition-colors hover:bg-amber-500/45"
                >
                  <Icon as={TrophyIcon} size="xs" strokeWidth={2.1} />
                  Today&rsquo;s Goal · {dailyGoal.done}/{dailyGoal.total} activities
                </Link>
              )}
            </div>
          </div>
        </section>

        {/* Subscription reminder — Free/Expired learners get an upgrade card
            listing their Pro benefits; self-hides once they're Pro/Trial. */}
        <SubscriptionReminderCard audience="learner" />

        {/* Audit A8 — verify-email reminder. Self-hides for already-
            verified accounts (incl. Google sign-in) and dismissed sessions. */}
        <VerifyEmailBanner />
        <StudyPlanCard
          results={recentResults}
          weakTopics={weakTopics}
          grade={userGrade}
          dailyGoal={dailyGoal}
          loading={loading}
          aiNotesOn={aiNotesOn}
        />
        {/* Audit A5.1 — daily-reminder push opt-in. Self-gated to learners
            with streak ≥ 1; renders nothing otherwise. */}
        <PushPermissionPrompt streak={stats.streak} />

        {/* TEMPORARY (2026 exams) — Grade-7 PSLE timetable, shown to every
            learner regardless of grade or plan so the national exam calendar
            is always reachable. Remove with the ExamTimetableCard component +
            bundled PDF when exams close. */}
        {showExamTimetable && <ExamTimetableCard />}

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
          imageAlt="Exam clipboard with trophy, clock and books"
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
          imageAlt="Game controller with trophy and learning blocks"
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
          image={DASHBOARD_CHARACTERS.notes}
          imageAlt="Open notebook with a pen"
          imageVariant="card"
        />

        <DashboardActionCard
          to="/papers"
          className="border-violet-300 bg-[linear-gradient(135deg,#EDE9FE_0%,#C4B5FD_55%,#7C3AED_100%)]"
          icon={Files}
          iconClassName="bg-violet-600 text-white"
          kicker="ECZ archive · Grade 7 & 12"
          kickerClassName="text-violet-800"
          title="Past Papers"
          titleClassName="text-violet-950"
          body="Real ECZ exam papers — practise under timer, download with mark schemes"
          bodyClassName="text-violet-900/80"
          action="Browse"
          actionClassName="bg-violet-600 text-white"
          image={DASHBOARD_CHARACTERS.papers}
          imageAlt="Exam clipboard with a checklist and award badge"
          imageVariant="card"
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
                      perf={perfBySubject[subject.label]}
                      {...subjectCounts(userGrade, subject)}
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
                    Update your profile so we can show your Grade 4, 5, 6, or 7 subjects.
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
                    perf={nextLevelUnlocked ? perfBySubject[subject.label] : 0}
                    dimmed={!nextLevelUnlocked}
                    locked={!nextLevelUnlocked}
                    {...subjectCounts(nextGrade, subject)}
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
                  Grade 7 is the top grade in this hub. Keep practising to maintain mastery.
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
                    perf={perfBySubject[subject.label]}
                    ctaLabel="Start Challenge"
                    ctaHref="/quizzes"
                    {...subjectCounts(userGrade, subject)}
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
                  // topic.subject is the stored subject label; map it back to
                  // the curriculum id so the chip tone resolves. The chip used
                  // to deep-link the retired /practise/:grade/:subjectId course
                  // map, falling back to the library when the subject did not
                  // resolve; every chip now goes to the library.
                  const subjectId = resolveSubject(topic.subject)?.id
                  const tone = SUBJECT_TONES[subjectId] || SUBJECT_TONES.mathematics
                  return (
                    <Link
                      key={`${topic.subject}:${topic.topic}`}
                      to="/quizzes"
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
              // Display only the 5 most recent; the full 30 stay loaded
              // for the streak compute above.
              recentResults.slice(0, 5).map(r => <RecentResultRow key={r.id} result={r} />)
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
            <div className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
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
            <div className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-2 sm:mx-0 sm:px-0" style={{ scrollbarWidth: 'thin' }}>
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
                  className="flex-shrink-0 flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-2xl theme-bg-subtle border theme-border theme-text-muted hover:theme-card-hover transition-colors"
                >
                  <span className="text-xl">+{earnedBadges.length - 8}</span>
                  <span className="text-xs font-bold">More</span>
                </Link>
              )}
            </div>
          )}
        </section>

        {/* ── SETTINGS ────────────────────────────────────────────
              Learner settings used to live only inside /profile, where
              they were easy to miss. Surfaced here, right under the
              badges shelf, so appearance + language + privacy controls
              are one tap from the dashboard. Sign Out closes the group.
              The /profile page keeps the same controls for teachers and
              admins, whose dashboards don't render this hub.
        ──────────────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="learner-page-heading text-display-md flex items-center gap-2">
              <Icon as={Settings} size="lg" strokeWidth={2.1} /> Settings
            </h2>
          </div>

          <div className="space-y-3">
            {/* Appearance & preferences */}
            <div className="zx-card theme-card rounded-2xl border theme-border divide-y divide-current/10">
              <div className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="theme-text font-black text-sm flex items-center gap-2">
                    <span aria-hidden="true">🎨</span> Theme
                  </p>
                  <p className="theme-text-muted text-xs mt-0.5">Pick the colours you like best.</p>
                </div>
                <ThemeSelector />
              </div>
              <div className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="theme-text font-black text-sm flex items-center gap-2">
                    <span aria-hidden="true">🔋</span> Data saver
                  </p>
                  <p className="theme-text-muted text-xs mt-0.5">Use less mobile data by trimming images and motion.</p>
                </div>
                <DataSaverToggle showLabel />
              </div>
              <div className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="theme-text font-black text-sm flex items-center gap-2">
                    <span aria-hidden="true">🌍</span> Language
                  </p>
                  <p className="theme-text-muted text-xs mt-0.5">Choose the language for menus and buttons.</p>
                </div>
                <LanguageToggle compact />
              </div>
            </div>

            {/* Product analytics consent — reflects the localStorage
                decision and flips analytics on/off without a reload. */}
            <AnalyticsConsentToggle />

            {/* Replay any first-session tour the learner dismissed. */}
            <ReplayTourCard />

            {/* Sign out — mirrors the account-menu action so learners can
                leave straight from the dashboard. */}
            <button
              type="button"
              aria-label="Sign out of your account"
              onClick={() => {
                logout()
                  .then(() => navigate('/login'))
                  .catch(err => console.error('GradeHub settings logout:', err))
              }}
              className="zx-card w-full flex items-center justify-center gap-2 rounded-2xl border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-600 shadow-sm transition-colors hover:bg-red-100 min-h-0"
            >
              <Icon as={LogOut} size="sm" strokeWidth={2.1} /> Sign Out
            </button>
          </div>
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

      {/* Occasional, dismissible "suggest a subject / paper / feature" nudge —
          mirrors the teacher dashboard. The once-a-day payment reminder popup
          is mounted globally in App.jsx, so it already covers this surface. */}
      <SuggestionNudge source="learner-dashboard" />
    </div>
  )
}
