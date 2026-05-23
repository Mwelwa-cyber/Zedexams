import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  collection, doc, getDocs, limit as fsLimit, onSnapshot, orderBy, query,
  serverTimestamp, updateDoc, where,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import { classForStatus } from './agentRegistry'

// Section 4 + 5: slide-in drawer showing a task's live detail +
// the admin control buttons.
//
// Listeners:
//   aiAgentTasks/{taskId}                             — task header
//   aiTaskSteps where taskId == X order by stepNumber — step graph
//   aiAgentLogs where taskId == X order by createdAt  — newest few logs
//
// Control actions (admin-only Firestore rules already in place):
//   Approve            → status='approved'   (triggers onApproved
//                                              → flips aiGeneratedContent
//                                              .status='published')
//   Reject             → status='rejected'
//   Regenerate         → status='regenerating'
//   Cancel             → status='rejected' + errorMessage set
//   Publish            → status='approved' (alias of Approve — kept as
//                                            a separate button so the
//                                            label reads naturally on
//                                            already-approved drafts)
//
// The drawer is mobile-friendly: full-width on small screens, 720px
// max on lg+.

function timeOf(ts) {
  if (!ts) return '—'
  const ms = ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

function Section({ title, children }) {
  return (
    <section className="px-4 py-3 border-b border-slate-100">
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
        {title}
      </h4>
      {children}
    </section>
  )
}

function StepRow({ step }) {
  const status = step.status || 'queued'
  const accent = status === 'completed' ? 'bg-emerald-500' :
    status === 'failed' ? 'bg-rose-500' :
    status === 'running' ? 'bg-blue-500 animate-pulse' :
    'bg-slate-300'
  return (
    <li className="flex items-start gap-2 py-1.5">
      <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${accent}`} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-slate-700">
          #{step.stepNumber} {step.stepTitle || step.agentName}
        </div>
        {step.message && (
          <div className="text-[11px] text-slate-500">{step.message}</div>
        )}
      </div>
      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${classForStatus(status)}`}>
        {status}
      </span>
    </li>
  )
}

