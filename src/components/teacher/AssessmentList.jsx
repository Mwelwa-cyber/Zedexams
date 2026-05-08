import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { downloadAssessmentDocx } from '../../utils/assessmentToDocx'
import { printAssessmentAsPdf } from '../../utils/assessmentToPdf'
import SeoHelmet from '../seo/SeoHelmet'

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
    <div className="studio-card space-y-3 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-lg" style={{ background: '#e8d8f0' }}>
          🦅
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-sm leading-snug" style={{ color: '#0e2a32' }}>{assessment.title || 'Untitled assessment'}</p>
          <div className="flex flex-wrap gap-1.5 mt-1.5 items-center">
            <span className="text-xs font-bold" style={{ color: '#566f76' }}>{typeLabel}</span>
            {assessment.grade && <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#e6f5ed', color: '#0a5a35' }}>Grade {assessment.grade}</span>}
            {assessment.subject && <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#e3eef0', color: '#16505d' }}>{assessment.subject}</span>}
            {assessment.term && <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#f5efe1', color: '#566f76' }}>T{assessment.term}</span>}
            {assessment.totalMarks != null && <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#fde9b8', color: '#8a3d12' }}>{assessment.totalMarks} marks</span>}
            {assessment.duration != null && <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#fff5e6', color: '#c2531a' }}>{assessment.duration} min</span>}
          </div>
          <p className="mt-1.5 text-xs" style={{ color: '#566f76' }}>
            {assessment.questionCount ?? 0} questions · Created {formatDate(assessment.createdAt)}
            {assessment.updatedAt && ` · Updated ${formatDate(assessment.updatedAt)}`}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          to={`/teacher/assessments/${id}/edit`}
          className="rounded-xl border-2 px-3 py-1.5 text-xs font-bold no-underline transition-colors"
          style={{ background: '#fff', borderColor: '#0e2a32', color: '#0e2a32' }}
        >
          ✏️ Edit
        </Link>
        <button
          type="button"
          onClick={() => handleExport('docx', 'paper')}
          disabled={!!exporting || busy}
          className="rounded-xl border-2 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
          style={{ background: '#fff', borderColor: '#0e2a32', color: '#0e2a32' }}
        >
          {exporting === 'docx-paper' ? 'Building…' : '📄 Paper (DOCX)'}
        </button>
        <button
          type="button"
          onClick={() => handleExport('pdf', 'paper')}
          disabled={!!exporting || busy}
          className="rounded-xl border-2 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
          style={{ background: '#fff', borderColor: '#0e2a32', color: '#0e2a32' }}
        >
          {exporting === 'pdf-paper' ? 'Opening…' : '📄 Paper (PDF)'}
        </button>
        <button
          type="button"
          onClick={() => handleExport('docx', 'scheme')}
          disabled={!!exporting || busy}
          className="rounded-xl border-2 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
          style={{ background: '#fff', borderColor: '#0e2a32', color: '#0e2a32' }}
        >
          {exporting === 'docx-scheme' ? 'Building…' : '🗒️ Scheme (DOCX)'}
        </button>
        <button
          type="button"
          onClick={() => handleExport('pdf', 'scheme')}
          disabled={!!exporting || busy}
          className="rounded-xl border-2 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
          style={{ background: '#fff', borderColor: '#0e2a32', color: '#0e2a32' }}
        >
          {exporting === 'pdf-scheme' ? 'Opening…' : '🗒️ Scheme (PDF)'}
        </button>
        <button
          type="button"
          onClick={() => onDelete(assessment)}
          disabled={busy}
          className="rounded-xl border-2 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
          style={{ borderColor: '#fecaca', color: '#b91c1c', background: '#fff' }}
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
          <div key={n} className="h-24 animate-pulse rounded-2xl" style={{ background: '#ece4d2', border: '2px solid #d9cfb8' }} />
        ))}
      </div>
    )
  }

  return (
    <div>
      <SeoHelmet title="Assessments" noIndex />
      {/* Page header — brand on the left, action on the right */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <Link to="/teacher" className="flex items-center gap-2.5 no-underline" style={{ color: '#0e2a32' }}>
          <span style={{ fontSize: 22 }}>🦅</span>
          <div className="leading-tight">
            <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 16, margin: 0, color: '#0e2a32' }}>
              ZedExams <span style={{ color: '#ff7a2e' }}>•</span>
            </p>
            <p style={{ fontSize: 11.5, color: '#566f76', margin: 0, fontWeight: 600 }}>
              Assessment Studio
            </p>
          </div>
        </Link>
        <Link
          to="/teacher"
          className="inline-flex items-center gap-2 rounded-xl border-2 font-bold no-underline transition-colors"
          style={{ background: '#fff', borderColor: '#0e2a32', color: '#0e2a32', padding: '8px 14px', fontSize: 13 }}
          onMouseEnter={e => { e.currentTarget.style.background = '#f5efe1' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#fff' }}
        >
          ← Dashboard
        </Link>
      </div>

      {/* Dark brand hero */}
      <div
        className="rounded-3xl p-7 sm:p-9 mb-8 flex items-center gap-6 flex-wrap"
        style={{ background: 'linear-gradient(135deg, #0e2a32 0%, #16505d 100%)', color: '#fff', boxShadow: '0 12px 32px rgba(14,42,50,.18)' }}
      >
        <div style={{ flex: 1, minWidth: 260 }}>
          <span
            className="inline-flex items-center gap-2 mb-3 rounded-full text-xs font-bold uppercase tracking-wider"
            style={{ background: '#ff7a2e', color: '#fff', padding: '7px 14px' }}
          >
            🦅 Sharp Eagle
          </span>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 36, lineHeight: 1.05, margin: '0 0 8px', letterSpacing: '-.3px' }}>
            My assessments
          </h1>
          <p style={{ fontSize: 14.5, opacity: .88, marginBottom: 16, maxWidth: 520, lineHeight: 1.55 }}>
            Tests and exam papers you've created for your class — private to you, never shown to learners. Print, download as DOCX or PDF, or open the marking scheme.
          </p>
          <div className="flex gap-4 flex-wrap mb-5" style={{ fontSize: 13, opacity: .78, fontWeight: 500 }}>
            <span>📄 DOCX + PDF export</span>
            <span>🗒️ Marking scheme</span>
            <span>🔒 Teacher-private</span>
          </div>
          <button
            type="button"
            onClick={() => navigate('/teacher/assessments/new')}
            className="inline-flex items-center gap-2.5 rounded-2xl font-bold no-underline transition-colors"
            style={{ background: '#ff7a2e', color: '#fff', padding: '13px 22px', fontSize: 14.5, border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#e6651a' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#ff7a2e' }}
          >
            ▶ New assessment
          </button>
        </div>
        <div
          className="flex-shrink-0 hidden sm:grid place-items-center"
          style={{ width: 150, height: 150, borderRadius: '50%', background: '#fff', fontSize: 68, boxShadow: '0 8px 28px rgba(0,0,0,.25)' }}
        >
          🦅
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mb-5">
          {error}
        </div>
      )}

      {assessments.length === 0 ? (
        <div
          className="text-center py-12 rounded-2xl border-2 border-dashed"
          style={{ background: '#fff', borderColor: '#b8ad96' }}
        >
          <div style={{ fontSize: 40, marginBottom: 12, opacity: .5 }}>📂</div>
          <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 17, color: '#0e2a32', marginBottom: 6 }}>
            No assessments yet
          </p>
          <p style={{ fontSize: 13, color: '#8a9aa1', margin: '0 0 16px' }}>
            Create your first weekly test, mid-term, or end-of-term paper.
          </p>
          <button
            type="button"
            onClick={() => navigate('/teacher/assessments/new')}
            className="inline-flex items-center gap-2 rounded-xl font-bold transition-colors"
            style={{ background: '#ff7a2e', color: '#fff', border: 'none', cursor: 'pointer', padding: '10px 18px', fontSize: 14 }}
            onMouseEnter={e => { e.currentTarget.style.background = '#e6651a' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#ff7a2e' }}
          >
            + Create assessment
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2.5 mb-3" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: '#ff7a2e' }}>
            <span style={{ width: 32, height: 3, background: '#ff7a2e', borderRadius: 2, display: 'inline-block', flexShrink: 0 }} />
            Saved
          </div>
          <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 24, color: '#0e2a32', margin: '0 0 16px' }}>
            {assessments.length} assessment{assessments.length === 1 ? '' : 's'}
          </h2>
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
        </>
      )}
    </div>
  )
}
