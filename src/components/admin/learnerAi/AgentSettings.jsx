import { useEffect, useState } from 'react'
import {
  collection, doc, onSnapshot, serverTimestamp, setDoc, query,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import ControlCentreLayout from './ControlCentreLayout'
import { AGENTS, displayNameFor } from './agentRegistry'

// Section 10: admin controls for the learner-AI pipeline.
//   10a — settings/global.learnerAi.* auto-publish toggles
//   10b — per-agent enabled/paused grid (writes to aiAgentControls)
//
// Reuses the existing settings/global doc pattern from AdminSettings.jsx
// + the aiAgentControls writer from LiveAgentStatusCards. Every write
// stamps updatedBy: currentUser.uid so the existing audit log picks
// the action up automatically.

const FLAGS = [
  {
    key: 'autoPublishPracticeQuizzes',
    label: 'Auto-publish practice quizzes',
    help: 'When ON, practice quizzes that pass Quality Check publish ' +
      'straight to learners without admin review.',
  },
  {
    key: 'autoPublishNotes',
    label: 'Auto-publish notes',
    help: 'When ON, notes drafts that pass Quality Check publish to ' +
      'learners automatically.',
  },
  {
    key: 'autoPublishStudyTips',
    label: 'Auto-publish study tips',
    help: 'When ON, study tips publish automatically — but only when ' +
      'the source task carries parameters.weakLearnerId (i.e. tips ' +
      'derived from real weakness data).',
  },
  {
    key: 'autoPublishLearnerFeedback',
    label: 'Auto-publish learner feedback',
    help: 'When ON, post-quiz feedback for the learner publishes to ' +
      'their dashboard immediately — but only when both learnerId ' +
      'AND attemptId are set on the source task.',
  },
]

function Toggle({ on, onClick, disabled, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
        on ? 'bg-emerald-600' : 'bg-slate-300'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-90'}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform ${
          on ? 'translate-x-5' : 'translate-x-0.5'
        } translate-y-0.5`}
      />
    </button>
  )
}

function FlagRow({ flag, value, busy, onToggle }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900">{flag.label}</div>
        <p className="text-xs text-slate-600 leading-snug mt-0.5">{flag.help}</p>
      </div>
      <Toggle
        on={value === true}
        disabled={busy}
        ariaLabel={flag.label}
        onClick={() => onToggle(flag.key, value !== true)}
      />
    </div>
  )
}

export default function AgentSettings() {
  const { currentUser } = useAuth()
  const [settings, setSettings] = useState({})
  const [controls, setControls] = useState({})
  const [busyKey, setBusyKey] = useState(null)
  const [err, setErr] = useState(null)

  // settings/global listener
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'settings', 'global'),
      snap => {
        const data = snap.exists() ? snap.data() : {}
        setSettings((data && data.learnerAi) || {})
      },
      e => setErr(e.message),
    )
    return () => unsub()
  }, [])

  // aiAgentControls listener
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'aiAgentControls')),
      snap => {
        const next = {}
        snap.forEach(d => { next[d.id] = d.data() || {} })
        setControls(next)
      },
      () => {},
    )
    return () => unsub()
  }, [])

  async function setFlag(key, nextVal) {
    setBusyKey(key)
    setErr(null)
    try {
      const updatedBy = (currentUser && currentUser.uid) || 'admin'
      await setDoc(doc(db, 'settings', 'global'), {
        learnerAi: { ...settings, [key]: nextVal },
        updatedBy,
        updatedAt: serverTimestamp(),
      }, { merge: true })
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusyKey(null)
    }
  }

  async function setPaused(agent, nextPaused) {
    setBusyKey(agent.stateDocId)
    setErr(null)
    try {
      const updatedBy = (currentUser && currentUser.uid) || 'admin'
      await setDoc(doc(db, 'aiAgentControls', agent.stateDocId), {
        enabled: true,
        paused: nextPaused,
        pauseReason: nextPaused ? 'Paused from Settings' : null,
        updatedBy,
        updatedAt: serverTimestamp(),
      }, { merge: true })
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <ControlCentreLayout
      title="Settings"
      helmetTitle="Settings — AI Control Centre"
    >
      {err && (
        <div className="text-rose-700 text-xs bg-rose-50 border border-rose-200 rounded p-2 mb-3">
          Failed: {err}
        </div>
      )}

      {/* 10a — auto-publish flags */}
      <section className="mb-6 bg-white border border-slate-200 rounded-lg p-4">
        <header className="mb-2">
          <h2 className="text-base font-bold text-slate-900">Auto-publish</h2>
          <p className="text-xs text-slate-600 leading-snug">
            Per-task-type publishing automation. Even when ON, the
            existing Quality Check gate refuses to publish anything
            whose <code>requiresHumanReview</code> is set or whose status
            is <code>failed</code>. Exam quizzes never auto-publish.
          </p>
        </header>
        {FLAGS.map(f => (
          <FlagRow
            key={f.key}
            flag={f}
            value={settings[f.key]}
            busy={busyKey === f.key}
            onToggle={setFlag}
          />
        ))}
      </section>

      {/* 10b — per-agent pause grid */}
      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <header className="mb-2">
          <h2 className="text-base font-bold text-slate-900">Per-agent pause control</h2>
          <p className="text-xs text-slate-600 leading-snug">
            Pausing an agent blocks new task chains at the dispatcher (existing
            cache TTL: 60s). The Live Monitor's per-agent card has the same
            controls; this grid is the canonical settings view.
          </p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
          {AGENTS.map(agent => {
            const ctrl = controls[agent.stateDocId] || {}
            const paused = ctrl.paused === true
            return (
              <div key={agent.stateDocId} className="border border-slate-200 rounded-lg p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">
                    {displayNameFor(agent, null)}
                  </div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                    {agent.kind}
                  </div>
                  {paused && ctrl.pauseReason && (
                    <div className="text-[11px] text-amber-700 mt-1">
                      {ctrl.pauseReason}
                    </div>
                  )}
                </div>
                <Toggle
                  on={!paused}
                  disabled={busyKey === agent.stateDocId}
                  ariaLabel={`Toggle ${agent.id} enabled`}
                  onClick={() => setPaused(agent, !paused)}
                />
              </div>
            )
          })}
        </div>
      </section>

      <p className="text-[10px] text-slate-400 mt-4">
        Every change is stamped with your admin uid (<code>{currentUser && currentUser.uid}</code>) +
        a server timestamp. The audit log picks the write up automatically.
      </p>
    </ControlCentreLayout>
  )
}
