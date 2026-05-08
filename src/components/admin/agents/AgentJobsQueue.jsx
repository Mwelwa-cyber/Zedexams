import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  collection, onSnapshot, query, where, orderBy, limit,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { AGENTS_BY_ID, JOB_STATUSES } from '../../../config/agents'
import Skeleton from '../../ui/Skeleton'

const STATUS_STYLES = {
  queued:             { cls: 'bg-gray-100 text-gray-600',     label: 'Queued'             },
  running:            { cls: 'bg-blue-100 text-blue-700',     label: 'Running'            },
  awaiting_approval:  { cls: 'bg-yellow-100 text-yellow-700', label: 'Awaiting approval'  },
  approved:           { cls: 'bg-emerald-100 text-emerald-700', label: 'Approved'         },
  rejected:           { cls: 'bg-red-100 text-red-600',       label: 'Rejected'           },
  done:               { cls: 'bg-green-100 text-green-700',   label: 'Done'               },
  failed:             { cls: 'bg-red-100 text-red-700',       label: 'Failed'             },
}

function fmt(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function StatusPill({ status }) {
  const s = STATUS_STYLES[status] || { cls: 'bg-gray-100 text-gray-500', label: status || '—' }
  return (
    <span className={`inline-flex items-center text-[11px] font-black px-2 py-0.5 rounded-full whitespace-nowrap ${s.cls}`}>
      {s.label}
    </span>
  )
}

export default function AgentJobsQueue({ departmentId = null, statusFilter = null, agentId = null, max = 50 }) {
  const [jobs, setJobs]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    setLoading(true)
    const constraints = []
    if (departmentId) constraints.push(where('department', '==', departmentId))
    if (statusFilter) constraints.push(where('status', '==', statusFilter))
    if (agentId)      constraints.push(where('agentId', '==', agentId))
    constraints.push(orderBy('createdAt', 'desc'))
    constraints.push(limit(max))

    const q = query(collection(db, 'agentJobs'), ...constraints)
    const unsub = onSnapshot(
      q,
      (snap) => {
        setJobs(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setLoading(false)
        setError(null)
      },
      (err) => {
        setError(err)
        setLoading(false)
      },
    )
    return () => unsub()
  }, [departmentId, statusFilter, agentId, max])

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={64} className="!rounded-xl" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p className="font-black">Couldn't load agent jobs.</p>
        <p className="mt-1 text-xs">{error.message}</p>
      </div>
    )
  }

  if (jobs.length === 0) {
    return (
      <div className="theme-card theme-border rounded-2xl border py-12 text-center">
        <p className="theme-text font-black">No jobs yet</p>
        <p className="theme-text-muted mt-1 text-sm">
          Once briefs start flowing, queued jobs land here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {jobs.map(job => {
        const agent = AGENTS_BY_ID[job.agentId]
        return (
          <Link
            key={job.id}
            to={`/admin/agents/jobs/${job.id}`}
            className="theme-card theme-border block rounded-xl border p-3 no-underline transition-colors hover:bg-gray-50"
          >
            <div className="flex items-center gap-3">
              <div className="theme-accent-fill theme-on-accent flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-xs font-black shadow-elev-inner-hl">
                {(agent?.name || job.agentId || '?')[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="theme-text truncate text-sm font-black">
                  {agent ? `${agent.name} — ${agent.role}` : (job.agentId || 'Unknown agent')}
                </p>
                <p className="theme-text-muted truncate text-xs">
                  {job.input?.topic || job.input?.brief || 'Job ' + job.id.slice(0, 8)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusPill status={job.status} />
                <span className="text-[10px] theme-text-muted">{fmt(job.createdAt)}</span>
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

export { JOB_STATUSES }
