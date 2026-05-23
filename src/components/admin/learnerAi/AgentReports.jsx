import { useEffect, useMemo, useState } from 'react'
import {
  collection, limit as fsLimit, onSnapshot, query, where,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import ControlCentreLayout from './ControlCentreLayout'
import { AGENTS } from './agentRegistry'

// Section 8: per-agent counters over the last 7d / 30d window.
// Reads:
//   - aiAgentLogs (severity counts per agent)
//   - aiSupervisorLogs (action counts per agent)
//
// CSS-only sparkline bars — no chart library. Capped at 500 log rows
// per window to keep listener cost bounded.

function startOfWindow(days) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function Bar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="w-full bg-slate-100 rounded-sm h-1.5 overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function StatCell({ value, color }) {
  return (
    <span className={`tabular-nums font-mono text-sm font-semibold ${color || 'text-slate-700'}`}>
      {value}
    </span>
  )
}

export default function AgentReports() {
  const [windowDays, setWindowDays] = useState(7)
  const [logs, setLogs] = useState([])
  const [supLogs, setSupLogs] = useState([])
  const [err, setErr] = useState(null)

  useEffect(() => {
    const since = startOfWindow(windowDays)
    const q1 = query(
      collection(db, 'aiAgentLogs'),
      where('createdAt', '>=', since),
      fsLimit(500),
    )
    const u1 = onSnapshot(q1, snap => {
      setLogs(snap.docs.map(d => d.data()))
      setErr(null)
    }, e => setErr(e.message))

    const q2 = query(
      collection(db, 'aiSupervisorLogs'),
      where('createdAt', '>=', since),
      fsLimit(500),
    )
    const u2 = onSnapshot(q2, snap => {
      setSupLogs(snap.docs.map(d => d.data()))
    }, () => {})

    return () => { u1(); u2() }
  }, [windowDays])

  // Aggregate per-agent.
  const rows = useMemo(() => {
    const byAgent = new Map()
    const init = () => ({
      runs: 0, info: 0, warning: 0, error: 0,
      approved: 0, rejected: 0, regen: 0, sentForReview: 0,
    })
    for (const a of AGENTS) byAgent.set(a.displayOverride || a.id, init())

    for (const l of logs) {
      const key = l.agentName || ''
      const entry = byAgent.get(key) || init()
      entry.runs += 1
      if (l.severity === 'info') entry.info += 1
      else if (l.severity === 'warning') entry.warning += 1
      else if (l.severity === 'error') entry.error += 1
      byAgent.set(key, entry)
    }
    for (const sl of supLogs) {
      const key = sl.agentName || ''
      const entry = byAgent.get(key) || init()
      switch (sl.actionTaken) {
        case 'approved': entry.approved += 1; break
        case 'rejected': entry.rejected += 1; break
        case 'regenerate_required': entry.regen += 1; break
        case 'sent_for_review': entry.sentForReview += 1; break
        default: break
      }
      byAgent.set(key, entry)
    }

    return [...byAgent.entries()]
        .map(([name, stats]) => ({ name, ...stats }))
        .sort((a, b) => b.runs - a.runs)
  }, [logs, supLogs])

  const maxRuns = useMemo(() =>
    rows.reduce((m, r) => Math.max(m, r.runs), 0),
  [rows])

  const totals = useMemo(() => ({
    runs: rows.reduce((s, r) => s + r.runs, 0),
    errors: rows.reduce((s, r) => s + r.error, 0),
    approved: rows.reduce((s, r) => s + r.approved, 0),
    rejected: rows.reduce((s, r) => s + r.rejected, 0),
    regen: rows.reduce((s, r) => s + r.regen, 0),
  }), [rows])

  return (
    <ControlCentreLayout
      title="Agent reports"
      helmetTitle="Agent reports — AI Control Centre"
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-slate-700">Window</span>
        {[1, 7, 30].map(d => (
          <button
            key={d}
            type="button"
            onClick={() => setWindowDays(d)}
            className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              windowDays === d ?
                'bg-blue-600 text-white' :
                'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {d === 1 ? 'last 24h' : `last ${d}d`}
          </button>
        ))}
        <div className="text-xs text-slate-500 ml-auto">
          {logs.length + supLogs.length} events
        </div>
      </div>

      {err && (
        <div className="text-rose-700 text-xs bg-rose-50 border border-rose-200 rounded p-2 mb-3">
          Failed: {err}
        </div>
      )}

      {/* Totals strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        {[
          {label: 'Total events', value: totals.runs, accent: 'border-slate-200'},
          {label: 'Approved', value: totals.approved, accent: 'border-emerald-200'},
          {label: 'Rejected', value: totals.rejected, accent: 'border-rose-200'},
          {label: 'Regen. requested', value: totals.regen, accent: 'border-amber-200'},
          {label: 'Errors', value: totals.errors, accent: 'border-rose-200'},
        ].map(t => (
          <div key={t.label} className={`rounded border ${t.accent} bg-white p-3`}>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{t.label}</div>
            <div className="text-2xl font-bold text-slate-900 tabular-nums">{t.value}</div>
          </div>
        ))}
      </div>

      {/* Per-agent table */}
      <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600 uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Agent</th>
              <th className="px-3 py-2 text-left">Activity</th>
              <th className="px-3 py-2 text-right">Runs</th>
              <th className="px-3 py-2 text-right">Warn</th>
              <th className="px-3 py-2 text-right">Err</th>
              <th className="px-3 py-2 text-right">Approved</th>
              <th className="px-3 py-2 text-right">Rejected</th>
              <th className="px-3 py-2 text-right">Regen</th>
              <th className="px-3 py-2 text-right">Review</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.name || 'unknown'} className="border-t border-slate-100">
                <td className="px-3 py-2 font-semibold text-slate-700 max-w-[200px] truncate">
                  {r.name || <span className="text-slate-400 italic">unknown</span>}
                </td>
                <td className="px-3 py-2 min-w-[140px]">
                  <Bar value={r.runs} max={maxRuns} color="bg-blue-500" />
                </td>
                <td className="px-3 py-2 text-right"><StatCell value={r.runs} /></td>
                <td className="px-3 py-2 text-right"><StatCell value={r.warning} color={r.warning ? 'text-amber-700' : 'text-slate-400'} /></td>
                <td className="px-3 py-2 text-right"><StatCell value={r.error}   color={r.error   ? 'text-rose-700'  : 'text-slate-400'} /></td>
                <td className="px-3 py-2 text-right"><StatCell value={r.approved} color={r.approved ? 'text-emerald-700' : 'text-slate-400'} /></td>
                <td className="px-3 py-2 text-right"><StatCell value={r.rejected} color={r.rejected ? 'text-rose-700' : 'text-slate-400'} /></td>
                <td className="px-3 py-2 text-right"><StatCell value={r.regen}    color={r.regen    ? 'text-amber-700' : 'text-slate-400'} /></td>
                <td className="px-3 py-2 text-right"><StatCell value={r.sentForReview} color={r.sentForReview ? 'text-slate-700' : 'text-slate-400'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-500 mt-3 leading-snug">
        Counts capped at the most recent {logs.length + supLogs.length} events for the window.
        Older data is in <code>aiAgentLogs</code> + <code>aiSupervisorLogs</code> for the
        forensic Logs tab. Token-cost dashboards land when generators stamp cost on
        the artifacts (Phase B).
      </p>
    </ControlCentreLayout>
  )
}
