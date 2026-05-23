import { useEffect, useState } from 'react'
import {
  collection, doc, limit as fsLimit, onSnapshot, orderBy, query,
  serverTimestamp, updateDoc,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import SeoHelmet from '../../seo/SeoHelmet'

// Admin queue for Curriculum Watcher reports. Each row is one
// detected change in a whitelisted source URL; admin must approve
// (review + apply manually via /admin/cbc-kb) or reject.
//
// Hard rule (mirrors the agent + the user spec):
//   - The watcher itself NEVER mutates cbcKnowledgeBase. It only
//     writes a `pending_review` report doc.
//   - Approving the report records the decision in adminAuditLogs
//     via the curriculumUpdateReportsOnApproved Cloud Function, but
//     does NOT auto-apply the change. Admin must manually update
//     the KB through the existing CbcKbAdmin UI.

const STATUS_CLASSES = {
  pending_review: 'bg-amber-50 text-amber-800 border-amber-300',
  approved:       'bg-emerald-50 text-emerald-800 border-emerald-300',
  rejected:       'bg-rose-50 text-rose-700 border-rose-300',
  applied:        'bg-blue-50 text-blue-800 border-blue-300',
}

function StatusPill({ status }) {
  const cls = STATUS_CLASSES[status] || 'bg-slate-100 text-slate-700 border-slate-300'
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${cls}`}>
      {status || 'unknown'}
    </span>
  )
}

function formatTimestamp(ts) {
  if (!ts || typeof ts.toDate !== 'function') return ''
  try { return ts.toDate().toLocaleString() } catch { return '' }
}

export default function CurriculumUpdateReports() {
  const { currentUser, isAdmin } = useAuth()
  const [reports, setReports] = useState([])
  const [busyId, setBusyId] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    const unsub = onSnapshot(
      query(
        collection(db, 'curriculumUpdateReports'),
        orderBy('checkedAt', 'desc'),
        fsLimit(50),
      ),
      snap => setReports(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      e => setErr(e.message),
    )
    return () => unsub()
  }, [])

  async function setStatus(reportId, status) {
    if (!isAdmin || !currentUser) {
      setErr('Admin only')
      return
    }
    const PROMPTS = {
      approved: 'Approve this report?\n\n' +
        'Approving does NOT auto-apply the curriculum change — you must update ' +
        'the KB manually via /admin/cbc-kb. This action is recorded in the audit log.',
      rejected: 'Reject this report? This decision is recorded in the audit log.',
      applied:  'Mark this report as applied?\n\n' +
        'Click this only after you have manually updated the KB in /admin/cbc-kb. ' +
        'The audit log will record the apply timestamp.',
    }
    if (!confirm(PROMPTS[status] || `Set status to ${status}?`)) return
    setBusyId(reportId)
    setErr(null)
    try {
      await updateDoc(doc(db, 'curriculumUpdateReports', reportId), {
        status,
        reviewedBy: currentUser.uid,
        reviewedAt: serverTimestamp(),
      })
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <SeoHelmet title="Curriculum updates — Learner AI" />
      <h1 className="text-2xl font-bold mb-1">Curriculum update reports</h1>
      <p className="text-sm text-slate-600 mb-4">
        Daily scans by the Curriculum Watcher agent. Reports never mutate
        the KB — approve here records the decision; apply the change
        manually via{' '}
        <a className="text-blue-700 hover:underline" href="/admin/cbc-kb">
          /admin/cbc-kb
        </a>.
      </p>

      {err && (
        <div className="rounded border border-rose-200 bg-rose-50 text-rose-700 text-sm p-2 mb-3">
          {err}
        </div>
      )}

      {!reports.length && (
        <div className="text-sm text-slate-500 text-center py-12 border border-dashed border-slate-200 rounded-lg">
          No reports yet. The Curriculum Watcher runs on schedule (weekly /
          monthly per source).
        </div>
      )}

      <div className="space-y-3">
        {reports.map(r => {
          const status = r.status || 'pending_review'
          const isPending = status === 'pending_review'
          return (
            <article key={r.id} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
              <header className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-bold text-slate-900 truncate">
                    {r.sourceName || 'Unnamed source'}
                  </h2>
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                    {r.sourceUrl ? (
                      <a className="hover:underline" href={r.sourceUrl}
                         target="_blank" rel="noopener noreferrer">
                        {r.sourceUrl}
                      </a>
                    ) : '—'}
                  </div>
                </div>
                <StatusPill status={status} />
              </header>

              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[11px] text-slate-700">
                {r.trustLevel && (
                  <div><dt className="font-semibold text-slate-500">Trust</dt><dd>{r.trustLevel}</dd></div>
                )}
                {r.updateType && (
                  <div><dt className="font-semibold text-slate-500">Update type</dt><dd>{r.updateType}</dd></div>
                )}
                {Array.isArray(r.affectedGrades) && r.affectedGrades.length > 0 && (
                  <div><dt className="font-semibold text-slate-500">Grades</dt><dd>{r.affectedGrades.join(', ')}</dd></div>
                )}
                {Array.isArray(r.affectedSubjects) && r.affectedSubjects.length > 0 && (
                  <div className="col-span-2 sm:col-span-1">
                    <dt className="font-semibold text-slate-500">Subjects</dt>
                    <dd>{r.affectedSubjects.join(', ')}</dd>
                  </div>
                )}
              </dl>

              {r.summary && (
                <p className="text-sm text-slate-800 whitespace-pre-wrap leading-snug">
                  {r.summary}
                </p>
              )}
              {r.recommendation && (
                <p className="text-xs text-slate-600 italic leading-snug">
                  <span className="font-semibold not-italic">Recommendation: </span>
                  {r.recommendation}
                </p>
              )}

              <footer className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <div className="text-[11px] text-slate-500">
                  Checked: {formatTimestamp(r.checkedAt)}
                  {r.reviewedAt && (
                    <> · Reviewed: {formatTimestamp(r.reviewedAt)}{r.reviewedBy ? ` by ${r.reviewedBy.slice(0, 10)}…` : ''}</>
                  )}
                </div>
                {isPending && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setStatus(r.id, 'approved')}
                      disabled={busyId === r.id}
                      className="text-xs font-bold px-3 py-1.5 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus(r.id, 'rejected')}
                      disabled={busyId === r.id}
                      className="text-xs font-bold px-3 py-1.5 rounded bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-40"
                    >
                      Reject
                    </button>
                  </div>
                )}
                {status === 'approved' && (
                  <button
                    type="button"
                    onClick={() => setStatus(r.id, 'applied')}
                    disabled={busyId === r.id}
                    title="Click after manually updating the KB in /admin/cbc-kb"
                    className="text-xs font-bold px-3 py-1.5 rounded bg-blue-50 text-blue-800 hover:bg-blue-100 disabled:opacity-40"
                  >
                    Mark applied
                  </button>
                )}
              </footer>
            </article>
          )
        })}
      </div>
    </div>
  )
}
