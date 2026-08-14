import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, limit as fsLimit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useFirestore } from '../../../hooks/useFirestore'
import { listDailyUsage } from '../../../utils/aiCosts'
import {
  computeTreasury,
  monthProgress,
  currentMonthKey,
  seedTreasuryInputs,
  fmtUsd,
  fmtZmw,
  fmtPct,
  fmtRatio,
  fmtRunway,
  DEFAULT_ZMW_PER_USD,
  DEFAULT_REINVEST_RATIO,
} from '../lib/treasury'
import {
  DEPARTMENTS,
  AGENTS,
  SPEND_LABEL,
  RUNS_VIA_LABEL,
  agentsByDept,
  getAgent,
  seedAgentActivity,
} from '../lib/companyOrg'
import {
  Bot,
  Sparkles,
  TrendingUp,
  CreditCard,
  Zap,
  ShieldCheck,
  Target,
  Clock,
  RefreshCw,
  AlertTriangle,
  CheckCircleIcon,
  Users,
} from '../../../shared/components/icons'

// ── tone lookups ───────────────────────────────────────────────────────────
const ACCENT = {
  emerald: { dot: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-800', bar: 'bg-emerald-500' },
  blue: { dot: 'bg-blue-500', chip: 'bg-blue-100 text-blue-800', bar: 'bg-blue-500' },
  amber: { dot: 'bg-amber-500', chip: 'bg-amber-100 text-amber-800', bar: 'bg-amber-500' },
  violet: { dot: 'bg-violet-500', chip: 'bg-violet-100 text-violet-800', bar: 'bg-violet-500' },
  rose: { dot: 'bg-rose-500', chip: 'bg-rose-100 text-rose-800', bar: 'bg-rose-500' },
  slate: { dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-700', bar: 'bg-slate-400' },
}

const STATUS_TONE = {
  healthy: { chip: 'bg-emerald-100 text-emerald-800', label: 'Self-funding', icon: CheckCircleIcon },
  tight: { chip: 'bg-amber-100 text-amber-800', label: 'Budget tight', icon: AlertTriangle },
  over: { chip: 'bg-rose-100 text-rose-800', label: 'Over budget — governor would pause', icon: AlertTriangle },
  bootstrapping: { chip: 'bg-blue-100 text-blue-800', label: 'Bootstrapping', icon: Zap },
  idle: { chip: 'bg-slate-100 text-slate-700', label: 'Idle', icon: Clock },
}

const JOB_TONE = {
  done: 'bg-emerald-100 text-emerald-700',
  awaiting_approval: 'bg-yellow-100 text-yellow-800',
  running: 'bg-blue-100 text-blue-700',
  queued: 'bg-gray-100 text-gray-600',
  failed: 'bg-rose-100 text-rose-700',
}

const SPEND_TONE = {
  slate: 'bg-slate-100 text-slate-600',
  emerald: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-800',
  rose: 'bg-rose-100 text-rose-700',
}

function relAt(date) {
  if (!date) return ''
  const ms = Date.now() - date.getTime()
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function jobLabel(job) {
  const i = job.input || {}
  if (i.brief) return String(i.brief).slice(0, 90)
  if (i.tool && i.topic) return `${i.tool} · ${i.topic}`
  if (i.runType) return String(i.runType).replace(/-/g, ' ')
  return job.agentId || 'job'
}

// ── small presentational pieces ────────────────────────────────────────────
function Kpi({ icon: IconCmp, label, value, sub, tone = 'theme-text' }) {
  return (
    <div className="theme-card theme-border rounded-2xl border p-4">
      <div className="flex items-center gap-2">
        {IconCmp && <IconCmp size={15} className="text-gray-400" />}
        <p className="text-[11px] font-black uppercase tracking-wide text-gray-500">{label}</p>
      </div>
      <p className={`mt-1 text-2xl font-black ${tone}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs theme-text-muted">{sub}</p>}
    </div>
  )
}

function SelfFundingBar({ treasury }) {
  const r = treasury.selfFundingRatio
  // Track maxes out at 5×; the 1× mark is break-even.
  const pct = r == null ? 100 : Math.max(2, Math.min(100, (Math.min(r, 5) / 5) * 100))
  const fill = treasury.sustainable ? 'bg-emerald-500' : 'bg-rose-500'
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-black uppercase tracking-wide text-gray-500">Self-funding ratio</p>
        <p className={`text-2xl font-black ${treasury.sustainable ? 'text-emerald-700' : 'text-rose-700'}`}>
          {fmtRatio(r)}
        </p>
      </div>
      <div className="relative mt-2 h-3 w-full rounded-full bg-slate-100">
        <div className={`h-3 rounded-full ${fill} transition-all`} style={{ width: `${pct}%` }} />
        {/* break-even marker at 1× = 20% of a 5× track */}
        <div className="absolute top-[-3px] bottom-[-3px] w-0.5 bg-slate-900/70" style={{ left: '20%' }} />
      </div>
      <p className="mt-1.5 text-xs theme-text-muted">
        {r == null
          ? 'No AI spend yet this month.'
          : treasury.sustainable
            ? `Revenue covers AI spend ${fmtRatio(r)} over. Break-even is the dark mark (1×).`
            : `Below break-even — AI spend outruns revenue (${fmtRatio(r)}).`}
      </p>
    </div>
  )
}

function ModeToggle({ mode, setMode, hasLive }) {
  return (
    <div className="inline-flex items-center rounded-xl border theme-border bg-white p-0.5 text-xs font-black">
      {['live', 'preview'].map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          className={`rounded-lg px-3 py-1.5 capitalize transition-colors ${
            mode === m ? 'bg-[#0F1B2D] text-white' : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          {m === 'live' && !hasLive ? 'live (no data)' : m}
        </button>
      ))}
    </div>
  )
}

// ── agent + department cards ────────────────────────────────────────────────
function AgentCard({ agent, paused, accent }) {
  const spend = SPEND_LABEL[agent.spend] || SPEND_LABEL.none
  return (
    <div className={`rounded-xl border p-3 ${paused ? 'border-yellow-300 bg-yellow-50' : 'theme-card theme-border'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-black theme-text">{agent.name}</p>
          <p className="truncate text-[11px] theme-text-muted">{agent.title}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${
          paused ? 'bg-yellow-200 text-yellow-900' : `${ACCENT[accent]?.chip || ACCENT.slate.chip}`
        }`}>
          {paused ? 'Paused' : 'Active'}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug theme-text-muted line-clamp-2">{agent.mission}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-black text-white">{agent.model}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
          {RUNS_VIA_LABEL[agent.runsVia] || agent.runsVia}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SPEND_TONE[spend.tone] || SPEND_TONE.slate}`}>
          {spend.label}
        </span>
      </div>
      <p className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
        <Clock size={11} /> {agent.cadence}
      </p>
    </div>
  )
}

function DepartmentSection({ dept, controlMap }) {
  const agents = agentsByDept(dept.id)
  const accent = ACCENT[dept.accent] || ACCENT.slate
  const activeCount = agents.filter((a) => !controlMap[a.id]?.paused).length
  return (
    <section className="theme-card theme-border rounded-2xl border p-4">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${accent.dot}`} />
          <div>
            <p className="text-sm font-black theme-text">{dept.name}</p>
            <p className="mt-0.5 max-w-md text-xs theme-text-muted">{dept.blurb}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-700">
          {activeCount}/{agents.length} active
        </span>
      </header>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((a) => (
          <AgentCard key={a.id} agent={a} accent={dept.accent} paused={Boolean(controlMap[a.id]?.paused)} />
        ))}
      </div>
    </section>
  )
}

