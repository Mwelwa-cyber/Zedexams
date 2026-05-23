import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { classForStatus } from './agentRegistry'
import {
  examQuizToAssessment, suggestExamQuizFilename,
} from '../../../utils/examQuizToAssessment'

// One card per aiGeneratedContent doc. Wraps the per-artifact admin
// actions (View / Approve / Publish / Reject / Regenerate / Edit /
// Compare Versions) + the exam-quiz-specific extras (Print Preview /
// Download Word / Marking Guide).
//
// Approve / Reject / Regenerate write to the LINKED aiAgentTasks doc
// (we get its id from artifact._linkedTaskId, populated by the
// ArtifactGrid via a sibling listener). Cloud Function
// aiAgentTasksOnApproved handles the artifact's status flip.
//
// Print Preview reuses the existing `@media print` rules in
// assessmentStudio.css. Word download reuses
// downloadAssessmentDocx + the examQuizToAssessment adapter.
// Marking Guide opens the existing MarkingGuidePanel (handled by
// the parent on click — onMarkingGuide callback).

function timeAgo(ts) {
  if (!ts) return ''
  const ms = ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0
  if (!ms) return ''
  const diff = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86_400)}d ago`
}

function previewTitle(artifact) {
  const c = artifact.content || {}
  if (typeof c.title === 'string' && c.title.length) return c.title
  if (c.header && typeof c.header.paperName === 'string' && c.header.paperName.length) {
    return c.header.paperName
  }
  return `${artifact.subject || 'Subject'} — ${artifact.topic || 'Topic'}`
}

function previewSummary(artifact) {
  const c = artifact.content || {}
  if (typeof c.shortExplanation === 'string') return c.shortExplanation
  if (typeof c.description === 'string') return c.description
  if (typeof c.encouragingMessage === 'string') return c.encouragingMessage
  if (typeof c.feedback === 'string') return c.feedback
  if (typeof c.summary === 'string') return c.summary
  if (Array.isArray(c.questions) && c.questions[0]) {
    const q = c.questions[0]
    return q.questionText || q.prompt || ''
  }
  if (Array.isArray(c.tips) && c.tips[0]) {
    return c.tips[0].tip || c.tips[0]
  }
  return ''
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

function buildPrintHtml(artifact) {
  const {assessment, questions} = examQuizToAssessment(artifact.content || {})
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
  const instructionsHtml = (assessment.instructions || []).map(i => `<li>${escapeHtml(i)}</li>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8" />
    <title>${escapeHtml(assessment.title || 'Exam paper')}</title>
    <style>
      body { font-family: serif; padding: 1.5cm; color: #1a202c; }
      h1 { font-size: 18pt; margin-bottom: 0.25rem; }
      h2 { font-size: 13pt; margin-top: 1.5rem; }
      .exam-header { border-bottom: 1px solid #1a202c; padding-bottom: 0.5rem; margin-bottom: 1rem; }
      .exam-header dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; font-size: 10pt; }
      .exam-header dt { font-weight: bold; }
      .exam-instructions { font-style: italic; color: #4a5568; }
      ol.exam-questions { padding-left: 1.25rem; }
      ol.exam-questions > li { margin-bottom: 0.75rem; }
      ol.exam-options { padding-left: 1.5rem; font-size: 11pt; }
      ol.exam-parts { padding-left: 1.5rem; font-size: 11pt; }
      .exam-marks { float: right; color: #4a5568; }
      @media print { body { padding: 1cm; } }
    </style>
  </head><body>
    <div class="exam-header">
      <h1>${escapeHtml(assessment.title || 'Examination paper')}</h1>
      <dl>
        <dt>School</dt><dd>${escapeHtml(assessment.schoolName || '_____________________')}</dd>
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
  </body></html>`
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

async function handlePrintPreview(artifact) {
  const html = buildPrintHtml(artifact)
  const w = window.open('', '_blank', 'noopener,noreferrer')
  if (!w) {
    alert('Pop-up blocked. Allow pop-ups for this site to use Print Preview.')
    return
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => { try { w.print() } catch { /* ignore */ } }, 250)
}

async function handleDownloadWord(artifact) {
  try {
    const {downloadAssessmentDocx} = await import('../../../utils/assessmentToDocx')
    const adapted = examQuizToAssessment(artifact.content || {})
    const filename = suggestExamQuizFilename(artifact.content || {}, 'docx')
    await downloadAssessmentDocx(adapted.assessment, adapted.questions, filename, {mode: 'paper'})
  } catch (err) {
    alert(`Word download failed: ${err && err.message || err}. ` +
      'Falling back to JSON dump.')
    const blob = new Blob([JSON.stringify(artifact.content, null, 2)],
        {type: 'application/json'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = suggestExamQuizFilename(artifact.content || {}, 'json')
    a.click()
    URL.revokeObjectURL(url)
  }
}

export default function ArtifactCard({
  artifact,
  onView,
  onRegenerate,
  onMarkingGuide,
  // onCompareVersions — placeholder for the Phase B version-history
  // diff viewer. The button is disabled below; once the version
  // subcollection lands we'll wire this prop up.
}) {
  const status = artifact.status || 'draft'
  const title = previewTitle(artifact)
  const summary = previewSummary(artifact)
  const isExam = artifact.type === 'exam_quiz'
  const linkedTaskId = artifact._linkedTaskId

  async function handleApprove() {
    if (!confirm('Approve this artifact? It will be published to learners.')) return
    await setTaskStatus({ taskId: linkedTaskId, status: 'approved', extra: { errorMessage: null }})
  }
  async function handleReject() {
    if (!confirm('Reject this artifact? It will not be published.')) return
    await setTaskStatus({ taskId: linkedTaskId, status: 'rejected', extra: { errorMessage: 'Rejected by admin' }})
  }

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 flex flex-col gap-2">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-900 leading-tight line-clamp-2">{title}</h3>
          <div className="text-[11px] text-slate-500 mt-0.5">
            G{artifact.grade} · {artifact.subject}
            {artifact.topic ? ` · ${artifact.topic}` : ''}
            {artifact.subtopic ? ` / ${artifact.subtopic}` : ''}
          </div>
        </div>
        <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${classForStatus(status)}`}>
          {status}
        </span>
      </header>

      {summary && (
        <p className="text-xs text-slate-700 line-clamp-3">{summary}</p>
      )}

      <div className="text-[11px] text-slate-400">
        {artifact.createdAt ? `Created ${timeAgo(artifact.createdAt)}` : ''}
        {artifact.updatedAt ? ` · updated ${timeAgo(artifact.updatedAt)}` : ''}
        {Number.isInteger(artifact.version) ? ` · v${artifact.version}` : ''}
      </div>

      <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100 mt-auto">
        <button
          type="button"
          onClick={() => onView && onView(artifact)}
          className="text-[11px] font-semibold px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100"
        >
          View
        </button>
        <button
          type="button"
          onClick={() => onRegenerate && onRegenerate(artifact, 'edit')}
          disabled={!linkedTaskId}
          className="text-[11px] font-semibold px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40"
          title="Edit = regenerate with admin notes"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={handleApprove}
          disabled={!linkedTaskId || status === 'published' || status === 'approved'}
          className="text-[11px] font-semibold px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
        >
          Approve & Publish
        </button>
        <button
          type="button"
          onClick={handleReject}
          disabled={!linkedTaskId || status === 'rejected'}
          className="text-[11px] font-semibold px-2 py-1 rounded bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-40"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={() => onRegenerate && onRegenerate(artifact, 'regenerate')}
          disabled={!linkedTaskId}
          className="text-[11px] font-semibold px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-40"
        >
          Regenerate
        </button>
        <button
          type="button"
          disabled
          title="Compare Versions arrives with the version-history subcollection (Phase B)"
          className="text-[11px] font-semibold px-2 py-1 rounded bg-slate-100 text-slate-400 cursor-not-allowed"
        >
          Compare Versions
        </button>

        {/* Exam-quiz-only extras */}
        {isExam && (
          <>
            <button
              type="button"
              onClick={() => handlePrintPreview(artifact)}
              className="text-[11px] font-semibold px-2 py-1 rounded bg-violet-50 text-violet-700 hover:bg-violet-100"
            >
              Print Preview
            </button>
            <button
              type="button"
              onClick={() => handleDownloadWord(artifact)}
              className="text-[11px] font-semibold px-2 py-1 rounded bg-violet-50 text-violet-700 hover:bg-violet-100"
            >
              Download Word
            </button>
            <button
              type="button"
              onClick={() => onMarkingGuide && onMarkingGuide(artifact)}
              className="text-[11px] font-semibold px-2 py-1 rounded bg-violet-50 text-violet-700 hover:bg-violet-100"
            >
              Marking Guide
            </button>
          </>
        )}
      </div>
    </article>
  )
}
