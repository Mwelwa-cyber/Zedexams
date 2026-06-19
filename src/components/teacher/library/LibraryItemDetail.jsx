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
  getItemPermissions,
  LIBRARY_ACCESS,
} from '../../../utils/teacherLibraryService'
import LessonPlanView from '../views/LessonPlanView'
import WorksheetView from '../views/WorksheetView'
import FlashcardsView from '../views/FlashcardsView'
import SchemeOfWorkView from '../views/SchemeOfWorkView'
import MarkScheduleView from '../views/MarkScheduleView'
import WeeklyForecastView from '../views/WeeklyForecastView'
import RecordOfWorkView from '../views/RecordOfWorkView'
import ClassTimetableView from '../views/ClassTimetableView'
import RubricView from '../views/RubricView'
import NotesView from '../views/NotesView'
import SbaTaskView from '../views/SbaTaskView'
import SbaTrackerView from '../views/SbaTrackerView'
import SbaPlanView from '../views/SbaPlanView'
import SeoHelmet from '../../seo/SeoHelmet'
import { downloadLessonPlanDocx } from '../../../utils/lessonPlanToDocx'
import { downloadWorksheetDocx } from '../../../utils/worksheetToDocx'
import { downloadFlashcardsDocx } from '../../../utils/flashcardsToDocx'
import { downloadSchemeOfWorkDocx } from '../../../utils/schemeOfWorkToDocx'
import { downloadMarkScheduleDocx } from '../../../utils/markScheduleToDocx'
import { downloadMarkScheduleXlsx } from '../../../utils/markScheduleToXlsx'
import { downloadReportCardsDocx } from '../../../utils/reportCardsToDocx'
import { downloadFullLessonDocx } from '../../../utils/fullLessonToDocx'
import FullLessonView from '../views/FullLessonView'
import { downloadWeeklyForecastDocx } from '../../../utils/weeklyForecastToDocx'
import { downloadRecordOfWorkDocx } from '../../../utils/recordOfWorkToDocx'
import { downloadClassTimetableDocx } from '../../../utils/classTimetableToDocx'
import { downloadClassTimetableXlsx } from '../../../utils/classTimetableToXlsx'
import { downloadClassTimetablePdf } from '../../../utils/classTimetableToPdf'
import { downloadRubricDocx } from '../../../utils/rubricToDocx'
import { downloadNotesDocx } from '../../../utils/notesToDocx'
import { downloadSbaTaskDocx } from '../../../utils/sbaTaskToDocx'
import { downloadSbaTrackerDocx } from '../../../utils/sbaTrackerToDocx'
import { downloadSbaPlannerDocx } from '../../../utils/sbaPlannerToDocx'
import { buildSbaPlan } from '../../../utils/sbaPlanner'
import { buildDownloadName } from '../../../utils/downloadFilename'

// Human-readable document-type labels, keyed by the generation's `tool`.
const TOOL_DOC_TYPES = {
  lesson_plan: 'Lesson Plan',
  worksheet: 'Worksheet',
  flashcards: 'Flashcards',
  scheme_of_work: 'Scheme of Work',
  rubric: 'Rubric',
  notes: 'Notes',
  mark_schedule: 'Mark Schedule',
  full_lesson: 'Full Lesson',
  weekly_forecast: 'Weekly Forecast',
  record_of_work: 'Record of Work',
  class_timetable: 'Class Timetable',
  sba_task: 'SBA Task',
  sba_mark_sheet: 'SBA Mark Schedule',
  sba_plan: 'SBA Year Plan',
}
import { buildGeneratorQueryString } from '../../../utils/useFormDefaultsFromUrl'
import { resolveGeneration } from '../../../utils/adminGenerationsService'
import { publishShare } from '../../../utils/shareService'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../ui/Toast'
import ConfirmDialog from '../../ui/ConfirmDialog'

