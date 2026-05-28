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
import EmptyState from '../ui/EmptyState'
import SeoHelmet from '../seo/SeoHelmet'
import ParentDigestTester from './ParentDigestTester'
import AdminSetupBanner from './AdminSetupBanner'

// Pastel mascot tones cycle through orange / blue / green / yellow / pink /
// purple so the grid feels like the /games hub mascot row.
const STAT_TONE = {
  green:  'tone-green',
  blue:   'tone-blue',
  orange: 'tone-orange',
  purple: 'tone-purple',
  yellow: 'tone-yellow',
  pink:   'tone-pink',
}

function StatCard({ icon, label, value, sub, tone, loading, linkTo }) {
  const inner = (
    <div className={`admin-game-card relative flex min-h-[86px] items-center gap-3 rounded-[18px] bg-white p-3 sm:p-4 ${linkTo ? 'is-pressable cursor-pointer' : ''}`}>
      <div className={`admin-game-tile ${STAT_TONE[tone] || 'tone-orange'} h-10 w-10 shrink-0 text-[20px] leading-none sm:h-11 sm:w-11`}>
        <span aria-hidden="true">{icon}</span>
      </div>
      <div className="min-w-0">
        <div className="admin-game-display text-[24px] leading-none" style={{ color: '#0F1B2D' }}>
          {loading ? <Skeleton height={22} width={48} /> : value}
        </div>
        <div className="mt-1 truncate text-[10px] font-extrabold uppercase tracking-[0.12em]" style={{ color: '#4A5A6E' }}>
          {label}
        </div>
        {sub && (
          <div className="mt-0.5 truncate text-[11px] font-semibold" style={{ color: '#4A5A6E' }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  )
  return linkTo ? <Link to={linkTo} className="no-underline">{inner}</Link> : inner
}

function AttentionItem({ to, icon, title, detail, level = 'neutral', action = 'Open' }) {
  const color = level === 'high' ? '#B91C1C' : level === 'medium' ? '#C2410C' : '#053541'
  const background = level === 'high' ? '#FEF2F2' : level === 'medium' ? '#FFF7E6' : '#E3EEF0'

  return (
    <Link
      to={to}
      className="admin-game-card-soft flex min-h-[92px] items-start gap-3 p-3 no-underline is-pressable"
      style={{ background, color: '#0F1B2D' }}
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border-2 text-sm font-black" style={{ borderColor: '#0F1B2D', color, background: '#FFFFFF' }}>
        <span aria-hidden="true">{icon}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-black leading-tight" style={{ color: '#0F1B2D' }}>{title}</p>
        <p className="mt-1 text-[11px] font-semibold leading-snug" style={{ color: '#4A5A6E' }}>{detail}</p>
        <p className="mt-2 text-[10px] font-black uppercase tracking-[0.12em]" style={{ color }}>{action}</p>
      </div>
    </Link>
  )
}

// Quick actions — each lives in a sticker card with a pastel mascot tile, an
// orange "GO" pill in the top corner, and a short blurb. Mirrors the
// SubjectTile look from /games.
const QUICK_ACTIONS = [
  { to: '/admin/lessons/new',             icon: '📖',  label: 'Create Lesson',     sub: 'Add a new lesson for learners',          tone: 'tone-green'  },
  { to: '/admin/quizzes/new',             icon: '✏️',  label: 'Create Quiz',       sub: 'Build a new quiz or test',               tone: 'tone-blue'   },
  { to: '/admin/quizzes/new?mode=import', icon: '📄',  label: 'Import Quiz',       sub: 'Convert Word/PDF into questions',        tone: 'tone-yellow' },
  { to: '/admin/quizzes/new?mode=ai',     icon: '✦',   label: 'AI Quiz Generator', sub: 'Draft questions with Zed',               tone: 'tone-pink'   },
  { to: '/admin/content',                 icon: '📁',  label: 'Manage Content',    sub: 'Edit or delete existing content',        tone: 'tone-orange' },
  { to: '/admin/learners',                icon: '👥',  label: 'View Learners',     sub: 'Monitor learner activity and progress',  tone: 'tone-purple' },
  { to: '/admin/cbc-kb',                  icon: '📚',  label: 'CBC Knowledge Base',sub: 'Add custom curriculum topics',           tone: 'tone-blue'   },
]

export default function AdminDashboard() {
  const { currentUser } = useAuth()
  const { getDashboardCounts, getRecentResults, getPendingPayments } = useFirestore()

  const [stats, setStats]     = useState({ lessons: 0, quizzes: 0, learners: 0, results: 0, pending: 0, gens: 0, gensFlagged: 0, gensFailed: 0, gensCostUsd: '0.00', pendingPayments: 0, lowScores: 0 })
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
        const [counts, recentResults, gens, payments] = await Promise.all([
          getDashboardCounts(),
          getRecentResults(8),
          getGenerationsSummary().catch(() => ({ total: 0, flagged: 0, failed: 0, totalCostUsd: '0.00' })),
          getPendingPayments().catch(() => []),
        ])
        const safeGens = gens && typeof gens === 'object' ? gens : {}
        const recentArr = Array.isArray(recentResults) ? recentResults : []
        const lowScores = recentArr.filter(r => typeof r.percentage === 'number' && r.percentage < 40).length
        setStats({
          lessons:  counts.lessons,
          quizzes:  counts.quizzes,
          learners: counts.learners,
          results:  counts.results,
          pending:  counts.pending,
          gens: safeGens.total ?? 0,
          gensFlagged: safeGens.flagged ?? 0,
          gensFailed: safeGens.failed ?? 0,
          gensCostUsd: safeGens.totalCostUsd ?? '0.00',
          pendingPayments: Array.isArray(payments) ? payments.length : 0,
          lowScores,
        })
        setRecent(recentArr)
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
  }, [getDashboardCounts, getRecentResults, getPendingPayments])

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

  // Only surface things that actually need an admin's attention, sorted
  // high → medium. An empty list renders the "All clear" state below.
  const attentionItems = []
  if (stats.gensFlagged > 0) {
    attentionItems.push({
      to: '/admin/generations',
      icon: '!',
      title: `${stats.gensFlagged} AI generation${stats.gensFlagged === 1 ? '' : 's'} flagged`,
      detail: 'Open the generation logs and inspect the flagged output.',
      level: 'high',
      action: 'Audit',
    })
  }
  if (stats.gensFailed > 0) {
    attentionItems.push({
      to: '/admin/generations',
      icon: '✕',
      title: `${stats.gensFailed} AI generation${stats.gensFailed === 1 ? '' : 's'} failed`,
      detail: 'A generator run errored out — check the logs for the cause.',
      level: 'high',
      action: 'Open logs',
    })
  }
  if (stats.pending > 0) {
    attentionItems.push({
      to: '/admin/approvals',
      icon: '!',
      title: `${stats.pending} content item${stats.pending === 1 ? '' : 's'} awaiting approval`,
      detail: 'Review learner-facing lessons and quizzes before they go live.',
      level: 'medium',
      action: 'Review',
    })
  }
  if (stats.pendingPayments > 0) {
    attentionItems.push({
      to: '/admin/payments',
      icon: '$',
      title: `${stats.pendingPayments} payment${stats.pendingPayments === 1 ? '' : 's'} pending`,
      detail: 'Confirm or reject MoMo requests to unblock premium access.',
      level: 'medium',
      action: 'Settle',
    })
  }
  if (stats.lowScores > 0) {
    attentionItems.push({
      to: '/admin/results',
      icon: '↓',
      title: `${stats.lowScores} recent score${stats.lowScores === 1 ? '' : 's'} below 40%`,
      detail: 'Several learners are struggling on recent quizzes — review results.',
      level: 'medium',
      action: 'Review',
    })
  }

  return (
    <div className="space-y-6">
      <SeoHelmet title="Admin dashboard" noIndex />

      {/* First-run hint pointing at the Platform Health diagnostic.
          Self-dismisses via localStorage so returning admins don't see it. */}
      <AdminSetupBanner />

      {/* Operational header for the admin workspace. */}
      <section>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <span className="admin-game-eyebrow">Admin overview</span>
            <h1 className="admin-game-display mt-2 text-[30px] leading-[1.05] sm:text-[38px]" style={{ color: '#0F1B2D' }}>
              Platform overview
            </h1>
            <p className="mt-2 max-w-2xl text-[13px] font-medium" style={{ color: '#4A5A6E' }}>
              Review queues, spot blockers, and jump into the next admin task.
            </p>
          </div>
          <Link
            to="/admin/analytics"
            className="hidden sm:inline text-xs font-extrabold whitespace-nowrap"
            style={{ color: '#053541' }}
          >
            All ›
          </Link>
        </div>
      </section>

      {/* Stats grid — compact cards so more of the dashboard fits above the fold. */}
      <section>
        <div className="mb-3">
          <span className="admin-game-eyebrow">Stats</span>
          <h2 className="admin-game-display mt-1 text-[21px] sm:text-[24px]" style={{ color: '#0F1B2D' }}>
            Platform snapshot
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6 stagger">
          {[
            { icon: '📖', label: 'Lessons',         value: stats.lessons,  tone: 'green'                                          },
            { icon: '📝', label: 'Quizzes',         value: stats.quizzes,  tone: 'blue'                                           },
            { icon: '👥', label: 'Learners',        value: stats.learners, tone: 'orange', linkTo: '/admin/learners'              },
            { icon: '📊', label: 'Results',         value: stats.results,  tone: 'purple'                                         },
            { icon: '🔔', label: 'Content pending', value: stats.pending,  tone: 'yellow', linkTo: '/admin/approvals'             },
            {
              icon: '✨',
              label: 'AI generations',
              value: stats.gens,
              sub: stats.gensFlagged > 0 ? `${stats.gensFlagged} flagged` : `$${stats.gensCostUsd} spent`,
              tone: stats.gensFlagged > 0 ? 'yellow' : 'pink',
              linkTo: '/admin/generations',
            },
          ].map(s => (
            <div key={s.label} className="animate-slide-in-soft">
              <StatCard icon={s.icon} label={s.label} value={s.value} sub={s.sub} tone={s.tone} loading={loading} linkTo={s.linkTo} />
            </div>
          ))}
        </div>
      </section>

      {/* Attention queue — puts review work above creation shortcuts. */}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <span className="admin-game-eyebrow">Needs attention</span>
            <h2 className="admin-game-display mt-1 text-[21px] sm:text-[24px]" style={{ color: '#0F1B2D' }}>
              Review queue
            </h2>
          </div>
        </div>
        {loading ? (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="admin-game-card-soft min-h-[92px] p-3">
                <Skeleton height={12} width="52%" />
                <div className="mt-3 space-y-2">
                  <Skeleton height={10} width="90%" />
                  <Skeleton height={10} width="42%" />
                </div>
              </div>
            ))}
          </div>
        ) : attentionItems.length === 0 ? (
          <div className="admin-game-card-soft flex items-center gap-3 p-4" style={{ background: '#E3F4EC' }}>
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border-2 text-sm font-black" style={{ borderColor: '#0F1B2D', color: '#047857', background: '#FFFFFF' }}>
              <span aria-hidden="true">✓</span>
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-black" style={{ color: '#0F1B2D' }}>All clear</p>
              <p className="mt-0.5 text-[11px] font-semibold leading-snug" style={{ color: '#4A5A6E' }}>
                No flagged or failed generations, pending approvals, payments, or low scores right now.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            {attentionItems.map(item => (
              <AttentionItem key={item.title} {...item} />
            ))}
          </div>
        )}
      </section>

      {/* Quick Actions — sticker cards with pastel mascot tiles and an
          orange "GO" pill, mirroring the SubjectTile from /games. */}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <span className="admin-game-eyebrow">Core workflows</span>
            <h2 className="admin-game-display mt-1 text-[21px] sm:text-[24px]" style={{ color: '#0F1B2D' }}>
              Quick actions
            </h2>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 stagger">
          {QUICK_ACTIONS.map((a, i) => (
            <Link
              key={a.to}
              to={a.to}
              className="admin-game-card is-pressable relative flex flex-col rounded-[22px] bg-white p-4 sm:p-5 no-underline animate-pop"
              style={{ animationDelay: `${i * 60}ms`, color: '#0F1B2D' }}
            >
              <span className="admin-game-pill-accent admin-game-pill absolute right-3 top-3">
                Go ›
              </span>
              <div className={`admin-game-tile ${a.tone} mb-3 h-14 w-14 text-[28px] leading-none`}>
                <span aria-hidden="true">{a.icon}</span>
              </div>
              <p className="admin-game-display text-[17px] leading-tight" style={{ color: '#0F1B2D' }}>
                {a.label}
              </p>
              <p className="mt-1 text-[11.5px] font-semibold" style={{ color: '#4A5A6E' }}>
                {a.sub}
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* Developer tools — collapsed by default so the seed + parent-digest
          test panels stay out of the way on every dashboard load. Wrapped in
          a sticker card to match the rest of the game theme. */}
      <details className="admin-game-card rounded-[22px] bg-white">
        <summary className="cursor-pointer select-none flex items-center justify-between gap-3 px-5 py-4">
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="text-lg">🛠️</span>
            <span className="admin-game-eyebrow">Developer tools</span>
          </span>
          <span className="text-[11px] font-semibold normal-case tracking-normal" style={{ color: '#4A5A6E' }}>
            Seed data &amp; digest tester
          </span>
        </summary>
        <div className="px-5 pb-5 pt-1 space-y-4">
          {/* Audit A3 PR 3 — admin-only on-demand parent digest tester. */}
          <ParentDigestTester />

          {/* Seed Data */}
          <div className="admin-game-card rounded-[18px] p-5" style={{ background: '#FFF7E6' }}>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1">
                <p className="admin-game-eyebrow">Seed</p>
                <h2 className="admin-game-display text-[18px] mt-1" style={{ color: '#0F1B2D' }}>Sample data</h2>
                <p className="mt-1 text-[12px] font-medium" style={{ color: '#4A5A6E' }}>
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
                  style={{ backgroundColor: '#FF7A1A', color: 'white' }}
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
            {seedMsg && (
              <p className="mt-3 text-[12px] font-bold rounded-xl px-4 py-2" style={{ background: '#FFEDD5', color: '#9A3412' }}>
                {seedMsg}
              </p>
            )}
          </div>
        </div>
      </details>

      {/* Recent Results — bordered sticker table mirroring the games hub
          aesthetic. */}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <span className="admin-game-eyebrow">Activity</span>
            <h2 className="admin-game-display mt-1 text-[22px] sm:text-[26px]" style={{ color: '#0F1B2D' }}>
              Recent results
            </h2>
          </div>
          <Link to="/admin/results" className="text-xs font-extrabold" style={{ color: '#053541' }}>
            All ›
          </Link>
        </div>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="admin-game-card rounded-[18px] p-4 bg-white">
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
          <div className="admin-game-card rounded-[22px] bg-white p-10">
            <EmptyState
              title="No results yet"
              description="Results will appear here once learners take quizzes."
            />
          </div>
        ) : (
          <div className="admin-game-card rounded-[22px] bg-white overflow-hidden">
            <div className="grid grid-cols-3 gap-3 px-4 py-3 text-[10.5px] font-extrabold uppercase tracking-[0.12em]" style={{ background: '#0F172A', color: '#FFFFFF' }}>
              <span>Learner</span>
              <span>Quiz</span>
              <span className="text-right">Score · Date</span>
            </div>
            <div>
              {recent.map((r, idx) => (
                <div
                  key={r.id}
                  className="grid grid-cols-3 gap-3 px-4 py-3 items-center"
                  style={{ borderTop: idx === 0 ? 'none' : '1.5px dashed #D8D0BC' }}
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-extrabold truncate" style={{ color: '#0F1B2D' }}>
                      {r.userName || 'Learner'}
                    </p>
                    <p className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: '#4A5A6E' }}>
                      Grade {r.grade}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold truncate" style={{ color: '#0F1B2D' }}>
                      {r.quizTitle}
                    </p>
                    <p className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: '#4A5A6E' }}>
                      {r.subject}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className="admin-game-display text-[18px] leading-none"
                      style={{ color: pctColor(r.percentage) === 'green' ? '#047857' : pctColor(r.percentage) === 'amber' ? '#C2410C' : '#B91C1C' }}
                    >
                      {r.percentage}%
                    </p>
                    <p className="mt-0.5 text-[10.5px] font-semibold" style={{ color: '#4A5A6E' }}>
                      {r.score}/{r.totalMarks} · {fmt(r.completedAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
