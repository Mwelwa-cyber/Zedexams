import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Sprout, ChevronRight } from '../ui/icons'
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

const StatCard_colors = {
  green:  'bg-green-50  text-green-600  border-green-100',
  blue:   'bg-blue-50   text-blue-600   border-blue-100',
  orange: 'bg-orange-50 text-orange-600 border-orange-100',
  purple: 'bg-purple-50 text-purple-600 border-purple-100',
  yellow: 'bg-yellow-50 text-yellow-600 border-yellow-100',
}

function StatCard({ icon, label, value, color, loading, linkTo }) {
  const inner = (
    <div className={`rounded-2xl border p-5 shadow-elev-md shadow-elev-inner-hl transition-all duration-base ease-out ${StatCard_colors[color]} ${linkTo ? 'hover-lift press-feedback cursor-pointer' : ''}`}>
      <div className="text-3xl mb-2" aria-hidden="true">{icon}</div>
      <div className="text-display-md text-gray-800" style={{ fontSize: 22 }}>
        {loading ? <Skeleton height={20} width={40} /> : value}
      </div>
      <div className="text-eyebrow mt-1" style={{ color: 'inherit' }}>{label}</div>
    </div>
  )
  return linkTo ? <Link to={linkTo}>{inner}</Link> : inner
}

function QuickAction({ to, icon, label, sub, color }) {
  // Coloured accent rail on the left edge — gives each action a touch of
  // identity without making the card itself a full pastel block. Resting
  // state stays on theme tokens so the panel reads in every theme.
  const accents = {
    green:  'before:bg-emerald-400',
    blue:   'before:bg-sky-400',
    orange: 'before:bg-orange-400',
  }
  return (
    <Link
      to={to}
      className={`group relative flex items-start gap-3 p-4 rounded-2xl theme-card border theme-border shadow-elev-sm hover-lift press-feedback overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-1 ${accents[color] || 'before:bg-emerald-400'}`}
    >
      <span className="text-2xl pl-1" aria-hidden="true">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="font-black theme-text text-sm transition-colors">{label}</p>
        <p className="text-xs theme-text-muted mt-0.5">{sub}</p>
      </div>
    </Link>
  )
}