function ActivityFeed({ items }) {
  if (!items.length) {
    return <p className="text-xs theme-text-muted">No recent agent activity.</p>
  }
  return (
    <ul className="space-y-2">
      {items.map((it) => {
        const agent = getAgent(it.agentId)
        return (
          <li key={it.id} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-[11px] font-black text-white">
              {(agent?.name || it.agentId || '?').slice(0, 2)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold theme-text">
                {agent?.name || it.agentId}
                <span className="theme-text-muted font-normal"> · {it.label}</span>
              </p>
              <p className="mt-0.5 flex items-center gap-2 text-[10px] theme-text-muted">
                <span className={`rounded-full px-1.5 py-0.5 font-black ${JOB_TONE[it.status] || JOB_TONE.queued}`}>
                  {String(it.status).replace(/_/g, ' ')}
                </span>
                <span className="inline-flex items-center gap-1"><Clock size={10} /> {relAt(it.at)}</span>
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// Preview-mode company-health snapshot (Marshal), so the strip renders even
// before the supervisor has run once.
const PREVIEW_HEALTH = {
  healthy: true,
  watchedCount: 7,
  summary: 'All 7 scheduled agents on time',
  lateAgents: [],
  neverRan: [],
  pendingAgents: [],
  pausedAgents: [],
  stuckCount: 0,
  recentFailureCount: 0,
}

function HealthStrip({ health }) {
  if (!health) {
    return (
      <div className="theme-card theme-border flex items-center gap-2 rounded-2xl border p-3 text-xs theme-text-muted">
        <ShieldCheck size={15} /> No supervisor run yet — Marshal posts a company-health check every hour.
      </div>
    )
  }
  const good = health.healthy
  const checked = health.checkedAt ? relAt(new Date(health.checkedAt)) : ''
  const chips = []
  if (health.lateAgents?.length) chips.push(`${health.lateAgents.length} late`)
  if (health.neverRan?.length) chips.push(`${health.neverRan.length} never ran`)
  if (health.pausedAgents?.length) chips.push(`${health.pausedAgents.length} paused`)
  if (health.stuckCount) chips.push(`${health.stuckCount} stuck`)
  if (health.recentFailureCount) chips.push(`${health.recentFailureCount} failed/24h`)
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 p-3 ${
      good ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'
    }`}>
      <div className="flex items-center gap-2.5">
        {good
          ? <CheckCircleIcon size={18} className="shrink-0 text-emerald-600" />
          : <AlertTriangle size={18} className="shrink-0 text-rose-600" />}
        <div className="min-w-0">
          <p className={`text-sm font-black ${good ? 'text-emerald-800' : 'text-rose-800'}`}>
            {good ? 'All systems go' : 'Attention needed'}
            <span className="theme-text-muted font-bold"> · Marshal supervisor</span>
          </p>
          <p className="text-xs theme-text-muted">{health.summary}{checked ? ` · checked ${checked}` : ''}</p>
        </div>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span key={c} className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-700">{c}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── the page ────────────────────────────────────────────────────────────────
export function CompanyHQ() {
  const { getRevenueByDay } = useFirestore()
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState({ revenueZmw: 0, apiCostUsd: 0, activations: 0, callCount: 0 })
  const [controlMap, setControlMap] = useState({})
  const [jobs, setJobs] = useState([])
  const [health, setHealth] = useState(null)
  const [fxMeta, setFxMeta] = useState(null)
  const [mode, setMode] = useState('live')
  const [fx, setFx] = useState(DEFAULT_ZMW_PER_USD)
  const [reinvest, setReinvest] = useState(DEFAULT_REINVEST_RATIO)

  // Live revenue (payments, MTD) + AI spend (aiUsage daily rollups, MTD).
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const now = new Date()
    const monthKey = currentMonthKey(now)
    Promise.all([
      getRevenueByDay(31).catch(() => []),
      listDailyUsage({ days: 31 }).catch(() => []),
    ]).then(([revRows, costRows]) => {
      if (cancelled) return
      const revenueZmw = revRows
        .filter((r) => r.date.getMonth() === now.getMonth() && r.date.getFullYear() === now.getFullYear())
        .reduce((s, r) => s + (r.revenue || 0), 0)
      const activations = revRows
        .filter((r) => r.date.getMonth() === now.getMonth() && r.date.getFullYear() === now.getFullYear())
        .reduce((s, r) => s + (r.activations || 0), 0)
      const monthCost = costRows.filter((r) => String(r.date).startsWith(monthKey))
      const apiCostUsd = monthCost.reduce((s, r) => s + (r.totalCostUsd || 0), 0)
      const callCount = monthCost.reduce((s, r) => s + (r.callCount || 0), 0)
      setLive({ revenueZmw, apiCostUsd, activations, callCount })
      // Auto-fall back to Preview when there's nothing live to show.
      if (revenueZmw <= 0 && apiCostUsd <= 0) setMode('preview')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [getRevenueByDay])

  // Live agent pause-state (agentControl) — reactive.
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'agentControl'),
      (snap) => {
        const map = {}
        snap.forEach((d) => { map[d.id] = d.data() || {} })
        setControlMap(map)
      },
      () => {},
    )
    return () => unsub()
  }, [])

  // Recent agentJobs for the activity feed.
  useEffect(() => {
    let cancelled = false
    getDocs(query(collection(db, 'agentJobs'), orderBy('createdAt', 'desc'), fsLimit(12)))
      .then((snap) => {
        if (cancelled) return
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((j) => j.seed !== true)
          .map((j) => ({
            id: j.id,
            agentId: j.agentId,
            status: j.status || 'queued',
            label: jobLabel(j),
            at: j.createdAt?.toDate ? j.createdAt.toDate() : (j.createdAt ? new Date(j.createdAt) : null),
          }))
        setJobs(rows)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Latest Marshal company-health rollup.
  useEffect(() => {
    let cancelled = false
    getDocs(query(
      collection(db, 'agentJobs'),
      where('agentId', '==', 'marshal'),
      orderBy('createdAt', 'desc'),
      fsLimit(1),
    ))
      .then((snap) => {
        if (cancelled || snap.empty) return
        const d = snap.docs[0].data() || {}
        const m = d.output?.marshal
        if (m) {
          const at = m.checkedAt || (d.createdAt?.toDate ? d.createdAt.toDate().getTime() : Date.now())
          setHealth({ ...m, checkedAt: at })
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Auto-refreshed FX rate (settings/fxRate, written daily by dailyFxRefresh).
  // Seeds the FX assumption with the live rate so the read-out tracks the real
  // kwacha; falls back to the default if no rate has been fetched yet.
  useEffect(() => {
    let cancelled = false
    getDoc(doc(db, 'settings', 'fxRate'))
      .then((snap) => {
        if (cancelled || !snap.exists()) return
        const d = snap.data() || {}
        const rate = Number(d.zmwPerUsd)
        if (Number.isFinite(rate) && rate >= 5 && rate <= 100) {
          setFx(rate)
          const at = Number.isFinite(Number(d.fetchedAtMs))
            ? Number(d.fetchedAtMs)
            : (d.fetchedAt?.toDate ? d.fetchedAt.toDate().getTime() : null)
          setFxMeta({ rate, at })
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const hasLive = live.revenueZmw > 0 || live.apiCostUsd > 0
  const preview = mode === 'preview'

  const inputs = useMemo(() => {
    const { daysElapsed, daysInMonth } = monthProgress()
    if (preview) {
      return { ...seedTreasuryInputs(), zmwPerUsd: fx, reinvestRatio: reinvest }
    }
    return {
      revenueZmw: live.revenueZmw,
      apiCostUsd: live.apiCostUsd,
      zmwPerUsd: fx,
      reinvestRatio: reinvest,
      daysElapsed,
      daysInMonth,
    }
  }, [preview, live, fx, reinvest])

  const t = useMemo(() => computeTreasury(inputs), [inputs])

  const feed = useMemo(() => {
    if (!preview && jobs.length) return jobs
    return seedAgentActivity()
  }, [preview, jobs])

  const displayHealth = preview ? { ...PREVIEW_HEALTH, checkedAt: Date.now() - 12 * 60_000 } : health

  const statusMeta = STATUS_TONE[t.status] || STATUS_TONE.idle
  const StatusIcon = statusMeta.icon

  const totalAgents = AGENTS.length
  const pausedCount = AGENTS.filter((a) => controlMap[a.id]?.paused).length

  return (
    <div className="space-y-6">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <header className="rounded-2xl border-2 p-5" style={{ background: '#0F1B2D', borderColor: '#0F1B2D', color: '#fff' }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl" style={{ background: '#D97757' }}>
              <Bot size={26} />
            </span>
            <div>
              <h1 className="text-xl font-black leading-tight">ZedExams AI Company</h1>
              <p className="mt-1 max-w-xl text-sm text-white/70">
                {totalAgents} AI agents across {DEPARTMENTS.length} departments build, check, sell and support
                CBC learning — and the company pays for its own API out of the subscriptions it earns.
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black ${statusMeta.chip}`}>
              <StatusIcon size={14} /> {statusMeta.label}
            </span>
            <ModeToggle mode={mode} setMode={setMode} hasLive={hasLive} />
          </div>
        </div>
      </header>

      {preview && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
          <Sparkles size={14} />
          {hasLive
            ? 'Preview mode — showing representative numbers. Switch to Live for this month’s real figures.'
            : 'No live revenue or AI spend recorded yet this month — showing a representative preview of how the treasury reads.'}
        </div>
      )}

      {/* ── Company health (Marshal) ─────────────────────────── */}
      <HealthStrip health={displayHealth} />

      {/* ── Treasury ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-emerald-600" />
          <h2 className="text-base font-black theme-text">Treasury — how it pays for its API</h2>
        </div>

        <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-900">
          <p className="font-bold">The self-funding rule</p>
          <p className="mt-1 leading-relaxed">
            Subscriptions (ZMW, via Lenco) are the company’s income. The agents’ main running cost is AI API spend
            (tracked in USD). The company may spend at most a <b>reinvestment fraction</b> of the revenue it has
            <b> actually earned</b> this month on model calls — so spend can never outrun income:
          </p>
          <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 font-mono text-[13px] text-emerald-800">
            AI budget = revenue&nbsp;×&nbsp;{fmtPct(t.reinvestRatio)} &nbsp;=&nbsp; {fmtUsd(t.revenueUsd)}&nbsp;×&nbsp;{fmtPct(t.reinvestRatio)} &nbsp;=&nbsp; <b>{fmtUsd(t.derivedBudgetUsd)}</b>
          </p>
          <p className="mt-2 text-xs text-emerald-700">
            The existing month-to-date budget gate already refuses AI calls once spend reaches the ceiling — wiring it
            to this revenue-linked number (instead of a fixed amount) makes the company self-fund automatically.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi icon={CreditCard} label="Revenue · MTD"
            value={fmtZmw(t.revenueZmw)}
            sub={`≈ ${fmtUsd(t.revenueUsd)} at ${fx} ZMW/USD`} tone="text-emerald-700" />
          <Kpi icon={Zap} label="AI spend · MTD"
            value={fmtUsd(t.apiCostUsd)}
            sub={`${fmtUsd(t.dailyBurnUsd)}/day · proj. ${fmtUsd(t.projectedMonthCostUsd)} by month-end`} tone="text-rose-700" />
          <Kpi icon={TrendingUp} label="Gross margin"
            value={fmtPct(t.grossMarginPct)}
            sub={`${fmtUsd(t.grossProfitUsd)} after AI cost`} />
          <Kpi icon={Target} label="Budget ceiling used"
            value={Number.isFinite(t.budgetUsedPct) ? fmtPct(t.budgetUsedPct) : '—'}
            sub={`${fmtUsd(t.budgetHeadroomUsd)} headroom · runway ${fmtRunway(t.runwayDays)}`}
            tone={t.overBudget ? 'text-rose-700' : t.status === 'tight' ? 'text-amber-700' : 'theme-text'} />
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <div className="theme-card theme-border rounded-2xl border p-4 lg:col-span-2">
            <SelfFundingBar treasury={t} />
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <dt className="font-black uppercase tracking-wide text-gray-500">Derived AI budget</dt>
                <dd className="mt-0.5 text-base font-black theme-text">{fmtUsd(t.derivedBudgetUsd)}</dd>
              </div>
              <div>
                <dt className="font-black uppercase tracking-wide text-gray-500">Spent so far</dt>
                <dd className="mt-0.5 text-base font-black theme-text">{fmtUsd(t.apiCostUsd)}</dd>
              </div>
              <div>
                <dt className="font-black uppercase tracking-wide text-gray-500">Proj. month-end budget</dt>
                <dd className="mt-0.5 text-base font-black theme-text">{fmtUsd(t.projectedBudgetUsd)}</dd>
              </div>
              <div>
                <dt className="font-black uppercase tracking-wide text-gray-500">Proj. month-end spend</dt>
                <dd className="mt-0.5 text-base font-black theme-text">{fmtUsd(t.projectedMonthCostUsd)}</dd>
              </div>
            </dl>
          </div>

          {/* Assumptions — interactive so the owner can stress-test the model */}
          <div className="theme-card theme-border rounded-2xl border p-4">
            <p className="text-[11px] font-black uppercase tracking-wide text-gray-500">Assumptions</p>
            <label className="mt-3 block text-xs font-bold theme-text">
              FX · ZMW per USD
              <input
                type="number" min="1" step="0.5" value={fx}
                onChange={(e) => setFx(Math.max(1, Number(e.target.value) || DEFAULT_ZMW_PER_USD))}
                className="mt-1 w-full rounded-lg border theme-border bg-white px-2 py-1.5 text-sm font-black"
              />
              <span className="mt-1 block text-[10px] font-normal theme-text-muted">
                {fxMeta
                  ? <>Auto-updated daily{fxMeta.at ? ` · ${relAt(new Date(fxMeta.at))}` : ''}</>
                  : 'Manual assumption (no auto-rate yet)'}
              </span>
            </label>
            <label className="mt-3 block text-xs font-bold theme-text">
              Reinvestment fraction
              <select
                value={reinvest}
                onChange={(e) => setReinvest(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border theme-border bg-white px-2 py-1.5 text-sm font-black"
              >
                <option value={0.2}>20% of revenue</option>
                <option value={0.3}>30% of revenue</option>
                <option value={0.4}>40% of revenue</option>
                <option value={0.5}>50% of revenue</option>
              </select>
            </label>
            <p className="mt-3 text-[11px] leading-snug theme-text-muted">
              The kwacha rate is an assumption, not a locked pair — it only puts ZMW revenue on the same axis as USD
              spend. {hasLive ? `This month: ${live.activations} activations, ${live.callCount.toLocaleString()} AI calls.` : ''}
            </p>
          </div>
        </div>
      </section>

      {/* ── Org chart ────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-blue-600" />
            <h2 className="text-base font-black theme-text">The company — {totalAgents} agents, {DEPARTMENTS.length} departments</h2>
          </div>
          <span className="text-xs theme-text-muted">
            {pausedCount > 0 ? `${pausedCount} paused` : 'all running'} · manage in{' '}
            <a href="/admin/agents" className="font-black text-blue-700 underline">AI agents</a>
          </span>
        </div>
        <div className="space-y-3">
          {DEPARTMENTS.map((dept) => (
            <DepartmentSection key={dept.id} dept={dept} controlMap={controlMap} />
          ))}
        </div>
      </section>

      {/* ── Activity ─────────────────────────────────────────── */}
      <section className="theme-card theme-border rounded-2xl border p-4">
        <header className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RefreshCw size={16} className="text-gray-400" />
            <h2 className="text-sm font-black theme-text">Recent activity</h2>
          </div>
          <span className="text-[10px] theme-text-muted">
            {preview || !jobs.length ? 'preview' : `last ${jobs.length} jobs`}
          </span>
        </header>
        {loading ? <p className="text-xs theme-text-muted">Loading…</p> : <ActivityFeed items={feed} />}
      </section>

      <p className="pb-2 text-center text-[11px] theme-text-muted">
        Operating model: <a href="https://github.com/Mwelwa-cyber/Zedexams/blob/main/ORG.md" className="underline">ORG.md</a>
        {' · '}Cost detail in <a href="/admin/ai-costs" className="underline">AI costs</a>
        {' · '}Revenue in <a href="/admin/payments" className="underline">Payments</a>
      </p>
    </div>
  )
}

export default CompanyHQ