export default function RunningTaskDetailDrawer({ taskId, onClose }) {
  const { currentUser } = useAuth()
  const [task, setTask] = useState(null)
  const [steps, setSteps] = useState([])
  const [logs, setLogs] = useState([])
  const [content, setContent] = useState(null)
  const [busy, setBusy] = useState(false)

  // Lock body scroll while drawer open
  useEffect(() => {
    if (!taskId) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [taskId])

  useEffect(() => {
    if (!taskId) return
    const unsubTask = onSnapshot(doc(db, 'aiAgentTasks', taskId), snap => {
      setTask(snap.exists() ? { id: snap.id, ...snap.data() } : null)
    })
    const unsubSteps = onSnapshot(
      query(
        collection(db, 'aiTaskSteps'),
        where('taskId', '==', taskId),
        orderBy('stepNumber', 'asc'),
      ),
      snap => setSteps(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    )
    const unsubLogs = onSnapshot(
      query(
        collection(db, 'aiAgentLogs'),
        where('taskId', '==', taskId),
        orderBy('createdAt', 'desc'),
        fsLimit(20),
      ),
      snap => setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    )
    return () => { unsubTask(); unsubSteps(); unsubLogs() }
  }, [taskId])

  // Resolve the latest aiGeneratedContent doc for this task so the
  // "Open generated content" button has a target.
  useEffect(() => {
    if (!task) return
    let cancelled = false
    async function load() {
      if (task.resultContentId) {
        try {
          const docs = await getDocs(query(
            collection(db, 'aiGeneratedContent'),
            where('__name__', '==', task.resultContentId),
            fsLimit(1),
          ))
          if (cancelled) return
          docs.forEach(d => setContent({ id: d.id, ...d.data() }))
          return
        } catch { /* fall through to grade/subject/topic lookup */ }
      }
      if (!task.grade) return
      try {
        const docs = await getDocs(query(
          collection(db, 'aiGeneratedContent'),
          where('grade', '==', String(task.grade)),
          where('subject', '==', String(task.subject || '')),
          where('topic', '==', String(task.topic || '')),
          orderBy('createdAt', 'desc'),
          fsLimit(1),
        ))
        if (cancelled) return
        docs.forEach(d => setContent({ id: d.id, ...d.data() }))
      } catch { /* swallow */ }
    }
    setContent(null)
    load()
    return () => { cancelled = true }
  }, [task])

  async function setStatus(nextStatus, extra = {}) {
    if (!taskId) return
    setBusy(true)
    try {
      await updateDoc(doc(db, 'aiAgentTasks', taskId), {
        status: nextStatus,
        ...extra,
        updatedAt: serverTimestamp(),
      })
    } catch (err) {
      alert(`Failed: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  if (!taskId) return null

  const canApprove = task && (task.status === 'needs_review' ||
    task.status === 'passed_quality_check')
  const canReject = task && !['rejected', 'published'].includes(task.status)
  const canRegenerate = task && ['failed_quality_check', 'needs_review',
    'rejected', 'error'].includes(task.status)
  const canCancel = task && ['queued', 'running', 'thinking', 'generating',
    'checking', 'waiting', 'regenerating'].includes(task.status)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Task ${taskId} detail`}
      className="fixed inset-0 z-50 flex justify-end"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close drawer"
        className="absolute inset-0 bg-slate-900/40"
      />
      <aside className="relative w-full max-w-xl lg:max-w-2xl bg-white h-full overflow-y-auto shadow-xl flex flex-col">
        <header className="px-4 py-3 border-b border-slate-200 sticky top-0 bg-white z-10 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-slate-500">Task</div>
            <h3 className="text-base font-bold text-slate-900 truncate">
              {task ? task.taskType : 'Loading…'}
            </h3>
            <div className="text-xs text-slate-500 truncate">
              {taskId}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {task && (
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${classForStatus(task.status)}`}>
                {task.status}
              </span>
            )}
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-slate-700 text-2xl leading-none px-1"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </header>

        {!task ? (
          <div className="p-6 text-sm text-slate-500">Loading task…</div>
        ) : (
          <>
            <Section title="Agent + curriculum">
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-slate-500">Agent</dt>
                <dd className="text-slate-900 font-medium">{task.agentName || '—'}</dd>
                <dt className="text-slate-500">Task type</dt>
                <dd className="text-slate-900 font-medium">{task.taskType}</dd>
                <dt className="text-slate-500">Grade</dt><dd>{task.grade || '—'}</dd>
                <dt className="text-slate-500">Subject</dt><dd>{task.subject || '—'}</dd>
                <dt className="text-slate-500">Term</dt><dd>{task.term || '—'}</dd>
                <dt className="text-slate-500">Topic</dt><dd>{task.topic || '—'}</dd>
                <dt className="text-slate-500">Subtopic</dt><dd>{task.subtopic || '—'}</dd>
                <dt className="text-slate-500">Started</dt><dd>{timeOf(task.startedAt)}</dd>
                <dt className="text-slate-500">Updated</dt><dd>{timeOf(task.updatedAt)}</dd>
                {task.completedAt && (<>
                  <dt className="text-slate-500">Completed</dt>
                  <dd>{timeOf(task.completedAt)}</dd>
                </>)}
              </dl>
              {task.errorMessage && (
                <div className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">
                  {task.errorMessage}
                </div>
              )}
            </Section>

            <Section title={`Step-by-step progress (${steps.length})`}>
              {steps.length ? (
                <ol className="text-sm">
                  {steps.map(s => <StepRow key={s.id} step={s} />)}
                </ol>
              ) : (
                <div className="text-xs text-slate-500">No step records yet.</div>
              )}
            </Section>

            <Section title={`Recent logs (${logs.length})`}>
              <ul className="text-xs space-y-1.5 max-h-48 overflow-y-auto">
                {logs.length === 0 && (
                  <li className="text-slate-500">No log entries yet.</li>
                )}
                {logs.map(l => (
                  <li key={l.id}>
                    <span className={
                      l.severity === 'error' ? 'text-rose-700' :
                      l.severity === 'warning' ? 'text-amber-700' :
                      'text-slate-700'
                    }>
                      <span className="font-mono text-[10px] text-slate-400">[{l.severity}]</span>{' '}
                      <span className="font-semibold">{l.agentName}</span>
                      {' · '}{l.action}{l.message ? ` — ${l.message}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>

            {content && (
              <Section title="Generated artifact">
                <div className="text-xs">
                  <div><strong>Type:</strong> {content.type} · <em>{content.status}</em></div>
                  <div className="text-slate-500">ID: {content.id}</div>
                </div>
              </Section>
            )}

            <Section title="Admin actions">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!canApprove || busy}
                  onClick={() => setStatus('approved', {
                    errorMessage: null,
                    reviewedBy: (currentUser && currentUser.uid) || 'admin',
                  })}
                  className="text-xs font-semibold px-3 py-1.5 rounded bg-emerald-600 text-white disabled:opacity-40 hover:bg-emerald-700"
                >
                  Approve &amp; Publish
                </button>
                <button
                  type="button"
                  disabled={!canReject || busy}
                  onClick={() => setStatus('rejected')}
                  className="text-xs font-semibold px-3 py-1.5 rounded bg-rose-600 text-white disabled:opacity-40 hover:bg-rose-700"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={!canRegenerate || busy}
                  onClick={() => setStatus('regenerating', { errorMessage: null })}
                  className="text-xs font-semibold px-3 py-1.5 rounded bg-amber-500 text-white disabled:opacity-40 hover:bg-amber-600"
                >
                  Regenerate
                </button>
                <button
                  type="button"
                  disabled={!canCancel || busy}
                  onClick={() => {
                    if (confirm('Cancel this running task?')) {
                      setStatus('rejected', { errorMessage: 'Cancelled by admin' })
                    }
                  }}
                  className="text-xs font-semibold px-3 py-1.5 rounded bg-slate-200 text-slate-700 disabled:opacity-40 hover:bg-slate-300"
                >
                  Cancel Task
                </button>
                <Link
                  to={`/admin/learner-ai/tasks/${taskId}`}
                  onClick={onClose}
                  className="text-xs font-semibold px-3 py-1.5 rounded bg-blue-50 text-blue-700 hover:bg-blue-100"
                >
                  Open full task page
                </Link>
                {content && (
                  <Link
                    to={`/admin/generations`}
                    onClick={onClose}
                    className="text-xs font-semibold px-3 py-1.5 rounded bg-violet-50 text-violet-700 hover:bg-violet-100"
                  >
                    Open generated content
                  </Link>
                )}
              </div>
              <p className="text-[10px] text-slate-500 mt-2 leading-snug">
                Exam quizzes never auto-publish — admin approval here flips
                the artifact to <code>published</code>. Curriculum updates land
                as reports and never apply automatically.
              </p>
            </Section>
          </>
        )}
      </aside>
    </div>
  )
}
