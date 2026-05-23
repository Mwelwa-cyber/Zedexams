import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  collection, limit as fsLimit, onSnapshot, orderBy, query, where,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'

// v2 task status palette. Keep in sync with TASK_STATUSES in
// src/schemas/learnerAi.js.
const STATUS_COLORS = {
  queued:               'bg-slate-200 text-slate-700',
  running:              'bg-blue-100 text-blue-800',
  thinking:             'bg-blue-100 text-blue-800',
  generating:           'bg-violet-100 text-violet-800',
  checking:             'bg-amber-100 text-amber-800',
  waiting:              'bg-slate-100 text-slate-600',
  completed:            'bg-emerald-50 text-emerald-700',
  passed_quality_check: 'bg-emerald-100 text-emerald-800',
  failed_quality_check: 'bg-rose-100 text-rose-700',
  needs_review:         'bg-orange-100 text-orange-800',
  approved:             'bg-emerald-100 text-emerald-800',
  published:            'bg-emerald-100 text-emerald-800',
  rejected:             'bg-rose-100 text-rose-800',
  regenerating:         'bg-amber-100 text-amber-800',
  error:                'bg-rose-100 text-rose-800',
}

const ACTIVE_STATUSES = [
  'queued', 'running', 'thinking', 'generating', 'checking', 'waiting', 'regenerating',
]

// Used by LearnerAiHome — admin-attention queue. Tasks need a human
// look-once they finish the auto pipeline.
const REVIEW_STATUS = 'needs_review'

function timeAgo(ts) {
  if (!ts) return ''
  const ms = ts.toDate ? ts.toDate().getTime() : new Date(ts).getTime()
  const diffSec = Math.floor((Date.now() - ms) / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86_400)}d ago`
}

// statusFilter: 'needs_review' | 'active' | <single status>.
// Default is 'needs_review' (the admin-attention queue in v2).
//
// When `onRowClick(taskId)` is supplied (Live Monitor passes it in),
// the row's "Open" button calls it instead of navigating to the
// full task page — the Monitor opens its drawer overlay. Without
// it the row still links to /admin/learner-ai/tasks/{id} for the
// standalone /tasks list view.
export default function TaskQueue({ statusFilter = REVIEW_STATUS, onRowClick }) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    setLoading(true)
    let q
    if (statusFilter === 'active') {
      q = query(
        collection(db, 'aiAgentTasks'),
        where('status', 'in', ACTIVE_STATUSES),
        orderBy('createdAt', 'desc'),
        fsLimit(40),
      )
    } else {
      q = query(
        collection(db, 'aiAgentTasks'),
        where('status', '==', statusFilter),
        orderBy('createdAt', 'desc'),
        fsLimit(40),
      )
    }
    const unsub = onSnapshot(
      q,
      snap => {
        setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setLoading(false)
        setErr(null)
      },
      e => { setErr(e.message); setLoading(false) },
    )
    return () => unsub()
  }, [statusFilter])

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>
  if (err) return <div className="text-sm text-rose-600">Failed: {err}</div>
  if (!tasks.length) return <div className="text-sm text-slate-500">No tasks.</div>

  return (
    <div className="overflow-x-auto border border-slate-200 rounded-lg">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
          <tr>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Type</th>
            <th className="px-3 py-2 text-left">Grade / Subject / Topic</th>
            <th className="px-3 py-2 text-left">Agent</th>
            <th className="px-3 py-2 text-left">Artifact</th>
            <th className="px-3 py-2 text-left">Created</th>
            <th className="px-3 py-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map(t => (
            <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-3 py-2">
                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${STATUS_COLORS[t.status] || 'bg-slate-100'}`}>
                  {t.status}
                </span>
              </td>
              <td className="px-3 py-2">{t.taskType}</td>
              <td className="px-3 py-2 text-slate-700">
                G{t.grade} · {t.subject} · {t.topic || '—'}
                {t.subtopic ? ` / ${t.subtopic}` : ''}
              </td>
              <td className="px-3 py-2 text-slate-600">{t.agentName || '—'}</td>
              <td className="px-3 py-2 text-xs">
                {t.resultContentId ? (
                  <span className="text-emerald-700">artifact ✓</span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-slate-500">{timeAgo(t.createdAt)}</td>
              <td className="px-3 py-2">
                {onRowClick ? (
                  <button
                    type="button"
                    onClick={() => onRowClick(t.id)}
                    className="text-blue-600 hover:underline text-xs font-semibold"
                  >
                    View Task
                  </button>
                ) : (
                  <Link to={`/admin/learner-ai/tasks/${t.id}`} className="text-blue-600 hover:underline text-xs">
                    Open
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
