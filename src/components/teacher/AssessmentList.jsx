import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { downloadAssessmentDocx } from '../../utils/assessmentToDocx'
import { printAssessmentAsPdf } from '../../utils/assessmentToPdf'

const ASSESSMENT_TYPE_LABELS = {
  weekly: 'Weekly test',
  monthly: 'Monthly test',
  mid_term: 'Mid-term test',
  end_of_term: 'End-of-term test',
  topic: 'Topic test',
  mock: 'Mock exam',
  diagnostic: 'Diagnostic / baseline',
  pre_test: 'Pre-test',
  post_test: 'Post-test',
  revision: 'Revision test',
  continuous: 'Continuous assessment',
  summative: 'Summative assessment',
  practical: 'Practical assessment',
  oral: 'Oral assessment',
  project: 'Project-based assessment',
}

function formatDate(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function safeFileName(title, suffix) {
  const base = String(title || 'assessment')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'assessment'
  return `${base}-${suffix}`
}

function AssessmentRow({ assessment, onDelete, onExport, busy }) {
  const id = assessment.id
  const typeLabel = ASSESSMENT_TYPE_LABELS[assessment.assessmentType] || 'Assessment'
  const [exporting, setExporting] = useState(null)

  async function handleExport(format, mode) {
    setExporting(`${format}-${mode}`)
    try {
      await onExport(assessment, format, mode)
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="theme-card theme-border space-y-3 rounded-2xl border p-4">
      <div className="flex items-start gap-3">
        <div className="theme-accent-bg theme-accent-text flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-lg">
          📝
        </div>
        <div className="flex-1 min-w-0">
          <p className="theme-text font-black text-sm leading-snug">{assessment.title || 'Untitled assessment'}</p>
          <div className="flex flex-wrap gap-1.5 mt-1.5 items-center">
            <span className="theme-text-muted text-xs font-bold">{typeLabel}</span>
            {assessment.grade && <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">Grade {assessment.grade}</span>}
            {assessment.subject && <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{assessment.subject}</span>}
            {assessment.term && <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded-full">T{assessment.term}</span>}
            {assessment.totalMarks != null && <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">{assessment.totalMarks} marks</span>}
            {assessment.duration != null && <span className="bg-orange-100 text-orange-700 text-xs font-bold px-2 py-0.5 rounded-full">{assessment.duration} min</span>}
          </div>
          <p className="theme-text-muted mt-1.5 text-xs">
            {assessment.questionCount ?? 0} questions · Created {formatDate(assessment.createdAt)}
            {assessment.updatedAt && ` · Updated ${formatDate(assessment.updatedAt)}`}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          to={`/teacher/assessments/${id}/edit`}
          className="theme-card theme-border theme-text hover:border-[var(--accent)] hover:theme-accent-text rounded-xl border-2 px-3 py-1.5 text-xs font-bold transition-colors"
        >
          ✏️ Edit
        </Link>
        <button
          type="button"
          onClick={() => handleExport('docx', 'paper')}
          disabled={!!exporting || busy}
          className="theme-card theme-border theme-text hover:border-[var(--accent)] hover:theme-accent-text rounded-xl border-2 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
        >
          {exporting === 'docx-paper' ? 'Building…' : '📄 Paper (DOCX)'}
        </button>
        <button
          type="button"
          onClick={() => handleExport('pdf', 'paper')}
          disabled={!!exporting || busy}
          className="theme-card theme-border theme-text hover:border-[var(--accent)] hover:theme-accent-text rounded-xl border-2 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
        >
          {exporting === 'pdf-paper' ? 'Opening…' : '📄 Paper (PDF)'}
        </button>
        <button
          type="button"
          onClick={() => handleExport('docx', 'scheme')}
          disabled={!!exporting || busy}
          className="theme-card theme-border theme-text hover:border-[var(--accent)] hover:theme-accent-text rounded-xl border-2 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
        >
          {exporting === 'docx-scheme' ? 'Building…' : '🗒️ Scheme (DOCX)'}
        </button>
        <button
          type="button"
          onClick={() => handleExport('pdf', 'scheme')}
          disabled={!!exporting || busy}
          className="theme-card theme-border theme-text hover:border-[var(--accent)] hover:theme-accent-text rounded-xl border-2 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
        >
          {exporting === 'pdf-scheme' ? 'Opening…' : '🗒️ Scheme (PDF)'}
        </button>
        <button
          type="button"
          onClick={() => onDelete(assessment)}
          disabled={busy}
          className="text-danger hover:bg-danger-subtle rounded-xl border-2 border-red-200 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
        >
          🗑 Delete
        </button>
      </div>
    </div>
  )
}

export default function AssessmentList() {
  const { currentUser } = useAuth()
  const { getMyAssessments, getAssessmentQuestions, deleteAssessment } = useFirestore()
  const navigate = useNavigate()

  const [assessments, setAssessments] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!currentUser?.uid) return
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const items = await getMyAssessments(currentUser.uid)
        if (!cancelled) setAssessments(items)
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load assessments.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [currentUser?.uid, getMyAssessments])

  async function handleDelete(assessment) {
    if (!window.confirm(`Delete "${assessment.title || 'this assessment'}" permanently? This cannot be undone.`)) return
    setBusyId(assessment.id)
    try {
      await deleteAssessment(assessment.id)
      setAssessments(curr => curr.filter(a => a.id !== assessment.id))
    } catch (err) {
      alert(`Delete failed: ${err.message || 'unexpected error'}`)
    } finally {
      setBusyId(null)
    }
  }

  async function handleExport(assessment, format, mode) {
    // Fetch the full question set on-demand so the list view stays cheap.
    const questions = await getAssessmentQuestions(assessment.id)
    const filename = safeFileName(
      assessment.title,
      mode === 'paper' ? 'paper' : 'marking-scheme',
    )
    if (format === 'docx') {
      await downloadAssessmentDocx(assessment, questions, `${filename}.docx`, { mode })
    } else {
      printAssessmentAsPdf(assessment, questions, { mode })
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(n => (
          <div key={n} className="theme-card theme-border theme-bg-subtle h-24 animate-pulse rounded-2xl border" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-eyebrow">My library</p>
          <h1 className="text-display-xl theme-text mt-1 flex items-center gap-2">
            <span aria-hidden="true">📝</span> Assessments
          </h1>
          <p className="theme-text-muted text-body-sm mt-1">
            Tests and exam papers you've created for your class. Private to you — not shown to learners.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/teacher/assessments/new')}
          className="theme-accent-fill theme-on-accent rounded-xl px-5 py-2.5 text-sm font-black transition-all duration-fast ease-out shadow-elev-sm shadow-elev-inner-hl hover:-translate-y-px hover:shadow-elev-md"
        >
          + New assessment
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {assessments.length === 0 ? (
        <div className="theme-card theme-border rounded-2xl border-2 border-dashed py-12 text-center">
          <div className="text-5xl mb-3 opacity-50">📂</div>
          <p className="theme-text font-black mb-1">No assessments yet</p>
          <p className="theme-text-muted text-sm mb-5">Create your first weekly test, mid-term, or end-of-term paper.</p>
          <button
            type="button"
            onClick={() => navigate('/teacher/assessments/new')}
            className="theme-accent-fill theme-on-accent rounded-xl px-5 py-2.5 text-sm font-black"
          >
            + Create assessment
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {assessments.map(a => (
            <AssessmentRow
              key={a.id}
              assessment={a}
              onDelete={handleDelete}
              onExport={handleExport}
              busy={busyId === a.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
