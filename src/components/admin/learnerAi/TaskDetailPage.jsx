import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  collection, doc, getDocs, limit as fsLimit, onSnapshot, orderBy, query,
  serverTimestamp, updateDoc, where,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import { prettyAgentName } from './agentRegistry'
import SeoHelmet from '../../seo/SeoHelmet'

// Render any of "4" / "G4" / "Grade 4" as "Grade 4". Defends against
// the historic mix of grade formats across task writers — the
// AgentBriefForm wrote "G4", the test-button (#566) wrote "Grade 4"
// before this fix, and aiPracticeQuizService writes the artifact's
// raw grade. Without normalisation the header rendered "GGrade 4"
// for the test button's malformed value.
function formatGrade(raw) {
  if (raw == null) return ''
  const s = String(raw).trim()
  if (!s) return ''
  // Already "Grade X" — leave it.
  if (/^grade\s/i.test(s)) return s.replace(/^grade\s+/i, 'Grade ')
  // "G4" / "G12" — strip the G prefix.
  const gMatch = s.match(/^G(\d+)$/i)
  if (gMatch) return `Grade ${gMatch[1]}`
  // Bare digit — prepend "Grade ".
  if (/^\d+$/.test(s)) return `Grade ${s}`
  // Anything else (e.g. "ECE") — pass through verbatim.
  return s
}

