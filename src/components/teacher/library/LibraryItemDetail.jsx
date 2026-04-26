import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  getGeneration,
  deleteGeneration,
  recordExport,
  updateGenerationOutput,
  TOOL_META,
  titleForGeneration,
  formatDate,
} from '../../../utils/teacherLibraryService'
import LessonPlanView from '../views/LessonPlanView'
import WorksheetView from '../views/WorksheetView'
import FlashcardsView from '../views/FlashcardsView'
import SchemeOfWorkView from '../views/SchemeOfWorkView'
import RubricView from '../views/RubricView'
import { downloadLessonPlanDocx } from '../../../utils/lessonPlanToDocx'
import { downloadWorksheetDocx } from '../../../utils/worksheetToDocx'
import { downloadFlashcardsDocx } from '../../../utils/flashcardsToDocx'
import { downloadSchemeOfWorkDocx } from '../../../utils/schemeOfWorkToDocx'
import { downloadRubricDocx } from '../../../utils/rubricToDocx'
import { buildGeneratorQueryString } from '../../../utils/useFormDefaultsFromUrl'
import { publishShare } from '../../../utils/shareService'
import { useAuth } from '../../../contexts/AuthContext'

export default function LibraryItemDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const [item, setItem] = useState(null)
  const [status, setStatus] = useState('loading')
  const [showAnswers, setShowAnswers] = useState(false)
  const [editingHeader, setEditingHeader] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareInfo, setShareInfo] = useState(null)
  const [shareError, setShareError] = useState('')

  async function onShare() {
    if (!item?.output || !currentUser?.uid) return
    setSharing(true)
    setShareError('')
    try {
      const title = item.output?.header?.topic
        ? `Lesson plan — ${item.output.header.topic}`
        : 'Shared lesson plan'
      const result = await publishShare({
        tool: item.tool,
        ownerUid: currentUser.uid,
        title,
        plan: item.output,
        subject: item.inputs?.subject || item.output?.header?.subject || null,
        grade: item.inputs?.grade || item.output?.header?.class || null,
        topic: item.inputs?.topic || item.output?.header?.topic || null,
      })
      setShareInfo(result)
    } catch (err) {
      setShareError(err?.message || 'Could not create share link.')
    } finally {
      setSharing(false)
    }
  }

  function onCopyShare() {
    if (!shareInfo?.url) return
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(shareInfo.url).catch(() => {})
    }
  }

  useEffect(() => {
    if (!id) return
    setStatus('loading')
    getGeneration(id).then((row) => {
      if (!row) {
        setStatus('notfound')
        return
      }
      setItem(row)
      setStatus('ready')
    })
  }, [id])

  async function onDelete() {
    if (!item) return
    const confirmed = window.confirm(
      'Delete this generation? This cannot be undone.',
    )
    if (!confirmed) return
    const ok = await deleteGeneration(item.id)
    if (ok) {
      navigate('/teacher/library')
    } else {
      window.alert('Could not delete this item. Please try again.')
    }
  }

  async function onExport() {
    if (!item?.output) return
    const slug = (s) => String(s || '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    const base = [
      slug(item.inputs?.grade),
      slug(item.inputs?.subject),
      slug(item.inputs?.topic || item.output?.header?.topic),
      new Date(item.createdAt?.toDate?.() || Date.now()).toISOString().slice(0, 10),
    ].filter(Boolean).join('_')

    if (item.tool === 'lesson_plan') {
      await downloadLessonPlanDocx(item.output, `${base}_lesson-plan.docx`)
      recordExport(item.id, 'docx')
    } else if (item.tool === 'worksheet') {
      await downloadWorksheetDocx(item.output, `${base}_worksheet.docx`, { mode: 'worksheet' })
      recordExport(item.id, 'docx')
    } else if (item.tool === 'flashcards') {
      await downloadFlashcardsDocx(item.output, `${base}_flashcards.docx`)
      recordExport(item.id, 'docx')
    } else if (item.tool === 'scheme_of_work') {
      await downloadSchemeOfWorkDocx(item.output, `${base}_scheme-of-work.docx`)
      recordExport(item.id, 'docx')
    } else if (item.tool === 'rubric') {
      await downloadRubricDocx(item.output, `${base}_rubric.docx`)
      recordExport(item.id, 'docx')
    }
  }

  async function onExportAnswerKey() {
    if (item?.tool !== 'worksheet' || !item.output) return
    const slug = (s) => String(s || '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    const base = [
      slug(item.inputs?.grade),
      slug(item.inputs?.subject),
      slug(item.inputs?.topic || item.output?.header?.topic),
      new Date(item.createdAt?.toDate?.() || Date.now()).toISOString().slice(0, 10),
    ].filter(Boolean).join('_')
    await downloadWorksheetDocx(item.output, `${base}_ANSWER-KEY.docx`, { mode: 'answer_key' })
    recordExport(item.id, 'docx_answer_key')
  }

  function onRegenerate() {
    if (!item) return
    const meta = TOOL_META[item.tool]
    if (!meta) return
    // Build a query string from the original inputs so the target generator
    // pre-fills its form via useFormDefaultsFromUrl().
    const qs = buildGeneratorQueryString(item.inputs || {})
    navigate(`${meta.route}${qs}`)
  }

  async function onSaveHeaderEdits(nextHeader) {
    if (!item) return
    setSavingEdit(true)
    const nextOutput = { ...item.output, header: { ...(item.output?.header || {}), ...nextHeader } }
    const ok = await updateGenerationOutput(item.id, nextOutput)
    if (ok) {
      setItem((prev) => ({ ...prev, output: nextOutput, teacherEdited: true }))
      setEditingHeader(false)
    } else {
      window.alert('Could not save changes. Please try again.')
    }
    setSavingEdit(false)
  }

  // Edit-details is currently supported for tools with an editable `output.header`.
  const canEditDetails = item && ['lesson_plan', 'scheme_of_work', 'worksheet']
    .includes(item.tool)

  if (status === 'loading') {
    return (
      <div className="min-h-screen theme-bg p-8 flex items-center justify-center">
        <div className="theme-card border theme-border rounded-2xl p-8 text-center">
          <div className="text-4xl mb-3 animate-bounce">📚</div>
          <p className="theme-text-secondary">Loading…</p>
        </div>
      </div>
    )
  }

  if (status === 'notfound' || !item) {
    return (
      <div className="min-h-screen theme-bg p-8 flex items-center justify-center">
        <div className="theme-card border theme-border rounded-2xl p-8 max-w-md text-center">
          <div className="text-5xl mb-3">🤷</div>
          <h2 className="text-lg font-black theme-text mb-2">Not found</h2>
          <p className="text-sm theme-text-secondary mb-4">
            This generation may have been deleted or belongs to another account.
          </p>
          <Link
            to="/teacher/library"
            className="inline-block px-4 py-2 rounded-xl font-bold border theme-border"
          >
            ← Back to library
          </Link>
        </div>
      </div>
    )
  }

  const meta = TOOL_META[item.tool] || { label: item.tool, icon: '📄' }

  return (
    <div className="min-h-screen theme-bg p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Breadcrumb */}
        <nav className="mb-4 text-sm theme-text-secondary">
          <Link to="/teacher/library" className="hover:underline">← My Library</Link>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl" aria-hidden="true">{meta.icon}</span>
              <span className="text-[10px] font-black uppercase tracking-wide theme-text-secondary">
                {meta.label}
              </span>
              {item.status === 'flagged' && (
                <span className="text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                  Review recommended
                </span>
              )}
            </div>
            <h1 className="text-2xl font-black theme-text">
              {titleForGeneration(item)}
            </h1>
            <div className="mt-1 text-xs theme-text-secondary flex flex-wrap gap-3">
              <span>{item.inputs?.grade}</span>
              <span>·</span>
              <span>{formatSubject(item.inputs?.subject)}</span>
              <span>·</span>
              <span>{formatDate(item.createdAt)}</span>
              {item.modelUsed && (
                <>
                  <span>·</span>
                  <span className="font-mono">{item.modelUsed}</span>
                </>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {item.tool === 'worksheet' && (
              <label className="flex items-center gap-2 text-sm theme-text px-3 py-2 rounded-xl border theme-border cursor-pointer">
                <input
                  type="checkbox"
                  checked={showAnswers}
                  onChange={(e) => setShowAnswers(e.target.checked)}
                  className="accent-indigo-500"
                />
                Show answers
              </label>
            )}
            <button
              onClick={onExport}
              className="px-4 py-2 rounded-xl text-sm font-bold border theme-border hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            >
              📄 Export .docx
            </button>
            <button
              onClick={onShare}
              disabled={sharing}
              className="px-4 py-2 rounded-xl text-sm font-bold border theme-border hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50"
            >
              {sharing ? '🔗 Publishing…' : '🔗 Share link'}
            </button>
            {item.tool === 'worksheet' && (
              <button
                onClick={onExportAnswerKey}
                className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-indigo-500 to-purple-500"
              >
                🔑 Answer Key .docx
              </button>
            )}
            {canEditDetails && (
              <button
                onClick={() => setEditingHeader(true)}
                className="px-4 py-2 rounded-xl text-sm font-bold border theme-border"
              >
                ✏️ Edit details
              </button>
            )}
            <button
              onClick={onRegenerate}
              className="px-4 py-2 rounded-xl text-sm font-bold border theme-border"
            >
              🔁 Generate similar
            </button>
            <button
              onClick={onDelete}
              className="px-4 py-2 rounded-xl text-sm font-bold text-rose-700 border border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950 transition"
            >
              🗑️ Delete
            </button>
          </div>
        </div>

        {/* Share banner — shown once a share link has been created */}
        {shareInfo && (
          <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm">
            <p className="font-black text-emerald-900 mb-1">Share link ready</p>
            <p className="text-emerald-800 text-xs mb-2">Anyone with this link can view this plan (read-only). You can revoke it from the Library at any time.</p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={shareInfo.url}
                readOnly
                onFocus={(e) => e.target.select()}
                className="flex-1 min-w-[260px] px-3 py-2 rounded-lg border border-emerald-300 bg-white text-emerald-900 text-xs font-mono"
              />
              <button onClick={onCopyShare} className="px-3 py-2 rounded-lg text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700">
                Copy
              </button>
            </div>
          </div>
        )}
        {shareError && (
          <div className="mb-4 rounded-xl border border-rose-300 bg-rose-50 text-rose-900 px-4 py-3 text-sm">
            ⚠️ {shareError}
          </div>
        )}

        {/* Warning banner, if present */}
        {item.status === 'flagged' && item.errorMessage && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
            ⚠️ This generation was flagged during validation. Please review
            carefully before using.
          </div>
        )}

        {item.status === 'failed' && (
          <div className="mb-4 rounded-xl border border-rose-300 bg-rose-50 text-rose-900 px-4 py-3 text-sm">
            ⚠️ This generation failed: {item.errorMessage || 'unknown error'}.
            Try regenerating from the same inputs.
          </div>
        )}

        {/* Content */}
        <div className="theme-card border theme-border rounded-2xl p-5">
          {item.tool === 'lesson_plan' && <LessonPlanView plan={item.output} />}
          {item.tool === 'worksheet' && (
            <WorksheetView worksheet={item.output} showAnswers={showAnswers} />
          )}
          {item.tool === 'flashcards' && <FlashcardsView flashcards={item.output} />}
          {item.tool === 'scheme_of_work' && <SchemeOfWorkView scheme={item.output} />}
          {item.tool === 'rubric' && <RubricView rubric={item.output} />}
          {!item.output && (
            <p className="text-sm theme-text-secondary italic">
              This generation has no output to display.
            </p>
          )}
        </div>
      </div>

      {editingHeader && item && (
        <EditHeaderModal
          tool={item.tool}
          header={item.output?.header || {}}
          saving={savingEdit}
          onCancel={() => setEditingHeader(false)}
          onSave={onSaveHeaderEdits}
        />
      )}
    </div>
  )
}

