import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { usePlatformSettings } from '../../../contexts/PlatformSettingsContext'
import { useLearnerFirestore } from '../../../hooks/useLearnerFirestore'
import { useSubscription } from '../../../hooks/useSubscription'
import { PremiumGate, RenewalBanner, UpgradeBanner, AttemptCounter, UpgradeModal } from '../../subscription'
import Mascot from '../../../shared/components/Mascot'
import Button from '../../../shared/components/Button'
import Skeleton from '../../../shared/components/Skeleton'
import ContentLoadError from '../../../shared/components/ContentLoadError'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import Icon from '../../../shared/components/Icon'
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ClipboardList,
  PencilLine,
  Sparkles,
  Target,
  TrophyIcon,
} from '../../../shared/components/icons'
import ProgressWidget from '../components/ProgressWidget'
import StreakXpCard from '../components/StreakXpCard'
import StudyPlanCard from '../components/StudyPlanCard'
import { FeedbackButton } from '../../feedback'
import { buildRequestKey } from '../../../utils/requestControl.js'
import { deduplicatedRequest } from '../../../utils/requestDeduplication.js'
import { useAbortableRequest } from '../../../hooks/useAbortableRequest.js'
import { GuardianConsentBanner } from '../../auth'

const subjectBadge = {
  English:               'bg-violet-100 text-violet-700',
  'Integrated Science':  'bg-orange-100 text-orange-700',
  Mathematics:           'bg-blue-100 text-blue-700',
  'Social Studies':      'bg-teal-100 text-teal-700',
  'Expressive Art':      'bg-rose-100 text-rose-700',
  'Technology Studies':  'bg-cyan-100 text-cyan-700',
  Cinyanja:              'bg-pink-100 text-pink-700',
  // legacy
  Science:               'bg-orange-100 text-orange-700',
  'Expressive Arts':     'bg-rose-100 text-rose-700',
  'Home Economics':      'bg-pink-100 text-pink-700',
}
const subjectShort = {
  English: 'English', 'Integrated Science': 'Science',
  Mathematics: 'Maths', 'Social Studies': 'Soc. St.',
  'Expressive Art': 'Art', 'Technology Studies': 'Tech',
  Cinyanja: 'Cinyanja',
  // legacy
  Science: 'Science', 'Expressive Arts': 'Exp. Arts', 'Home Economics': 'Home Ec.',
}

function pctColor(p) {
  if (p >= 70) return 'text-green-600'
  if (p >= 50) return 'text-yellow-600'
  return 'text-red-500'
}

const QUICK_ACTIONS = [
  { icon: PencilLine,   label: 'Practice quiz',   sub: 'CBC questions by topic', to: '/quizzes',    accent: 'accent-mint'  },
  { icon: BookOpen,     label: 'Lessons',         sub: 'Revise one topic',       to: '/lessons',    accent: 'accent-blue'  },
  { icon: Sparkles,     label: 'Study plan',      sub: 'AI weekly revision',     to: '/study-plan', accent: 'accent-amber' },
  { icon: BarChart3,    label: 'Results',         sub: 'Review score history',   to: '/my-results', accent: 'accent-amber' },
  { icon: CalendarDays, label: 'School calendar', sub: 'Terms and holidays',     to: '/calendar',   accent: 'accent-pink'  },
]

