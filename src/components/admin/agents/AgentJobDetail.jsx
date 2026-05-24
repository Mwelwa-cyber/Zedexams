import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import { AGENTS_BY_ID } from '../../../config/agents'
import SeoHelmet from '../../seo/SeoHelmet'
import Skeleton from '../../ui/Skeleton'
import Button from '../../ui/Button'

const STATUS_STYLES = {
  queued:             { cls: 'bg-gray-100 text-gray-600',     label: 'Queued'             },
  running:            { cls: 'bg-blue-100 text-blue-700',     label: 'Running'            },
  awaiting_approval:  { cls: 'bg-yellow-100 text-yellow-700', label: 'Awaiting approval'  },
  approved:           { cls: 'bg-emerald-100 text-emerald-700', label: 'Approved'         },
  rejected:           { cls: 'bg-red-100 text-red-600',       label: 'Rejected'           },
  done:               { cls: 'bg-green-100 text-green-700',   label: 'Done'               },
  failed:             { cls: 'bg-red-100 text-red-700',       label: 'Failed'             },
}

const MIN_OVERRIDE_REASON = 10

function fmt(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function JsonBlock({ label, value, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
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
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs font-black uppercase tracking-wide text-gray-500">{label}</h3>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="text-xs theme-text-muted hover:underline"
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <pre className="theme-card theme-border overflow-x-auto rounded-xl border p-3 text-xs leading-relaxed">
          {formatted}
        </pre>
      )}
    </section>
  )
}

