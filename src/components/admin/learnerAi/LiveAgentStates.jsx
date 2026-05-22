import { useEffect, useState } from 'react'
import {
  collection, doc, onSnapshot, query, serverTimestamp, setDoc,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'

// The 11 learner-AI agents. Order matters here — pipeline order from
// brief → published artifact.
const AGENTS = [
  { id: 'supervisor',        label: 'Supervisor',           role: 'Orchestrator' },
  { id: 'standards',         label: 'Standards',            role: 'Exam standards owner' },
  { id: 'curriculumReader',  label: 'Curriculum Reader',    role: 'No-guess safety gate' },
  { id: 'practiceQuiz',      label: 'Practice Quiz',        role: 'Short formative quizzes' },
  { id: 'examQuiz',          label: 'Exam Quiz',            role: 'Exam-style drafts' },
  { id: 'notes',             label: 'Notes',                role: 'Learner study notes' },
  { id: 'studyTips',         label: 'Study Tips',           role: 'Per-topic tips' },
  { id: 'weakness',          label: 'Weakness Detection',   role: 'Per-learner gap analysis' },
  { id: 'feedback',          label: 'Learner Feedback',     role: 'Encouraging feedback' },
  { id: 'qualityCheck',      label: 'Quality Check',        role: 'Deterministic + LLM verifier' },
  { id: 'curriculumWatcher', label: 'Curriculum Watcher',   role: 'Daily KB drift scan' },
]

function timeAgo(ts) {
  if (!ts) return '—'
  const ms = ts.toDate ? ts.toDate().getTime() : new Date(ts).getTime()
  const diff = Math.floor((Date.now() - ms) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  return `${Math.floor(diff / 3600)}h`
}

export default function LiveAgentStates() {
  const [states, setStates] = useState({})
  const [pausedMap, setPausedMap] = useState({})
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    const unsubState = onSnapshot(
      query(collection(db, 'aiLiveAgentStates')),
      snap => {
        const map = {}
        snap.forEach(d => { map[d.id] = d.data() })
        setStates(map)
      },
    )
    const unsubCtrl = onSnapshot(
      query(collection(db, 'aiAgentControls')),
      snap => {
        const map = {}
        snap.forEach(d => { map[d.id] = !!d.data().paused })
        setPausedMap(map)
      },
    )
    return () => { unsubState(); unsubCtrl() }
  }, [])

  async function togglePause(agentId) {
    setBusy(agentId)
    try {
      const next = !pausedMap[agentId]
      await setDoc(doc(db, 'aiAgentControls', agentId), {
        enabled: true,
        paused: next,
        pauseReason: next ? 'Paused from admin UI' : null,
        updatedBy: 'admin',
        updatedAt: serverTimestamp(),
      }, { merge: true })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {AGENTS.map(a => {
        const s = states[a.id] || {}
        const paused = !!pausedMap[a.id]
        const status = paused ? 'paused' : (s.status || 'idle')
        return (
          <div key={a.id} className="border border-slate-200 rounded-lg p-3 bg-white">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold text-slate-900">{a.label}</div>
                <div className="text-xs text-slate-500">{a.role}</div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                paused ? 'bg-rose-100 text-rose-700' :
                status === 'running' ? 'bg-violet-100 text-violet-700' :
                status === 'error' ? 'bg-amber-100 text-amber-700' :
                'bg-slate-100 text-slate-600'
              }`}>{status}</span>
            </div>
            <div className="text-xs text-slate-500 mt-2">
              Heartbeat: {timeAgo(s.lastHeartbeat)} ago · runs today: {s.stats?.runsToday ?? 0}
            </div>
            <button
              onClick={() => togglePause(a.id)}
              disabled={busy === a.id}
              className="mt-3 text-xs px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
