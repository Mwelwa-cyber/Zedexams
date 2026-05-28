/**
 * AdminCsvImport — /admin/import/csv
 *
 * Bulk-import flow for quiz questions from a CSV file. Three phases:
 *   1. Upload  — download a canonical template, then upload a filled CSV
 *   2. Preview — table of parsed rows with per-row status badges
 *                (✓ ok / ⚠ warning / ✗ error). Teachers fix issues in
 *                place by editing cells before publishing.
 *   3. Publish — create a new draft quiz and write the validated
 *                questions through the same path the editor uses
 *                (saveQuestions → normalizeQuestionPayload), so every
 *                imported row goes through the same Zod gate.
 *
 * Out of scope (covered in follow-up PRs):
 *   - Hotspot / fill / diagram question types in the CSV
 *   - AI-assist tag/topic suggestions on the preview
 *   - Bulk-edit ("set topic for all rows")
 *   - True Question Bank model (questions still attach to one quiz)
 */

import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import {
  CSV_HEADERS,
  buildCsvTemplate,
  parseCsvImport,
  rowToQuestion,
} from '../../utils/csvQuizImport'
import { Download, Upload, Check, AlertTriangle, X as XMarkIcon } from '../ui/icons'
import Icon from '../ui/Icon'

const SUBJECTS = [
  'Mathematics', 'Integrated Science', 'Science', 'English',
  'Social Studies', 'Cinyanja', 'Home Economics', 'Expressive Arts',
  'Technology Studies', 'Chemistry', 'Biology', 'Physics',
  'Special Paper 1',
]

const GRADES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']

function StatusBadge({ status }) {
  if (status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
        <Icon icon={Check} size="xs" /> OK
      </span>
    )
  }
  if (status === 'warning') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800">
        <Icon icon={AlertTriangle} size="xs" /> Warning
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700">
      <Icon icon={XMarkIcon} size="xs" /> Error
    </span>
  )
}

