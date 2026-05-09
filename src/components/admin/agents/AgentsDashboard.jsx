/**
 * AgentsDashboard — dark-themed control panel for /admin/agents.
 *
 * Single Firestore subscription on the most recent 200 agentJobs powers
 * 6 of the 7 widgets (stats row, pipeline flow, activity feed, agents
 * table, workload donut, recent published grid). The scheduled-jobs
 * panel is fully static (cron declarations live in functions/index.js).
 *
 * Dark theme is scoped to this component via explicit Tailwind slate
 * utilities — the rest of the admin chrome stays light.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  collection, limit as fsLimit, onSnapshot, orderBy, query,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { AGENTS, AGENTS_BY_ID } from '../../../config/agents'
import SeoHelmet from '../../seo/SeoHelmet'

const JOBS_WINDOW = 200

// Pipeline ordering for content jobs. Aria → Cala → Reva → Pubo.
const CONTENT_PHASES = [
  { id: 'aria',  label: 'Drafting',     emoji: 'A' },
  { id: 'cala',  label: 'CBC check',    emoji: 'C' },
  { id: 'reva',  label: 'Review',       emoji: 'R' },
  { id: 'pubo',  label: 'Publishing',   emoji: 'P' },
]

const SCHEDULED_JOBS = [
  {
    id: 'nightlyQaSmoke',
    label: 'Nightly QA smoke',
    schedule: 'Every day 02:00',
    timezone: 'Africa/Lusaka',
    agent: 'quill',
  },
  {
    id: 'weeklyCbcAlignmentAudit',
    label: 'Weekly CBC audit',
    schedule: 'Every Sunday 03:00',
    timezone: 'Africa/Lusaka',
    agent: 'cala',
  },
]

const STATUS_COLORS = {
  queued:             'bg-slate-700 text-slate-300',
  running:            'bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/40',
  awaiting_approval:  'bg-yellow-500/20 text-yellow-300 ring-1 ring-yellow-500/40',
  approved:           'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40',
  rejected:           'bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/40',
  done:               'bg-emerald-600/30 text-emerald-200 ring-1 ring-emerald-500/40',
  failed:             'bg-red-500/20 text-red-300 ring-1 ring-red-500/40',
}

const STATUS_LABEL = {
  queued: 'Queued',
  running: 'Running',
  awaiting_approval: 'Awaiting',
  approved: 'Approved',
  rejected: 'Rejected',
  done: 'Done',
  failed: 'Failed',
}

const AGENT_DOT = {
  aria:   '#f97316',
  cala:   '#22d3ee',
  reva:   '#a855f7',
  pubo:   '#10b981',
  quill:  '#facc15',
  rex:    '#ec4899',
  ledger: '#60a5fa',
}

function fmtRel(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`
  return `${Math.round(diffSec / 86400)}d ago`
}

function fmtAbs(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// ── widgets ──────────────────────────────────────────────────────────

function StatTile({ label, value, hint, accent }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-700/50 bg-slate-800/40 p-3 sm:rounded-2xl sm:p-4 shadow-lg shadow-slate-950/30">
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 truncate">{label}</p>
      <p className={`mt-1 text-xl sm:text-2xl font-black truncate ${accent || 'text-slate-100'}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-slate-500 truncate">{hint}</p>}
    </div>
  )
}

function StatsRow({ jobs }) {
  const stats = useMemo(() => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const dayAgo = Date.now() - 24 * 3600 * 1000

    let jobsToday = 0
    let queuedRunning = 0
    let awaiting = 0
    let done = 0
    let failed = 0
    let recentFailed = 0
    jobs.forEach(j => {
      const at = j.createdAt?.toDate?.() || (j.createdAt ? new Date(j.createdAt) : null)
      if (at && at.getTime() >= todayStart.getTime()) jobsToday += 1
      if (j.status === 'queued' || j.status === 'running') queuedRunning += 1
      if (j.status === 'awaiting_approval') awaiting += 1
      if (j.status === 'done') done += 1
      if (j.status === 'failed') {
        failed += 1
        if (at && at.getTime() >= dayAgo) recentFailed += 1
      }
    })
    const successDenom = done + failed
    const successPct = successDenom > 0 ? Math.round((done / successDenom) * 100) : null
    return { jobsToday, queuedRunning, awaiting, successPct, recentFailed }
  }, [jobs])

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <StatTile label="Agents" value={AGENTS.length} hint="Content + QA / Eng" />
      <StatTile label="Jobs today" value={stats.jobsToday} hint={`${jobs.length} in window`} />
      <StatTile
        label="Active"
        value={stats.queuedRunning}
        hint="Queued + running"
        accent={stats.queuedRunning > 0 ? 'text-blue-300' : 'text-slate-100'}
      />
      <StatTile
        label="Awaiting approval"
        value={stats.awaiting}
        hint="Needs human"
        accent={stats.awaiting > 0 ? 'text-yellow-300' : 'text-slate-100'}
      />
      <StatTile
        label="Success rate"
        value={stats.successPct == null ? '—' : `${stats.successPct}%`}
        hint="Done ÷ (done + failed)"
        accent="text-emerald-300"
      />
      <StatTile
        label="Failed (24h)"
        value={stats.recentFailed}
        hint="Recent failures"
        accent={stats.recentFailed > 0 ? 'text-rose-300' : 'text-slate-100'}
      />
    </div>
  )
}

function PipelineFlow({ jobs }) {
  // Active jobs (queued + running) grouped by current agentId.
  const counts = useMemo(() => {
    const out = {}
    jobs.forEach(j => {
      if (j.status === 'queued' || j.status === 'running') {
        out[j.agentId] = (out[j.agentId] || 0) + 1
      }
    })
    return out
  }, [jobs])

  return (
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-4 sm:p-5 shadow-lg shadow-slate-950/30">
      <header className="mb-3 sm:mb-4 flex items-baseline justify-between">
        <p className="text-sm font-black text-slate-100">Agent pipeline</p>
        <span className="text-[10px] uppercase tracking-wider text-slate-400">live</span>
      </header>
      <ol className="grid grid-cols-4 gap-1.5 sm:flex sm:items-center sm:gap-2 sm:overflow-x-auto sm:pb-1">
        {CONTENT_PHASES.map((phase, i) => {
          const n = counts[phase.id] || 0
          const dot = AGENT_DOT[phase.id]
          const active = n > 0
          return (
            <li key={phase.id} className="flex items-center gap-1.5 sm:gap-2">
              <Link
                to={`/admin/agents/${phase.id}`}
                className={`flex w-full sm:min-w-[140px] flex-col items-center rounded-xl border px-1.5 py-2 sm:px-3 sm:py-3 text-center no-underline transition-all ${
                  active
                    ? 'border-slate-500 bg-slate-700/40 shadow-lg shadow-slate-950/40'
                    : 'border-slate-700 bg-slate-800/30 hover:bg-slate-700/30'
                }`}
              >
                <span
                  className={`flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full text-[10px] sm:text-xs font-black text-slate-900 ${
                    active ? 'animate-pulse' : ''
                  }`}
                  style={{ backgroundColor: dot }}
                >
                  {phase.emoji}
                </span>
                <p className="mt-1 sm:mt-1.5 text-[10px] sm:text-[11px] font-black text-slate-200 leading-tight">
                  {phase.label}
                </p>
                <p className={`text-[10px] ${active ? 'text-slate-200' : 'text-slate-500'}`}>
                  {n} active
                </p>
              </Link>
              {i < CONTENT_PHASES.length - 1 && (
                <span className="hidden sm:inline text-slate-600" aria-hidden>→</span>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function ActivityFeed({ jobs }) {
  const recent = jobs.slice(0, 12)
  return (
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-4 sm:p-5 shadow-lg shadow-slate-950/30">
      <header className="mb-3 flex items-baseline justify-between">
        <p className="text-sm font-black text-slate-100">Activity</p>
        <span className="text-[10px] uppercase tracking-wider text-slate-400">live</span>
      </header>
      {recent.length === 0 ? (
        <p className="text-xs text-slate-400">No activity yet.</p>
      ) : (
        <ol className="space-y-2">
          {recent.map(j => {
            const agent = AGENTS_BY_ID[j.agentId]
            const dot = AGENT_DOT[j.agentId] || '#94a3b8'
            return (
              <li key={j.id}>
                <Link
                  to={`/admin/agents/jobs/${j.id}`}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 no-underline transition-colors hover:bg-slate-700/40"
                >
                  <span className="h-6 w-6 flex-shrink-0 rounded-full text-[10px] font-black text-slate-900 grid place-items-center" style={{ backgroundColor: dot }}>
                    {(agent?.name || j.agentId || '?')[0].toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-black text-slate-100">
                      {agent?.name || j.agentId} · <span className="font-bold text-slate-400">{STATUS_LABEL[j.status] || j.status}</span>
                    </p>
                    <p className="truncate text-[10px] text-slate-500">
                      {j.input?.topic || j.input?.runType || 'job ' + j.id.slice(0, 6)}
                    </p>
                  </div>
                  <span className="text-[10px] text-slate-500">{fmtRel(j.createdAt)}</span>
                </Link>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function AgentsTable({ jobs }) {
  // Per-agent aggregates over the window.
  const stats = useMemo(() => {
    const out = {}
    jobs.forEach(j => {
      const id = j.agentId
      if (!out[id]) out[id] = { total: 0, done: 0, failed: 0, last: null }
      out[id].total += 1
      if (j.status === 'done') out[id].done += 1
      if (j.status === 'failed') out[id].failed += 1
      const at = j.createdAt?.toDate?.() || (j.createdAt ? new Date(j.createdAt) : null)
      if (at && (!out[id].last || at > out[id].last)) out[id].last = at
    })
    return out
  }, [jobs])

  return (
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-4 sm:p-5 shadow-lg shadow-slate-950/30">
      <header className="mb-3 flex items-baseline justify-between">
        <p className="text-sm font-black text-slate-100">All AI agents</p>
        <span className="text-[10px] uppercase tracking-wider text-slate-400">{AGENTS.length} agents</span>
      </header>

      {/* Mobile: card list. Reads cleanly on a phone instead of a 5-col
          horizontal-scroll table. */}
      <ul className="space-y-2 md:hidden">
        {AGENTS.map(a => {
          const s = stats[a.id] || { total: 0, done: 0, failed: 0, last: null }
          const successDenom = s.done + s.failed
          const successPct = successDenom > 0 ? Math.round((s.done / successDenom) * 100) : null
          const dot = AGENT_DOT[a.id] || '#94a3b8'
          return (
            <li key={a.id}>
              <Link
                to={`/admin/agents/${a.id}`}
                className="flex items-center gap-2 rounded-xl border border-slate-700/50 bg-slate-800/30 p-2.5 no-underline transition-colors hover:bg-slate-700/30"
              >
                <span className="h-8 w-8 flex-shrink-0 rounded-full text-[11px] font-black text-slate-900 grid place-items-center" style={{ backgroundColor: dot }}>
                  {a.name[0]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-black text-slate-100">
                    {a.name} <span className="font-bold text-slate-400">· {a.role}</span>
                  </p>
                  <p className="truncate text-[10px] text-slate-500">
                    {a.department === 'qaEng' ? 'QA / Eng' : 'Content'} ·
                    {' '}{s.total} jobs ·
                    {' '}{s.last ? fmtRel(s.last) : 'no runs'}
                  </p>
                </div>
                {successPct != null && (
                  <span className={`flex-shrink-0 text-xs font-black ${
                    successPct >= 80 ? 'text-emerald-300' :
                    successPct >= 50 ? 'text-yellow-300' :
                    'text-rose-300'
                  }`}>
                    {successPct}%
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>

      {/* Desktop / tablet: full table. */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
              <th className="pb-2 pr-3 font-black">Agent</th>
              <th className="pb-2 pr-3 font-black">Dept</th>
              <th className="pb-2 pr-3 font-black text-right">Jobs</th>
              <th className="pb-2 pr-3 font-black text-right">Success</th>
              <th className="pb-2 pr-3 font-black">Last run</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {AGENTS.map(a => {
              const s = stats[a.id] || { total: 0, done: 0, failed: 0, last: null }
              const successDenom = s.done + s.failed
              const successPct = successDenom > 0 ? Math.round((s.done / successDenom) * 100) : null
              const dot = AGENT_DOT[a.id] || '#94a3b8'
              return (
                <tr key={a.id} className="text-slate-200">
                  <td className="py-2 pr-3">
                    <Link to={`/admin/agents/${a.id}`} className="flex items-center gap-2 no-underline">
                      <span className="h-6 w-6 flex-shrink-0 rounded-full text-[10px] font-black text-slate-900 grid place-items-center" style={{ backgroundColor: dot }}>
                        {a.name[0]}
                      </span>
                      <span className="font-black text-slate-100">{a.name}</span>
                      <span className="text-slate-400">{a.role}</span>
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-slate-400">{a.department === 'qaEng' ? 'QA / Eng' : 'Content'}</td>
                  <td className="py-2 pr-3 text-right font-bold">{s.total}</td>
                  <td className="py-2 pr-3 text-right font-bold">
                    {successPct == null ? <span className="text-slate-500">—</span> :
                      <span className={successPct >= 80 ? 'text-emerald-300' : successPct >= 50 ? 'text-yellow-300' : 'text-rose-300'}>{successPct}%</span>}
                  </td>
                  <td className="py-2 pr-3 text-slate-400">{s.last ? fmtAbs(s.last) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function WorkloadDonut({ jobs }) {
  // Distribution over the last 7 days, by agentId.
  const data = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000
    const counts = {}
    jobs.forEach(j => {
      const at = j.createdAt?.toDate?.()?.getTime() || 0
      if (at >= cutoff) counts[j.agentId] = (counts[j.agentId] || 0) + 1
    })
    const total = Object.values(counts).reduce((s, v) => s + v, 0)
    return { counts, total }
  }, [jobs])

  // Build the SVG donut: cumulative arc segments per agent.
  const segments = []
  let acc = 0
  AGENTS.forEach(a => {
    const n = data.counts[a.id] || 0
    if (n === 0 || data.total === 0) return
    const start = acc / data.total
    const end = (acc + n) / data.total
    acc += n
    segments.push({ id: a.id, name: a.name, n, start, end, color: AGENT_DOT[a.id] || '#94a3b8' })
  })

  function arcPath(start, end) {
    // Donut radius 38, centered at 50,50. Inner radius 26.
    const a0 = start * 2 * Math.PI - Math.PI / 2
    const a1 = end * 2 * Math.PI - Math.PI / 2
    const large = end - start > 0.5 ? 1 : 0
    const x0 = 50 + 38 * Math.cos(a0)
    const y0 = 50 + 38 * Math.sin(a0)
    const x1 = 50 + 38 * Math.cos(a1)
    const y1 = 50 + 38 * Math.sin(a1)
    const ix0 = 50 + 26 * Math.cos(a1)
    const iy0 = 50 + 26 * Math.sin(a1)
    const ix1 = 50 + 26 * Math.cos(a0)
    const iy1 = 50 + 26 * Math.sin(a0)
    return `M ${x0} ${y0} A 38 38 0 ${large} 1 ${x1} ${y1} L ${ix0} ${iy0} A 26 26 0 ${large} 0 ${ix1} ${iy1} Z`
  }

  return (
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-4 sm:p-5 shadow-lg shadow-slate-950/30">
      <header className="mb-3 flex items-baseline justify-between">
        <p className="text-sm font-black text-slate-100">Workload</p>
        <span className="text-[10px] uppercase tracking-wider text-slate-400">7d</span>
      </header>
      {data.total === 0 ? (
        <p className="text-xs text-slate-400">No jobs in the last 7 days.</p>
      ) : (
        <div className="flex items-center gap-4">
          <svg viewBox="0 0 100 100" className="h-28 w-28 flex-shrink-0">
            {segments.length === 1 ? (
              <>
                <circle cx="50" cy="50" r="38" fill={segments[0].color} />
                <circle cx="50" cy="50" r="26" fill="#1e293b" />
              </>
            ) : (
              segments.map(s => <path key={s.id} d={arcPath(s.start, s.end)} fill={s.color} />)
            )}
            <text x="50" y="48" textAnchor="middle" className="fill-slate-100 text-[14px] font-black">
              {data.total}
            </text>
            <text x="50" y="62" textAnchor="middle" className="fill-slate-400 text-[7px]">
              jobs
            </text>
          </svg>
          <ul className="flex-1 space-y-1 text-[11px]">
            {segments.map(s => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="font-black text-slate-200">{s.name}</span>
                <span className="ml-auto font-bold text-slate-400">{s.n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function ScheduledJobs() {
  return (
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-4 sm:p-5 shadow-lg shadow-slate-950/30">
      <header className="mb-3 flex items-baseline justify-between">
        <p className="text-sm font-black text-slate-100">Scheduled jobs</p>
        <span className="text-[10px] uppercase tracking-wider text-slate-400">cron</span>
      </header>
      <ul className="space-y-2">
        {SCHEDULED_JOBS.map(s => {
          const agent = AGENTS_BY_ID[s.agent]
          const dot = AGENT_DOT[s.agent] || '#94a3b8'
          return (
            <li key={s.id} className="flex items-center gap-3 rounded-lg bg-slate-700/30 px-3 py-2">
              <span className="h-7 w-7 flex-shrink-0 rounded-lg text-[10px] font-black text-slate-900 grid place-items-center" style={{ backgroundColor: dot }}>
                {(agent?.name || '?')[0]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-black text-slate-100">{s.label}</p>
                <p className="truncate text-[10px] text-slate-400">{s.schedule} · {s.timezone}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function RecentPublishedGrid({ jobs }) {
  const completed = jobs.filter(j => j.status === 'done').slice(0, 8)
  return (
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-4 sm:p-5 shadow-lg shadow-slate-950/30">
      <header className="mb-3 flex items-baseline justify-between">
        <p className="text-sm font-black text-slate-100">Recent completed jobs</p>
        <Link to="/admin/agents/jobs" className="text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-slate-200">
          view all →
        </Link>
      </header>
      {completed.length === 0 ? (
        <p className="text-xs text-slate-400">No completed jobs yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {completed.map(j => {
            const agent = AGENTS_BY_ID[j.agentId]
            const dot = AGENT_DOT[j.agentId] || '#94a3b8'
            return (
              <Link
                key={j.id}
                to={`/admin/agents/jobs/${j.id}`}
                className="block rounded-xl border border-slate-700 bg-slate-800/30 p-3 no-underline transition-colors hover:bg-slate-700/30"
              >
                <div className="flex items-start gap-2">
                  <span className="h-6 w-6 flex-shrink-0 rounded-full text-[10px] font-black text-slate-900 grid place-items-center" style={{ backgroundColor: dot }}>
                    {(agent?.name || j.agentId || '?')[0].toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-black text-slate-100">
                      {j.input?.topic || j.input?.runType || 'job'}
                    </p>
                    <p className="truncate text-[10px] text-slate-400">
                      {j.input?.tool?.replace(/_/g, ' ') || j.input?.runType || agent?.role || ''}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px]">
                  <span className={`px-1.5 py-0.5 rounded-full font-black ${STATUS_COLORS[j.status] || 'bg-slate-700 text-slate-300'}`}>
                    {STATUS_LABEL[j.status] || j.status}
                  </span>
                  <span className="text-slate-500">{fmtRel(j.createdAt)}</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ── shell ────────────────────────────────────────────────────────────

export default function AgentsDashboard() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    const q = query(
      collection(db, 'agentJobs'),
      orderBy('createdAt', 'desc'),
      fsLimit(JOBS_WINDOW),
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        setJobs(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setLoading(false)
        setError(null)
      },
      (err) => { setError(err); setLoading(false) },
    )
    return () => unsub()
  }, [])

  return (
    <div className="rounded-2xl bg-slate-900 p-3 sm:p-5 text-slate-100 shadow-2xl overflow-hidden">
      <SeoHelmet title="AI Agents Dashboard" noIndex />

      <header className="mb-4 sm:mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">ZedExams</p>
          <h1 className="text-xl sm:text-2xl font-black text-slate-50">AI Agents Dashboard</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Monitor, manage, and inspect every agent powering ZedExams.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-500/30">
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            System nominal
          </span>
          <Link
            to="/admin/agents/jobs"
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-black text-slate-200 no-underline hover:bg-slate-700"
          >
            All jobs
          </Link>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          <p className="font-black">Couldn't load agentJobs.</p>
          <p className="mt-1 text-xs">{error.message}</p>
        </div>
      )}

      {loading && jobs.length === 0 ? (
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-8 text-center text-sm text-slate-400">
          Loading dashboard…
        </div>
      ) : (
        <div className="space-y-4">
          {/* Stats row */}
          <StatsRow jobs={jobs} />

          {/* Pipeline + activity */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2"><PipelineFlow jobs={jobs} /></div>
            <ActivityFeed jobs={jobs} />
          </div>

          {/* Agents table + workload + scheduled */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2"><AgentsTable jobs={jobs} /></div>
            <div className="space-y-4">
              <WorkloadDonut jobs={jobs} />
              <ScheduledJobs />
            </div>
          </div>

          {/* Recent published grid */}
          <RecentPublishedGrid jobs={jobs} />
        </div>
      )}
    </div>
  )
}
