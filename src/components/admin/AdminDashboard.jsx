import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Sprout } from '../ui/icons'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import { clearSeedFirestore, seedFirestore } from '../../utils/seedData'
import { getGenerationsSummary } from '../../utils/adminGenerationsService'
import { db } from '../../firebase/config'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import Skeleton from '../ui/Skeleton'
import PageHeader from '../ui/PageHeader'
import EmptyState from '../ui/EmptyState'
import SeoHelmet from '../seo/SeoHelmet'
import ParentDigestTester from './ParentDigestTester'

const STAT_TINT = {
  green:  't-mint',
  blue:   't-blue',
  orange: 't-amber',
  purple: 't-purple',
  yellow: 't-amber',
}

function StatCard({ icon, label, value, color, loading, linkTo }) {
  const inner = (
    <div className={`stat-tile ${STAT_TINT[color] || 't-purple'} ${linkTo ? 'hover-lift press-feedback cursor-pointer' : ''}`}>
      <div className="stat-tile-icon" aria-hidden="true"><span className="text-base">{icon}</span></div>
      <div className="stat-num">
        {loading ? <Skeleton height={20} width={40} /> : value}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  )
  return linkTo ? <Link to={linkTo}>{inner}</Link> : inner
}

// Admin quick actions reuse the learner dashboard's qa-card / accent-* styles
// so the two surfaces stay visually consistent. The 7 actions cycle through
// mint/blue/amber/pink to keep the grid lively without re-using the same
// accent on adjacent cards.
const QUICK_ACTIONS = [
  { to: '/admin/lessons/new',             icon: '📖',  label: 'Create Lesson',     sub: 'Add a new lesson for learners',          accent: 'accent-mint'  },
  { to: '/admin/quizzes/new',             icon: '✏️',  label: 'Create Quiz',       sub: 'Build a new quiz or test',               accent: 'accent-blue'  },
  { to: '/admin/quizzes/new?mode=import', icon: '📄',  label: 'Import Quiz',       sub: 'Convert Word/PDF into questions',        accent: 'accent-amber' },
  { to: '/admin/quizzes/new?mode=ai',     icon: '✦',  label: 'AI Quiz Generator', sub: 'Draft questions with Zed',               accent: 'accent-pink'  },
  { to: '/admin/content',                 icon: '📁',  label: 'Manage Content',    sub: 'Edit or delete existing content',        accent: 'accent-mint'  },
  { to: '/admin/learners',                icon: '👥',  label: 'View Learners',     sub: 'Monitor learner activity and progress',  accent: 'accent-blue'  },
  { to: '/admin/cbc-kb',                  icon: '📚',  label: 'CBC Knowledge Base',sub: 'Add custom curriculum topics',           accent: 'accent-amber' },
]

