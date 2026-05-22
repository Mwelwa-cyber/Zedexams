import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  collection, limit as fsLimit, onSnapshot, orderBy, query, where,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'

const STATUS_COLORS = {
  queued: 'bg-slate-200 text-slate-700',
  supervisor_planning: 'bg-blue-100 text-blue-800',
  curriculum_read: 'bg-indigo-100 text-indigo-800',
  generating: 'bg-violet-100 text-violet-800',
  quality_check: 'bg-amber-100 text-amber-800',
  awaiting_approval: 'bg-orange-100 text-orange-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-rose-100 text-rose-800',
  published: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-slate-100 text-slate-500',
  superseded: 'bg-slate-100 text-slate-500',
}

const ACTIVE_STATUSES = [
  'queued', 'supervisor_planning', 'curriculum_read', 'generating', 'quality_check',
]

function timeAgo(ts) {
  if (!ts) return ''
  const ms = ts.toDate ? ts.toDate().getTime() : new Date(ts).getTime()
  const diffSec = Math.floor((Date.now() - ms) / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86_400)}d ago`
}

// statusFilter: 'awaiting_approval' | 'active' | <single status>
export default function TaskQueue({ statusFilter = 'awaiting_approval' }) {
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
            <th className="px-3 py-2 text-left">Grounded</th>
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
              <td className="px-3 py-2 text-slate-600">{t.agentId || '—'}</td>
              <td className="px-3 py-2">
                {t.curriculumRef?.sourceDocId ? (
                  <span className="text-emerald-700 text-xs">✓ {t.curriculumRef.sourceDocId}</span>
                ) : (
                  <span className="text-slate-400 text-xs">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-slate-500">{timeAgo(t.createdAt)}</td>
              <td className="px-3 py-2">
                <Link to={`/admin/learner-ai/tasks/${t.id}`} className="text-blue-600 hover:underline text-xs">
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
