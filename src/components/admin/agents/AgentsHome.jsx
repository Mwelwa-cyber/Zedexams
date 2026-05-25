import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  collection, doc, getDocs, limit as fsLimit, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, where,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import SeoHelmet from '../../seo/SeoHelmet'
import { AGENTS_BY_ID, DEPARTMENTS } from '../../../config/agents'
import AgentJobsQueue from './AgentJobsQueue'
import AgentRunHistory from './AgentRunHistory'
import AgentsDashboard from './AgentsDashboard'

function AgentCostMeter({ agentId }) {
  // Aggregate over the most recent 50 jobs for this agent. For agents that
  // produce aiGenerations (Aria via runX runners), join via
  // publishedRefs[0].docId to pull tokensIn/tokensOut/costUsdCents. Other
  // agents (Cala, Reva, Quill) typically have no aiGenerations doc; we
  // fall back to a job count + a note.
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!agentId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const jobsSnap = await getDocs(query(
          collection(db, 'agentJobs'),
          where('agentId', '==', agentId),
          orderBy('createdAt', 'desc'),
          fsLimit(50),
        ))
        const jobs = jobsSnap.docs.map(d => ({ id: d.id, ...d.data() }))

        // De-dupe + bound aiGenerations reads at one per job (≤50 total).
        const genIds = [...new Set(
          jobs
            .map(j => j.publishedRefs?.[0]?.docId)
            .filter(Boolean),
        )]
        const genSnaps = await Promise.all(
          genIds.map(id => getDocs(query(
            collection(db, 'aiGenerations'),
            where('__name__', '==', id),
            fsLimit(1),
          )).catch(() => null)),
        )
        const gens = {}
        genSnaps.forEach((snap, i) => {
          if (snap && !snap.empty) gens[genIds[i]] = snap.docs[0].data()
        })

        const counts = { done: 0, failed: 0, awaiting_approval: 0, other: 0 }
        let totalCostCents = 0
        let totalTokensIn  = 0
        let totalTokensOut = 0
        let lastRun = null
        jobs.forEach(j => {
          if (counts[j.status] !== undefined) counts[j.status] += 1
          else counts.other += 1
          if (!lastRun || (j.createdAt && j.createdAt.seconds > (lastRun.seconds || 0))) {
            lastRun = j.createdAt
          }
          const genId = j.publishedRefs?.[0]?.docId
          const gen = genId && gens[genId]
          if (gen) {
            totalCostCents += Number(gen.costUsdCents || 0)
            totalTokensIn  += Number(gen.tokensIn || 0)
            totalTokensOut += Number(gen.tokensOut || 0)
          }
        })

        if (cancelled) return
        setStats({
          counts,
          totalCostCents,
          totalTokensIn,
          totalTokensOut,
          totalJobs: jobs.length,
          jobsWithCost: genIds.length,
          lastRun,
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [agentId])

  if (loading || !stats) {
    return (
      <section className="theme-card theme-border rounded-2xl border p-4">
        <p className="text-sm font-black theme-text">Activity & cost</p>
        <p className="text-xs theme-text-muted mt-0.5">Loading…</p>
      </section>
    )
  }

  if (stats.totalJobs === 0) {
    return (
      <section className="theme-card theme-border rounded-2xl border p-4">
        <p className="text-sm font-black theme-text">Activity & cost</p>
        <p className="text-xs theme-text-muted mt-0.5">
          No runs yet. Stats land here once this agent runs.
        </p>
      </section>
    )
  }

  const dollars = (stats.totalCostCents / 100).toFixed(2)
  const lastRunFmt = stats.lastRun
    ? (stats.lastRun.toDate
        ? stats.lastRun.toDate()
        : new Date(stats.lastRun)
      ).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      })
    : '—'

  return (
    <section className="theme-card theme-border rounded-2xl border p-4">
      <header className="flex items-baseline justify-between mb-3">
        <p className="text-sm font-black theme-text">Activity & cost</p>
        <span className="text-[10px] theme-text-muted">last 50 runs</span>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
        <div>
          <dt className="font-black uppercase tracking-wide text-gray-500">Runs</dt>
          <dd className="theme-text mt-0.5 text-lg font-black">{stats.totalJobs}</dd>
        </div>
        <div>
          <dt className="font-black uppercase tracking-wide text-gray-500">Cost</dt>
          <dd className="theme-text mt-0.5 text-lg font-black">
            {stats.jobsWithCost > 0 ? `$${dollars}` : '—'}
          </dd>
          {stats.jobsWithCost > 0 && (
            <p className="theme-text-muted text-[10px] mt-0.5">
              from {stats.jobsWithCost} aiGenerations
            </p>
          )}
        </div>
        <div>
          <dt className="font-black uppercase tracking-wide text-gray-500">Tokens in</dt>
          <dd className="theme-text mt-0.5 font-bold">{stats.totalTokensIn.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="font-black uppercase tracking-wide text-gray-500">Tokens out</dt>
          <dd className="theme-text mt-0.5 font-bold">{stats.totalTokensOut.toLocaleString()}</dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {stats.counts.done > 0 && (
          <span className="bg-green-100 text-green-700 text-[10px] font-black px-2 py-0.5 rounded-full">
            {stats.counts.done} done
          </span>
        )}
        {stats.counts.failed > 0 && (
          <span className="bg-red-100 text-red-700 text-[10px] font-black px-2 py-0.5 rounded-full">
            {stats.counts.failed} failed
          </span>
        )}
        {stats.counts.awaiting_approval > 0 && (
          <span className="bg-yellow-100 text-yellow-700 text-[10px] font-black px-2 py-0.5 rounded-full">
            {stats.counts.awaiting_approval} awaiting approval
          </span>
        )}
        {stats.counts.other > 0 && (
          <span className="bg-gray-100 text-gray-600 text-[10px] font-black px-2 py-0.5 rounded-full">
            {stats.counts.other} other
          </span>
        )}
      </div>

      <p className="theme-text-muted text-[10px] mt-3">
        Last run {lastRunFmt}
        {stats.jobsWithCost === 0 && stats.totalJobs > 0 && (
          <> · cost only surfaces for agents that produce aiGenerations (Aria)</>
        )}
      </p>
    </section>
  )
}

