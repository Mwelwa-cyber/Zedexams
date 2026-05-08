import AgentJobsQueue from './AgentJobsQueue'

export default function AgentRunHistory({ agentId, max = 50 }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-black text-gray-700">Recent runs</h3>
      <AgentJobsQueue agentId={agentId} max={max} />
    </div>
  )
}
