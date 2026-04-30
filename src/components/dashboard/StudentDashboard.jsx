import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { useSubscription } from '../../hooks/useSubscription'
import UpgradeModal from '../subscription/UpgradeModal'
import { UpgradeBanner, AttemptCounter } from '../subscription/PremiumGate'
import PremiumGate from '../subscription/PremiumGate'
import Mascot from '../ui/Mascot'
import Button from '../ui/Button'
import Skeleton from '../ui/Skeleton'
import ProgressWidget from './ProgressWidget'

const STARS = [
  { top: '10%', left:  '7%',  delay: '0s',    dur: '3.2s', emoji: '⭐', cls: 'text-xl opacity-70' },
  { top: '68%', left: '88%',  delay: '0.6s',  dur: '2.8s', emoji: '✨', cls: 'text-sm opacity-50' },
  { top: '22%', left: '80%',  delay: '1.1s',  dur: '3.7s', emoji: '🌟', cls: 'text-base opacity-55' },
  { top: '78%', left: '11%',  delay: '0.3s',  dur: '3.0s', emoji: '⭐', cls: 'text-xs opacity-45' },
  { top: '42%', left: '93%',  delay: '1.7s',  dur: '2.6s', emoji: '✨', cls: 'text-sm opacity-40' },
  { top: '55%', left:  '3%',  delay: '0.9s',  dur: '3.4s', emoji: '🌟', cls: 'text-base opacity-50' },
]

function FloatingStars() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {STARS.map((s, i) => (
        <span key={i} className={`absolute ${s.cls}`}
          style={{ top: s.top, left: s.left, animation: `float ${s.dur} ease-in-out infinite`, animationDelay: s.delay }}>
          {s.emoji}
        </span>
      ))}
    </div>
  )
}

const subjectBadge = {
  Mathematics:           'bg-blue-100 text-blue-700',
  English:               'bg-violet-100 text-violet-700',
  'Integrated Science':  'bg-orange-100 text-orange-700',
  'Social Studies':      'bg-teal-100 text-teal-700',
  'Technology Studies':  'bg-cyan-100 text-cyan-700',
  'Home Economics':      'bg-pink-100 text-pink-700',
  'Expressive Arts':     'bg-rose-100 text-rose-700',
  Science:               'bg-orange-100 text-orange-700',
}
const subjectShort = {
  Mathematics: 'Maths', English: 'English',
  'Integrated Science': 'Science', 'Social Studies': 'Soc. St.',
  'Technology Studies': 'Tech', 'Home Economics': 'Home Ec.', 'Expressive Arts': 'Exp. Arts',
  Science: 'Science',
}

function pctColor(p) {
  if (p >= 70) return 'text-green-600'
  if (p >= 50) return 'text-yellow-600'
  return 'text-red-500'
}

const QUICK_ACTIONS = [
  { icon: '✏️', label: 'Take a Quiz',  sub: 'Test your knowledge',   to: '/quizzes',  accent: 'accent-mint'  },
  { icon: '📚', label: 'Lessons',      sub: 'Read study notes',      to: '/lessons',  accent: 'accent-blue'  },
  { icon: '📊', label: 'My Results',   sub: 'View your history',     to: '/my-results', accent: 'accent-amber' },
]

export default function StudentDashboard() {
  const { userProfile }  = useAuth()
  const { getUserResults, getWeaknessAnalysis } = useFirestore()
  const { isPremium, canUseWeaknessAnalysis }   = useSubscription()
  const navigate = useNavigate()

  const [results, setResults]   = useState([])
  const [weakness, setWeakness] = useState([])
  const [loading, setLoading]   = useState(true)
  const [showUpgrade, setShowUpgrade] = useState(false)

  useEffect(() => {
    async function load() {
      if (!userProfile?.id) return
      const [r, w] = await Promise.all([
        getUserResults(userProfile.id, 30),
        canUseWeaknessAnalysis ? getWeaknessAnalysis(userProfile.id) : Promise.resolve([]),
      ])
      setResults(r); setWeakness(w); setLoading(false)
    }
    load()
  }, [userProfile?.id, canUseWeaknessAnalysis])

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
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}

      {/* Welcome hero */}
      <section className="hero min-h-[130px]">
        <FloatingStars />
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
        {/* Owl mascot peeking from the right */}
        <div className="absolute bottom-0 right-4 pointer-events-none">
          <Mascot size={100} mood={avgScore >= 70 ? 'star' : 'happy'} />
        </div>
        <div className="relative pr-24 sm:pr-28">
          <p className="hero-eyebrow">{greeting} 👋</p>
          <h1 className="hero-title">{userProfile?.displayName ?? 'Learner'}!</h1>
          <p className="hero-sub">Ready to ace your exams today?</p>
          <div className="relative flex items-center gap-2 mt-2 flex-wrap">
            {userProfile?.grade && (
              <span className="bg-white/20 text-white/90 text-xs font-bold px-2.5 py-1 rounded-full">
                Grade {userProfile.grade}
              </span>
            )}
            {userProfile?.school && (
              <span className="bg-white/20 text-white/90 text-xs px-2.5 py-1 rounded-full truncate max-w-[150px]">
                {userProfile.school}
              </span>
            )}
            {isPremium && (
              <span className="bg-yellow-400 text-yellow-900 text-xs font-black px-2.5 py-1 rounded-full animate-bounce-slow">
                ⭐ Premium
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Upgrade banner */}
      <UpgradeBanner onUpgradeClick={() => setShowUpgrade(true)} />

      {/* Attempt counter */}
      <AttemptCounter onUpgradeClick={() => setShowUpgrade(true)} />

      {/* Stats */}
      <div className="stats-row stats-row-3">
        {[
          { icon: '📝', label: 'Quizzes Done', val: loading ? '…' : totalQuizzes,                         t: 't-purple', delay: '0ms'   },
          { icon: '🎯', label: 'Avg Score',    val: loading ? '…' : totalQuizzes > 0 ? `${avgScore}%` : '—', t: 't-mint',   delay: '80ms'  },
          { icon: '🏆', label: 'Passed',       val: loading ? '…' : passed,                               t: 't-amber',  delay: '160ms' },
        ].map(s => (
          <div key={s.label} className={`stat-tile ${s.t} animate-pop`} style={{ animationDelay: s.delay }}>
            <div className="stat-tile-icon" aria-hidden="true"><span className="text-base">{s.icon}</span></div>
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

      {/* Quick actions */}
      <div>
        <h2 className="qa-title">⚡ Quick Actions</h2>
        <div className="qa-grid">
          {QUICK_ACTIONS.map((a, i) => (
            <Link key={a.to} to={a.to}
              className={`qa-card ${a.accent} hover-lift press-feedback animate-pop`}
              style={{ animationDelay: `${i * 60}ms` }}>
              <span className="qa-icon" aria-hidden="true"><span className="text-base">{a.icon}</span></span>
              <div className="qa-text">
                <p className="qa-name">{a.label}</p>
                <p className="qa-desc">{a.sub}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

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
