/**
 * §6.2 — the review queue. One question per row: stem, key, draft prose,
 * Approve / Edit / Reject, and bulk-approve for a whole part.
 *
 * ── Why this is a page and not a panel in the Quiz step ──────────────────
 *
 * A reviewer reads sixty rows in one sitting and approves at the speed of the
 * worst one. That work wants the whole screen, a filter, and somewhere to keep
 * its place — none of which fits in a wizard step the admin is trying to get
 * PAST. The Quiz step links here instead.
 *
 * ── The screen's one job, and what the machine already did ───────────────
 *
 * Every rule a machine can check has been checked before a draft reaches this
 * screen: `why` is under 40 words, there is a distractor for every wrong
 * option and none for the right one, and none of them says "this is
 * incorrect". A draft failing any of those was never stored. So the reviewer's
 * attention goes to the one thing only a person can judge — whether the
 * explanation is TRUE — and that is why `coverage` counts APPROVED only.
 * Drafted-but-unread is not progress toward anything.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import {
  bulkApprove, draftExplanations, loadExplanationQueue, reviewExplanation,
} from '../services/explanationService'

const STATUS_LABEL = {
  approved: 'Approved',
  ai_draft: 'Draft — needs a human',
  missing: 'Not written',
}

const FILTERS = [
  { id: 'ai_draft', label: 'To review' },
  { id: 'missing', label: 'Not written' },
  { id: 'approved', label: 'Approved' },
  { id: 'all', label: 'All' },
]

function StatusPill({ status }) {
  const tone = status === 'approved'
    ? 'bg-emerald-100 text-emerald-800'
    : status === 'ai_draft'
      ? 'bg-amber-100 text-amber-900'
      : 'theme-bg-subtle theme-text-muted'
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-black ${tone}`}>
      {STATUS_LABEL[status] || status}
    </span>
  )
}

function Row({ row, quizId, onChanged, busy, setBusy }) {
  const [editing, setEditing] = useState(false)
  const [why, setWhy] = useState(row.why || '')
  const [example, setExample] = useState(row.example || '')
  const [distractors, setDistractors] = useState(row.distractors || {})

  useEffect(() => {
    setWhy(row.why || '')
    setExample(row.example || '')
    setDistractors(row.distractors || {})
  }, [row.why, row.example, row.distractors])

  const letters = useMemo(
    () => row.options.map((_, i) => String.fromCharCode(65 + i)).filter((_, i) => i !== row.correctIndex),
    [row.options, row.correctIndex],
  )
  const correctLetter = Number.isInteger(row.correctIndex)
    ? String.fromCharCode(65 + row.correctIndex)
    : '—'

  const act = useCallback(async (action, edited) => {
    setBusy(true)
    const res = await reviewExplanation({ quizId, questionId: row.id, action, edited })
    setBusy(false)
    if (res.ok) { setEditing(false); onChanged() }
  }, [quizId, row.id, onChanged, setBusy])

  return (
    <div className="theme-card border theme-border rounded-radius-md p-4 mb-3">
      <div className="flex items-start gap-3">
        <span className="flex-shrink-0 w-9 h-9 rounded-lg theme-bg-subtle grid place-items-center text-sm font-black">
          {row.n ?? row.order + 1}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-bold theme-text text-sm">{row.stem}</p>
          <p className="theme-text-muted text-xs mt-1">
            {[row.section, row.topic].filter(Boolean).join(' · ')}
            {row.section || row.topic ? ' · ' : ''}
            {`Answer: ${correctLetter}`}
            {Number.isInteger(row.correctIndex) ? ` — ${row.options[row.correctIndex]}` : ''}
          </p>
        </div>
        <StatusPill status={row.explanationStatus} />
      </div>

      {/* A question with no key cannot be explained, and saying so is more
          useful than an empty row: it is a CONTENT bug in the paper, and the
          fix is in the Quiz editor rather than here. */}
      {!Number.isInteger(row.correctIndex) && (
        <p className="mt-3 text-xs font-bold text-rose-700">
          This question has no answer key, so it cannot be explained. Fix it in the Quiz editor first.
        </p>
      )}

      {(row.why || row.example || editing) && (
        <div className="mt-3 space-y-2 text-sm">
          {editing ? (
            <>
              <label className="block">
                <span className="text-xs font-black uppercase tracking-widest theme-text-muted">
                  {`Why ${correctLetter} is right`}
                </span>
                <textarea
                  className="w-full rounded-xl border-2 theme-border theme-input px-3 py-2 text-sm mt-1"
                  rows={2}
                  value={why}
                  onChange={(e) => setWhy(e.target.value)}
                />
              </label>
              {letters.map((l) => (
                <label className="block" key={l}>
                  <span className="text-xs font-black uppercase tracking-widest theme-text-muted">
                    {`Why ${l} is wrong`}
                  </span>
                  <textarea
                    className="w-full rounded-xl border-2 theme-border theme-input px-3 py-2 text-sm mt-1"
                    rows={2}
                    value={distractors[l] || ''}
                    onChange={(e) => setDistractors((d) => ({ ...d, [l]: e.target.value }))}
                  />
                </label>
              ))}
              <label className="block">
                <span className="text-xs font-black uppercase tracking-widest theme-text-muted">
                  Remember it like this
                </span>
                <textarea
                  className="w-full rounded-xl border-2 theme-border theme-input px-3 py-2 text-sm mt-1"
                  rows={2}
                  value={example}
                  onChange={(e) => setExample(e.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              {row.why && (
                <p><span className="font-black">{`Why ${correctLetter}: `}</span>{row.why}</p>
              )}
              {letters.map((l) => (row.distractors?.[l] ? (
                <p key={l} className="theme-text-muted">
                  <span className="font-black">{`Why ${l}: `}</span>
                  {row.distractors[l]}
                </p>
              ) : null))}
              {row.example && (
                <p className="theme-text-muted"><span className="font-black">Example: </span>{row.example}</p>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-3">
        {editing ? (
          <>
            <button
              type="button"
              disabled={busy}
              className="rounded-full px-4 py-1.5 text-xs font-black bg-emerald-600 text-white disabled:opacity-50"
              onClick={() => act('edit', { why, distractors, example })}
            >
              {/* An edited explanation is APPROVED by definition — a human
                  wrote it and pressed save. There is no "edited but
                  unapproved" state to get stuck in. */}
              Save and approve
            </button>
            <button
              type="button"
              className="rounded-full px-4 py-1.5 text-xs font-black theme-bg-subtle theme-text"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {row.explanationStatus === 'ai_draft' && (
              <button
                type="button"
                disabled={busy}
                className="rounded-full px-4 py-1.5 text-xs font-black bg-emerald-600 text-white disabled:opacity-50"
                onClick={() => act('approve')}
              >
                Approve
              </button>
            )}
            {Number.isInteger(row.correctIndex) && (
              <button
                type="button"
                className="rounded-full px-4 py-1.5 text-xs font-black theme-bg-subtle theme-text"
                onClick={() => setEditing(true)}
              >
                {row.why ? 'Edit' : 'Write it myself'}
              </button>
            )}
            {row.explanationStatus !== 'missing' && (
              <button
                type="button"
                disabled={busy}
                className="rounded-full px-4 py-1.5 text-xs font-black text-rose-700 border-2 border-rose-200 disabled:opacity-50"
                onClick={() => act('reject')}
              >
                {/* Reject CLEARS the prose rather than leaving it as a draft:
                    a rejected explanation that stays on the document is one
                    accidental bulk-approve away from a child reading the thing
                    a reviewer refused. */}
                Reject
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function ExplanationReview() {
  const { paperId } = useParams()
  const [queue, setQueue] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('ai_draft')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await loadExplanationQueue(paperId)
    setLoading(false)
    if (res.ok) setQueue(res.data)
    else setMessage(res.message)
  }, [paperId])

  useEffect(() => { load() }, [load])

  const rows = useMemo(() => {
    const all = queue?.questions || []
    if (filter === 'all') return all
    return all.filter((q) => q.explanationStatus === filter)
  }, [queue, filter])

  const runDrafter = useCallback(async (redraft) => {
    setBusy(true)
    setMessage('Drafting… this takes a moment per question.')
    const res = await draftExplanations({ paperId, redraft })
    setBusy(false)
    if (!res.ok) { setMessage(res.message); return }
    const { drafted, refused, failed } = res.data
    // Every outcome is REPORTED, refusals included. A drafter that silently
    // skipped the questions it could not do would read as one that had
    // finished, and the questions it skipped are exactly the ones a person
    // needs to look at.
    setMessage(
      `${drafted} drafted`
      + (refused ? ` · ${refused} refused (the marking scheme did not support it, or the key looks wrong)` : '')
      + (failed ? ` · ${failed} failed` : ''),
    )
    load()
  }, [paperId, load])

  const approveAllShown = useCallback(async () => {
    const ids = rows.filter((r) => r.explanationStatus === 'ai_draft').map((r) => r.id)
    if (ids.length === 0) return
    setBusy(true)
    const res = await bulkApprove({ quizId: queue.quizId, questionIds: ids })
    setBusy(false)
    if (res.ok) {
      setMessage(`${res.data.approved} approved${res.data.skipped ? ` · ${res.data.skipped} skipped` : ''}`)
      load()
    } else setMessage(res.message)
  }, [rows, queue, load])

  if (loading) {
    return <div className="min-h-screen theme-bg p-8"><p className="theme-text-muted">Loading the review queue…</p></div>
  }
  if (!queue) {
    return (
      <div className="min-h-screen theme-bg p-8">
        <p className="theme-text">{message || 'We could not load that paper.'}</p>
        <Link to="/admin/papers" className="theme-accent-text font-black underline text-sm">Back to papers</Link>
      </div>
    )
  }

  const c = queue.coverage
  const pct = Math.round(c.coverage * 100)

  return (
    <div className="min-h-screen theme-bg px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <Link to={`/admin/papers/${paperId}/edit?step=quiz`} className="theme-accent-text font-black text-xs">
          ← Back to the paper
        </Link>
        <h1 className="font-display font-black text-2xl theme-text mt-2">Explanations</h1>
        <p className="theme-text-muted text-sm mt-1">
          Only an <b>approved</b> explanation is ever shown to a learner. An unexplained question
          shows its answer and nothing else — which is fine, and is what every question does until
          somebody here says otherwise.
        </p>

        <div className="theme-card border theme-border rounded-radius-md p-4 mt-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-black text-lg theme-text">{`${pct}% explained`}</span>
            <span className="theme-text-muted text-xs font-bold">
              {`${c.approved} approved · ${c.drafted} awaiting review · ${c.missing} not written`}
            </span>
          </div>
          <div className="theme-bg-subtle rounded-full h-2 w-full overflow-hidden mt-2">
            <div className="theme-accent-fill h-full" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <button
              type="button"
              disabled={busy}
              className="theme-accent-fill theme-on-accent rounded-full px-4 py-2 text-sm font-black disabled:opacity-50"
              onClick={() => runDrafter(false)}
            >
              Draft the missing ones
            </button>
            <button
              type="button"
              disabled={busy}
              className="theme-card border-2 theme-border rounded-full px-4 py-2 text-sm font-black theme-text disabled:opacity-50"
              onClick={() => runDrafter(true)}
            >
              Redraft the drafts
            </button>
          </div>
          {message && <p className="theme-text-muted text-xs mt-3">{message}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-6 mb-3">
          {FILTERS.map((f) => (
            <button
              type="button"
              key={f.id}
              aria-pressed={filter === f.id}
              className={`rounded-full px-3 py-1.5 text-xs font-black ${
                filter === f.id ? 'theme-accent-fill theme-on-accent' : 'theme-bg-subtle theme-text-muted'
              }`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
          {filter === 'ai_draft' && rows.length > 0 && (
            <button
              type="button"
              disabled={busy}
              className="ml-auto rounded-full px-4 py-1.5 text-xs font-black bg-emerald-600 text-white disabled:opacity-50"
              onClick={approveAllShown}
            >
              {`Approve all ${rows.length} shown`}
            </button>
          )}
        </div>

        {rows.length === 0
          ? <p className="theme-text-muted text-sm">Nothing here.</p>
          : rows.map((row) => (
            <Row key={row.id} row={row} quizId={queue.quizId} onChanged={load} busy={busy} setBusy={setBusy} />
          ))}
      </div>
    </div>
  )
}