// Render "1" / "Term 1" / "T1" as "Term 1". Same defensive
// normalisation as formatGrade.
function formatTerm(raw) {
  if (raw == null) return ''
  const s = String(raw).trim()
  if (!s) return ''
  if (/^term\s/i.test(s)) return s.replace(/^term\s+/i, 'Term ')
  const tMatch = s.match(/^T(\d+)$/i)
  if (tMatch) return `Term ${tMatch[1]}`
  if (/^\d+$/.test(s)) return `Term ${s}`
  return s
}

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
  const [supervisorRows, setSupervisorRows] = useState([])
  const [gens, setGens] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!taskId) return
    const unsub = onSnapshot(doc(db, 'aiAgentTasks', taskId), snap => {
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
    const unsubSup = onSnapshot(
      query(
        collection(db, 'aiSupervisorLogs'),
        where('taskId', '==', taskId),
        orderBy('createdAt', 'asc'),
        fsLimit(20),
      ),
      snap => setSupervisorRows(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    )
    return () => { unsubLogs(); unsubSup() }
  }, [taskId])

  // v2: aiGeneratedContent doesn't carry taskId. Resolve by
  // resultContentId stamped on the task, or by (grade, subject, topic).
  useEffect(() => {
    if (!task) return
    let cancelled = false
    async function load() {
      const hits = []
      if (task.resultContentId) {
        try {
          const docs = await getDocs(query(
            collection(db, 'aiGeneratedContent'),
            where('__name__', '==', task.resultContentId),
            fsLimit(1),
          ))
          docs.forEach(d => hits.push({ id: d.id, ...d.data() }))
        } catch {
          // ignore
        }
      }
      if (!hits.length && task.grade) {
        try {
          const docs = await getDocs(query(
            collection(db, 'aiGeneratedContent'),
            where('grade', '==', String(task.grade)),
            where('subject', '==', String(task.subject || '')),
            where('topic', '==', String(task.topic || '')),
            orderBy('createdAt', 'desc'),
            fsLimit(5),
          ))
          docs.forEach(d => hits.push({ id: d.id, ...d.data() }))
        } catch {
          // ignore
        }
      }
      if (!cancelled) setGens(hits)
    }
    load()
    return () => { cancelled = true }
  }, [task])

  async function decide(status) {
    if (!task) return
    setBusy(true)
    try {
      await updateDoc(doc(db, 'aiAgentTasks', taskId), {
        status,
        updatedAt: serverTimestamp(),
      })
      navigate('/admin/learner-ai')
    } catch (err) {
      alert(`Failed to ${status}: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  if (!task) return <div className="p-6 text-slate-500">Loading task…</div>

  const canApprove = task.status === 'needs_review' || task.status === 'passed_quality_check'

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <SeoHelmet title={`Task ${taskId.slice(0, 8)} — Learner AI`} />
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">
          {task.taskType}{' '}
          <span className="ml-2 text-sm font-normal text-slate-500">{task.status}</span>
        </h1>
        <div className="text-sm text-slate-600 mt-1">
          {formatGrade(task.grade) || '—'} · {task.subject || '—'}
          {task.term ? ` · ${formatTerm(task.term)}` : ''}
          {' · '}{task.topic || '—'}{task.subtopic ? ` / ${task.subtopic}` : ''}
          {task.agentName ? ` · agent: ${prettyAgentName(task.agentName)}` : ''}
        </div>
        {task.errorMessage && (
          <div className="text-sm text-rose-700 mt-1">Error: {task.errorMessage}</div>
        )}
      </header>

      <Section title="Steps">
        {steps.length ? (
          <ul className="text-sm divide-y">
            {steps.map(s => (
              <li key={s.id} className="py-1.5">
                <span className="font-medium">#{s.stepNumber} {prettyAgentName(s.agentName)}</span>
                {' — '}{s.status}
                {s.message ? <span className="text-slate-500"> · {s.message}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-slate-500">No step records.</div>
        )}
      </Section>

      <Section title={`Supervisor decisions (${supervisorRows.length})`}>
        {supervisorRows.length ? (
          <ul className="text-sm divide-y">
            {supervisorRows.map(s => (
              <li key={s.id} className="py-1.5">
                <strong>{s.actionTaken}</strong> · confidence {(s.confidenceScore * 100).toFixed(0)}%
                <div className="text-slate-500 text-xs">{s.reason}</div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-slate-500">No supervisor decisions yet.</div>
        )}
      </Section>

      <Section title={`Generated artifacts (${gens.length})`}>
        {gens.length ? gens.map(g => (
          <div key={g.id} className="text-sm mb-3 pb-3 border-b last:border-b-0">
            <div>
              <strong>{g.type}</strong> · status: <em>{g.status}</em> · version {g.version}
            </div>
            <div className="text-slate-500 text-xs">ID: {g.id}</div>
            {g.curriculumReference && (
              <div className="text-xs text-slate-600 mt-1">
                Source: {g.curriculumReference.documentPath || '—'}
                {' · competency: '}{g.curriculumReference.competency || '—'}
              </div>
            )}
            <pre className="text-xs bg-slate-50 p-2 rounded mt-2 max-h-48 overflow-auto">{JSON.stringify(g.content, null, 2)}</pre>
            {g.qualityCheck && Object.keys(g.qualityCheck).length > 0 && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-slate-600">Quality check</summary>
                <pre className="bg-slate-50 p-2 rounded overflow-auto">{JSON.stringify(g.qualityCheck, null, 2)}</pre>
              </details>
            )}
          </div>
        )) : <div className="text-sm text-slate-500">No artifacts yet.</div>}
      </Section>

      <Section title={`Logs (${logs.length})`}>
        <ul className="text-xs divide-y max-h-72 overflow-auto">
          {logs.map(l => (
            <li key={l.id} className="py-1">
              <span className={
                l.severity === 'error' ? 'text-rose-700' :
                l.severity === 'warning' ? 'text-amber-600' :
                'text-slate-700'
              }>
                [{l.severity}] {prettyAgentName(l.agentName)}.{l.action} — {l.message}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {canApprove && (
        <div className="border border-orange-200 bg-orange-50 rounded-lg p-4 mt-6">
          <h3 className="font-semibold text-orange-900 mb-2">Review</h3>
          <div className="text-xs text-slate-600 mb-3">
            Approving flips the linked aiGeneratedContent doc to <code>published</code>.
            Reviewer: {currentUser?.email || currentUser?.uid || 'unknown'}
          </div>
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
