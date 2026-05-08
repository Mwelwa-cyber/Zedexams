import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import SeoHelmet from '../../seo/SeoHelmet'
import { AGENTS_BY_ID, DEPARTMENTS } from '../../../config/agents'
import AgentDirectory from './AgentDirectory'
import AgentJobsQueue from './AgentJobsQueue'
import AgentRunHistory from './AgentRunHistory'

const TABS = [
  { id: 'all',     label: 'All',          deptFilter: null    },
  { id: 'content', label: 'Content',      deptFilter: 'content' },
  { id: 'qaEng',   label: 'QA / Eng',     deptFilter: 'qaEng' },
]

export function AgentsHome() {
  const [tab, setTab] = useState('all')
  const active = TABS.find(t => t.id === tab) || TABS[0]

  return (
    <div className="space-y-6">
      <SeoHelmet title="Agents" noIndex />

      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black text-gray-800">Agents</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            The ZedExams operating model — Content + QA/Engineering departments,
            human-in-the-loop.
          </p>
        </div>
        <Link
          to="/admin/agents/jobs"
          className="text-xs font-black theme-text-muted hover:theme-text underline"
        >
          View all jobs →
        </Link>
      </header>

      {/* Tabs */}
      <div className="theme-border flex gap-1 border-b">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-black transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? 'theme-accent-text border-current'
                : 'theme-text-muted border-transparent hover:theme-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Roster */}
      <AgentDirectory departmentId={active.deptFilter} />

      {/* Awaiting approval */}
      <section>
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-black text-gray-800">Awaiting approval</h2>
          <span className="text-xs theme-text-muted">human-in-the-loop</span>
        </header>
        <AgentJobsQueue
          departmentId={active.deptFilter}
          statusFilter="awaiting_approval"
          max={20}
        />
      </section>

      {/* Recent activity */}
      <section>
        <header className="mb-3">
          <h2 className="text-lg font-black text-gray-800">Recent activity</h2>
        </header>
        <AgentJobsQueue departmentId={active.deptFilter} max={20} />
      </section>
    </div>
  )
}

export function AgentsAllJobs() {
  return (
    <div className="space-y-5">
      <SeoHelmet title="Agent jobs" noIndex />
      <header>
        <Link to="/admin/agents" className="text-xs theme-text-muted hover:underline">
          ← Back to agents
        </Link>
        <h1 className="mt-1 text-2xl font-black text-gray-800">All agent jobs</h1>
      </header>
      <AgentJobsQueue max={100} />
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

      <AgentRunHistory agentId={agent.id} />
    </div>
  )
}

export default AgentsHome