export default function AdminDashboard() {
  const { currentUser } = useAuth()
  const { getDashboardCounts, getRecentResults } = useFirestore()

  const [stats, setStats]     = useState({ lessons: 0, quizzes: 0, learners: 0, results: 0, pending: 0, gens: 0, gensFlagged: 0, gensCostUsd: '0.00' })
  const [recent, setRecent]   = useState([])
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [clearingSeed, setClearingSeed] = useState(false)
  const [seedMsg, setSeedMsg] = useState('')

  async function handleSeed() {
    if (!window.confirm('This will add sample quizzes to Firestore. Continue?')) return
    setSeeding(true); setSeedMsg('')
    try {
      await seedFirestore(db, currentUser.uid)
      setSeedMsg('✅ Sample data seeded successfully!')
    } catch (e) {
      setSeedMsg('❌ ' + e.message)
    } finally { setSeeding(false) }
  }

  async function handleClearSeed() {
    if (!window.confirm('This will remove the seeded sample quizzes created by your account. Continue?')) return
    setClearingSeed(true); setSeedMsg('')
    try {
      const result = await clearSeedFirestore(db, currentUser.uid)
      setSeedMsg(
        result.quizzesDeleted > 0
          ? `✅ Cleared ${result.quizzesDeleted} seeded sample quiz${result.quizzesDeleted === 1 ? '' : 'zes'}.`
          : 'ℹ️ No seeded sample quizzes were found for your account.',
      )
    } catch (e) {
      setSeedMsg('❌ ' + e.message)
    } finally { setClearingSeed(false) }
  }

  useEffect(() => {
    async function load() {
      try {
        const [counts, recentResults, gens] = await Promise.all([
          getDashboardCounts(),
          getRecentResults(8),
          getGenerationsSummary().catch(() => ({ total: 0, flagged: 0, totalCostUsd: '0.00' })),
        ])
        const safeGens = gens && typeof gens === 'object' ? gens : {}
        setStats({
          lessons:  counts.lessons,
          quizzes:  counts.quizzes,
          learners: counts.learners,
          results:  counts.results,
          pending:  counts.pending,
          gens: safeGens.total ?? 0,
          gensFlagged: safeGens.flagged ?? 0,
          gensCostUsd: safeGens.totalCostUsd ?? '0.00',
        })
        setRecent(Array.isArray(recentResults) ? recentResults : [])
      } catch (error) {
        // Keep the dashboard mounted with zeroed stats rather than
        // bubbling the reject up to the error boundary — the shell
        // and quick-actions are still useful without the counts.
        console.error('AdminDashboard load failed:', error)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  function fmt(ts) {
    if (!ts) return '—'
    try {
      const d = typeof ts?.toDate === 'function' ? ts.toDate() : new Date(ts)
      if (!d || Number.isNaN(d.getTime?.())) return '—'
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    } catch {
      return '—'
    }
  }

  function pctColor(p) {
    if (p >= 70) return 'green'
    if (p >= 50) return 'amber'
    return 'red'
  }

  return (
    <div className="space-y-6">
      <SeoHelmet title="Admin dashboard" noIndex />
      <PageHeader
        eyebrow="Admin overview"
        title="Dashboard"
        description="Overview of your ZedExams platform — at a glance."
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 stagger">
        {[
          { icon: '📖',   label: 'Lessons',          value: stats.lessons,     color: 'green'                                                     },
          { icon: '📝',   label: 'Quizzes',          value: stats.quizzes,     color: 'blue'                                                      },
          { icon: '👥',   label: 'Learners',         value: stats.learners,    color: 'orange', linkTo: '/admin/learners'                         },
          { icon: '📊',   label: 'Results',          value: stats.results,     color: 'purple'                                                    },
          { icon: '🔔',   label: 'Content Pending',  value: stats.pending,     color: 'yellow',  linkTo: '/admin/approvals'                       },
          { icon: '✨',   label: stats.gensFlagged > 0 ? `AI Gens · ${stats.gensFlagged} flagged` : `AI Gens · $${stats.gensCostUsd}`, value: stats.gens, color: stats.gensFlagged > 0 ? 'yellow' : 'purple', linkTo: '/admin/generations' },
        ].map(s => (
          <div key={s.label} className="animate-slide-in-soft">
            <StatCard icon={s.icon} label={s.label} value={s.value} color={s.color} loading={loading} linkTo={s.linkTo} />
          </div>
        ))}
      </div>

      {/* Quick Actions — same qa-card / accent palette the learner dashboard
          uses so admins and learners see a consistent visual language. The
          grid grows 2 → 3 → 4 columns to keep cards comfortable on every
          breakpoint with our 7-action set. */}
      <div>
        <h2 className="qa-title">⚡ Quick Actions</h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 stagger">
          {QUICK_ACTIONS.map((a, i) => (
            <Link
              key={a.to}
              to={a.to}
              className={`qa-card ${a.accent} hover-lift press-feedback animate-pop`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <span className="qa-icon" aria-hidden="true"><span className="text-base">{a.icon}</span></span>
              <div className="qa-text">
                <p className="qa-name">{a.label}</p>
                <p className="qa-desc">{a.sub}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Developer tools — collapsed by default so the seed + parent-digest
          test panels stay out of the way on every dashboard load. Admins who
          need them are one click away; the rest of the page no longer scrolls
          past two large amber/white blocks that the typical day-to-day admin
          never touches. */}
      <details className="surface rounded-radius-lg shadow-elev-sm">
        <summary className="cursor-pointer select-none flex items-center justify-between gap-3 px-4 py-3 text-eyebrow">
          <span className="flex items-center gap-2">
            <span aria-hidden="true">🛠️</span>
            <span>Developer tools</span>
          </span>
          <span className="text-body-sm font-normal normal-case tracking-normal text-slate-500">
            Seed data &amp; digest tester
          </span>
        </summary>
        <div className="px-4 pb-4 pt-1 space-y-4">
          {/* Audit A3 PR 3 — admin-only on-demand parent digest tester. */}
          <ParentDigestTester />

          {/* Seed Data */}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 shadow-elev-sm">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1">
                <h2 className="text-display-md text-amber-900" style={{ fontSize: 16 }}>Seed sample data</h2>
                <p className="text-amber-700 text-body-sm mt-0.5">
                  Load the sample quizzes into Firestore, or clear the seeded set created by your account.
                  Clearing removes the matching seeded quiz docs and their question subcollections.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleSeed}
                  loading={seeding}
                  disabled={clearingSeed}
                  leadingIcon={<Icon as={Sprout} size="sm" />}
                  className="shrink-0"
                  style={{ backgroundColor: '#F59E0B', color: 'white' }}
                >
                  {seeding ? 'Seeding…' : 'Run seed'}
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={handleClearSeed}
                  loading={clearingSeed}
                  disabled={seeding}
                  className="shrink-0"
                >
                  {clearingSeed ? 'Clearing…' : 'Clear seed'}
                </Button>
              </div>
            </div>
            {seedMsg && <p className="mt-3 text-body-sm font-bold text-amber-900 bg-amber-100 rounded-xl px-4 py-2">{seedMsg}</p>}
          </div>
        </div>
      </details>

      {/* Recent Results */}
      <div>
        <div className="ra-title">
          <span>Recent activity</span>
          <Link to="/admin/results">View all →</Link>
        </div>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="surface--tight rounded-radius-md p-4">
                <div className="flex items-center gap-3">
                  <Skeleton shape="circle" size={32} />
                  <div className="flex-1 space-y-2">
                    <Skeleton height={12} width="66%" />
                    <Skeleton height={10} width="33%" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : recent.length === 0 ? (
          <div className="surface--tight rounded-radius-lg">
            <EmptyState
              title="No results yet"
              description="Results will appear here once learners take quizzes."
            />
          </div>
        ) : (
          <div className="ra-table">
            <div className="ra-row head">
              <span>Learner</span>
              <span>Quiz</span>
              <span>Score · Date</span>
            </div>
            {recent.map(r => (
              <div key={r.id} className="ra-row">
                <div>
                  <p className="ra-learner-name">{r.userName || 'Learner'}</p>
                  <p className="ra-learner-grade">Grade {r.grade}</p>
                </div>
                <div>
                  <p className="ra-quiz-name truncate">{r.quizTitle}</p>
                  <p className="ra-quiz-subj">{r.subject}</p>
                </div>
                <div>
                  <p className={`ra-score ${pctColor(r.percentage)}`}>{r.percentage}%</p>
                  <p className="ra-score-frac">{r.score}/{r.totalMarks} · {fmt(r.completedAt)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