/* ── Edit-header modal ─────────────────────────────────────── */

const HEADER_FIELDS_BY_TOOL = {
  lesson_plan: [
    { key: 'school',              label: 'School',              type: 'text' },
    { key: 'teacherName',         label: 'Teacher name',        type: 'text' },
    { key: 'date',                label: 'Date',                type: 'text', placeholder: 'YYYY-MM-DD' },
    { key: 'time',                label: 'Time',                type: 'text', placeholder: '08:40–09:20' },
    { key: 'class',               label: 'Class',               type: 'text' },
    { key: 'termAndWeek',         label: 'Term & week',         type: 'text' },
    { key: 'numberOfPupils',      label: 'Number of pupils',    type: 'number' },
    { key: 'mediumOfInstruction', label: 'Medium of instruction', type: 'text' },
  ],
  scheme_of_work: [
    { key: 'school',              label: 'School',              type: 'text' },
    { key: 'teacherName',         label: 'Teacher name',        type: 'text' },
    { key: 'class',               label: 'Class',               type: 'text' },
    { key: 'academicYear',        label: 'Academic year',       type: 'text' },
    { key: 'mediumOfInstruction', label: 'Medium of instruction', type: 'text' },
  ],
  worksheet: [
    { key: 'title',        label: 'Title',        type: 'text' },
    { key: 'instructions', label: 'Instructions', type: 'textarea' },
    { key: 'duration',     label: 'Duration',     type: 'text', placeholder: '30 minutes' },
  ],
}

