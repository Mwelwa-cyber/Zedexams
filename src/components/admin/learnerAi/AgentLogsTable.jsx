import { useEffect, useState } from 'react'
import {
  collection, limit as fsLimit, onSnapshot, orderBy, query, where,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import SeoHelmet from '../../seo/SeoHelmet'

export default function AgentLogsTable() {
  const [logs, setLogs] = useState([])
  const [level, setLevel] = useState('all')
  const [groundedFilter, setGroundedFilter] = useState('all')
  const [err, setErr] = useState(null)

  useEffect(() => {
    let q
    if (groundedFilter === 'ungrounded') {
      // Audit query — find every ungrounded log row.
      q = query(
        collection(db, 'aiAgentLogs'),
        where('curriculumGrounded', '==', false),
        orderBy('createdAt', 'desc'),
        fsLimit(100),
      )
    } else if (level !== 'all') {
      q = query(
        collection(db, 'aiAgentLogs'),
        where('level', '==', level),
        orderBy('createdAt', 'desc'),
        fsLimit(100),
      )
    } else {
      q = query(
        collection(db, 'aiAgentLogs'),
        orderBy('createdAt', 'desc'),
        fsLimit(100),
      )
    }
    const unsub = onSnapshot(q, snap => {
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setErr(null)
    }, e => setErr(e.message))
    return () => unsub()
  }, [level, groundedFilter])

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <SeoHelmet title="Learner AI logs — Admin" />
      <h1 className="text-2xl font-bold mb-4">Learner AI logs</h1>

      <div className="flex gap-3 items-center mb-4 text-sm">
        <label>Level:
          <select value={level} onChange={e => setLevel(e.target.value)} className="ml-2 border rounded px-2 py-1">
            <option value="all">all</option>
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="error">error</option>
            <option value="blocked">blocked</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={groundedFilter === 'ungrounded'}
            onChange={e => setGroundedFilter(e.target.checked ? 'ungrounded' : 'all')}
          /> Ungrounded only (audit)
        </label>
      </div>

      {err && <div className="text-rose-600 text-sm mb-2">Failed: {err}</div>}

      <div className="overflow-x-auto border rounded">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600 uppercase">
            <tr>
              <th className="px-2 py-2 text-left">When</th>
              <th className="px-2 py-2 text-left">Agent</th>
              <th className="px-2 py-2 text-left">Action</th>
              <th className="px-2 py-2 text-left">Level</th>
              <th className="px-2 py-2 text-left">Grounded</th>
              <th className="px-2 py-2 text-left">Task</th>
              <th className="px-2 py-2 text-left">Summary</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(l => (
              <tr key={l.id} className="border-t">
                <td className="px-2 py-1">{l.createdAt?.toDate?.()?.toLocaleString?.() || ''}</td>
                <td className="px-2 py-1 font-medium">{l.agentId}</td>
                <td className="px-2 py-1">{l.action}</td>
                <td className="px-2 py-1">{l.level}</td>
                <td className="px-2 py-1">{l.curriculumGrounded ? '✓' : '—'}</td>
                <td className="px-2 py-1">{l.taskId?.slice(0, 8) || ''}</td>
                <td className="px-2 py-1 max-w-md truncate">{typeof l.outputSummary === 'string' ? l.outputSummary : JSON.stringify(l.outputSummary || {})}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
