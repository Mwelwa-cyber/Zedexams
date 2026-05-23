import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  collection, doc, limit as fsLimit, onSnapshot,
  orderBy, query, serverTimestamp, updateDoc, where,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import ControlCentreLayout from './ControlCentreLayout'
import CompareVersionsPanel from './CompareVersionsPanel'
import {
  examQuizToAssessment, suggestExamQuizFilename,
} from '../../../utils/examQuizToAssessment'

// Full-screen single-artifact review page for AI-generated exam quiz
// drafts. Renders the formal Zambian paper format (school / grade /
// term / year / subject / paper name / learner-name & date
// placeholders / time / total marks / instructions / Section A /
// Section B / Section C / answer key / marking guide) PLUS the
// verifier verdicts (Standards Check, Quality Check, Supervisor
// Decision, Curriculum Reference) admins need to make the call.
//
// Hard rules enforced server-side (mirrored in the UI):
//   - Exam quizzes never auto-publish (absent from
//     dispatcher.js AUTO_PUBLISH_SETTING_BY_TASK).
//   - Quality Check pins requiresHumanReview=true for every exam
//     artifact (Supervisor Decision then refuses to auto-approve).
//   - Approve / Reject / Regenerate flip the LINKED aiAgentTasks
//     doc — the dispatcher's onUpdate trigger publishes the artifact.
//   - Edit reuses the existing Regenerate-with-notes flow (the only
//     editor for AI artifacts; we never directly edit the
//     content doc — that would bypass the verifier chain).
//
// Route: /admin/learner-ai/exams/:contentId
// Linked from: ArtifactCard's "View" button when type==='exam_quiz'.

const STATUS_CLASSES = {
  draft:                 'bg-slate-100 text-slate-700 border-slate-300',
  awaiting_supervisor:   'bg-amber-50  text-amber-800  border-amber-300',
  needs_review:          'bg-amber-50  text-amber-800  border-amber-300',
  awaiting_approval:     'bg-amber-50  text-amber-800  border-amber-300',
  approved:              'bg-emerald-50 text-emerald-800 border-emerald-300',
  published:             'bg-emerald-50 text-emerald-800 border-emerald-300',
  rejected:              'bg-rose-50   text-rose-700   border-rose-300',
  regenerate_required:   'bg-amber-50  text-amber-800  border-amber-300',
}

function StatusBadge({ status }) {
  const cls = STATUS_CLASSES[status] || STATUS_CLASSES.draft
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${cls}`}>
      {status || 'draft'}
    </span>
  )
}

function VerdictPill({ status }) {
  const map = {
    passed:        'bg-emerald-50 text-emerald-700 border-emerald-300',
    failed:        'bg-rose-50    text-rose-700    border-rose-300',
    needs_review:  'bg-amber-50   text-amber-800   border-amber-300',
    approved:      'bg-emerald-50 text-emerald-700 border-emerald-300',
    rejected:      'bg-rose-50    text-rose-700    border-rose-300',
    sent_for_review:    'bg-amber-50 text-amber-800 border-amber-300',
    regenerate_required:'bg-amber-50 text-amber-800 border-amber-300',
  }
  const cls = map[status] || 'bg-slate-50 text-slate-700 border-slate-300'
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${cls}`}>
      {status || '—'}
    </span>
  )
}

function ConfidenceBar({ value }) {
  const pct = Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)
  const cls = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-slate-600 w-9 text-right">{pct}%</span>
    </div>
  )
}