function EditHeaderModal({ tool, header, saving, onCancel, onSave }) {
  const fields = HEADER_FIELDS_BY_TOOL[tool] || []
  const [draft, setDraft] = useState(() => {
    const d = {}
    for (const f of fields) {
      d[f.key] = header[f.key] ?? ''
    }
    return d
  })

  function set(key, value) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  function onSubmit(e) {
    e.preventDefault()
    // Coerce number fields
    const cleaned = { ...draft }
    for (const f of fields) {
      if (f.type === 'number') {
        const n = Number(cleaned[f.key])
        cleaned[f.key] = Number.isFinite(n) ? n : 0
      }
    }
    onSave(cleaned)
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 flex items-start justify-center overflow-y-auto p-4">
      <form
        onSubmit={onSubmit}
        className="bg-white rounded-2xl max-w-xl w-full my-8 shadow-2xl"
      >
        <div className="sticky top-0 bg-white border-b theme-border px-5 py-3 flex items-center justify-between rounded-t-2xl">
          <h2 className="font-black text-lg">Edit details</h2>
          <button type="button" onClick={onCancel} className="text-slate-500 hover:text-slate-900">✕</button>
        </div>
        <div className="p-5 space-y-3">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1">
                {f.label}
              </label>
              {f.type === 'textarea' ? (
                <textarea
                  value={draft[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder || ''}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border-2 theme-border focus:outline-none focus:border-emerald-400 resize-none"
                />
              ) : (
                <input
                  type={f.type}
                  value={draft[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder || ''}
                  className="w-full px-3 py-2 rounded-lg border-2 theme-border focus:outline-none focus:border-emerald-400"
                />
              )}
            </div>
          ))}
          <p className="text-xs text-slate-500 italic pt-1">
            These changes save to your library and reflect in future exports.
            To change the lesson's topic or content, use <b>Generate similar</b> instead.
          </p>
        </div>
        <div className="sticky bottom-0 bg-white border-t theme-border px-5 py-3 flex items-center justify-end gap-2 rounded-b-2xl">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm font-bold border-2 theme-border hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 rounded-xl text-sm font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

function formatSubject(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