export default function AdminDashboard() {
  const { currentUser } = useAuth()
  const { getAllLessons, getAllQuizzes, getAllUsers, getAllResults, getPendingApprovals, getPendingTeacherApplications } = useFirestore()

  const [stats, setStats]     = useState({ lessons: 0, quizzes: 0, learners: 0, results: 0, pending: 0, teacherApps: 0, gens: 0, gensFlagged: 0, gensCostUsd: '0.00' })
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
        const [lessons, quizzes, users, results, pending, teacherApps, gens] = await Promise.all([
          getAllLessons(), getAllQuizzes(), getAllUsers(), getAllResults(), getPendingApprovals(), getPendingTeacherApplications(),
          getGenerationsSummary().catch(() => ({ total: 0, flagged: 0, totalCostUsd: '0.00' })),
        ])
        const safe = (value, fallback = []) => (Array.isArray(value) ? value : fallback)
        const safeLessons = safe(lessons)
        const safeQuizzes = safe(quizzes)
        const safeUsers = safe(users)
        const safeResults = safe(results)
        const safePending = safe(pending)
        const safeTeacherApps = safe(teacherApps)
        const safeGens = gens && typeof gens === 'object' ? gens : {}
        setStats({
          lessons:  safeLessons.length,
          quizzes:  safeQuizzes.length,
          learners: safeUsers.filter(u => u?.role === 'learner' || u?.role === 'student').length,
          results:  safeResults.length,
          pending:  safePending.length,
          teacherApps: safeTeacherApps.length,
          gens: safeGens.total ?? 0,
          gensFlagged: safeGens.flagged ?? 0,
          gensCostUsd: safeGens.totalCostUsd ?? '0.00',
        })
        setRecent(safeResults.slice(0, 8))
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
    if (p >= 70) return 'text-green-600'
    if (p >= 50) return 'text-yellow-600'
    return 'text-red-500'
  }

  return (
    <div className="space-y-6">
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
          { icon: '🧑‍🏫', label: 'Teacher Apps',     value: stats.teacherApps, color: 'blue',    linkTo: '/admin/teacher-applications'            },
          { icon: '✨',   label: stats.gensFlagged > 0 ? `AI Gens · ${stats.gensFlagged} flagged` : `AI Gens · $${stats.gensCostUsd}`, value: stats.gens, color: stats.gensFlagged > 0 ? 'yellow' : 'purple', linkTo: '/admin/generations' },
        ].map(s => (
          <div key={s.label} className="animate-slide-in-soft">
            <StatCard icon={s.icon} label={s.label} value={s.value} color={s.color} loading={loading} linkTo={s.linkTo} />
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-eyebrow mb-3">Quick actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <QuickAction to="/admin/lessons/new" icon="📖" label="Create Lesson" sub="Add a new lesson for learners" color="green" />
          <QuickAction to="/admin/generate/lesson-plan" icon="✨" label="AI Lesson Plan" sub="Generate a CBC lesson plan in seconds" color="green" />
          <QuickAction to="/admin/quizzes/new" icon="✏️" label="Create Quiz"   sub="Build a new quiz or test"    color="blue"  />
          <QuickAction to="/admin/quizzes/new?mode=import" icon="📄" label="Import Quiz" sub="Convert Word/PDF into editable questions" color="green" />
          <QuickAction to="/admin/quizzes/new?mode=ai" icon="✦" label="AI Quiz Generator" sub="Draft questions with Zed" color="blue" />
          <QuickAction to="/admin/content"     icon="📁" label="Manage Content" sub="Edit or delete existing content" color="orange" />
          <QuickAction to="/admin/learners" icon="👥" label="View Learners" sub="Monitor learner activity and progress" color="orange" />
          <QuickAction to="/admin/teacher-applications" icon="🧑‍🏫" label="Review Teachers" sub="Approve verified teacher accounts" color="blue" />
          <QuickAction to="/admin/cbc-kb" icon="📚" label="CBC Knowledge Base" sub="Add custom curriculum topics (esp. G10–12)" color="green" />
        </div>
      </div>

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

      {/* Recent Results */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-eyebrow">Recent activity</h2>
          <Link to="/admin/results" className="inline-flex items-center gap-0.5 text-green-600 text-xs font-black hover:underline">
            View all <Icon as={ChevronRight} size="xs" />
          </Link>
        </div>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border theme-border p-4 shadow-elev-sm">
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
          <div className="theme-card rounded-2xl border theme-border shadow-elev-sm">
            <EmptyState
              title="No results yet"
              description="Results will appear here once learners take quizzes."
            />
          </div>
        ) : (
          <div className="bg-white rounded-2xl border theme-border shadow-elev-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b theme-border">
                    <th className="text-left px-4 py-3 font-black text-gray-600 text-xs">Learner</th>
                    <th className="text-left px-4 py-3 font-black text-gray-600 text-xs">Quiz</th>
                    <th className="text-left px-4 py-3 font-black text-gray-600 text-xs">Score</th>
                    <th className="text-left px-4 py-3 font-black text-gray-600 text-xs">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {recent.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-bold text-gray-800 text-xs">{r.userName || 'Learner'}</p>
                        <p className="text-gray-400 text-xs">Grade {r.grade}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-bold text-gray-700 text-xs truncate max-w-[140px]">{r.quizTitle}</p>
                        <p className="text-gray-400 text-xs">{r.subject}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-black text-sm ${pctColor(r.percentage)}`}>{r.percentage}%</span>
                        <p className="text-gray-400 text-xs">{r.score}/{r.totalMarks}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{fmt(r.completedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