export default function LibraryItemDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { currentUser, userProfile, isAdmin } = useAuth()
  const toast = useToast()
  const [item, setItem] = useState(null)
  const [status, setStatus] = useState('loading')
  const [showAnswers, setShowAnswers] = useState(false)
  // Mark schedules: false = raw marks view, true = percentages view.
  const [showPercents, setShowPercents] = useState(false)
  const [editingHeader, setEditingHeader] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareInfo, setShareInfo] = useState(null)
  const [shareError, setShareError] = useState('')
  // Delete flow — confirmingDelete drives the ConfirmDialog, deleting its spinner.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Admin-only: acknowledge a failed generation so it drops out of the
  // dashboard "Needs attention" queue without deleting the audit record.
  const [resolvingFailure, setResolvingFailure] = useState(false)

  // Pro vs Premium access — Pro can download own generations only,
  // Premium can download / print / export everything.
  const permissions = getItemPermissions({
    userProfile: userProfile ? { ...userProfile, uid: currentUser?.uid } : null,
    isAdmin,
    item,
  })

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
    getGeneration(id)
      .then((row) => {
        if (!row) {
          setStatus('notfound')
          return
        }
        setItem(row)
        setStatus('ready')
      })
      .catch(err => {
        console.error('LibraryItemDetail load:', err)
        setStatus('notfound')
      })
  }, [id])

  async function onResolveFailure() {
    if (!item) return
    setResolvingFailure(true)
    const ok = await resolveGeneration(item.id, true)
    setResolvingFailure(false)
    if (ok) {
      setItem((prev) => ({ ...prev, adminResolved: true }))
    } else {
      toast.error('Could not mark this generation resolved. Please try again.')
    }
  }

  function onDelete() {
    if (!item) return
    setConfirmingDelete(true)
  }

  async function confirmDelete() {
    if (!item) return
    setDeleting(true)
    const ok = await deleteGeneration(item.id)
    setDeleting(false)
    setConfirmingDelete(false)
    if (ok) {
      navigate('/teacher/library')
    } else {
      toast.error('Could not delete this item. Please try again.')
    }
  }

  async function onExport() {
    if (!item?.output) return
    if (!permissions.canDownload) {
      toast.error(
        permissions.level === LIBRARY_ACCESS.PRO
          ? 'Downloads of library documents you didn\'t create are reserved for Premium accounts.'
          : 'Sign in to a paid plan to download library documents.',
      )
      return
    }
    const name = (ext = 'docx') => buildDownloadName({
      docType: TOOL_DOC_TYPES[item.tool] || TOOL_META[item.tool]?.label || 'Document',
      grade: item.inputs?.grade || item.output?.header?.grade,
      subject: item.inputs?.subject || item.output?.header?.subject,
      topic: item.inputs?.topic || item.output?.header?.topic,
      term: item.inputs?.term ?? item.output?.header?.term,
      year: item.inputs?.year ?? item.output?.header?.year,
      week: item.inputs?.weekNumber ?? item.output?.header?.weekNumber,
      extra: item.output?.header?.className,
      ext,
    })

    if (item.tool === 'lesson_plan') {
      await downloadLessonPlanDocx(item.output, name())
      recordExport(item.id, 'docx')
    } else if (item.tool === 'worksheet') {
      await downloadWorksheetDocx(item.output, name(), { mode: 'worksheet' })
      recordExport(item.id, 'docx')
    } else if (item.tool === 'flashcards') {
      await downloadFlashcardsDocx(item.output, name())
      recordExport(item.id, 'docx')
    } else if (item.tool === 'scheme_of_work') {
      await downloadSchemeOfWorkDocx(item.output, name())
      recordExport(item.id, 'docx')
    } else if (item.tool === 'rubric') {
      await downloadRubricDocx(item.output, name())
      recordExport(item.id, 'docx')
    } else if (item.tool === 'notes') {
      await downloadNotesDocx(item.output, name())
      recordExport(item.id, 'docx')
    } else if (item.tool === 'mark_schedule') {
      await downloadMarkScheduleDocx(item.output, name(), { mode: showPercents ? 'percent' : 'marks' })
      recordExport(item.id, 'docx')
    } else if (item.tool === 'full_lesson') {
      await downloadFullLessonDocx(item.output, name())
      recordExport(item.id, 'docx')
    } else if (item.tool === 'weekly_forecast') {
      await downloadWeeklyForecastDocx(item.output, name())
      recordExport(item.id, 'docx')
    } else if (item.tool === 'record_of_work') {
      await downloadRecordOfWorkDocx(item.output, name())
      recordExport(item.id, 'docx')
    } else if (item.tool === 'class_timetable') {
      await downloadClassTimetableDocx(item.output, name())
      recordExport(item.id, 'docx')
    } else if (item.tool === 'sba_task') {
      await downloadSbaTaskDocx(item.output, name(), {
        includeAnswers: true,
        schoolName: item.output?.header?.schoolName || userProfile?.school || userProfile?.schoolName || '',
      })
      recordExport(item.id, 'docx')
    } else if (item.tool === 'sba_mark_sheet') {
      await downloadSbaTrackerDocx(item.output, name())
      recordExport(item.id, 'docx')
    } else if (item.tool === 'sba_plan') {
      const h = item.output?.header || {}
      const plan = buildSbaPlan(h.subject, h.grade, item.output?.statuses || {})
      if (plan) {
        await downloadSbaPlannerDocx({ ...plan, statuses: item.output?.statuses || {} }, h, name())
        recordExport(item.id, 'docx')
      }
    }
  }

  async function onExportXlsx() {
    if (!item?.output || !permissions.canDownload) return
    if (item.tool !== 'mark_schedule' && item.tool !== 'class_timetable') return
    const name = buildDownloadName({
      docType: TOOL_DOC_TYPES[item.tool] || 'Document',
      grade: item.inputs?.grade || item.output?.header?.grade,
      subject: item.inputs?.subject || item.output?.header?.subject,
      term: item.inputs?.term ?? item.output?.header?.term,
      year: item.inputs?.year ?? item.output?.header?.year,
      extra: item.output?.header?.className,
      ext: 'xlsx',
    })
    if (item.tool === 'class_timetable') {
      await downloadClassTimetableXlsx(item.output, name)
    } else {
      await downloadMarkScheduleXlsx(item.output, name)
    }
    recordExport(item.id, 'xlsx')
  }

  async function onExportPdf() {
    if (item?.tool !== 'class_timetable' || !item.output || !permissions.canDownload) return
    try {
      const name = buildDownloadName({
        docType: TOOL_DOC_TYPES[item.tool] || 'Class Timetable',
        grade: item.inputs?.grade || item.output?.header?.grade,
        term: item.inputs?.term ?? item.output?.header?.term,
        year: item.inputs?.year ?? item.output?.header?.year,
        extra: item.output?.header?.className,
        ext: 'pdf',
      })
      await downloadClassTimetablePdf(item.output, { filename: name })
      recordExport(item.id, 'pdf')
    } catch (err) {
      console.error('[LibraryItemDetail] timetable pdf failed', err)
    }
  }

  async function onExportReportCards() {
    if (item?.tool !== 'mark_schedule' || !item.output) return
    if (!permissions.canDownload) return
    const name = buildDownloadName({
      docType: 'Report Cards',
      grade: item.inputs?.grade || item.output?.header?.grade,
      term: item.inputs?.term ?? item.output?.header?.term,
      year: item.inputs?.year ?? item.output?.header?.year,
    })
    await downloadReportCardsDocx(item.output, name)
    recordExport(item.id, 'report_cards')
  }

  async function onExportAnswerKey() {
    if (item?.tool !== 'worksheet' || !item.output) return
    if (!permissions.canDownload) return
    const name = buildDownloadName({
      docType: 'Worksheet',
      grade: item.inputs?.grade || item.output?.header?.grade,
      subject: item.inputs?.subject || item.output?.header?.subject,
      topic: item.inputs?.topic || item.output?.header?.topic,
      variant: 'Answer Key',
    })
    await downloadWorksheetDocx(item.output, name, { mode: 'answer_key' })
    recordExport(item.id, 'docx_answer_key')
  }

  function onRegenerate() {
    if (!item) return
    const meta = TOOL_META[item.tool]
    if (!meta?.route) return
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
      toast.error('Could not save changes. Please try again.')
    }
    setSavingEdit(false)
  }

  // Edit-details is currently supported for tools with an editable `output.header`.
  const canEditDetails = item && ['lesson_plan', 'scheme_of_work', 'worksheet', 'sba_task']
    .includes(item.tool)

  if (status === 'loading') {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center" style={{ background: '#f5efe1' }}>
        <div className="studio-card p-8 text-center">
          <div className="text-4xl mb-3 animate-bounce">📚</div>
          <p style={{ color: '#566f76' }}>Loading…</p>
        </div>
      </div>
    )
  }

  if (status === 'notfound' || !item) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center" style={{ background: '#f5efe1' }}>
        <div className="studio-card p-8 max-w-md text-center">
          <div className="text-5xl mb-3">🤷</div>
          <h2 className="studio-display" style={{ fontSize: 20, color: '#0e2a32', marginBottom: 8 }}>Not found</h2>
          <p className="text-sm mb-4" style={{ color: '#566f76' }}>
            This generation may have been deleted or belongs to another account.
          </p>
          <Link to="/teacher/library" className="studio-btn-ghost inline-block">
            ← Back to library
          </Link>
        </div>
      </div>
    )
  }

  const meta = TOOL_META[item.tool] || { label: item.tool, icon: '📄' }

  return (
    <div className="min-h-screen py-4 sm:py-6 lg:py-8" style={{ background: '#f5efe1' }}>
      <SeoHelmet title={item?.title || meta.label || 'Library item'} noIndex />
      <div className="max-w-5xl mx-auto">
        {/* Breadcrumb */}
        <nav className="mb-4 text-sm" style={{ color: '#566f76' }}>
          <Link to="/teacher/library" className="hover:underline" style={{ color: '#0e2a32', fontWeight: 700 }}>← My Library</Link>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl" aria-hidden="true">{meta.icon}</span>
              <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: '#ff7a2e', letterSpacing: '1.2px' }}>
                {meta.label}
              </span>
              {item.status === 'flagged' && (
                <span className="text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: '#fff5e6', color: '#c2531a' }}>
                  Review recommended
                </span>
              )}
            </div>
            <h1 className="studio-display" style={{ fontSize: 28, color: '#0e2a32', margin: 0 }}>
              {titleForGeneration(item)}
            </h1>
            <div className="mt-1 text-xs flex flex-wrap gap-3" style={{ color: '#566f76' }}>
              <span>{item.inputs?.grade || item.meta?.klass}</span>
              <span>·</span>
              <span>{formatSubject(item.inputs?.subject || item.meta?.subject)}</span>
              <span>·</span>
              <span>{formatDate(item.createdAt)}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {item.tool === 'worksheet' && (
              <label className="flex items-center gap-2 text-sm px-3 py-2 rounded-xl cursor-pointer" style={{ color: '#0e2a32', border: '1.5px solid #d9cfb8' }}>
                <input
                  type="checkbox"
                  checked={showAnswers}
                  onChange={(e) => setShowAnswers(e.target.checked)}
                  style={{ accentColor: '#ff7a2e' }}
                />
                Show answers
              </label>
            )}
            {item.tool === 'mark_schedule' && (
              <label className="flex items-center gap-2 text-sm px-3 py-2 rounded-xl cursor-pointer" style={{ color: '#0e2a32', border: '1.5px solid #d9cfb8' }}>
                <input
                  type="checkbox"
                  checked={showPercents}
                  onChange={(e) => setShowPercents(e.target.checked)}
                  style={{ accentColor: '#ff7a2e' }}
                />
                Show percentages
              </label>
            )}
            <button
              onClick={onExport}
              disabled={!permissions.canDownload}
              className="studio-btn-ghost disabled:opacity-50 disabled:cursor-not-allowed"
              title={permissions.canDownload
                ? 'Download a Word .docx copy'
                : 'Premium only — upgrade to download library documents'}
            >
              📄 Export .docx
            </button>
            {(item.tool === 'mark_schedule' || item.tool === 'class_timetable') && (
              <button
                onClick={onExportXlsx}
                disabled={!permissions.canDownload}
                className="studio-btn-ghost disabled:opacity-50 disabled:cursor-not-allowed"
                title={permissions.canDownload
                  ? 'Download an Excel workbook'
                  : 'Premium only — upgrade to download library documents'}
              >
                📊 Export .xlsx
              </button>
            )}
            {item.tool === 'class_timetable' && (
              <button
                onClick={onExportPdf}
                disabled={!permissions.canDownload}
                className="studio-btn-ghost disabled:opacity-50 disabled:cursor-not-allowed"
                title={permissions.canDownload
                  ? 'Open a print view to save as PDF'
                  : 'Premium only — upgrade to download library documents'}
              >
                🖨️ Export PDF
              </button>
            )}
            {item.tool === 'mark_schedule' && (
              <button
                onClick={onExportReportCards}
                disabled={!permissions.canDownload}
                className="studio-btn-ghost disabled:opacity-50 disabled:cursor-not-allowed"
                title={permissions.canDownload
                  ? 'Download per-pupil report cards — one page per pupil'
                  : 'Premium only — upgrade to download library documents'}
              >
                🪪 Report cards
              </button>
            )}
            <button
              onClick={onShare}
              disabled={sharing}
              className="studio-btn-ghost disabled:opacity-50"
            >
              {sharing ? '🔗 Publishing…' : '🔗 Share link'}
            </button>
            {item.tool === 'worksheet' && (
              <button
                onClick={onExportAnswerKey}
                disabled={!permissions.canDownload}
                className="studio-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                title={permissions.canDownload
                  ? 'Download the answer key'
                  : 'Premium only — upgrade to download answer keys'}
              >
                🔑 Answer Key .docx
              </button>
            )}
            {canEditDetails && (
              <button onClick={() => setEditingHeader(true)} className="studio-btn-ghost">
                ✏️ Edit details
              </button>
            )}
            {meta.route && (
              <button onClick={onRegenerate} className="studio-btn-ghost">
                🔁 Generate similar
              </button>
            )}
            {item.tool === 'lesson_plan' && (
              <button
                onClick={() => navigate(`/teacher/generate/notes?lessonPlanId=${item.id}`)}
                className="studio-btn-primary"
              >
                📓 Generate Notes
              </button>
            )}
            <button
              onClick={onDelete}
              className="px-4 py-2 rounded-xl text-sm font-bold transition"
              style={{ color: '#b91c1c', border: '2px solid #fecaca', background: '#fff' }}
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
              {/* WhatsApp is how Zambian teachers actually pass documents
                  around — one tap beats copy-switch-paste. */}
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`${titleForGeneration(item)} — ${shareInfo.url}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black text-white bg-green-600 hover:bg-green-700"
              >
                <span aria-hidden="true">💬</span> WhatsApp
              </a>
            </div>
          </div>
        )}
        {shareError && (
          <div className="mb-4 rounded-xl border border-rose-300 bg-rose-50 text-rose-900 px-4 py-3 text-sm">
            ⚠️ {shareError}
          </div>
        )}

        {/* Pro vs Premium access notice — Pro users can only download docs
            they generated themselves. Library-supplied docs are view-only
            unless they upgrade to Premium. */}
        {permissions.level === LIBRARY_ACCESS.PRO && !permissions.canDownload && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
            🔒 You're on the Pro plan. You can preview this document, but
            downloads of library-supplied documents are reserved for Premium.
          </div>
        )}
        {permissions.level === LIBRARY_ACCESS.FREE && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
            🔒 View-only on the free plan — upgrade to download, print, or export.
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
            <p>
              ⚠️ This generation failed: {item.errorMessage || 'unknown error'}.
              Try regenerating from the same inputs.
            </p>
            {isAdmin && (
              <div className="mt-2">
                {item.adminResolved ? (
                  <span className="text-xs font-bold text-rose-700/70">
                    ✓ Marked resolved — cleared from the admin attention queue.
                  </span>
                ) : (
                  <button
                    onClick={onResolveFailure}
                    disabled={resolvingFailure}
                    className="text-xs font-black underline disabled:opacity-50"
                  >
                    {resolvingFailure ? 'Resolving…' : 'Mark resolved'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div className="studio-card p-5">
          {item.tool === 'lesson_plan' && item.output && <LessonPlanView plan={item.output} />}
          {item.tool === 'lesson_plan' && !item.output && item.html && (
            <LegacyStudioFrame html={item.html} />
          )}
          {item.tool === 'worksheet' && (
            <WorksheetView worksheet={item.output} showAnswers={showAnswers} />
          )}
          {item.tool === 'flashcards' && <FlashcardsView flashcards={item.output} />}
          {item.tool === 'scheme_of_work' && <SchemeOfWorkView scheme={item.output} />}
          {item.tool === 'mark_schedule' && item.output && (
            <MarkScheduleView schedule={item.output} mode={showPercents ? 'percent' : 'marks'} />
          )}
          {item.tool === 'class_timetable' && item.output && (
            <ClassTimetableView timetable={item.output} />
          )}
          {item.tool === 'weekly_forecast' && item.output && (
            <WeeklyForecastView forecast={item.output} />
          )}
          {item.tool === 'record_of_work' && item.output && (
            <RecordOfWorkView record={item.output} />
          )}
          {item.tool === 'full_lesson' && <FullLessonView lesson={item.output} />}
          {item.tool === 'rubric' && <RubricView rubric={item.output} />}
          {item.tool === 'notes' && <NotesView notes={item.output} />}
          {item.tool === 'sba_task' && (
            <SbaTaskView
              task={item.output}
              showAnswers
              schoolName={item.output?.header?.schoolName || userProfile?.school || userProfile?.schoolName || ''}
            />
          )}
          {item.tool === 'sba_mark_sheet' && item.output && <SbaTrackerView sheet={item.output} />}
          {item.tool === 'sba_plan' && item.output && <SbaPlanView plan={item.output} />}
          {!item.output && !(item.tool === 'lesson_plan' && item.html) && (
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

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this generation?"
        message="It will disappear from your library for good. This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
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
  sba_task: [
    { key: 'schoolName', label: 'School name', type: 'text', placeholder: 'Your school name' },
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
                  className="studio-input resize-none"
                />
              ) : (
                <input
                  type={f.type}
                  value={draft[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder || ''}
                  className="studio-input"
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
            className="studio-btn-ghost"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="studio-btn-primary disabled:opacity-50"
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

/**
 * Render a legacy Lesson Plan Studio doc (pre-PR-403 saves only had a
 * pre-rendered `html` string + the studio's CSS bundle, never an `output`
 * tree). We mount it inside a sandboxed iframe so the studio's global
 * stylesheet doesn't leak into the React app, and resize the frame to
 * fit its content.
 */
function LegacyStudioFrame({ html }) {
  const [height, setHeight] = useState(800)
  const safeHtml = String(html || '')
  const srcDoc = `<!doctype html><html><head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <link rel="stylesheet" href="/studio/lesson.css" />
    <style>
      body { margin: 0; padding: 24px 16px; background: transparent; }
      .doc-wrap { box-shadow: none !important; margin: 0 auto; }
    </style>
  </head><body><div id="view-plans"><div class="workspace">${safeHtml}</div></div>
    <script>
      function reportHeight() {
        const h = document.documentElement.scrollHeight
        parent.postMessage({ __legacyStudioFrameHeight: h }, '*')
      }
      window.addEventListener('load', reportHeight)
      window.addEventListener('resize', reportHeight)
      setTimeout(reportHeight, 250)
      setTimeout(reportHeight, 1000)
    </script>
  </body></html>`

  useEffect(() => {
    function onMessage(e) {
      const h = e?.data?.__legacyStudioFrameHeight
      if (typeof h === 'number' && h > 200) setHeight(h + 24)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <iframe
      title="Lesson plan"
      srcDoc={srcDoc}
      sandbox="allow-same-origin allow-scripts"
      style={{ width: '100%', height, border: 0, display: 'block' }}
    />
  )
}
