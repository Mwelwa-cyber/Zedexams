import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  collection, doc, getDocs, limit as fsLimit, onSnapshot, orderBy, query,
  serverTimestamp, updateDoc, where,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import SeoHelmet from '../../seo/SeoHelmet'

function Section({ title, children }) {
  return (
    <section className="mb-6 border border-slate-200 rounded-lg bg-white p-4">
      <h3 className="font-semibold text-slate-900 mb-2">{title}</h3>
      {children}
    </section>
  )
}

export default function TaskDetailPage() {
  const { taskId } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const [task, setTask] = useState(null)
  const [steps, setSteps] = useState([])
  const [logs, setLogs] = useState([])
  const [gens, setGens] = useState([])
  const [reviewNotes, setReviewNotes] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!taskId) return
    const unsub = onSnapshot(doc(db, 'aiAgentTasks', taskId), snap => {
      setTask(snap.exists() ? { id: snap.id, ...snap.data() } : null)
    })
    const unsubSteps = onSnapshot(
      query(collection(db, 'aiAgentTasks', taskId, 'steps'), orderBy('stepNumber', 'asc')),
      snap => setSteps(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    )
    return () => { unsub(); unsubSteps() }
  }, [taskId])

  useEffect(() => {
    if (!taskId) return
    const unsubLogs = onSnapshot(
      query(
        collection(db, 'aiAgentLogs'),
        where('taskId', '==', taskId),
        orderBy('createdAt', 'asc'),
        fsLimit(50),
      ),
      snap => setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    )
    return () => unsubLogs()
  }, [taskId])

  useEffect(() => {
    if (!taskId) return
    let cancelled = false
    getDocs(query(
      collection(db, 'learnerAiGenerations'),
      where('taskId', '==', taskId),
      orderBy('createdAt', 'desc'),
      fsLimit(10),
    )).then(snap => {
      if (cancelled) return
      setGens(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [taskId, task?.status])

  async function decide(status) {
    if (!task) return
    setBusy(true)
    try {
      await updateDoc(doc(db, 'aiAgentTasks', taskId), {
        status,
        reviewedBy: currentUser?.uid || null,
        reviewedAt: serverTimestamp(),
        reviewNotes: reviewNotes || null,
      })
      navigate('/admin/learner-ai')
    } catch (err) {
      alert(`Failed to ${status}: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  if (!task) return <div className="p-6 text-slate-500">Loading task…</div>

  const canApprove = task.status === 'awaiting_approval'

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <SeoHelmet title={`Task ${taskId.slice(0, 8)} — Learner AI`} />
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">
          {task.taskType}{' '}
          <span className="ml-2 text-sm font-normal text-slate-500">{task.status}</span>
        </h1>
        <div className="text-sm text-slate-600 mt-1">
          G{task.grade} · {task.subject} · {task.topic || '—'} {task.subtopic ? `/ ${task.subtopic}` : ''}
        </div>
      </header>

      <Section title="Curriculum reference">
        {task.curriculumRef ? (
          <div className="text-sm">
            <div><strong>Source doc:</strong> {task.curriculumRef.sourceDocId}</div>
            <div><strong>KB version:</strong> {task.curriculumRef.kbVersion}</div>
            <div><strong>Module:</strong> {task.curriculumRef.moduleId}</div>
            <div><strong>Storage path:</strong> {task.curriculumRef.storagePath || '—'}</div>
            <div><strong>Cited excerpts:</strong> {task.curriculumRef.citedExcerpts?.length || 0}</div>
            {task.curriculumRef.citedExcerpts?.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-slate-700">
                {task.curriculumRef.citedExcerpts.slice(0, 5).map((e, i) => (
                  <li key={i}><span className="text-slate-400">[{i}]</span> {e.text}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="text-sm text-slate-500">
            No curriculumRef yet (Curriculum Reader has not run or refused).
          </div>
        )}
      </Section>

      <Section title="Supervisor plan">
        {task.supervisorPlan ? (
          <ol className="text-sm list-decimal pl-5">
            {task.supervisorPlan.steps?.map((s, i) => (
              <li key={i} className={s.status === 'failed' ? 'text-rose-700' : s.status === 'succeeded' ? 'text-emerald-700' : 'text-slate-700'}>
                {s.agentId} — {s.status || 'pending'}
              </li>
            ))}
          </ol>
        ) : (
          <div className="text-sm text-slate-500">No plan yet.</div>
        )}
      </Section>

      <Section title="Steps">
        {steps.length ? (
          <ul className="text-sm divide-y">
            {steps.map(s => (
              <li key={s.id} className="py-1.5">
                <span className="font-medium">#{s.stepNumber} {s.agentId}</span> — {s.status} {s.durationMs ? `(${s.durationMs}ms)` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-slate-500">No step records.</div>
        )}
      </Section>

      <Section title="Quality verdict">
        {task.qualityVerdict ? (
          <pre className="text-xs bg-slate-50 p-2 rounded overflow-x-auto">{JSON.stringify(task.qualityVerdict, null, 2)}</pre>
        ) : (
          <div className="text-sm text-slate-500">Quality check pending.</div>
        )}
      </Section>

      <Section title={`Generated artifacts (${gens.length})`}>
        {gens.length ? gens.map(g => (
          <div key={g.id} className="text-sm mb-3 pb-3 border-b last:border-b-0">
            <div><strong>{g.artifactType}</strong> · visibility: <em>{g.visibility}</em></div>
            <div className="text-slate-500 text-xs">ID: {g.id}</div>
            <pre className="text-xs bg-slate-50 p-2 rounded mt-2 max-h-48 overflow-auto">{JSON.stringify(g.content, null, 2)}</pre>
          </div>
        )) : <div className="text-sm text-slate-500">No artifacts yet.</div>}
      </Section>

      <Section title={`Logs (${logs.length})`}>
        <ul className="text-xs divide-y max-h-72 overflow-auto">
          {logs.map(l => (
            <li key={l.id} className="py-1">
              <span className={
                l.level === 'error' ? 'text-rose-700' :
                l.level === 'blocked' ? 'text-amber-700' :
                l.level === 'warning' ? 'text-amber-600' :
                'text-slate-700'
              }>
                [{l.level}] {l.agentId}.{l.action} — grounded:{String(l.curriculumGrounded)}
                {l.outputSummary ? ' · ' + (typeof l.outputSummary === 'string' ? l.outputSummary : JSON.stringify(l.outputSummary).slice(0, 200)) : ''}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {canApprove && (
        <div className="border border-orange-200 bg-orange-50 rounded-lg p-4 mt-6">
          <h3 className="font-semibold text-orange-900 mb-2">Review</h3>
          <textarea
            value={reviewNotes}
            onChange={e => setReviewNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="w-full border border-orange-200 rounded p-2 text-sm"
            rows={3}
          />
          <div className="flex gap-3 mt-3">
            <button
              onClick={() => decide('approved')}
              disabled={busy}
              className="px-4 py-2 bg-emerald-600 text-white rounded font-medium disabled:opacity-50"
            >
              Approve & publish
            </button>
            <button
              onClick={() => decide('rejected')}
              disabled={busy}
              className="px-4 py-2 bg-rose-600 text-white rounded font-medium disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
