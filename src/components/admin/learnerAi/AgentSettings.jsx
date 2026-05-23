import { useEffect, useState } from 'react'
import {
  collection, doc, onSnapshot, serverTimestamp, setDoc, query,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import { GRADES, SUBJECTS } from '../../../config/curriculum'
import ControlCentreLayout from './ControlCentreLayout'
import { AGENTS, displayNameFor } from './agentRegistry'

// Permissive defaults — mirror functions/agents/learnerAi/automationGate.js
// so the UI shows the right initial state before the doc is created.
const AUTOMATION_DEFAULTS = Object.freeze({
  enabled: true,
  maxQuestionsPerDay: 100,
  maxQuizzesPerDay: 20,
  requireAdminApprovalForExamQuizzes: true,
  requireAdminApprovalForCurriculumUpdates: true,
  curriculumUpdateCheckFrequency: 'weekly',
  enabledGrades: [],
  enabledSubjects: [],
})

function utcDateKey() {
  const d = new Date()
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

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

function AutomationRulesSection({ automation, usage, busy, onPatch }) {
  const enabledGrades = Array.isArray(automation.enabledGrades) ? automation.enabledGrades : []
  const enabledSubjects = Array.isArray(automation.enabledSubjects) ? automation.enabledSubjects : []
  const questionsToday = (usage && usage.questionsGenerated) || 0
  const quizzesToday = (usage && usage.quizzesGenerated) || 0
  const questionCap = automation.maxQuestionsPerDay || 0
  const quizCap = automation.maxQuizzesPerDay || 0

  const qPct = questionCap ? Math.min(100, Math.round((questionsToday / questionCap) * 100)) : 0
  const qzPct = quizCap ? Math.min(100, Math.round((quizzesToday / quizCap) * 100)) : 0

  function toggleGrade(g) {
    const has = enabledGrades.map(String).includes(String(g))
    const next = has ?
      enabledGrades.filter(x => String(x) !== String(g)) :
      [...enabledGrades, String(g)]
    onPatch({ enabledGrades: next })
  }
  function toggleSubject(s) {
    const has = enabledSubjects.includes(s)
    const next = has ?
      enabledSubjects.filter(x => x !== s) :
      [...enabledSubjects, s]
    onPatch({ enabledSubjects: next })
  }
  function setNumber(key, val) {
    const n = Number(val)
    if (Number.isFinite(n)) onPatch({ [key]: Math.max(0, Math.floor(n)) })
  }

  const enabled = automation.enabled !== false

  return (
    <section className={`mb-6 rounded-lg p-4 border-2 ${
      enabled ? 'bg-white border-emerald-200' : 'bg-rose-50 border-rose-300'
    }`}>
      <header className="mb-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900">Automation rules</h2>
          <p className="text-xs text-slate-600 leading-snug mt-0.5">
            Master kill switch, daily quotas, grade + subject whitelists,
            curriculum-update frequency. Read by the dispatcher's
            automation gate on every task.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded ${
            enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
          }`}>
            {enabled ? 'Automation ON' : 'PAUSED'}
          </span>
          <Toggle
            on={enabled}
            disabled={busy}
            ariaLabel="Master automation toggle"
            onClick={() => onPatch({ enabled: !enabled })}
          />
        </div>
      </header>

      {/* Daily caps */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div className="border border-slate-200 rounded p-3">
          <label className="text-xs font-semibold text-slate-700 block mb-1">
            Max questions per day
          </label>
          <input
            type="number"
            min={0}
            max={10000}
            value={automation.maxQuestionsPerDay ?? AUTOMATION_DEFAULTS.maxQuestionsPerDay}
            onChange={e => setNumber('maxQuestionsPerDay', e.target.value)}
            disabled={busy}
            className="w-full text-sm border border-slate-300 rounded px-2 py-1 mb-2"
          />
          <div className="text-[11px] text-slate-500 mb-1">
            Today: <strong className="tabular-nums text-slate-900">{questionsToday}</strong> / {questionCap}
          </div>
          <div className="h-1.5 bg-slate-100 rounded overflow-hidden">
            <div
              className={`h-full transition-all ${qPct >= 100 ? 'bg-rose-500' : qPct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${qPct}%` }}
            />
          </div>
        </div>
        <div className="border border-slate-200 rounded p-3">
          <label className="text-xs font-semibold text-slate-700 block mb-1">
            Max quizzes per day
          </label>
          <input
            type="number"
            min={0}
            max={1000}
            value={automation.maxQuizzesPerDay ?? AUTOMATION_DEFAULTS.maxQuizzesPerDay}
            onChange={e => setNumber('maxQuizzesPerDay', e.target.value)}
            disabled={busy}
            className="w-full text-sm border border-slate-300 rounded px-2 py-1 mb-2"
          />
          <div className="text-[11px] text-slate-500 mb-1">
            Today: <strong className="tabular-nums text-slate-900">{quizzesToday}</strong> / {quizCap}
          </div>
          <div className="h-1.5 bg-slate-100 rounded overflow-hidden">
            <div
              className={`h-full transition-all ${qzPct >= 100 ? 'bg-rose-500' : qzPct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${qzPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Curriculum-update frequency */}
      <div className="border border-slate-200 rounded p-3 mb-4">
        <label className="text-xs font-semibold text-slate-700 block mb-2">
          Curriculum-update check frequency
        </label>
        <div className="flex gap-2">
          {['weekly', 'monthly'].map(opt => (
            <label key={opt} className={`text-xs font-semibold px-3 py-1.5 rounded-full cursor-pointer ${
              automation.curriculumUpdateCheckFrequency === opt ?
                'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}>
              <input
                type="radio"
                className="sr-only"
                name="curriculumUpdateCheckFrequency"
                value={opt}
                checked={automation.curriculumUpdateCheckFrequency === opt}
                onChange={() => onPatch({ curriculumUpdateCheckFrequency: opt })}
                disabled={busy}
              />
              {opt}
            </label>
          ))}
        </div>
        <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">
          Overrides the per-source defaults in curriculumWatcher.js. Reports
          still land at <code>pending_review</code> — never auto-applied.
        </p>
      </div>

      {/* Enabled grades */}
      <div className="border border-slate-200 rounded p-3 mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-slate-700">Enabled grades</label>
          {enabledGrades.length === 0 && (
            <span className="text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">
              all allowed
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {GRADES.map(g => {
            const on = enabledGrades.map(String).includes(String(g))
            return (
              <button
                key={g}
                type="button"
                onClick={() => toggleGrade(g)}
                disabled={busy}
                className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                  on ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                G{g}
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">
          Empty = no restriction. Pick specific grades to block tasks for any
          grade not on the list.
        </p>
      </div>

      {/* Enabled subjects */}
      <div className="border border-slate-200 rounded p-3 mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-slate-700">Enabled subjects</label>
          {enabledSubjects.length === 0 && (
            <span className="text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">
              all allowed
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SUBJECTS.map(s => {
            const on = enabledSubjects.includes(s.label)
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleSubject(s.label)}
                disabled={busy}
                className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                  on ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {s.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Hard-rule pins */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {[
          { label: 'Exam quizzes always require admin approval', key: 'requireAdminApprovalForExamQuizzes' },
          { label: 'Curriculum updates always require admin approval', key: 'requireAdminApprovalForCurriculumUpdates' },
        ].map(rule => (
          <div key={rule.key} className="flex items-center gap-2 text-xs bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
            <span className="text-emerald-700 font-bold">✓</span>
            <span className="text-slate-700 flex-1">{rule.label}</span>
            <span className="text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">
              always on
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function AgentSettings() {
  const { currentUser } = useAuth()
  const [settings, setSettings] = useState({})
  const [automation, setAutomation] = useState(AUTOMATION_DEFAULTS)
  const [usage, setUsage] = useState(null)
  const [controls, setControls] = useState({})
  const [busyKey, setBusyKey] = useState(null)
  const [err, setErr] = useState(null)

  // aiAutomationSettings/global listener — drives the new top section.
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'aiAutomationSettings', 'global'),
      snap => {
        if (snap.exists()) {
          const data = snap.data() || {}
          setAutomation({ ...AUTOMATION_DEFAULTS, ...data })
        } else {
          setAutomation(AUTOMATION_DEFAULTS)
        }
      },
      e => setErr(e.message),
    )
    return () => unsub()
  }, [])

  // aiUsageDaily/{today} listener — live "today: X / cap" indicator.
  useEffect(() => {
    const today = utcDateKey()
    const unsub = onSnapshot(
      doc(db, 'aiUsageDaily', today),
      snap => setUsage(snap.exists() ? snap.data() : { questionsGenerated: 0, quizzesGenerated: 0, artifactsGenerated: 0 }),
      () => setUsage({ questionsGenerated: 0, quizzesGenerated: 0, artifactsGenerated: 0 }),
    )
    return () => unsub()
  }, [])

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

  // Writer for the aiAutomationSettings/global doc. Always merges
  // so partial admin edits (e.g. toggling only enabled) don't blow
  // away the rest of the settings. Pins the two admin-approval
  // hard-rule literals to true on every write — the server-side
  // gate would refuse the doc otherwise.
  async function patchAutomation(patch) {
    setBusyKey('automation')
    setErr(null)
    try {
      const updatedBy = (currentUser && currentUser.uid) || 'admin'
      await setDoc(doc(db, 'aiAutomationSettings', 'global'), {
        ...AUTOMATION_DEFAULTS,
        ...automation,
        ...patch,
        requireAdminApprovalForExamQuizzes: true,
        requireAdminApprovalForCurriculumUpdates: true,
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

      {/* Automation rules — master kill switch, daily quotas, whitelists,
          curriculum-update frequency. Writes to aiAutomationSettings/global;
          the dispatcher's automationGate.js consults this doc on every
          task. */}
      <AutomationRulesSection
        automation={automation}
        usage={usage}
        busy={busyKey === 'automation'}
        onPatch={patchAutomation}
      />

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
