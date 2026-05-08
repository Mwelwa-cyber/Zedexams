import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { AGENTS_BY_ID } from '../../../config/agents'
import SeoHelmet from '../../seo/SeoHelmet'
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
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function JsonBlock({ label, value }) {
  if (value === undefined || value === null) {
    return (
      <section>
        <h3 className="text-xs font-black uppercase tracking-wide text-gray-500 mb-1">{label}</h3>
        <p className="text-sm theme-text-muted italic">— empty —</p>
      </section>
    )
  }
  let formatted = ''
  try { formatted = JSON.stringify(value, null, 2) } catch { formatted = String(value) }
  return (
    <section>
      <h3 className="text-xs font-black uppercase tracking-wide text-gray-500 mb-1">{label}</h3>
      <pre className="theme-card theme-border overflow-x-auto rounded-xl border p-3 text-xs leading-relaxed">
        {formatted}
      </pre>
    </section>
  )
}

export default function AgentJobDetail() {
  const { jobId } = useParams()
  const [job, setJob]         = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!jobId) return
    const ref = doc(db, `agentJobs/${jobId}`)
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setJob(snap.exists() ? { id: snap.id, ...snap.data() } : null)
        setLoading(false)
      },
      (err) => { setError(err); setLoading(false) },
    )
    return () => unsub()
  }, [jobId])

  if (loading) return <Skeleton height={400} className="!rounded-2xl" />

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p className="font-black">Couldn't load this job.</p>
        <p className="mt-1 text-xs">{error.message}</p>
      </div>
    )
  }

  if (!job) {
    return (
      <div className="theme-card theme-border rounded-2xl border py-12 text-center">
        <p className="theme-text font-black">Job not found</p>
        <p className="theme-text-muted mt-1 text-sm">
          It may have been deleted, or you may not have access.
        </p>
        <Link to="/admin/agents" className="theme-accent-text mt-4 inline-block text-sm font-bold underline">
          Back to dashboard
        </Link>
      </div>
    )
  }

  const agent  = AGENTS_BY_ID[job.agentId]
  const status = STATUS_STYLES[job.status] || { cls: 'bg-gray-100 text-gray-500', label: job.status || '—' }

  return (
    <div className="space-y-5">
      <SeoHelmet title="Agent job" noIndex />

      <nav className="text-xs theme-text-muted">
        <Link to="/admin/agents" className="hover:underline">Agents</Link>
        <span className="mx-1">/</span>
        <span>job {job.id.slice(0, 8)}</span>
      </nav>

      <header className="theme-card theme-border rounded-2xl border p-4">
        <div className="flex items-start gap-3">
          <div className="theme-accent-fill theme-on-accent flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-base font-black shadow-elev-inner-hl">
            {(agent?.name || job.agentId || '?')[0].toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="theme-text text-base font-black">
              {agent ? `${agent.name} — ${agent.role}` : (job.agentId || 'Unknown agent')}
            </p>
            <p className="theme-text-muted text-xs">
              Created {fmt(job.createdAt)}
              {job.reviewedAt && <> · Reviewed {fmt(job.reviewedAt)}</>}
            </p>
          </div>
          <span className={`inline-flex items-center text-xs font-black px-2.5 py-1 rounded-full whitespace-nowrap ${status.cls}`}>
            {status.label}
          </span>
        </div>
        {agent?.mission && (
          <p className="theme-text-muted mt-3 text-sm leading-relaxed">{agent.mission}</p>
        )}
      </header>

      {/* Phase 1: read-only. Approve/Reject ships in Phase 2 alongside the
          dispatcher Cloud Function. */}
      {job.status === 'awaiting_approval' && (
        <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm font-black text-yellow-800">Awaiting your approval</p>
          <p className="text-xs text-yellow-700 mt-1">
            Approve & Reject controls land in Phase 2. For now, review the
            input and output below.
          </p>
        </div>
      )}

      {job.error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-black">Error</p>
          <p className="mt-1 text-xs whitespace-pre-wrap">{job.error}</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <JsonBlock label="Input"  value={job.input} />
        <JsonBlock label="Output" value={job.output} />
      </div>

      {job.publishedRefs?.length > 0 && (
        <JsonBlock label="Published refs" value={job.publishedRefs} />
      )}
    </div>
  )
}
