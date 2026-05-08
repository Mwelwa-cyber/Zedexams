import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  collection, doc, limit, onSnapshot, orderBy, query, where,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../contexts/AuthContext'
import SeoHelmet from '../seo/SeoHelmet'
import Skeleton from '../ui/Skeleton'

// Pipeline phases — keep in sync with functions/agents/dispatcher.js.
// Aria → Cala → Reva runs as one Cloud Function; the agentId field tracks
// the currently-running (or last completed) step.
const PHASES = ['aria', 'cala', 'reva', 'pubo']
const PHASE_LABEL = {
  aria: 'Drafting',
  cala: 'CBC alignment',
  reva: 'Pedagogy review',
  pubo: 'Publishing',
}

const STATUS_STYLES = {
  queued:             { cls: 'bg-gray-100 text-gray-600',       label: 'Queued'             },
  running:            { cls: 'bg-blue-100 text-blue-700',       label: 'Running'            },
  awaiting_approval:  { cls: 'bg-yellow-100 text-yellow-700',   label: 'Awaiting approval'  },
  approved:           { cls: 'bg-emerald-100 text-emerald-700', label: 'Approved'           },
  rejected:           { cls: 'bg-red-100 text-red-600',         label: 'Rejected'           },
  done:               { cls: 'bg-green-100 text-green-700',     label: 'Published'          },
  failed:             { cls: 'bg-red-100 text-red-700',         label: 'Failed'             },
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

function PhaseTrack({ job }) {
  // Pick out which phase the job is currently in, in chronological order.
  // Output keys (output.aria, output.cala, …) tell us which phases finished.
  const out = job.output || {}
  const finished = new Set(Object.keys(out))
  const current = job.agentId || null

  return (
    <ol className="flex flex-wrap gap-1.5">
      {PHASES.map((p, i) => {
        const isFinished = finished.has(p)
        const isCurrent = current === p && !isFinished && (job.status === 'running' || job.status === 'queued')
        const cls = isFinished
          ? 'bg-green-100 text-green-700'
          : isCurrent
          ? 'bg-blue-100 text-blue-700 animate-pulse'
          : 'bg-gray-50 text-gray-400'
        return (
          <li key={p} className={`text-[10px] font-black px-2 py-0.5 rounded-full ${cls}`}>
            {i + 1}. {PHASE_LABEL[p]}
          </li>
        )
      })}
    </ol>
  )
}

function JobCard({ job }) {
  return (
    <Link
      to={`/teacher/agents/${job.id}`}
      className="theme-card theme-border block rounded-2xl border p-4 no-underline transition-shadow hover:shadow-elev-sm"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="theme-text font-black text-sm truncate">
            {job.input?.topic || 'Untitled brief'}
          </p>
          <p className="theme-text-muted text-xs">
            {job.input?.tool?.replace(/_/g, ' ')}
            {job.input?.subject && <> · {job.input.subject}</>}
            {job.input?.grade && <> · {job.input.grade}</>}
            {job.input?.term && <> · Term {job.input.term}</>}
          </p>
        </div>
        <StatusPill status={job.status} />
      </div>
      <PhaseTrack job={job} />
      <div className="mt-2 flex items-center justify-between text-[11px] theme-text-muted">
        <span>Submitted {fmt(job.createdAt)}</span>
        {job.error && <span className="text-red-600 truncate">⚠ {job.error}</span>}
      </div>
    </Link>
  )
}

export function AgentJobsList() {
  const { currentUser } = useAuth()
  const [jobs, setJobs]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!currentUser?.uid) return
    setLoading(true)
    const q = query(
      collection(db, 'agentJobs'),
      where('createdBy', '==', currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(50),
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
  }, [currentUser?.uid])

  return (
    <div className="space-y-5 max-w-3xl">
      <SeoHelmet title="My agent submissions" noIndex />

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-800">My submissions</h1>
          <p className="text-sm theme-text-muted mt-0.5">
            Briefs you've sent to the Content agents for review and publishing.
          </p>
        </div>
        <Link
          to="/teacher/agents/new"
          className="theme-accent-bg theme-accent-text shadow-elev-inner-hl rounded-xl px-4 py-2 text-sm font-black no-underline"
        >
          + New brief
        </Link>
      </header>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-black">Couldn't load submissions.</p>
          <p className="mt-1 text-xs">{error.message}</p>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={88} className="!rounded-2xl" />)}
        </div>
      ) : jobs.length === 0 ? (
        <div className="theme-card theme-border rounded-2xl border py-12 text-center">
          <p className="theme-text font-black">No submissions yet</p>
          <p className="theme-text-muted text-sm mt-1">
            Submit a brief and the Content agents will draft it for you.
          </p>
          <Link
            to="/teacher/agents/new"
            className="theme-accent-text inline-block mt-4 text-sm font-black underline"
          >
            Submit your first brief →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map(job => <JobCard key={job.id} job={job} />)}
        </div>
      )}
    </div>
  )
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
      <pre className="theme-card theme-border overflow-x-auto rounded-xl border p-3 text-xs leading-relaxed">{formatted}</pre>
    </section>
  )
}

