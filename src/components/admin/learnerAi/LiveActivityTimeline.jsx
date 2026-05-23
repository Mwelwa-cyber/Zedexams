import { useEffect, useMemo, useState } from 'react'
import {
  collection, limit as fsLimit, onSnapshot, orderBy, query, where,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'

// Section 3: real-time aiAgentLogs feed. Filterable by severity +
// task type + free-text search. Newest entries appear at the top
// (Firestore orderBy desc + a clientside subscribe).
//
// Cap at 100 most-recent rows to keep the listener cheap. Admins
// who need history can drop into the dedicated /admin/learner-ai/logs
// page (kept for older log spelunking).

const SEVERITY_BADGE = {
  info:    'bg-slate-100 text-slate-700',
  warning: 'bg-amber-100 text-amber-800',
  error:   'bg-rose-100 text-rose-800',
}

function timeOf(ts) {
  if (!ts) return ''
  const ms = ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0
  if (!ms) return ''
  const d = new Date(ms)
  return d.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit', second: '2-digit'})
}

function timeAgo(ts) {
  if (!ts) return ''
  const ms = ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0
  if (!ms) return ''
  const diff = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (diff < 5) return 'now'
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86_400)}d`
}

export default function LiveActivityTimeline() {
  const [logs, setLogs] = useState([])
  const [severity, setSeverity] = useState('all')   // all|info|warning|error
  const [taskType, setTaskType] = useState('all')
  const [search, setSearch] = useState('')
  const [err, setErr] = useState(null)

  useEffect(() => {
    const constraints = [orderBy('createdAt', 'desc'), fsLimit(100)]
    if (severity !== 'all') constraints.unshift(where('severity', '==', severity))
    if (taskType !== 'all') constraints.unshift(where('taskType', '==', taskType))
    const q = query(collection(db, 'aiAgentLogs'), ...constraints)
    const unsub = onSnapshot(
      q,
      snap => {
        setLogs(snap.docs.map(d => ({id: d.id, ...d.data()})))
        setErr(null)
      },
      e => setErr(e.message),
    )
    return () => unsub()
  }, [severity, taskType])

  const filtered = useMemo(() => {
    if (!search.trim()) return logs
    const needle = search.toLowerCase()
    return logs.filter(l =>
      (l.message || '').toLowerCase().includes(needle) ||
      (l.agentName || '').toLowerCase().includes(needle) ||
      (l.action || '').toLowerCase().includes(needle) ||
      (l.topic || '').toLowerCase().includes(needle) ||
      (l.subject || '').toLowerCase().includes(needle),
    )
  }, [logs, search])

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-slate-100">
        <label className="text-xs font-semibold text-slate-700">Severity
          <select value={severity} onChange={e => setSeverity(e.target.value)}
                  className="ml-2 text-xs border rounded px-2 py-1">
            <option value="all">all</option>
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="error">error</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-700">Task type
          <select value={taskType} onChange={e => setTaskType(e.target.value)}
                  className="ml-2 text-xs border rounded px-2 py-1">
            <option value="all">all</option>
            <option value="practice_quiz">practice_quiz</option>
            <option value="exam_quiz">exam_quiz</option>
            <option value="notes">notes</option>
            <option value="study_tips">study_tips</option>
            <option value="learner_feedback">learner_feedback</option>
            <option value="weakness_analysis">weakness_analysis</option>
            <option value="curriculum_update_check">curriculum_update_check</option>
          </select>
        </label>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search message / agent / topic…"
          className="flex-1 min-w-[180px] text-xs border rounded px-2 py-1"
        />
        <div className="text-[11px] text-slate-500">{filtered.length} / {logs.length}</div>
      </div>

      {err && <div className="text-rose-600 text-xs px-3 py-2">Failed: {err}</div>}

      <ul className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
        {filtered.length === 0 && (
          <li className="text-xs text-slate-500 p-4 text-center">No activity matches the filters.</li>
        )}
        {filtered.map(l => (
          <li key={l.id} className="px-3 py-2 hover:bg-slate-50">
            <div className="flex items-start gap-2 flex-wrap">
              <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${SEVERITY_BADGE[l.severity] || 'bg-slate-100 text-slate-600'}`}>
                {l.severity || 'info'}
              </span>
              <span className="text-[11px] text-slate-500 tabular-nums">{timeOf(l.createdAt)}</span>
              <span className="text-[11px] text-slate-400">({timeAgo(l.createdAt)})</span>
              <span className="text-xs font-semibold text-slate-700">{l.agentName}</span>
              <span className="text-[11px] text-slate-500">·</span>
              <span className="text-[11px] text-slate-500 font-mono">{l.action}</span>
              {l.taskType && (
                <span className="text-[10px] text-slate-500 bg-slate-100 rounded px-1.5">
                  {l.taskType}
                </span>
              )}
              {(l.grade || l.subject || l.topic) && (
                <span className="text-[10px] text-slate-500">
                  {l.grade ? `G${l.grade}` : ''}
                  {l.subject ? ` · ${l.subject}` : ''}
                  {l.topic ? ` · ${l.topic}` : ''}
                </span>
              )}
            </div>
            {l.message && (
              <div className="text-xs text-slate-700 mt-1">{l.message}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