// Structured renderer for Cala's alignment output. Replaces the raw JSON
// dump in the common case; the full JSON stays available below via the
// "Raw output" toggle so devs can still see everything.
function CbcAlignmentCard({ alignment }) {
  if (!alignment || typeof alignment !== 'object') return null
  const {
    aligned, citations = [], gaps = [], drift = [], kbVersion, kbWarning,
  } = alignment

  const citationCount = Array.isArray(citations) ? citations.length : 0
  const gapCount      = Array.isArray(gaps) ? gaps.length : 0
  const driftCount    = Array.isArray(drift) ? drift.length : 0

  const headerCls = aligned
    ? 'border-emerald-200 bg-emerald-50'
    : 'border-amber-200 bg-amber-50'
  const headerText = aligned
    ? 'text-emerald-800'
    : 'text-amber-800'

  return (
    <section className={`rounded-2xl border ${headerCls} p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-sm font-black ${headerText}`}>
            CBC alignment — {aligned ? 'aligned' : 'review needed'}
          </p>
          <p className={`text-xs mt-0.5 ${headerText} opacity-80`}>
            {citationCount} citation{citationCount === 1 ? '' : 's'} ·{' '}
            {gapCount} gap{gapCount === 1 ? '' : 's'} ·{' '}
            {driftCount} drift item{driftCount === 1 ? '' : 's'}
            {kbVersion ? <> · KB <code className="font-mono">{kbVersion}</code></> : null}
          </p>
        </div>
      </div>

      {kbWarning && (
        <p className="rounded-lg bg-white/60 px-3 py-2 text-xs text-amber-900">
          <span className="font-black">KB warning:</span> {kbWarning}
        </p>
      )}

      {citationCount > 0 && (
        <div>
          <h4 className="text-xs font-black uppercase tracking-wide text-emerald-900 mb-1.5">
            Citations
          </h4>
          <ul className="space-y-1.5">
            {citations.map((c, i) => (
              <li key={`${c.outcome || 'c'}-${i}`} className="rounded-lg bg-white/70 px-3 py-2 text-xs">
                <div className="font-mono text-[11px] text-emerald-800 font-black">
                  {c.outcome || '—'}
                </div>
                {c.text && (
                  <div className="theme-text mt-0.5">{c.text}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {gapCount > 0 && (
        <div>
          <h4 className="text-xs font-black uppercase tracking-wide text-amber-900 mb-1.5">
            Gaps
          </h4>
          <ul className="space-y-1.5">
            {gaps.map((g, i) => (
              <li key={`g-${i}`} className="rounded-lg bg-white/70 px-3 py-2 text-xs">
                {g.outcome && (
                  <div className="font-mono text-[11px] text-amber-800 font-black">
                    {g.outcome}
                  </div>
                )}
                {g.text && (
                  <div className="theme-text mt-0.5">{g.text}</div>
                )}
                {g.note && (
                  <div className="theme-text-muted mt-0.5 italic">{g.note}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {driftCount > 0 && (
        <div>
          <h4 className="text-xs font-black uppercase tracking-wide text-red-900 mb-1.5">
            Drift
          </h4>
          <ul className="space-y-1.5">
            {drift.map((d, i) => (
              <li key={`d-${i}`} className="rounded-lg bg-white/70 px-3 py-2 text-xs">
                <div className="font-mono text-[11px] text-red-800 font-black">
                  {d.outcome || '—'}
                </div>
                {d.note && (
                  <div className="theme-text-muted mt-0.5 italic">{d.note}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function ApprovalPanel({ job }) {
  const { currentUser } = useAuth()
  const [busy, setBusy]         = useState(false)
  const [mode, setMode]         = useState('idle')  // 'idle' | 'rejecting' | 'overriding'
  const [reason, setReason]     = useState('')
  const [errMsg, setErrMsg]     = useState(null)

  const alignment   = job.output?.cala
  const calaUnclean = alignment && (
    alignment.aligned === false
    || (Array.isArray(alignment.gaps) && alignment.gaps.length > 0)
    || (Array.isArray(alignment.drift) && alignment.drift.length > 0)
  )

  async function update(fields) {
    setBusy(true)
    setErrMsg(null)
    try {
      await updateDoc(doc(db, `agentJobs/${job.id}`), {
        ...fields,
        reviewedBy: currentUser?.uid || null,
        reviewedAt: serverTimestamp(),
      })
    } catch (e) {
      setErrMsg(e.message || 'Update failed.')
    } finally {
      setBusy(false)
    }
  }

  function startApprove() {
    if (calaUnclean) {
      setMode('overriding')
    } else {
      update({ status: 'approved', overrideReason: null })
    }
  }

  return (
    <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-4 space-y-3">
      <div>
        <p className="text-sm font-black text-yellow-800">Awaiting your approval</p>
        <p className="text-xs text-yellow-700 mt-0.5">
          {calaUnclean
            ? 'Cala flagged alignment issues. Approving will publish anyway — supply a reason for the audit trail.'
            : 'Approve to let Pubo publish the artifact, or reject with a reason.'}
        </p>
      </div>

      {mode === 'rejecting' && (
        <div className="space-y-2">
          <label className="block text-xs font-black text-yellow-900">Rejection reason</label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Explain what needs to be fixed…"
            rows={2}
            className="w-full border border-yellow-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-yellow-500 resize-none bg-white"
          />
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              className="flex-1"
              onClick={() => update({ status: 'rejected', reviewNotes: reason || null })}
            >
              Confirm reject
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              disabled={busy}
              onClick={() => { setMode('idle'); setReason('') }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mode === 'overriding' && (
        <div className="space-y-2">
          <label className="block text-xs font-black text-yellow-900">
            Override reason (required — recorded on the published artifact)
          </label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Why is it OK to publish despite the alignment issues above?"
            rows={3}
            className="w-full border border-yellow-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-yellow-500 resize-none bg-white"
          />
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={busy || reason.trim().length < MIN_OVERRIDE_REASON}
              className="flex-1"
              onClick={() => update({ status: 'approved', overrideReason: reason.trim() })}
            >
              Approve despite drift
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              disabled={busy}
              onClick={() => { setMode('idle'); setReason('') }}
            >
              Cancel
            </Button>
          </div>
          {reason.trim().length > 0 && reason.trim().length < MIN_OVERRIDE_REASON && (
            <p className="text-xs text-yellow-800">
              Give at least {MIN_OVERRIDE_REASON} characters of context.
            </p>
          )}
        </div>
      )}

      {mode === 'idle' && (
        <div className="flex gap-2">
          <Button
            variant={calaUnclean ? 'secondary' : 'primary'}
            size="md"
            disabled={busy}
            className="flex-1"
            onClick={startApprove}
          >
            {calaUnclean ? 'Approve despite drift…' : 'Approve & publish'}
          </Button>
          <Button
            variant="secondary"
            size="md"
            disabled={busy}
            className="flex-1"
            onClick={() => setMode('rejecting')}
          >
            Reject
          </Button>
        </div>
      )}

      {errMsg && (
        <p className="text-xs text-red-700">{errMsg}</p>
      )}
    </div>
  )
}

// "Retry Cala" affordance for jobs that failed inside Cala or Reva. The
// callable re-runs the deterministic Cala step on the existing Aria
// draft, then continues to Reva. Aria's tokens are not re-spent.
function RetryPanel({ job }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState(null)

  const errStr = String(job.error || '')
  const retryableStage = /^cala:/i.test(errStr)
    ? 'Cala'
    : /^reva:/i.test(errStr)
      ? 'Reva (re-runs from Cala)'
      : null
  const hasAriaDraft = Boolean(job.output?.aria?.draft)
  const canRetry = job.status === 'failed' && hasAriaDraft && retryableStage !== null

  if (!canRetry) return null

  async function onRetry() {
    setBusy(true)
    setErr(null)
    try {
      const fns = getFunctions(app, 'us-central1')
      const call = httpsCallable(fns, 'retryAgentJob')
      await call({ jobId: job.id })
    } catch (e) {
      setErr(e.message || 'Retry failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 space-y-2">
      <p className="text-sm font-black text-blue-900">Retry {retryableStage}</p>
      <p className="text-xs text-blue-800">
        Aria&apos;s draft is preserved. This re-runs Cala (free, deterministic)
        and Reva on the existing draft — Aria&apos;s tokens are not re-spent.
      </p>
      <Button
        variant="primary"
        size="sm"
        disabled={busy}
        onClick={onRetry}
      >
        {busy ? 'Retrying…' : `Retry ${retryableStage}`}
      </Button>
      {err && <p className="text-xs text-red-700">{err}</p>}
    </div>
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

  const alignment = useMemo(() => job?.output?.cala || null, [job])

  if (loading) return <Skeleton height={400} className="!rounded-2xl" />

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p className="font-black">Couldn&apos;t load this job.</p>
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
              {job.retryRequestedAt && <> · Last retry {fmt(job.retryRequestedAt)}</>}
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

      {job.status === 'awaiting_approval' && <ApprovalPanel job={job} />}
      {job.status === 'failed' && <RetryPanel job={job} />}

      {job.error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-black">Error</p>
          <p className="mt-1 text-xs whitespace-pre-wrap">{job.error}</p>
        </div>
      )}

      {alignment && <CbcAlignmentCard alignment={alignment} />}

      {job.overrideReason && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-black uppercase tracking-wide text-amber-800 mb-1">
            Approved with override
          </p>
          <p className="text-sm theme-text whitespace-pre-wrap">{job.overrideReason}</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <JsonBlock label="Input"  value={job.input} />
        <JsonBlock label="Raw output" value={job.output} defaultOpen={false} />
      </div>

      {job.publishedRefs?.length > 0 && (
        <JsonBlock label="Published refs" value={job.publishedRefs} />
      )}
    </div>
  )
}