export function AgentJobView() {
  const { jobId } = useParams()
  const { currentUser } = useAuth()
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
        <p className="font-black">Couldn't load this submission.</p>
        <p className="mt-1 text-xs">{error.message}</p>
      </div>
    )
  }
  if (!job) {
    return (
      <div className="theme-card theme-border rounded-2xl border py-12 text-center">
        <p className="theme-text font-black">Submission not found</p>
        <Link to="/teacher/agents" className="theme-accent-text mt-3 inline-block text-sm font-bold underline">
          Back to my submissions
        </Link>
      </div>
    )
  }
  if (job.createdBy !== currentUser?.uid) {
    return (
      <div className="theme-card theme-border rounded-2xl border py-12 text-center">
        <p className="theme-text font-black">Not your submission</p>
      </div>
    )
  }

  const out = job.output || {}

  return (
    <div className="space-y-5 max-w-3xl">
      <SeoHelmet title="Submission status" noIndex />

      <nav className="text-xs theme-text-muted">
        <Link to="/teacher/agents" className="hover:underline">My submissions</Link>
        <span className="mx-1">/</span>
        <span>{job.input?.topic || 'submission'}</span>
      </nav>

      <header className="theme-card theme-border rounded-2xl border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="theme-text font-black text-base">
              {job.input?.topic || 'Untitled brief'}
            </p>
            <p className="theme-text-muted text-xs mt-0.5">
              {job.input?.tool?.replace(/_/g, ' ')}
              {job.input?.subject && <> · {job.input.subject}</>}
              {job.input?.grade && <> · {job.input.grade}</>}
              {job.input?.term && <> · Term {job.input.term}</>}
              {' · '} Submitted {fmt(job.createdAt)}
            </p>
          </div>
          <StatusPill status={job.status} />
        </div>
        <div className="mt-3"><PhaseTrack job={job} /></div>

        {job.status === 'awaiting_approval' && (
          <div className="mt-3 rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
            Awaiting an admin reviewer. They can approve and publish, or
            reject with a reason. You'll see the verdict here in real time.
          </div>
        )}
        {job.status === 'rejected' && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            <p className="font-black mb-0.5">Rejected</p>
            {job.reviewNotes && <p>{job.reviewNotes}</p>}
          </div>
        )}
        {job.status === 'failed' && job.error && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            <p className="font-black mb-0.5">Failed</p>
            <p className="whitespace-pre-wrap">{job.error}</p>
          </div>
        )}
      </header>

      <JsonBlock label="Brief" value={job.input} />
      {out.aria && <JsonBlock label="Aria — draft" value={out.aria.draft} />}
      {out.cala && <JsonBlock label="Cala — CBC alignment" value={out.cala} />}
      {out.reva && <JsonBlock label="Reva — review" value={out.reva} />}
      {out.pubo && <JsonBlock label="Pubo — publication" value={out.pubo} />}

      {job.publishedRefs?.length > 0 && job.status === 'done' && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <p className="font-black">Published</p>
          <p className="text-xs mt-1">
            Visible in{' '}
            <Link
              to={`/admin/generations/${job.publishedRefs[0].docId}`}
              className="underline font-bold"
            >
              the library
            </Link>.
          </p>
        </div>
      )}
    </div>
  )
}

export default AgentJobsList