export default function StudentDashboard() {
  const { userProfile }  = useAuth()
  const { settings: platformSettings } = usePlatformSettings()
  const aiNotesOn = !!(platformSettings && platformSettings.learnerAi &&
    platformSettings.learnerAi.showAiNotesToLearners)
  const { getUserResults, getWeaknessAnalysis } = useLearnerFirestore()
  const { isPremium, canUseWeaknessAnalysis }   = useSubscription()
  const navigate = useNavigate()

  const [results, setResults]   = useState([])
  const [weakness, setWeakness] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [showUpgrade, setShowUpgrade] = useState(false)

  // `getUserResults`/`getWeaknessAnalysis` (from useLearnerFirestore()) get a fresh
  // identity every render, so `load` itself is re-created every render and
  // this effect can refire far more often than `userProfile.id` actually
  // changes. `deduplicatedRequest` collapses those repeat calls (same user,
  // same flag) onto one shared Firestore round-trip, and
  // `useAbortableRequest` makes sure only the LATEST call's result is ever
  // applied — a failed or superseded read still clears loading and surfaces
  // a retryable error instead of leaving the widgets stuck on their
  // placeholder skeletons forever (the infinite-loading bug this fixes).
  const { run, cancel } = useAbortableRequest({ timeoutMs: 15_000 })
  const load = useCallback(async () => {
    if (!userProfile?.id) return
    setLoading(true)
    setError(null)
    const key = buildRequestKey('student-dashboard-progress', userProfile.id, canUseWeaknessAnalysis)
    const result = await run(({ signal }) => deduplicatedRequest(key, () => Promise.all([
      getUserResults(userProfile.id, 30),
      canUseWeaknessAnalysis ? getWeaknessAnalysis(userProfile.id) : Promise.resolve([]),
    ]), { signal, timeoutMs: 15_000 }))
    if (result.status === 'success') {
      const [r, w] = result.data
      setResults(r); setWeakness(w)
      setLoading(false)
    } else if (result.status === 'error') {
      console.error('StudentDashboard load failed', result.error)
      setError('We couldn’t load your progress just now. Please check your connection and try again.')
      setLoading(false)
    }
    // 'stale' / 'aborted' — a newer load() call already owns loading/error/
    // results/weakness state.
  }, [userProfile?.id, canUseWeaknessAnalysis, getUserResults, getWeaknessAnalysis, run])

  useEffect(() => { load(); return cancel }, [load, cancel])

  const totalQuizzes = results.length
  const avgScore = totalQuizzes > 0
    ? Math.round(results.reduce((s, r) => s + (r.percentage ?? 0), 0) / totalQuizzes) : 0
  const passed   = results.filter(r => (r.percentage ?? 0) >= 50).length

  function fmt(ts) {
    if (!ts) return ''
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  }

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  })()

  return (
    <div className="max-w-2xl md:max-w-3xl mx-auto px-4 py-5 space-y-5">
      <SeoHelmet title="My stats" path="/my-stats" noIndex />

      {/* Guardian consent / migration prompt. Renders nothing for an approved
          or adult account, so it costs a signed-in teacher or an approved
          learner one null return. It sits ABOVE the hero because a learner in
          limited mode needs to know why Ask Zed is refusing before they
          conclude the app is broken. */}
      <GuardianConsentBanner />

      {showUpgrade && (
        <UpgradeModal
          portal="learner"
          defaultPlanId={userProfile?.subscriptionPlan}
          onClose={() => setShowUpgrade(false)}
        />
      )}

      {/* Welcome hero */}
      <section className="hero dashboard-hero min-h-[152px]">
        <div className="absolute inset-0 dashboard-hero-map" aria-hidden="true" />
        <div className="absolute bottom-0 right-3 sm:right-5 pointer-events-none">
          <Mascot size={100} mood={avgScore >= 70 ? 'star' : 'happy'} />
        </div>
        <div className="relative pr-24 sm:pr-32">
          <p className="hero-eyebrow">{greeting}</p>
          <h1 className="hero-title">
            Keep your exam plan moving, {userProfile?.displayName ?? 'Learner'}
          </h1>
          <p className="hero-sub">One quiz, one correction, one topic mastered.</p>
          <div className="relative flex items-center gap-2 mt-2 flex-wrap">
            {userProfile?.grade && (
              <span className="bg-white/20 text-white/90 text-xs font-bold px-2.5 py-1 rounded-full">
                Grade {userProfile.grade}
              </span>
            )}
            {userProfile?.school && (
              <span className="bg-white/20 text-white/90 text-xs px-2.5 py-1 rounded-full truncate max-w-[180px] sm:max-w-[220px]">
                {userProfile.school}
              </span>
            )}
            {isPremium && (
              <span className="bg-yellow-400 text-yellow-950 text-xs font-black px-2.5 py-1 rounded-full">
                Premium
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Gamification: XP, level, streak, personal best */}
      <StreakXpCard />

      {/* Renewal nudge — surfaces in the last 7 days of an active subscription */}
      <RenewalBanner onRenewClick={() => setShowUpgrade(true)} />

      {/* Upgrade banner */}
      <UpgradeBanner onUpgradeClick={() => setShowUpgrade(true)} />

      {/* Attempt counter */}
      <AttemptCounter onUpgradeClick={() => setShowUpgrade(true)} />

      {/* Read-failure notice — the stats/widgets below show placeholders when a
          read fails, so make the failure explicit and retryable rather than
          letting it read as "no activity yet". */}
      {error && (
        <ContentLoadError
          title="Couldn’t load your progress"
          message={error}
          onRetry={load}
        />
      )}

      {/* Stats */}
      <div className="stats-row stats-row-3">
        {[
          { icon: ClipboardList, label: 'Quizzes done', val: loading ? '...' : totalQuizzes,                         t: 't-purple', delay: '0ms'   },
          { icon: Target,        label: 'Average score', val: loading ? '...' : totalQuizzes > 0 ? `${avgScore}%` : '-', t: 't-mint',   delay: '80ms'  },
          { icon: TrophyIcon,    label: 'Passed',        val: loading ? '...' : passed,                               t: 't-amber',  delay: '160ms' },
        ].map(s => (
          <div key={s.label} className={`stat-tile ${s.t} animate-pop`} style={{ animationDelay: s.delay }}>
            <div className="stat-tile-icon" aria-hidden="true">
              <Icon as={s.icon} size="sm" />
            </div>
            <div className="stat-num">{s.val}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Progress tracking */}
      <ProgressWidget
        results={results}
        streak={userProfile?.currentStreak ?? 0}
        loading={loading}
      />

      <StudyPlanCard
        results={results}
        weakTopics={weakness}
        grade={userProfile?.grade}
        loading={loading}
        aiNotesOn={aiNotesOn}
      />

      {/* The AI practice banner that used to sit here linked to /ai-practice,
          a route deleted with the learnerAi pipeline in PR #713 — removed so
          the showAiPracticeQuizzesToLearners flag can't surface a dead link. */}

      {/* AI notes banner — feature-flagged via
          settings/global.learnerAi.showAiNotesToLearners. Same silent
          pattern as the practice banner above. */}
      {aiNotesOn && (
        <Link
          to="/notes"
          className="block rounded-2xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 to-teal-50 p-4 hover-lift press-feedback"
        >
          <div className="flex items-start gap-3">
            <span className="text-3xl shrink-0" aria-hidden="true">📓</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-900">
                AI study notes
              </div>
              <div className="text-xs text-slate-600 mt-0.5 leading-snug">
                Curriculum-aligned notes for Grade {userProfile?.grade ?? '—'}.
                Vocabulary, examples, and a quick-revision recap.
              </div>
            </div>
            <span className="text-emerald-700 font-bold text-sm shrink-0">
              Open →
            </span>
          </div>
        </Link>
      )}

      {/* Quick actions */}
      <div>
        <h2 className="qa-title">Quick actions</h2>
        <div className="qa-grid">
          {QUICK_ACTIONS.map((a, i) => (
            <Link key={a.to} to={a.to}
              className={`qa-card ${a.accent} hover-lift press-feedback animate-pop`}
              style={{ animationDelay: `${i * 60}ms` }}>
              <span className="qa-icon" aria-hidden="true">
                <Icon as={a.icon} size="sm" />
              </span>
              <div className="qa-text">
                <p className="qa-name">{a.label}</p>
                <p className="qa-desc">{a.sub}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Suggestion & request box */}
      <FeedbackButton source="learner-dashboard" />

      {/* Weakness analysis (premium) */}
      <PremiumGate feature="weaknessAnalysis">
        <div className="theme-card rounded-2xl border theme-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-black theme-text text-sm">🔍 Weak Topics</h2>
            <span className="text-xs theme-text-muted">Areas to improve</span>
          </div>
          {weakness.length === 0 ? (
            <div className="text-center py-6">
              <div className="text-3xl mb-2">🎉</div>
              <p className="text-gray-500 text-sm font-bold">Take more quizzes to see your weak spots</p>
            </div>
          ) : weakness.filter(w => w.percentage < 70).length === 0 ? (
            <div className="text-center py-4">
              <div className="text-3xl mb-2">🏆</div>
              <p className="text-green-600 font-black text-sm">All topics above 70% — great work!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {weakness.filter(w => w.percentage < 70).slice(0, 4).map(w => (
                <div key={w.topic}>
                  <div className="flex justify-between items-center mb-1">
                    <div>
                      <span className="text-sm font-black text-gray-700">{w.topic}</span>
                      <span className={`ml-2 text-xs font-bold px-2 py-0.5 rounded-full ${subjectBadge[w.subject] ?? 'bg-gray-100 text-gray-600'}`}>
                        {subjectShort[w.subject] ?? w.subject}
                      </span>
                    </div>
                    <span className={`font-black text-sm ${pctColor(w.percentage)}`}>{w.percentage}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className={`h-2 rounded-full transition-all duration-700 ${w.percentage >= 50 ? 'bg-yellow-400' : 'bg-red-400'}`}
                      style={{ width: `${w.percentage}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PremiumGate>

      {/* Recent results */}
      <div className="surface rounded-radius-lg p-4">
        <div className="ra-title">
          <span>📋 Recent Results</span>
          {results.length > 0 && (
            <Link to="/my-results">View all →</Link>
          )}
        </div>
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} height={56} />)}
          </div>
        ) : results.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-2" aria-hidden="true">🎯</div>
            <p className="theme-text-muted text-sm font-bold">No quizzes taken yet</p>
            <Button as={Link} to="/quizzes" variant="primary" size="sm" className="mt-3">
              Start your first quiz →
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {results.slice(0, 5).map(r => (
              <button key={r.id} onClick={() => navigate(`/results/${r.id}`)}
                className="w-full flex items-center gap-3 p-3 bg-gray-50 hover:bg-green-50 rounded-xl transition-colors text-left group min-h-0">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-black text-sm flex-shrink-0 ${
                  r.percentage >= 70 ? 'bg-green-100 text-green-700' :
                  r.percentage >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600'
                }`}>
                  {r.percentage}%
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-gray-800 text-sm truncate group-hover:text-green-700 transition-colors">
                    {r.quizTitle ?? 'Quiz'}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${subjectBadge[r.subject] ?? 'bg-gray-100 text-gray-600'}`}>
                      {subjectShort[r.subject] ?? r.subject}
                    </span>
                    <span className="text-gray-400 text-xs">{r.score}/{r.totalMarks} · {r.mode === 'exam' ? '🏆' : '🌱'} {r.mode}</span>
                    {r.completedAt && <span className="text-gray-300 text-xs hidden sm:inline">{fmt(r.completedAt)}</span>}
                  </div>
                </div>
                <span className="text-gray-300 group-hover:text-green-400 transition-colors">→</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