function AgentControlToggle({ agentId }) {
  const { currentUser } = useAuth()
  const [control, setControl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  const [errMsg, setErrMsg]   = useState(null)

  useEffect(() => {
    if (!agentId) return
    const ref = doc(db, `agentControl/${agentId}`)
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setControl(snap.exists() ? snap.data() : { paused: false })
        setLoading(false)
      },
      () => setLoading(false),
    )
    return () => unsub()
  }, [agentId])

  async function setPaused(next) {
    setBusy(true)
    setErrMsg(null)
    try {
      await setDoc(doc(db, `agentControl/${agentId}`), {
        paused: next,
        updatedBy: currentUser?.uid || null,
        updatedAt: serverTimestamp(),
      }, { merge: true })
    } catch (e) {
      setErrMsg(e.message || 'Update failed.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return null

  const paused = Boolean(control?.paused)
  return (
    <section className={`rounded-2xl border p-4 ${
      paused ? 'border-yellow-200 bg-yellow-50' : 'theme-card theme-border'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-sm font-black ${paused ? 'text-yellow-800' : 'theme-text'}`}>
            {paused ? 'Paused' : 'Running'}
          </p>
          <p className="text-xs theme-text-muted mt-0.5">
            {paused
              ? 'The dispatcher refuses new work for this agent. Existing in-flight jobs continue.'
              : 'The dispatcher will route new agentJobs to this agent normally.'}
          </p>
          {control?.updatedAt && (
            <p className="text-[10px] theme-text-muted mt-1">
              Last changed {(control.updatedAt.toDate
                ? control.updatedAt.toDate()
                : new Date(control.updatedAt)
              ).toLocaleString('en-GB', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
              })}
              {control.updatedBy && <> · by {control.updatedBy.slice(0, 8)}</>}
            </p>
          )}
        </div>
        <button
          onClick={() => setPaused(!paused)}
          disabled={busy}
          className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-black transition-colors ${
            paused
              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
              : 'bg-gray-200 text-gray-700 hover:bg-yellow-100 hover:text-yellow-800'
          } disabled:opacity-50`}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>
      {errMsg && <p className="text-xs text-red-700 mt-2">{errMsg}</p>}
    </section>
  )
}

export function AgentsHome() {
  return <AgentsDashboard />
}

// Status filter chips for the All Agent Jobs page. Each chip passes the
// selected status through to AgentJobsQueue's statusFilter prop, which
// adds a Firestore where() clause. 'All' clears the filter.
const JOBS_STATUS_CHIPS = [
  { id: null,                 label: 'All',                 tone: 'slate' },
  { id: 'awaiting_approval',  label: '⏳ Awaiting approval', tone: 'yellow' },
  { id: 'failed',             label: '⚠ Failed',            tone: 'rose' },
  { id: 'running',            label: '▶ Running',           tone: 'blue' },
  { id: 'queued',             label: '· Queued',            tone: 'gray' },
  { id: 'done',               label: '✓ Done',              tone: 'green' },
]

const CHIP_TONES = {
  slate:  { active: 'bg-slate-900 text-white',         idle: 'theme-card theme-border theme-text' },
  yellow: { active: 'bg-yellow-500 text-white',        idle: 'theme-card theme-border text-yellow-700' },
  rose:   { active: 'bg-rose-600 text-white',          idle: 'theme-card theme-border text-rose-700' },
  blue:   { active: 'bg-blue-600 text-white',          idle: 'theme-card theme-border text-blue-700' },
  gray:   { active: 'bg-gray-700 text-white',          idle: 'theme-card theme-border theme-text-muted' },
  green:  { active: 'bg-emerald-600 text-white',       idle: 'theme-card theme-border text-emerald-700' },
}

export function AgentsAllJobs() {
  const [statusFilter, setStatusFilter] = useState(null)
  return (
    <div className="space-y-5">
      <SeoHelmet title="Agent jobs" noIndex />
      <header>
        <Link to="/admin/agents" className="text-xs theme-text-muted hover:underline">
          ← Back to agents
        </Link>
        <h1 className="mt-1 text-2xl font-black text-gray-800">All agent jobs</h1>
        <p className="mt-1 text-xs theme-text-muted">
          Showing the 100 most recent jobs that match the filter. Click a chip to narrow by status.
        </p>
      </header>
      <div className="flex flex-wrap gap-2">
        {JOBS_STATUS_CHIPS.map(chip => {
          const active = statusFilter === chip.id
          const tone = CHIP_TONES[chip.tone] || CHIP_TONES.slate
          return (
            <button
              key={chip.id || 'all'}
              type="button"
              onClick={() => setStatusFilter(chip.id)}
              aria-pressed={active}
              className={`rounded-full px-3 py-1.5 text-xs font-black transition-colors border-2 ${
                active ? tone.active + ' border-transparent' : tone.idle
              }`}
            >
              {chip.label}
            </button>
          )
        })}
      </div>
      <AgentJobsQueue max={100} statusFilter={statusFilter} />
    </div>
  )
}

export function AgentProfile() {
  const { agentId } = useParams()
  const agent = AGENTS_BY_ID[agentId]

  if (!agent) {
    return (
      <div className="space-y-3">
        <Link to="/admin/agents" className="text-xs theme-text-muted hover:underline">
          ← Back to agents
        </Link>
        <div className="theme-card theme-border rounded-2xl border py-12 text-center">
          <p className="theme-text font-black">Unknown agent</p>
          <p className="theme-text-muted mt-1 text-sm">
            No agent with id <code>{agentId}</code> in the roster.
          </p>
        </div>
      </div>
    )
  }

  const dept = DEPARTMENTS[agent.department]

  return (
    <div className="space-y-5">
      <SeoHelmet title={`${agent.name} — ${agent.role}`} noIndex />

      <nav className="text-xs theme-text-muted">
        <Link to="/admin/agents" className="hover:underline">Agents</Link>
        <span className="mx-1">/</span>
        <span>{agent.name}</span>
      </nav>

      <header className="theme-card theme-border rounded-2xl border p-5">
        <div className="flex items-start gap-4">
          <div className="theme-accent-fill theme-on-accent flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl text-lg font-black shadow-elev-inner-hl">
            {agent.name[0]}
          </div>
          <div className="min-w-0 flex-1">
            <p className="theme-text text-xl font-black">{agent.name}</p>
            <p className="theme-text-muted text-sm font-bold">{agent.role} · {dept?.label}</p>
            <p className="theme-text mt-2 text-sm leading-relaxed">{agent.mission}</p>
          </div>
        </div>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-xs">
          <div>
            <dt className="font-black uppercase tracking-wide text-gray-500">Inputs</dt>
            <dd className="theme-text mt-1">{agent.inputs}</dd>
          </div>
          <div>
            <dt className="font-black uppercase tracking-wide text-gray-500">Outputs</dt>
            <dd className="theme-text mt-1">{agent.outputs}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="font-black uppercase tracking-wide text-gray-500">Wraps</dt>
            <dd className="theme-text mt-1 font-mono text-[11px]">{agent.wraps}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="font-black uppercase tracking-wide text-gray-500">How to invoke</dt>
            <dd className="theme-text mt-1">{agent.invocation}</dd>
          </div>
        </dl>
      </header>

      <AgentControlToggle agentId={agent.id} />

      <AgentCostMeter agentId={agent.id} />

      <AgentRunHistory agentId={agent.id} />
    </div>
  )
}

export default AgentsHome