export default function AdminCsvImport() {
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const { createQuiz, saveQuestions } = useFirestore()

  const [parsed, setParsed] = useState(null)
  const [fileName, setFileName] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [topLevelError, setTopLevelError] = useState('')
  const [quizMeta, setQuizMeta] = useState({
    title: '',
    subject: 'Mathematics',
    grade: '5',
    term: '1',
    description: '',
  })
  const fileInputRef = useRef(null)

  const summary = parsed?.summary
  const canPublish = parsed && parsed.rows.length > 0 && summary?.error === 0 && quizMeta.title.trim()

  // ── Template download ──────────────────────────────────────
  function handleDownloadTemplate() {
    const csv = buildCsvTemplate()
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', 'zedexams-quiz-template.csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // ── File upload ────────────────────────────────────────────
  function handleFile(file) {
    if (!file) return
    setTopLevelError('')
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = event => {
      const text = String(event.target?.result ?? '')
      const result = parseCsvImport(text)
      // Header-level failure: keep parsed=null so the upload form stays
      // visible. Clear the file input so re-uploading the same filename
      // (common after fixing in Excel) triggers onChange in Chromium.
      if (result.headerError) {
        setParsed(null)
        setTopLevelError(result.headerError)
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }
      setParsed(result)
    }
    reader.onerror = () => {
      setTopLevelError('Could not read the file. Please try again.')
    }
    reader.readAsText(file)
  }

  function handleReset() {
    setParsed(null)
    setFileName('')
    setTopLevelError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Inline edit ────────────────────────────────────────────
  // The teacher edits a cell in the preview, we re-run the per-row
  // validator, and the row's status badge + global summary update in
  // place. For the MVP only the most-edited columns are exposed inline
  // (text, correctAnswer, topic, marks); for anything else the teacher
  // re-uploads a corrected CSV.
  function updateRowCell(rowIndex, header, value) {
    if (!parsed) return
    const idx = CSV_HEADERS.indexOf(header)
    if (idx < 0) return
    setParsed(current => {
      if (!current) return current
      const rows = current.rows.map(r => ({ ...r, raw: [...r.raw] }))
      const target = rows[rowIndex]
      target.raw[idx] = value
      const fresh = rowToQuestion(target.raw)
      rows[rowIndex] = { ...target, ...fresh }
      const summary = { total: rows.length, ok: 0, warning: 0, error: 0 }
      rows.forEach(r => { summary[r.status] += 1 })
      return { ...current, rows, summary }
    })
  }

  // ── Publish ─────────────────────────────────────────────────
  async function handlePublish() {
    if (!parsed || !canPublish) return
    setPublishing(true)
    setTopLevelError('')
    try {
      const questionsForSave = parsed.rows.map(r => r.question).filter(Boolean)
      const totalMarks = questionsForSave.reduce((sum, q) => sum + (q.marks || 1), 0)

      const quizId = await createQuiz({
        title: quizMeta.title.trim(),
        subject: quizMeta.subject,
        grade: quizMeta.grade,
        term: quizMeta.term || '',
        description: quizMeta.description.trim(),
        passages: [],
        parts: [],
        passageCount: 0,
        totalMarks,
        questionCount: questionsForSave.length,
        isPublished: false,
        status: 'draft',
        createdBy: currentUser.uid,
        quizType: 'practice',
        mode: 'imported_csv',
        importStatus: summary?.warning ? 'needs_review' : 'success',
      })

      await saveQuestions(quizId, questionsForSave)
      navigate(`/admin/quizzes/${quizId}/edit`)
    } catch (err) {
      console.error('CSV publish failed:', err)
      setTopLevelError(err?.message || 'Failed to publish. Please review and try again.')
      setPublishing(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────
  const previewRows = useMemo(() => parsed?.rows ?? [], [parsed])

  return (
    <div className="theme-bg theme-text min-h-screen">
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">

        <header className="space-y-1">
          <h1 className="text-display-md">Bulk import — CSV</h1>
          <p className="theme-text-muted text-body-sm">
            Upload a spreadsheet of questions. Every row is validated, you fix any
            issues in place, then publish as a new draft quiz.
          </p>
        </header>

        {/* Step 1 — template + upload */}
        {!parsed && (
          <section className="theme-card rounded-2xl border theme-border p-5 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="zx-sb zx-sb-outline inline-flex items-center gap-2 text-sm"
              >
                <Icon icon={Download} size="sm" /> Download template
              </button>
              <p className="theme-text-muted text-xs">
                The template ships with example rows for every supported type — MCQ, True/False, numeric, short answer.
              </p>
            </div>

            <label className="block">
              <span className="theme-text-muted text-xs font-bold uppercase tracking-wide">Upload CSV</span>
              <div className="mt-2 flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={event => handleFile(event.target.files?.[0])}
                  className="theme-input block w-full rounded-xl border-2 theme-border px-3 py-2.5 text-sm"
                />
              </div>
            </label>

            {topLevelError && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
                {topLevelError}
              </p>
            )}
          </section>
        )}

        {/* Step 2 — preview + edit */}
        {parsed && parsed.rows.length > 0 && (
          <>
            <section className="theme-card rounded-2xl border theme-border p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="theme-text text-sm font-bold">{fileName}</p>
                  <p className="theme-text-muted text-xs">
                    {summary.total} rows · <span className="text-emerald-700">{summary.ok} ok</span> · <span className="text-amber-700">{summary.warning} warning</span> · <span className="text-red-700">{summary.error} error</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleReset}
                  className="zx-sb zx-sb-ghost text-xs"
                >
                  Reset & upload again
                </button>
              </div>
              {topLevelError && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{topLevelError}</p>
              )}
            </section>

            <section className="theme-card rounded-2xl border theme-border p-5 space-y-3">
              <h2 className="text-display-md text-lg">Quiz details</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="space-y-1">
                  <span className="theme-text-muted text-xs font-bold uppercase tracking-wide">Title</span>
                  <input
                    type="text"
                    value={quizMeta.title}
                    onChange={e => setQuizMeta(m => ({ ...m, title: e.target.value }))}
                    placeholder="Grade 5 Maths — Fractions"
                    className="theme-input block w-full rounded-xl border-2 theme-border px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-1">
                  <span className="theme-text-muted text-xs font-bold uppercase tracking-wide">Subject</span>
                  <select
                    value={quizMeta.subject}
                    onChange={e => setQuizMeta(m => ({ ...m, subject: e.target.value }))}
                    className="theme-input block w-full rounded-xl border-2 theme-border px-3 py-2 text-sm"
                  >
                    {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="theme-text-muted text-xs font-bold uppercase tracking-wide">Grade</span>
                  <select
                    value={quizMeta.grade}
                    onChange={e => setQuizMeta(m => ({ ...m, grade: e.target.value }))}
                    className="theme-input block w-full rounded-xl border-2 theme-border px-3 py-2 text-sm"
                  >
                    {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="theme-text-muted text-xs font-bold uppercase tracking-wide">Term</span>
                  <select
                    value={quizMeta.term}
                    onChange={e => setQuizMeta(m => ({ ...m, term: e.target.value }))}
                    className="theme-input block w-full rounded-xl border-2 theme-border px-3 py-2 text-sm"
                  >
                    <option value="1">Term 1</option>
                    <option value="2">Term 2</option>
                    <option value="3">Term 3</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="theme-card rounded-2xl border theme-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] border-collapse text-sm">
                  <thead className="theme-bg-subtle">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide">Row</th>
                      <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide">Status</th>
                      <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide">Type</th>
                      <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide">Question</th>
                      <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide">Correct</th>
                      <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide">Topic</th>
                      <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide">Marks</th>
                      <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className={`border-t theme-border ${row.status === 'error' ? 'bg-red-50/40' : row.status === 'warning' ? 'bg-amber-50/40' : ''}`}>
                        <td className="px-3 py-2 text-xs theme-text-muted">{row.index}</td>
                        <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                        <td className="px-3 py-2 text-xs font-bold">{row.raw[0]}</td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={row.raw[1] ?? ''}
                            onChange={e => updateRowCell(i, 'text', e.target.value)}
                            className="theme-input block w-full rounded-lg border theme-border px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={row.raw[6] ?? ''}
                            onChange={e => updateRowCell(i, 'correctAnswer', e.target.value)}
                            className="theme-input block w-24 rounded-lg border theme-border px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={row.raw[8] ?? ''}
                            onChange={e => updateRowCell(i, 'topic', e.target.value)}
                            className="theme-input block w-32 rounded-lg border theme-border px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="1"
                            max="10"
                            value={row.raw[9] ?? ''}
                            onChange={e => updateRowCell(i, 'marks', e.target.value)}
                            className="theme-input block w-16 rounded-lg border theme-border px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          {(row.errors.length > 0 || row.warnings.length > 0) && (
                            <ul className="space-y-0.5">
                              {row.errors.map((e, j) => (
                                <li key={`e-${j}`} className="text-xs font-bold text-red-700">• {e}</li>
                              ))}
                              {row.warnings.map((w, j) => (
                                <li key={`w-${j}`} className="text-xs font-bold text-amber-700">• {w}</li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={handlePublish}
                disabled={!canPublish || publishing}
                className="zx-sb zx-sb-primary inline-flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Icon icon={Upload} size="sm" />
                {publishing ? 'Publishing…' : `Publish as new draft quiz (${summary.total - summary.error} questions)`}
              </button>
              {!quizMeta.title.trim() && (
                <p className="text-xs font-bold text-amber-700">Set a quiz title first.</p>
              )}
              {summary.error > 0 && (
                <p className="text-xs font-bold text-red-700">Fix {summary.error} error row{summary.error === 1 ? '' : 's'} before publishing.</p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
