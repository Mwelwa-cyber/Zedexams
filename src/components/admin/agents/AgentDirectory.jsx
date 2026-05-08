import { Link } from 'react-router-dom'
import { DEPARTMENTS, agentsForDepartment } from '../../../config/agents'

const RUNTIME_LABELS = {
  'subagent':       'Claude Code',
  'cloud-function': 'Cloud Function',
  'github-action':  'GitHub Action',
}

function AgentCard({ agent }) {
  return (
    <Link
      to={`/admin/agents/${agent.id}`}
      className="theme-card theme-border block rounded-2xl border p-4 no-underline shadow-elev-sm transition-all duration-fast hover:shadow-elev-md hover:-translate-y-0.5"
    >
      <div className="flex items-start gap-3">
        <div className="theme-accent-fill theme-on-accent flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-base font-black shadow-elev-inner-hl">
          {agent.name[0]}
        </div>
        <div className="min-w-0 flex-1">
          <p className="theme-text text-sm font-black leading-snug">
            {agent.name} <span className="theme-text-muted font-bold">— {agent.role}</span>
          </p>
          <p className="theme-text-muted mt-1 text-xs leading-relaxed">{agent.mission}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {agent.runtime.map(r => (
              <span
                key={r}
                className="bg-gray-100 text-gray-600 text-[10px] font-bold px-2 py-0.5 rounded-full"
              >
                {RUNTIME_LABELS[r] || r}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Link>
  )
}

export default function AgentDirectory({ departmentId = null }) {
  const departments = departmentId
    ? [DEPARTMENTS[departmentId]]
    : Object.values(DEPARTMENTS)

  return (
    <div className="space-y-6">
      {departments.map(dept => {
        const agents = agentsForDepartment(dept.id)
        return (
          <section key={dept.id}>
            <header className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-black text-gray-800">
                {dept.label} Department
              </h2>
              <span className="text-xs theme-text-muted font-bold">
                {agents.length} {agents.length === 1 ? 'agent' : 'agents'}
              </span>
            </header>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {agents.map(a => <AgentCard key={a.id} agent={a} />)}
            </div>
          </section>
        )
      })}
    </div>
  )
}