function VerdictPanel({ title, verdict, emptyHint }) {
  if (!verdict || typeof verdict !== 'object') {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
          {title}
        </h3>
        <p className="text-xs text-slate-500">{emptyHint || 'Not run yet.'}</p>
      </section>
    )
  }
  const status = verdict.decision || verdict.status
  const confidence = verdict.confidenceScore
  const issues = Array.isArray(verdict.issues) ? verdict.issues : []
  const recs = Array.isArray(verdict.recommendations) ? verdict.recommendations : []
  const fixes = Array.isArray(verdict.fixedSuggestions) ? verdict.fixedSuggestions : []
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          {title}
        </h3>
        <VerdictPill status={status} />
      </header>
      {Number.isFinite(confidence) && <ConfidenceBar value={confidence} />}
      {verdict.reason && (
        <p className="text-xs text-slate-700 leading-snug whitespace-pre-wrap">
          {verdict.reason}
        </p>
      )}
      {issues.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mt-1">
            Issues ({issues.length})
          </div>
          <ul className="text-xs text-slate-700 space-y-1 mt-1">
            {issues.slice(0, 8).map((it, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className={
                  it.severity === 'critical' ? 'text-rose-600 font-bold' : 'text-amber-700'
                }>
                  {it.severity === 'critical' ? '✗' : '!'}
                </span>
                <span className="flex-1">
                  <span className="font-semibold">{it.axis}</span>{' — '}
                  <span>{it.message}</span>
                  {it.path && (
                    <span className="text-slate-400 ml-1">({it.path})</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {fixes.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mt-1">
            Suggested fixes
          </div>
          <ul className="text-xs text-slate-700 space-y-0.5 list-disc pl-4 mt-1">
            {fixes.slice(0, 8).map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
      {recs.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mt-1">
            Recommendations
          </div>
          <ul className="text-xs text-slate-700 space-y-0.5 list-disc pl-4 mt-1">
            {recs.slice(0, 8).map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
    </section>
  )
}

function CurriculumReferencePanel({ artifact }) {
  const c = artifact.content || {}
  const grade = artifact.grade
  const subject = artifact.subject
  const term = artifact.term
  const topic = artifact.topic
  const subtopic = artifact.subtopic
  const competency = c.competency || (c.parametersUsed && c.parametersUsed.competency)
  const learningOutcome = c.learningOutcome ||
    (c.parametersUsed && c.parametersUsed.learningOutcome)
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 space-y-1.5">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
        Curriculum reference
      </h3>
      <dl className="text-xs text-slate-700 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
        {grade && <><dt className="font-semibold">Grade</dt><dd>{grade}</dd></>}
        {subject && <><dt className="font-semibold">Subject</dt><dd>{subject}</dd></>}
        {term && <><dt className="font-semibold">Term</dt><dd>{term}</dd></>}
        {topic && <><dt className="font-semibold">Topic</dt><dd>{topic}</dd></>}
        {subtopic && <><dt className="font-semibold">Subtopic</dt><dd>{subtopic}</dd></>}
        {competency && <><dt className="font-semibold">Competency</dt><dd>{competency}</dd></>}
        {learningOutcome && (
          <>
            <dt className="font-semibold">Outcome</dt>
            <dd className="whitespace-pre-wrap">{learningOutcome}</dd>
          </>
        )}
      </dl>
    </section>
  )
}

function PaperHeader({ header }) {
  const h = header || {}
  return (
    <header className="border-b-2 border-slate-900 pb-3 mb-4 space-y-2">
      <div className="text-center">
        <h2 className="text-base font-bold uppercase tracking-wider text-slate-900">
          {h.schoolName || '_____________________________'}
        </h2>
        {h.paperName && (
          <div className="text-xs text-slate-700 mt-0.5">{h.paperName}</div>
        )}
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-slate-800">
        <Field label="Grade" value={h.grade} />
        <Field label="Subject" value={h.subject} />
        <Field label="Term" value={h.term ? `Term ${h.term}` : ''} />
        <Field label="Year" value={h.year} />
        <Field label={h.learnerNameLabel || 'Learner name'} value="_______________________" />
        <Field label={h.dateLabel || 'Date'} value="________________" />
        <Field label={h.timeLabel || 'Time'} value={h.timeAllowed} />
        <Field label="Total marks" value={h.totalMarks} />
      </dl>
      {Array.isArray(h.instructions) && h.instructions.length > 0 && (
        <div>
          <div className="text-xs font-bold text-slate-900 mt-2">Instructions</div>
          <ol className="text-xs text-slate-800 list-decimal pl-5 mt-0.5 space-y-0.5">
            {h.instructions.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </div>
      )}
    </header>
  )
}

function Field({ label, value }) {
  if (value == null || value === '') return null
  return (
    <div>
      <dt className="font-semibold text-slate-500 text-[10px] uppercase tracking-wider">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  )
}

function SectionBlock({ section }) {
  const questions = Array.isArray(section.questions) ? section.questions : []
  return (
    <section className="mb-5">
      <h3 className="text-sm font-bold text-slate-900 border-b border-slate-300 pb-1 mb-2">
        {section.title || `Section ${section.id}`}
        <span className="float-right text-xs text-slate-600 font-normal tabular-nums">
          ({section.marks || 0} marks)
        </span>
      </h3>
      {section.instructions && (
        <p className="text-xs italic text-slate-600 mb-2">{section.instructions}</p>
      )}
      <ol className="space-y-2 text-sm text-slate-800">
        {questions.map((q, idx) => (
          <li key={idx} className="leading-snug">
            <div>
              <span className="font-bold">{q.number || idx + 1}.</span>{' '}
              <span className="whitespace-pre-wrap">{q.prompt}</span>
              <span className="text-xs text-slate-600 ml-2 tabular-nums">
                ({q.marks || 0} marks)
              </span>
            </div>
            {Array.isArray(q.options) && q.options.length > 0 && (
              <ol type="A" className="pl-6 mt-1 text-sm text-slate-700 space-y-0.5">
                {q.options.map((opt, i) => <li key={i}>{opt}</li>)}
              </ol>
            )}
            {Array.isArray(q.structuredParts) && q.structuredParts.length > 0 && (
              <ol type="a" className="pl-6 mt-1 text-sm text-slate-700 space-y-1">
                {q.structuredParts.map((p, i) => (
                  <li key={i}>
                    <span className="whitespace-pre-wrap">{p.prompt}</span>
                    <span className="text-xs text-slate-500 ml-2 tabular-nums">
                      ({p.marks || 0} marks)
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

function AnswerKeyTable({ answerKey }) {
  const rows = Array.isArray(answerKey) ? answerKey : []
  if (!rows.length) {
    return <p className="text-xs text-slate-500">No answer-key entries.</p>
  }
  return (
    <div className="overflow-x-auto border border-slate-200 rounded-lg">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-600 uppercase">
          <tr>
            <th className="px-2 py-1.5 text-left">Sec</th>
            <th className="px-2 py-1.5 text-left">Q#</th>
            <th className="px-2 py-1.5 text-left">Answer</th>
            <th className="px-2 py-1.5 text-left">Marks</th>
            <th className="px-2 py-1.5 text-left">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((k, idx) => (
            <tr key={`${k.sectionId}-${k.questionNumber}-${idx}`}
                className="border-t border-slate-100">
              <td className="px-2 py-1 font-semibold">{k.sectionId}</td>
              <td className="px-2 py-1">{k.questionNumber}</td>
              <td className="px-2 py-1 max-w-[320px] whitespace-pre-wrap">{k.answer}</td>
              <td className="px-2 py-1 tabular-nums">{k.marks}</td>
              <td className="px-2 py-1 text-slate-600">{k.markingNotes || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

async function setTaskStatus({ taskId, status, extra = {} }) {
  if (!taskId) {
    alert('No source task linked to this artifact. Cannot change status.')
    return false
  }
  try {
    await updateDoc(doc(db, 'aiAgentTasks', taskId), {
      status, ...extra, updatedAt: serverTimestamp(),
    })
    return true
  } catch (e) {
    alert(`Failed: ${e.message}`)
    return false
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function buildPrintHtml(artifact, { withAnswerKey = false } = {}) {
  const { assessment, questions, answerKey, markingGuide } =
    examQuizToAssessment(artifact.content || {})
  const sections = new Map()
  for (const q of questions) {
    if (!sections.has(q.sectionId)) {
      sections.set(q.sectionId, {
        title: q.sectionTitle || `Section ${q.sectionId}`,
        marks: q.sectionMarks || 0,
        instructions: q.sectionInstructions || '',
        questions: [],
      })
    }
    sections.get(q.sectionId).questions.push(q)
  }
  const sectionsHtml = [...sections.values()].map((s) => `
    <section class="exam-section">
      <h2>${escapeHtml(s.title)} <small>(${s.marks} marks)</small></h2>
      ${s.instructions ? `<p class="exam-instructions">${escapeHtml(s.instructions)}</p>` : ''}
      <ol class="exam-questions">
        ${s.questions.map(q => `
          <li>
            <p><strong>${q.number}.</strong> ${escapeHtml(q.prompt)}
               <span class="exam-marks">(${q.marks} marks)</span></p>
            ${q.options.length ? `<ol type="A" class="exam-options">${q.options.map(o => `<li>${escapeHtml(o)}</li>`).join('')}</ol>` : ''}
            ${q.structuredParts.length ? `<ol type="a" class="exam-parts">${q.structuredParts.map(p => `<li>${escapeHtml(p.prompt)} <span class="exam-marks">(${p.marks} marks)</span></li>`).join('')}</ol>` : ''}
          </li>
        `).join('')}
      </ol>
    </section>
  `).join('')
  const instructionsHtml = (assessment.instructions || [])
    .map(i => `<li>${escapeHtml(i)}</li>`).join('')

  const keyHtml = withAnswerKey && answerKey.length ? `
    <section class="answer-key">
      <h2>Answer key + marking guide</h2>
      <table>
        <thead><tr><th>Section</th><th>Q#</th><th>Answer</th><th>Marks</th><th>Notes</th></tr></thead>
        <tbody>
          ${answerKey.map(k => `<tr>
            <td>${escapeHtml(k.sectionId)}</td>
            <td>${k.questionNumber}</td>
            <td>${escapeHtml(k.answer)}</td>
            <td>${k.marks}</td>
            <td>${escapeHtml(k.markingNotes || '')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${markingGuide ? `<p class="marking-guide">${escapeHtml(markingGuide)}</p>` : ''}
    </section>
  ` : ''

  return `<!doctype html><html><head><meta charset="utf-8" />
    <title>${escapeHtml(assessment.title || 'Exam paper')}</title>
    <style>
      body { font-family: serif; padding: 1.5cm; color: #1a202c; }
      h1 { font-size: 18pt; margin-bottom: 0.25rem; text-align: center; }
      h2 { font-size: 13pt; margin-top: 1.5rem; }
      .exam-header { border-bottom: 2px solid #1a202c; padding-bottom: 0.5rem; margin-bottom: 1rem; }
      .exam-header dl { display: grid; grid-template-columns: max-content 1fr max-content 1fr; gap: 0.25rem 1rem; font-size: 10pt; }
      .exam-header dt { font-weight: bold; }
      .exam-instructions { font-style: italic; color: #4a5568; }
      ol.exam-questions { padding-left: 1.25rem; }
      ol.exam-questions > li { margin-bottom: 0.75rem; }
      ol.exam-options { padding-left: 1.5rem; font-size: 11pt; }
      ol.exam-parts { padding-left: 1.5rem; font-size: 11pt; }
      .exam-marks { float: right; color: #4a5568; }
      .answer-key { page-break-before: always; }
      .answer-key table { width: 100%; border-collapse: collapse; font-size: 10pt; margin-top: 0.5rem; }
      .answer-key th, .answer-key td { border: 1px solid #cbd5e0; padding: 0.25rem 0.5rem; text-align: left; vertical-align: top; }
      .marking-guide { margin-top: 1rem; white-space: pre-wrap; font-size: 10pt; }
      @media print { body { padding: 1cm; } }
    </style>
  </head><body>
    <div class="exam-header">
      <h1>${escapeHtml(assessment.schoolName || '_____________________')}</h1>
      ${assessment.paperName ? `<p style="text-align:center;margin:0;">${escapeHtml(assessment.paperName)}</p>` : ''}
      <dl>
        <dt>Grade</dt><dd>${escapeHtml(assessment.grade)}</dd>
        <dt>Subject</dt><dd>${escapeHtml(assessment.subject)}</dd>
        <dt>Term</dt><dd>${escapeHtml(assessment.term)}</dd>
        <dt>Year</dt><dd>${assessment.year}</dd>
        <dt>${escapeHtml(assessment.learnerNameLabel)}</dt><dd>_____________________</dd>
        <dt>${escapeHtml(assessment.dateLabel)}</dt><dd>_____________________</dd>
        <dt>${escapeHtml(assessment.timeLabel)}</dt><dd>${escapeHtml(assessment.timeAllowed)}</dd>
        <dt>Total marks</dt><dd>${assessment.totalMarks}</dd>
      </dl>
      ${instructionsHtml ? `<p style="font-weight:bold;margin-top:0.5rem;">Instructions</p><ol>${instructionsHtml}</ol>` : ''}
    </div>
    ${sectionsHtml}
    ${keyHtml}
  </body></html>`
}

function openPrintWindow(html) {
  const w = window.open('', '_blank', 'noopener,noreferrer')
  if (!w) {
    alert('Pop-up blocked. Allow pop-ups for this site to use Print Preview.')
    return null
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.focus()
  return w
}

async function handlePrintPreview(artifact) {
  const w = openPrintWindow(buildPrintHtml(artifact, { withAnswerKey: false }))
  if (!w) return
  setTimeout(() => { try { w.print() } catch { /* ignore */ } }, 250)
}

async function handleDownloadPdf(artifact) {
  // Browser-based "Save as PDF" via the print dialog. The print-window
  // HTML already has the proper @media print CSS so the result matches
  // Print Preview exactly. No extra dependency needed.
  const w = openPrintWindow(buildPrintHtml(artifact, { withAnswerKey: false }))
  if (!w) return
  setTimeout(() => {
    try { w.print() } catch { /* ignore */ }
  }, 300)
}

async function handleDownloadWord(artifact) {
  try {
    const { downloadAssessmentDocx } = await import('../../../utils/assessmentToDocx')
    const adapted = examQuizToAssessment(artifact.content || {})
    const filename = suggestExamQuizFilename(artifact.content || {}, 'docx')
    await downloadAssessmentDocx(
      adapted.assessment, adapted.questions, filename, { mode: 'paper' },
    )
  } catch (err) {
    alert(`Word download failed: ${err && err.message || err}.`)
  }
}

export default function ExamDraftDetailPage() {
  const { contentId } = useParams()
  const [artifact, setArtifact] = useState(null)
  const [linkedTaskId, setLinkedTaskId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [showRegen, setShowRegen] = useState(false)
  const [regenMode, setRegenMode] = useState('edit')  // 'edit' | 'regenerate'
  const [regenNotes, setRegenNotes] = useState('')
  const [showVersions, setShowVersions] = useState(false)

  // Live subscription to the artifact so admins see the latest verdict
  // when the supervisor finishes during review.
  useEffect(() => {
    if (!contentId) return undefined
    const ref = doc(db, 'aiGeneratedContent', contentId)
    const unsub = onSnapshot(
      ref,
      snap => {
        if (!snap.exists()) {
          setErr('Artifact not found.')
          setArtifact(null)
          return
        }
        setArtifact({ id: snap.id, ...snap.data() })
        setErr(null)
      },
      e => setErr(e.message),
    )
    return () => unsub()
  }, [contentId])

  // Resolve the source aiAgentTasks doc so we can flip its status for
  // approve / reject / regenerate.
  useEffect(() => {
    if (!contentId) return undefined
    const q = query(
      collection(db, 'aiAgentTasks'),
      where('resultContentId', '==', contentId),
      orderBy('updatedAt', 'desc'),
      fsLimit(1),
    )
    const unsub = onSnapshot(
      q,
      snap => {
        snap.forEach(d => setLinkedTaskId(d.id))
      },
      () => {},
    )
    return () => unsub()
  }, [contentId])

  if (err) {
    return (
      <ControlCentreLayout title="Exam draft" helmetTitle="Exam draft — AI Control Centre">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {err}
        </div>
        <Link to="/admin/learner-ai/exam-quizzes" className="inline-block mt-3 text-xs font-semibold text-blue-700 hover:underline">
          ← Back to exam drafts
        </Link>
      </ControlCentreLayout>
    )
  }

  if (!artifact) {
    return (
      <ControlCentreLayout title="Exam draft" helmetTitle="Exam draft — AI Control Centre">
        <div className="text-sm text-slate-500">Loading…</div>
      </ControlCentreLayout>
    )
  }

  if (artifact.type !== 'exam_quiz') {
    return (
      <ControlCentreLayout title="Wrong artifact type" helmetTitle="Exam draft — AI Control Centre">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          This artifact is type <code className="font-mono">{artifact.type}</code>, not <code className="font-mono">exam_quiz</code>.
        </div>
        <Link to="/admin/learner-ai/exam-quizzes" className="inline-block mt-3 text-xs font-semibold text-blue-700 hover:underline">
          ← Back to exam drafts
        </Link>
      </ControlCentreLayout>
    )
  }

  const content = artifact.content || {}
  const header = content.header || {}
  const sections = Array.isArray(content.sections) ? content.sections : []
  const status = artifact.status || 'draft'
  const isPublished = status === 'published'
  const isRejected = status === 'rejected'

  async function handleApprove() {
    if (!confirm(
      'Approve this exam quiz?\n\n' +
      'It will be published to learners. Exam quizzes are not auto-published — ' +
      'you are the gatekeeper. Confirm only after reviewing every section + the marking guide.',
    )) return
    setBusy(true)
    await setTaskStatus({
      taskId: linkedTaskId,
      status: 'approved',
      extra: { errorMessage: null },
    })
    setBusy(false)
  }

  async function handleReject() {
    if (!confirm('Reject this exam quiz? It will not be published.')) return
    setBusy(true)
    await setTaskStatus({
      taskId: linkedTaskId,
      status: 'rejected',
      extra: { errorMessage: 'Rejected by admin (exam review page)' },
    })
    setBusy(false)
  }

  async function handleEdit() {
    setRegenMode('edit')
    setShowRegen(true)
  }

  async function handleRegenerate() {
    setRegenMode('regenerate')
    setShowRegen(true)
  }

  async function submitRegen() {
    setBusy(true)
    const ok = await setTaskStatus({
      taskId: linkedTaskId,
      status: 'queued',
      extra: {
        adminNotes: regenNotes || null,
        regenMode,
        startedAt: null,
        completedAt: null,
        resultContentId: null,
        errorMessage: null,
      },
    })
    setBusy(false)
    if (ok) {
      setShowRegen(false)
      setRegenNotes('')
    }
  }

  return (
    <ControlCentreLayout
      title={header.paperName || `${header.subject || 'Subject'} — Grade ${header.grade || '?'}`}
      helmetTitle={`Exam draft — ${header.subject || ''} G${header.grade || ''}`}
    >
      <div className="flex flex-wrap items-center gap-2 -mt-2 mb-3 text-xs text-slate-600">
        <Link to="/admin/learner-ai/exam-quizzes" className="font-semibold text-blue-700 hover:underline">
          ← Exam drafts
        </Link>
        <StatusBadge status={status} />
        <span className="text-slate-400">·</span>
        <span className="font-mono text-[10px]">{artifact.id}</span>
        {Number.isInteger(artifact.version) && <span>· v{artifact.version}</span>}
        <span className="ml-auto rounded-full bg-amber-50 border border-amber-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
          Never auto-publishes
        </span>
      </div>

      {/* Admin action bar — sticky so it stays in view while scrolling
          through long Section C structured questions. */}
      <div className="sticky top-14 z-10 -mx-4 md:mx-0 mb-4 bg-white/95 backdrop-blur border-y border-slate-200 px-4 md:px-0 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleApprove}
            disabled={busy || !linkedTaskId || isPublished}
            className="text-xs font-bold px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            Approve &amp; Publish
          </button>
          <button
            type="button"
            onClick={handleReject}
            disabled={busy || !linkedTaskId || isRejected}
            className="text-xs font-bold px-3 py-1.5 rounded bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={handleEdit}
            disabled={busy || !linkedTaskId}
            className="text-xs font-bold px-3 py-1.5 rounded bg-slate-100 text-slate-800 hover:bg-slate-200 disabled:opacity-40"
            title="Edit = re-queue the task with admin notes; the regenerated draft replaces this one."
          >
            Edit
          </button>
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={busy || !linkedTaskId}
            className="text-xs font-bold px-3 py-1.5 rounded bg-amber-100 text-amber-800 hover:bg-amber-200 disabled:opacity-40"
          >
            Regenerate
          </button>
          <span className="hidden md:inline text-slate-300">|</span>
          <button
            type="button"
            onClick={() => handlePrintPreview(artifact)}
            className="text-xs font-bold px-3 py-1.5 rounded bg-violet-50 text-violet-700 hover:bg-violet-100"
          >
            Print Preview
          </button>
          <button
            type="button"
            onClick={() => handleDownloadPdf(artifact)}
            className="text-xs font-bold px-3 py-1.5 rounded bg-violet-50 text-violet-700 hover:bg-violet-100"
            title="Opens print dialog — choose 'Save as PDF' as the destination."
          >
            Download PDF
          </button>
          <button
            type="button"
            onClick={() => handleDownloadWord(artifact)}
            className="text-xs font-bold px-3 py-1.5 rounded bg-violet-50 text-violet-700 hover:bg-violet-100"
          >
            Download Word
          </button>
          <span className="hidden md:inline text-slate-300">|</span>
          <button
            type="button"
            onClick={() => setShowVersions(true)}
            className="text-xs font-bold px-3 py-1.5 rounded bg-slate-100 text-slate-700 hover:bg-slate-200"
            title="See every version of this content + who approved / rejected / regenerated it."
          >
            Compare Versions
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 items-start">
        {/* Paper preview — formal Zambian school-test layout */}
        <article className="rounded-lg border border-slate-200 bg-white p-4 md:p-6">
          <PaperHeader header={header} />
          {sections.length === 0 ? (
            <p className="text-sm text-slate-500">No sections in this artifact.</p>
          ) : (
            sections.map(s => <SectionBlock key={s.id} section={s} />)
          )}

          <div className="mt-8 pt-4 border-t-2 border-slate-900">
            <h3 className="text-sm font-bold text-slate-900 mb-2">
              Answer key + marking guide
            </h3>
            <AnswerKeyTable answerKey={content.answerKey} />
            {content.markingGuide && (
              <div className="mt-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Marking notes
                </div>
                <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {content.markingGuide}
                </p>
              </div>
            )}
          </div>
        </article>

        {/* Right sidebar — verifier verdicts + curriculum reference */}
        <aside className="space-y-3 lg:sticky lg:top-32">
          <CurriculumReferencePanel artifact={artifact} />
          <VerdictPanel
            title="Supervisor decision"
            verdict={artifact.supervisorDecision}
            emptyHint="Supervisor hasn't reviewed yet. Decision arrives once Standards + Quality checks finish."
          />
          <VerdictPanel
            title="Quality Check"
            verdict={artifact.qualityCheck}
            emptyHint="Quality Check pending."
          />
          <VerdictPanel
            title="Zambian standards check"
            verdict={artifact.zambianStandardsCheck}
            emptyHint="Standards Check pending."
          />
        </aside>
      </div>

      {showRegen && (
        <div role="dialog" aria-modal="true"
             className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-4 space-y-3">
            <h3 className="text-base font-bold text-slate-900">
              {regenMode === 'edit' ? 'Edit with admin notes' : 'Regenerate'}
            </h3>
            <p className="text-xs text-slate-600">
              {regenMode === 'edit' ?
                'Briefly describe what to change. The notes are appended to the next generation prompt — the agent re-runs the full verifier chain and produces a fresh draft.' :
                'The task will be re-queued with the same parameters. Optionally leave a note about why.'}
            </p>
            <textarea
              value={regenNotes}
              onChange={e => setRegenNotes(e.target.value)}
              rows={5}
              placeholder={regenMode === 'edit' ?
                'e.g. Replace Section A Q3 — the answer key is wrong.' :
                'e.g. First draft missed Term 2 grounding.'}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRegen(false)}
                disabled={busy}
                className="text-xs font-bold px-3 py-1.5 rounded bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitRegen}
                disabled={busy || !linkedTaskId}
                className="text-xs font-bold px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
              >
                {busy ? 'Queueing…' : 'Re-queue task'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showVersions && (
        <CompareVersionsPanel
          contentId={artifact.id}
          onClose={() => setShowVersions(false)}
        />
      )}
    </ControlCentreLayout>
  )
}
