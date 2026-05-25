import { useEffect, useMemo, useState } from 'react'
import {
  collection, doc, onSnapshot, query, serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import { AGENTS, classForStatus, displayNameFor, displayKindFor } from './agentRegistry'
import { PREFLIGHT_REASONS, summarizeReason } from '../../../utils/learnerAiReasons'

// Runners write raw refusal codes ("no_source_doc_ref") into
// aiLiveAgentStates.lastMessage. Translate them on render so admins
// see "The lesson module is not linked to an approved syllabus …"
// rather than a Snake-cased token. Unknown strings pass through
// unchanged so non-refusal messages ("Looking up …") are preserved.
function humaniseLastMessage(raw) {
  if (typeof raw !== 'string' || !raw) return raw || ''
  const trimmed = raw.trim()
  if (PREFLIGHT_REASONS[trimmed]) return summarizeReason(trimmed)
  // Runner sometimes stamps "Refused: <reason>" — keep the prefix but
  // expand the reason on the back half.
  const refusedMatch = trimmed.match(/^Refused:\s*([a-z_]+)\s*$/i)
  if (refusedMatch) {
    const code = refusedMatch[1].toLowerCase()
    if (PREFLIGHT_REASONS[code]) return `Refused — ${summarizeReason(code)}`
  }
  return trimmed
}

// Section 2: per-agent status card grid. One card per registered
// agent. Driven by:
//   - aiLiveAgentStates (onSnapshot) — heartbeat + currentTask
//   - aiAgentControls   (onSnapshot) — paused/enabled flags
//   - aiAgentTasks      (onSnapshot, scoped to this agent) — the
//                                      currentTaskId reference so
//                                      View Task / Cancel Task buttons
//                                      can act without an extra fetch
//
// Control actions write directly to Firestore (admin-only rules);
// the dispatcher / runners react via the existing onUpdate triggers.

function ProgressBar({ progress }) {
  const pct = Math.max(0, Math.min(100, Number(progress) || 0))
  return (
    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
      <div className="h-full bg-blue-500 transition-all duration-500"
           style={{ width: `${pct}%` }} />
    </div>
  )
}

function timeAgo(ts) {
  if (!ts) return ''
  const ms = ts && typeof ts.toMillis === 'function' ?
    ts.toMillis() :
    (typeof ts === 'number' ? ts : new Date(ts).getTime())
  if (!Number.isFinite(ms)) return ''
  const diff = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (diff < 5) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86_400)}d ago`
}

function AgentCard({ agent, state, paused, onViewTask, onTogglePause, onCancelTask }) {
  const status = (state && state.status) || (paused ? 'paused' : 'idle')
  const progress = state && Number.isFinite(state.progress) ? state.progress : 0
  const currentTask = state && state.currentTask
  const lastMessage = state && state.lastMessage
  const updatedAt = state && state.updatedAt
  const taskId = state && state.currentTaskId
  const display = displayNameFor(agent, state)

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-2 min-h-[200px]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-slate-900 leading-tight">{display}</div>
          {displayKindFor(agent) && (
            <div className="text-[11px] text-slate-500 leading-snug mt-0.5 line-clamp-2">
              {displayKindFor(agent)}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${classForStatus(status)}`}>
            {status}
          </span>
          {paused && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-100 text-amber-800 border border-amber-200">
              paused
            </span>
          )}
        </div>
      </div>

      <ProgressBar progress={progress} />

      <div className="text-xs text-slate-700 line-clamp-2">
        {currentTask || <span className="text-slate-400 italic">No active task</span>}
      </div>

      {state && (
        <div className="text-[11px] text-slate-500 leading-tight">
          {state.grade ? `G${state.grade}` : ''}
          {state.subject ? ` · ${state.subject}` : ''}
          {state.topic ? ` · ${state.topic}` : ''}
          {state.subtopic ? ` / ${state.subtopic}` : ''}
        </div>
      )}

      {lastMessage && (
        <div
          className="text-[11px] text-slate-600 italic line-clamp-2"
          title={lastMessage}
        >
          {humaniseLastMessage(lastMessage)}
        </div>
      )}

      <div className="text-[10px] text-slate-400">{timeAgo(updatedAt)}</div>

      <div className="flex flex-wrap gap-1.5 mt-auto pt-2 border-t border-slate-100">
        <button
          type="button"
          disabled={!taskId}
          onClick={() => taskId && onViewTask(taskId)}
          className="text-[11px] font-semibold px-2 py-1 rounded bg-blue-50 text-blue-700 disabled:opacity-40 hover:bg-blue-100"
        >
          View Task
        </button>
        <button
          type="button"
          onClick={() => onTogglePause(agent, !paused)}
          className={`text-[11px] font-semibold px-2 py-1 rounded ${
            paused ?
              'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' :
              'bg-amber-50 text-amber-700 hover:bg-amber-100'
          }`}
        >
          {paused ? 'Resume Agent' : 'Pause Agent'}
        </button>
        <button
          type="button"
          disabled={!taskId}
          onClick={() => taskId && onCancelTask(taskId)}
          className="text-[11px] font-semibold px-2 py-1 rounded bg-rose-50 text-rose-700 disabled:opacity-40 hover:bg-rose-100"
        >
          Cancel Task
        </button>
      </div>
    </div>
  )
}

export default function LiveAgentStatusCards({ onViewTask }) {
  const { currentUser } = useAuth()
  const [states, setStates] = useState({})
  const [paused, setPaused] = useState({})

  // Per-agent state listener.
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'aiLiveAgentStates'),
      snap => {
        const next = {}
        snap.forEach(d => { next[d.id] = d.data() })
        setStates(next)
      },
      () => setStates({}),
    )
    return () => unsub()
  }, [])

  // Pause-flag listener.
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'aiAgentControls')),
      snap => {
        const next = {}
        snap.forEach(d => { next[d.id] = !!(d.data() || {}).paused })
        setPaused(next)
      },
      () => setPaused({}),
    )
    return () => unsub()
  }, [])

  async function handleTogglePause(agent, nextPaused) {
    const ref = doc(db, 'aiAgentControls', agent.stateDocId)
    await setDoc(ref, {
      enabled: true,
      paused: nextPaused,
      pauseReason: nextPaused ? 'Paused from Live Monitor' : null,
      updatedBy: (currentUser && currentUser.uid) || 'admin',
      updatedAt: serverTimestamp(),
    }, { merge: true })
  }

  async function handleCancelTask(taskId) {
    if (!confirm('Cancel this running task? The artifact will land at "rejected".')) return
    try {
      await updateDoc(doc(db, 'aiAgentTasks', taskId), {
        status: 'rejected',
        errorMessage: 'Cancelled from Live Monitor',
        updatedAt: serverTimestamp(),
      })
    } catch (err) {
      alert(`Failed to cancel: ${err.message}`)
    }
  }

  const cards = useMemo(() => AGENTS.map(agent => ({
    agent,
    state: states[agent.stateDocId] || null,
    paused: !!paused[agent.stateDocId],
  })), [states, paused])

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {cards.map(({ agent, state, paused: p }) => (
        <AgentCard
          key={agent.stateDocId}
          agent={agent}
          state={state}
          paused={p}
          onViewTask={onViewTask}
          onTogglePause={handleTogglePause}
          onCancelTask={handleCancelTask}
        />
      ))}
    </div>
  )
}
