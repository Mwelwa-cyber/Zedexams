import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  getGeneration,
  deleteGeneration,
  duplicateGeneration,
  recordExport,
  updateGenerationOutput,
  listMyGenerations,
  CLIENT_CREATED_TOOLS,
  TOOL_META,
  titleForGeneration,
  formatDate,
  getItemPermissions,
  LIBRARY_ACCESS,
} from '../../../utils/teacherLibraryService'
import { LessonPlanView } from '../../lessonPlanStudio'
import { WorksheetView } from '../../worksheet'
import {
  FlashcardsView,
  FlashcardStudyOverlay,
  useFlashcardProgress,
} from '../../flashcards'
import { downloadFlashcardsDocx } from '../../../engines/export-engine/flashcardsToDocx'
import { downloadFlashcardsPdf } from '../../../engines/export-engine/flashcardsToPdf'
import { SchemeOfWorkView } from '../../schemeOfWork'
import { MarkScheduleView } from '../../markSchedule'
import { WeeklyForecastView } from '../../weeklyForecast'
import { RecordOfWorkView } from '../../recordOfWork'
import { ClassTimetableView } from '../../classTimetable'
import { RubricView } from '../../rubric'
import { NotesView } from '../../teacherNotes'
import { SbaTaskView, SbaTrackerView, SbaPlanView } from '../../sba'
import LessonActivitiesView from '../../../components/teacher/views/LessonActivitiesView'
import { HomeworkView } from '../../homework'
import AssessmentPaperView from '../../../components/teacher/views/AssessmentPaperView'
import { aiPaperToStudioDoc } from '../../../utils/aiPaperToSections'
import { buildAssessmentExportReadiness } from '../../../utils/assessmentExportReadiness'
import { renderDiagramSvg } from '../../../components/diagrams/diagramCatalog'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import { downloadLessonPlanDocx } from '../../../engines/export-engine/lessonPlanToDocx'
import { downloadLibraryItemViaServer } from '../../../utils/serverLibraryDownload'
import { downloadWorksheetDocx } from '../../../engines/export-engine/worksheetToDocx'
import { downloadSchemeOfWorkDocx } from '../../../engines/export-engine/schemeOfWorkToDocx'
import { downloadMarkScheduleDocx } from '../../../engines/export-engine/markScheduleToDocx'
import { downloadMarkScheduleXlsx } from '../../../engines/export-engine/markScheduleToXlsx'
import { downloadReportCardsDocx } from '../../../engines/export-engine/reportCardsToDocx'
import { downloadFullLessonDocx } from '../../../utils/fullLessonToDocx'
import FullLessonView from '../../../components/teacher/views/FullLessonView'
import { downloadWeeklyForecastDocx } from '../../../engines/export-engine/weeklyForecastToDocx'
import { downloadRecordOfWorkDocx } from '../../../engines/export-engine/recordOfWorkToDocx'
import { downloadClassTimetableDocx } from '../../../engines/export-engine/classTimetableToDocx'
import { downloadClassTimetableXlsx } from '../../../engines/export-engine/classTimetableToXlsx'
import { downloadClassTimetablePdf } from '../../../engines/export-engine/classTimetableToPdf'
import { downloadLessonPlanPdf } from '../../../engines/export-engine/lessonPlanToPdf'
import { downloadRubricPdf } from '../../../engines/export-engine/rubricToPdf'
import { downloadNotesPdf } from '../../../engines/export-engine/notesToPdf'
import { downloadHomeworkPdf } from '../../../engines/export-engine/homeworkToPdf'
import { downloadFullLessonPdf } from '../../../utils/fullLessonToPdf'
import { downloadSchemeOfWorkPdf } from '../../../engines/export-engine/schemeOfWorkToPdf'
import { downloadSbaTaskPdf } from '../../../engines/export-engine/sbaTaskToPdf'
import { downloadRubricDocx } from '../../../engines/export-engine/rubricToDocx'
import { downloadNotesDocx } from '../../../engines/export-engine/notesToDocx'
import { downloadLessonActivitiesDocx } from '../../../utils/activityToDocx'
import { downloadHomeworkDocx } from '../../../engines/export-engine/homeworkToDocx'
import { downloadSbaTaskDocx } from '../../../engines/export-engine/sbaTaskToDocx'
import { downloadSbaTrackerDocx } from '../../../engines/export-engine/sbaTrackerToDocx'
import { downloadSbaPlannerDocx } from '../../../engines/export-engine/sbaPlannerToDocx'
import { buildSbaPlan } from '../../../utils/sbaPlanner'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { resolvePlanPayload } from '../lib/planPayload'
import { SchemeEditableTable } from '../../schemeOfWork'
import { WeeklyForecastEditableTable } from '../../weeklyForecast'
import { stampEditHistory, lastEditedAt, editHistoryOf } from '../../../utils/schemeEditHistory'

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
  homework: 'Homework',
  lesson_activities: 'Exercise & Homework',
  assessment: 'Test Paper',
  exam_paper: 'Exam Paper',
}

import { buildGeneratorQueryString } from '../../../utils/useFormDefaultsFromUrl'
import { inheritFromLessonPlan } from '../../../utils/lessonPlanInheritance'
import { readActiveAssignmentSeed } from '../../../utils/activeAssignmentSeed'
import { resolveGeneration } from '../../../utils/adminGenerationsService'
import { publishShare, revokeShare, listSharesForGeneration } from '../../../utils/shareService'
import { useAuth } from '../../../contexts/AuthContext'
import useStudioAvailability from '../../../hooks/useStudioAvailability'
import { useToast } from '../../../components/ui/Toast'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'

// Tools whose library detail offers a direct HTML→PDF download (beyond the
// lesson-plan / class-timetable specials handled separately in onExportPdf).
const PDF_EXPORT_TOOLS = [
  'flashcards',
  'rubric',
  'notes',
  'homework',
  'full_lesson',
  'scheme_of_work',
  'sba_task',
]

export default function LibraryItemDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { currentUser, userProfile, isAdmin } = useAuth()
  // A document whose studio is retired or withdrawn is still fully READABLE
  // and EXPORTABLE — nothing about it changes. What it loses is every route
  // back into the studio: "Generate similar", the lesson-plan hand-off, and
  // editing its saved inputs. `retiredLabel` names the reason on the page so
  // a teacher is not left wondering where the buttons went.
  const { isAvailable, retiredLabel } = useStudioAvailability()
  const toast = useToast()
  const [item, setItem] = useState(null)
  const [status, setStatus] = useState('loading')
  // Bumped by the error-panel Retry button to re-run the load effect.
  const [reloadKey, setReloadKey] = useState(0)
  const [showAnswers, setShowAnswers] = useState(false)
  // Mark schedules: false = raw marks view, true = percentages view.
  const [showPercents, setShowPercents] = useState(false)
  const [editingHeader, setEditingHeader] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  // Full-document edit mode (scheme of work / weekly forecast row editing).
  const [editingDoc, setEditingDoc] = useState(false)
  const [docDraft, setDocDraft] = useState(null)
  const [savingDoc, setSavingDoc] = useState(false)
  const [sharing, setSharing] = useState(false)
  // Live (non-revoked) share links for this item — loaded on open + updated on
  // create/revoke, so a teacher can take down a previously-shared link.
  const [activeShares, setActiveShares] = useState([])
  const [revokingToken, setRevokingToken] = useState(null)
  const [shareError, setShareError] = useState('')
  // Delete flow — confirmingDelete drives the ConfirmDialog, deleting its spinner.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  // Admin-only: acknowledge a failed generation so it drops out of the
  // dashboard "Needs attention" queue without deleting the audit record.
  const [resolvingFailure, setResolvingFailure] = useState(false)

  // Flashcard study mode
  const [studyIndex, setStudyIndex] = useState(0)
  const [studyFlipped, setStudyFlipped] = useState(false)
  const [studyOpen, setStudyOpen] = useState(false)
  const { masteredCards, markMastered, markReview } = useFlashcardProgress(
    item?.tool === 'flashcards' ? item?.id : null,
  )

  // Pro vs Premium access — Pro can download own generations only,
  // Premium can download / print / export everything.
  const permissions = getItemPermissions({
    userProfile: userProfile ? { ...userProfile, uid: currentUser?.uid } : null,
    isAdmin,
    item,
  })

  async function onShare() {
    // The Lesson Plan Studio saves its plan JSON under `data` (Firestore rules
    // forbid the studio writing `output`), so a studio-saved lesson plan has
    // `data` but no `output`. Resolve the shareable payload the same way the
    // PDF export does (`output || data`) — otherwise Share silently no-ops on
    // every lesson plan while PDF works, which is the reported bug.
    const shareable = resolvePlanPayload(item)
    // Both guards must show a visible error — a silent return here is the
    // "Share link button does nothing" bug (both content-missing and signed-out
    // cases look identical to the teacher if we just return quietly).
    if (!shareable) {
      setShareError(
        'This document has no content to share. It may be a legacy format — please generate a new copy to get a shareable link.',
      )
      return
    }
    if (!currentUser?.uid) {
      setShareError('You must be signed in to create a share link.')
      return
    }
    setSharing(true)
    setShareError('')
    try {
      const result = await publishShare({
        // Title is derived from the actual tool (worksheet, scheme, rubric…),
        // not hard-coded to "lesson plan".
        tool: item.tool,
        ownerUid: currentUser.uid,
        title: titleForGeneration(item).slice(0, 200),
        plan: shareable,
        subject: item.inputs?.subject || shareable?.header?.subject || null,
        grade: item.inputs?.grade || shareable?.header?.class || null,
        topic: item.inputs?.topic || shareable?.header?.topic || null,
        generationId: item.id,
      })
      setActiveShares((prev) => [{ token: result.token, url: result.url, createdAt: null }, ...prev])
    } catch (err) {
      setShareError(err?.message || 'Could not create share link.')
    } finally {
      setSharing(false)
    }
  }

  function copyShareUrl(url) {
    if (!url) return
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(() => {})
    }
  }

  async function onRevokeShare(token) {
    setRevokingToken(token)
    setShareError('')
    try {
      await revokeShare(token)
      setActiveShares((prev) => prev.filter((s) => s.token !== token))
    } catch (err) {
      setShareError(err?.message || 'Could not revoke that link.')
    } finally {
      setRevokingToken(null)
    }
  }

  useEffect(() => {
    if (!id) return undefined
    let cancelled = false
    setStatus('loading')
    getGeneration(id)
      .then((row) => {
        if (cancelled) return
        if (!row) {
          // getGeneration returns null ONLY for a genuinely missing/foreign
          // doc — a load failure rejects instead and lands in .catch below.
          setStatus('notfound')
          return
        }
        setItem(row)
        setStatus('ready')
      })
      .catch(err => {
        if (cancelled) return
        // A transient load failure is NOT "not found": show a retryable error
        // rather than a dead-end that tells the teacher their work was deleted.
        console.error('LibraryItemDetail load:', err)
        setStatus('error')
      })
    return () => { cancelled = true }
  }, [id, reloadKey])

  // Load any live share links the teacher already created for this item, so
  // they can revoke a link shared in a previous session.
  useEffect(() => {
    if (status !== 'ready' || !id || !currentUser?.uid) return undefined
    let cancelled = false
    listSharesForGeneration(currentUser.uid, id)
      .then((shares) => { if (!cancelled) setActiveShares(shares) })
      .catch(() => { /* best-effort — listSharesForGeneration already swallows */ })
    return () => { cancelled = true }
  }, [status, id, currentUser?.uid])

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

  // Duplicate — client-created tools only (mark schedules, forecasts,
  // records of work, timetables, SBA sheets/plans): firestore.rules lets the
  // owner create those docs directly. AI-generated docs can't be re-created
  // client-side; their path is "Generate similar". Owner-only, so an admin
  // viewing another teacher's doc doesn't clone it into their own library.
  const canDuplicate = item
    && CLIENT_CREATED_TOOLS.includes(item.tool)
    && !!item.output
    && item.ownerUid === currentUser?.uid

  async function onDuplicate() {
    if (!item || duplicating) return
    setDuplicating(true)
    try {
      const newId = await duplicateGeneration(item, currentUser?.uid)
      toast.success('Copy saved to your library — you\'re now viewing the copy.')
      navigate(`/teacher/library/${newId}`)
    } catch (err) {
      toast.error(err?.message || 'Could not duplicate this item. Please try again.')
    } finally {
      setDuplicating(false)
    }
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
    // Studio-saved lesson plans keep their JSON under `data`, not `output`
    // (see resolvePlanPayload / onShare). Resolve the exportable payload the
    // same way so Word export works for them — a bare `!item.output` guard
    // silently no-ops the Export button on every lesson plan (Word + Share
    // broken together while PDF, which already falls back to `data`, works).
    const exportable = resolvePlanPayload(item)
    // A silent return here is the "Export button does nothing" bug: no toast,
    // no console output — the teacher has no idea why the click was ignored.
    if (!exportable) {
      toast.error(
        'This document has no exportable content. It may be a legacy format — please generate a new copy to download it.',
      )
      return
    }
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
      grade: item.inputs?.grade || exportable?.header?.grade,
      subject: item.inputs?.subject || exportable?.header?.subject,
      topic: item.inputs?.topic || exportable?.header?.topic,
      term: item.inputs?.term ?? exportable?.header?.term,
      year: item.inputs?.year ?? exportable?.header?.year,
      week: item.inputs?.weekNumber ?? exportable?.header?.weekNumber,
      extra: exportable?.header?.className,
      ext,
    })

    try {
    if (item.tool === 'lesson_plan') {
      // Prefer the server-generated download: it streams from zedexams.com with
      // the correct filename (no Firebase, no upload) and works on browsers that
      // mangle in-page blob: download names. Falls back to the in-app generator
      // if the server path isn't available (unsaved item, native shell, error,
      // or a studio-saved plan the server can't rebuild yet).
      const served = await downloadLibraryItemViaServer({ generationId: item.id, filename: name() })
      // Hand the SAVED meta to the exporter: it carries the paper format the
      // plan was generated with (page budget, margins, environment display) and
      // which curriculum it belongs to. Without it a 1-page OBC plan downloaded
      // as a 2-page CBC one — the plan the teacher approved is not the plan
      // that came out of the printer.
      if (!served) await downloadLessonPlanDocx(exportable, name(), lessonPlanExportMeta(item))
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
    } else if (item.tool === 'lesson_activities') {
      await downloadLessonActivitiesDocx(item.output, name(), {
        includeAnswers: showAnswers,
        includeModelAnswers: showAnswers,
      })
      recordExport(item.id, 'docx')
    } else if (item.tool === 'homework') {
      await downloadHomeworkDocx(item.output, name(), { includeAnswers: showAnswers })
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
    } else if (item.tool === 'assessment' || item.tool === 'exam_paper') {
      // AI-generated test/exam papers: convert to the studio shape and reuse the
      // same DOCX exporter the Assessment Studio uses, honouring the marking-key
      // toggle. assessmentToDocx (+ the heavy `docx` lib) is loaded on demand.
      const { downloadAssessmentDocx } = await import('../../../utils/assessmentToDocx')
      const converted = aiPaperToStudioDoc(item.output, item.tool)
      const { doc, questions } = converted
      // The same readiness decision the studio makes. Exporting from the library
      // used to bypass every blocking rule — and a generated paper is exactly
      // where a diagram the catalog cannot draw turns up, because the model
      // chose the key rather than a teacher picking one from a list.
      const { gate } = buildAssessmentExportReadiness({
        sections: converted.sections,
        parts: converted.editorParts,
        paperDetails: { title: doc.title, subject: doc.subject, grade: doc.grade },
        serialized: {
          questions,
          passages: doc.passages,
          questionCount: converted.questionCount,
          totalMarks: converted.totalMarks,
        },
        diagramResolver: renderDiagramSvg,
      })
      if (gate.blocked) {
        toast.error(gate.message)
        return
      }
      await downloadAssessmentDocx(doc, questions, name(), { mode: showAnswers ? 'scheme' : 'paper' })
      recordExport(item.id, 'docx')
    } else if (item.tool === 'sba_plan') {
      const h = item.output?.header || {}
      const plan = buildSbaPlan(h.subject, h.grade, item.output?.statuses || {})
      if (plan) {
        await downloadSbaPlannerDocx({ ...plan, statuses: item.output?.statuses || {} }, h, name())
        recordExport(item.id, 'docx')
      } else {
        toast.error('No SBA planner blueprint exists for this subject and grade, so there is nothing to export.')
      }
    }
    } catch (err) {
      // A silent failure here is the "Word download does nothing" bug: the
      // export threw (native file-save unavailable, image build error, …) and
      // without this the user saw nothing at all. Surface it so they know to
      // retry / update the app, and so it lands in error reporting.
      console.error('[LibraryItemDetail] docx export failed', err)
      // A refused export already carries the sentence a teacher can act on:
      // which question, and what to do about it. "Please try again" is worse
      // than useless there — trying again produces the same refusal, and the
      // one instruction that would fix it has been thrown away.
      if (err?.code === 'unresolved-figure') toast.error(err.message)
      else toast.error('Could not create the Word file. Please try again, or update the app if this keeps happening.')
    }
  }

  async function onExportXlsx() {
    if (!item?.output || !permissions.canDownload) return
    if (item.tool !== 'mark_schedule' && item.tool !== 'class_timetable') return
    try {
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
    } catch (err) {
      console.error('[LibraryItemDetail] xlsx export failed', err)
      toast.error('Could not create the Excel file. Please try again.')
    }
  }

  async function onExportPdf() {
    if (!permissions.canDownload) return

    if (item?.tool === 'lesson_plan') {
      const plan = item.output || item.data
      if (!plan) return
      try {
        const filename = buildDownloadName({
          docType: 'Lesson Plan',
          grade: item.inputs?.grade || item.meta?.klass,
          subject: item.inputs?.subject || item.meta?.subject,
          topic: item.inputs?.topic || item.meta?.topic,
          ext: 'pdf',
        })
        await downloadLessonPlanPdf(plan, titleForGeneration(item), filename, lessonPlanExportMeta(item))
        recordExport(item.id, 'pdf')
      } catch (err) {
        console.error('[LibraryItemDetail] lesson plan pdf failed', err)
        toast.error('Could not create the PDF. Please try again.')
      }
      return
    }

    if (!item?.output) return

    if (item.tool === 'class_timetable') {
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
        toast.error('Could not create the PDF. Please try again.')
      }
      return
    }

    if (!PDF_EXPORT_TOOLS.includes(item.tool)) return
    const name = (ext = 'pdf') => buildDownloadName({
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
    // Library downloads are paid-only (permissions gate above), so no
    // free-plan attribution watermark — matches the DOCX branches.
    try {
      if (item.tool === 'flashcards') {
        await downloadFlashcardsPdf(item.output, name('pdf'))
      } else if (item.tool === 'rubric') {
        await downloadRubricPdf(item.output, name('pdf'))
      } else if (item.tool === 'notes') {
        await downloadNotesPdf(item.output, name('pdf'))
      } else if (item.tool === 'homework') {
        await downloadHomeworkPdf(item.output, name('pdf'), { includeAnswers: showAnswers })
      } else if (item.tool === 'full_lesson') {
        await downloadFullLessonPdf(item.output, name('pdf'))
      } else if (item.tool === 'scheme_of_work') {
        await downloadSchemeOfWorkPdf(item.output, name('pdf'))
      } else if (item.tool === 'sba_task') {
        // Teacher copy with the marking scheme — parity with the DOCX branch
        // (the library's SbaTaskView always shows the marking scheme too).
        await downloadSbaTaskPdf(item.output, name('pdf'), {
          includeAnswers: true,
          schoolName: item.output?.header?.schoolName || userProfile?.school || userProfile?.schoolName || '',
        })
      }
      recordExport(item.id, 'pdf')
    } catch (err) {
      console.error('[LibraryItemDetail] pdf export failed', err)
      toast.error('Could not create the PDF. Please try again.')
    }
  }

  async function onExportReportCards() {
    if (item?.tool !== 'mark_schedule' || !item.output) return
    if (!permissions.canDownload) return
    try {
      const name = buildDownloadName({
        docType: 'Report Cards',
        grade: item.inputs?.grade || item.output?.header?.grade,
        term: item.inputs?.term ?? item.output?.header?.term,
        year: item.inputs?.year ?? item.output?.header?.year,
      })
      await downloadReportCardsDocx(item.output, name)
      recordExport(item.id, 'report_cards')
    } catch (err) {
      console.error('[LibraryItemDetail] report cards export failed', err)
      toast.error('Could not create the report cards. Please try again.')
    }
  }

  async function onExportAnswerKey() {
    if (item?.tool !== 'worksheet' || !item.output) return
    if (!permissions.canDownload) return
    try {
      const name = buildDownloadName({
        docType: 'Worksheet',
        grade: item.inputs?.grade || item.output?.header?.grade,
        subject: item.inputs?.subject || item.output?.header?.subject,
        topic: item.inputs?.topic || item.output?.header?.topic,
        variant: 'Answer Key',
      })
      await downloadWorksheetDocx(item.output, name, { mode: 'answer_key' })
      recordExport(item.id, 'docx_answer_key')
    } catch (err) {
      console.error('[LibraryItemDetail] answer key export failed', err)
      toast.error('Could not create the answer key. Please try again.')
    }
  }

  function onRegenerate() {
    if (!item) return
    const meta = TOOL_META[item.tool]
    if (!meta?.route || !isAvailable(item.tool)) return
    // Build a query string from the original inputs so the target generator
    // pre-fills its form via useFormDefaultsFromUrl().
    const qs = buildGeneratorQueryString(item.inputs || {})
    navigate(`${meta.route}${qs}`)
  }

  // Lesson Plan → Worksheet/Homework inheritance. Opens the companion studio
  // pre-filled from THIS plan (plan metadata authoritative; the active
  // assignment only fills fields a legacy plan lacks). If a linked resource of
  // the same kind already exists, ask before creating another (duplicate guard).
  const KIT_ROUTES = { worksheet: '/teacher/generate/worksheet', homework: '/teacher/generate/homework' }
  const [creatingKit, setCreatingKit] = useState(false)
  const [dupPrompt, setDupPrompt] = useState(null) // { tool, url, title, when, status }

  function goToKitStudio(tool) {
    if (!isAvailable(tool)) return
    const seed = inheritFromLessonPlan(item, readActiveAssignmentSeed(currentUser?.uid))
    const qs = buildGeneratorQueryString(seed?.coords || { sourceLessonPlanId: item.id })
    navigate(`${KIT_ROUTES[tool]}${qs}`)
  }

  async function onCreateFromPlan(tool) {
    if (!item || !KIT_ROUTES[tool] || !isAvailable(tool) || creatingKit) return
    setCreatingKit(true)
    try {
      // Detect an existing worksheet/homework already linked to this plan. This
      // only scans the recent library (listMyGenerations caps at 60), so an
      // older linked resource can be missed — a missed convenience warning, not
      // a correctness issue.
      let existing = null
      let lookupFailed = false
      try {
        const rows = await listMyGenerations({ uid: currentUser?.uid, tool })
        existing = (rows || []).find((r) => r?.inputs?.sourceLessonPlanId === item.id) || null
      } catch {
        // A failed lookup must never block creation — tell the teacher we
        // couldn't check, then continue (worst case a duplicate they can delete).
        lookupFailed = true
      }
      if (lookupFailed) {
        toast.info('We could not check for an existing linked resource. Continuing.')
        goToKitStudio(tool)
        return
      }
      if (existing) {
        setDupPrompt({
          tool,
          url: `/teacher/library/${existing.id}`,
          title: titleForGeneration(existing),
          when: formatDate(existing.updatedAt || existing.createdAt),
          status: existing.status || '',
        })
        return
      }
      goToKitStudio(tool)
    } finally {
      setCreatingKit(false)
    }
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

  // Edit-details is currently supported for tools with an editable `output.header`
  // — and only while the tool is still on offer, since a retired document is
  // read-only (render + export).
  const canEditDetails = item
    && ['lesson_plan', 'scheme_of_work', 'worksheet', 'sba_task'].includes(item.tool)
    && isAvailable(item.tool)

  // Full-document (row-level) editing — the teacher is never locked into the
  // AI draft. Reopens the saved scheme/forecast in the same editable table the
  // studio uses. Edit history rides inside output.meta (Firestore rules only
  // let the owner write `output`, so a top-level updatedAt would be rejected).
  const canEditDoc = item && ['scheme_of_work', 'weekly_forecast'].includes(item.tool)

  function startEditDoc() {
    if (!item?.output) return
    setDocDraft(item.output)
    setEditingDoc(true)
  }

  async function onSaveDoc() {
    if (!item || !docDraft) return
    setSavingDoc(true)
    const summary = item.tool === 'weekly_forecast' ? 'edited forecast in library' : 'edited scheme in library'
    const nextOutput = stampEditHistory(docDraft, summary)
    const ok = await updateGenerationOutput(item.id, nextOutput)
    if (ok) {
      setItem((prev) => ({ ...prev, output: nextOutput, teacherEdited: true }))
      setEditingDoc(false)
      setDocDraft(null)
    } else {
      toast.error('Could not save changes. Please try again.')
    }
    setSavingDoc(false)
  }

  const editedAt = item?.output ? lastEditedAt(item.output) : null

  if (status === 'loading') {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center" style={{ background: 'var(--zt-surface)' }}>
        <div className="studio-card p-8 text-center">
          <div className="text-4xl mb-3 animate-bounce">📚</div>
          <p style={{ color: 'var(--zt-text-muted)' }}>Loading…</p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center" style={{ background: 'var(--zt-surface)' }}>
        <div className="studio-card p-8 max-w-md text-center">
          <div className="text-5xl mb-3">⚠️</div>
          <h2 className="studio-display" style={{ fontSize: 20, color: 'var(--zt-text)', marginBottom: 8 }}>Couldn’t load this item</h2>
          <p className="text-sm mb-4" style={{ color: 'var(--zt-text-muted)' }}>
            Something went wrong loading this generation — it hasn’t been deleted. Check your connection and try again.
          </p>
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              className="studio-btn-primary"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              Try again
            </button>
            <Link to="/teacher/library" className="studio-btn-ghost inline-block">
              ← Back to library
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (status === 'notfound' || !item) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center" style={{ background: 'var(--zt-surface)' }}>
        <div className="studio-card p-8 max-w-md text-center">
          <div className="text-5xl mb-3">🤷</div>
          <h2 className="studio-display" style={{ fontSize: 20, color: 'var(--zt-text)', marginBottom: 8 }}>Not found</h2>
          <p className="text-sm mb-4" style={{ color: 'var(--zt-text-muted)' }}>
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
  // Non-null only for a tool that is no longer offered — "Rubric (retired
  // tool)" / "Worksheet (tool returning soon)".
  const retiredNote = retiredLabel(item.tool)

  return (
    <div className="studio-page">
      <SeoHelmet title={item?.title || meta.label || 'Library item'} noIndex />
      <div className="w-full">
        {/* Breadcrumb */}
        <nav className="mb-4 text-sm" style={{ color: 'var(--zt-text-muted)' }}>
          <Link to="/teacher/library" className="hover:underline" style={{ color: 'var(--zt-text)', fontWeight: 700 }}>← My Library</Link>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl" aria-hidden="true">{meta.icon}</span>
              <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: '#d97757', letterSpacing: '1.2px' }}>
                {meta.label}
              </span>
              {item.status === 'flagged' && (
                <span className="text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: '#fff5e6', color: '#a5523a' }}>
                  Review recommended
                </span>
              )}
              {retiredNote && (
                <span
                  className="text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--zt-card)', color: 'var(--zt-text-muted)' }}
                >
                  {retiredNote}
                </span>
              )}
            </div>
            <h1 className="studio-display" style={{ fontSize: 28, margin: 0 }}>
              {titleForGeneration(item)}
            </h1>
            <div className="mt-1 text-xs flex flex-wrap gap-3" style={{ color: 'var(--zt-text-muted)' }}>
              <span>{item.inputs?.grade || item.meta?.klass}</span>
              <span>·</span>
              <span>{formatSubject(item.inputs?.subject || item.meta?.subject)}</span>
              <span>·</span>
              <span>{formatDate(item.createdAt)}</span>
              {editedAt && (
                <>
                  <span>·</span>
                  <span title={`${editHistoryOf(item.output).length} edit(s)`}>
                    ✏️ Last modified {formatIsoDate(editedAt)}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {(item.tool === 'worksheet' || item.tool === 'lesson_activities' ||
              item.tool === 'homework' ||
              item.tool === 'assessment' || item.tool === 'exam_paper') && (
              <label className="flex items-center gap-2 text-sm px-3 py-2 rounded-xl cursor-pointer" style={{ color: 'var(--zt-text)', border: '1.5px solid #d9cfb8' }}>
                <input
                  type="checkbox"
                  checked={showAnswers}
                  onChange={(e) => setShowAnswers(e.target.checked)}
                  style={{ accentColor: '#d97757' }}
                />
                {item.tool === 'assessment' || item.tool === 'exam_paper' ? 'Marking key' : 'Show answers'}
              </label>
            )}
            {item.tool === 'mark_schedule' && (
              <label className="flex items-center gap-2 text-sm px-3 py-2 rounded-xl cursor-pointer" style={{ color: 'var(--zt-text)', border: '1.5px solid #d9cfb8' }}>
                <input
                  type="checkbox"
                  checked={showPercents}
                  onChange={(e) => setShowPercents(e.target.checked)}
                  style={{ accentColor: '#d97757' }}
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
            {item.tool === 'flashcards' && item.output?.cards?.length > 0 && (
              <button
                onClick={() => { setStudyIndex(0); setStudyFlipped(false); setStudyOpen(true) }}
                className="studio-btn-primary"
              >
                ▶ Study
              </button>
            )}
            {item.tool === 'lesson_plan' && (item.output || item.data) && (
              <button
                onClick={onExportPdf}
                disabled={!permissions.canDownload}
                className="studio-btn-ghost disabled:opacity-50 disabled:cursor-not-allowed"
                title={permissions.canDownload
                  ? 'Download a PDF copy'
                  : 'Premium only — upgrade to download library documents'}
              >
                🖨️ Export PDF
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
            {PDF_EXPORT_TOOLS.includes(item.tool) && item.output && (
              <button
                onClick={onExportPdf}
                disabled={!permissions.canDownload}
                className="studio-btn-ghost disabled:opacity-50 disabled:cursor-not-allowed"
                title={permissions.canDownload
                  ? 'Download a PDF copy'
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
            {canEditDoc && !editingDoc && (
              <button onClick={startEditDoc} className="studio-btn-primary">
                ✏️ {item.tool === 'weekly_forecast' ? 'Edit forecast' : 'Edit scheme'}
              </button>
            )}
            {canEditDetails && (
              <button onClick={() => setEditingHeader(true)} className="studio-btn-ghost">
                ✏️ Edit details
              </button>
            )}
            {canDuplicate && (
              <button
                onClick={onDuplicate}
                disabled={duplicating}
                className="studio-btn-ghost disabled:opacity-50"
                title="Save an editable copy of this document to your library"
              >
                {duplicating ? '⧉ Duplicating…' : '⧉ Duplicate'}
              </button>
            )}
            {meta.route && isAvailable(item.tool) && (
              <button onClick={onRegenerate} className="studio-btn-ghost">
                🔁 Generate similar
              </button>
            )}
            {(item.tool === 'worksheet' || item.tool === 'homework') && item.inputs?.sourceLessonPlanId && (
              <button
                onClick={() => navigate(`/teacher/library/${item.inputs.sourceLessonPlanId}`)}
                className="studio-btn-ghost"
                title="Open the lesson plan this was created from"
              >
                📘 Built from lesson plan
              </button>
            )}
            {item.tool === 'lesson_plan' && (item.output || item.data) && (
              <>
                {isAvailable('worksheet') && (
                  <button
                    onClick={() => onCreateFromPlan('worksheet')}
                    disabled={creatingKit}
                    className="studio-btn-ghost disabled:opacity-50"
                    title="Turn this lesson plan into learner practice"
                  >
                    📝 Create Worksheet
                  </button>
                )}
                <button
                  onClick={() => onCreateFromPlan('homework')}
                  disabled={creatingKit}
                  className="studio-btn-ghost disabled:opacity-50"
                  title="Turn this lesson plan into a take-home activity"
                >
                  🏠 Create Homework
                </button>
                <button
                  onClick={() => navigate(`/teacher/generate/notes?lessonPlanId=${item.id}`)}
                  className="studio-btn-primary"
                >
                  📓 Generate Notes
                </button>
              </>
            )}
            <button
              onClick={onDelete}
              className="px-4 py-2 rounded-xl text-sm font-bold transition"
              style={{ color: '#b91c1c', border: '2px solid #fecaca', background: 'var(--zt-card)' }}
            >
              🗑️ Delete
            </button>
          </div>
        </div>

        {/* Active share links — listed so each can be revoked individually. */}
        {activeShares.length > 0 && (
          <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm">
            <p className="font-black text-emerald-900 mb-1">
              {activeShares.length === 1 ? 'Share link active' : `${activeShares.length} share links active`}
            </p>
            <p className="text-emerald-800 text-xs mb-2">
              Anyone with a link can view this (read-only). Revoke a link to stop it working immediately.
            </p>
            <div className="space-y-2">
              {activeShares.map((s) => (
                <div key={s.token} className="flex items-center gap-2 flex-wrap">
                  <input
                    type="text"
                    value={s.url}
                    readOnly
                    onFocus={(e) => e.target.select()}
                    className="flex-1 min-w-[240px] px-3 py-2 rounded-lg border border-emerald-300 bg-white text-emerald-900 text-xs font-mono"
                  />
                  <button onClick={() => copyShareUrl(s.url)} className="px-3 py-2 rounded-lg text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700">
                    Copy
                  </button>
                  {/* WhatsApp is how Zambian teachers actually pass documents
                      around — one tap beats copy-switch-paste. */}
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(`${titleForGeneration(item)} — ${s.url}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black text-white bg-green-600 hover:bg-green-700"
                  >
                    <span aria-hidden="true">💬</span> WhatsApp
                  </a>
                  <button
                    onClick={() => onRevokeShare(s.token)}
                    disabled={revokingToken === s.token}
                    className="px-3 py-2 rounded-lg text-xs font-black text-rose-700 border-2 border-rose-200 bg-white hover:bg-rose-50 disabled:opacity-50"
                  >
                    {revokingToken === s.token ? 'Revoking…' : 'Revoke'}
                  </button>
                </div>
              ))}
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
        <div className="studio-card px-2 py-4 sm:p-5">
          {item.tool === 'lesson_plan' && item.output && <LessonPlanView plan={item.output} />}
          {item.tool === 'lesson_plan' && !item.output && item.html && (
            <LegacyStudioFrame html={item.html} />
          )}
          {item.tool === 'worksheet' && (
            <WorksheetView worksheet={item.output} showAnswers={showAnswers} />
          )}
          {item.tool === 'flashcards' && (
            <FlashcardsView
              flashcards={item.output}
              masteredCards={masteredCards}
              onStudy={() => { setStudyIndex(0); setStudyFlipped(false); setStudyOpen(true) }}
            />
          )}
          {item.tool === 'scheme_of_work' && editingDoc && (
            <DocEditBar saving={savingDoc} onSave={onSaveDoc} onCancel={() => { setEditingDoc(false); setDocDraft(null) }}>
              <SchemeEditableTable scheme={docDraft} onChange={setDocDraft} />
            </DocEditBar>
          )}
          {item.tool === 'scheme_of_work' && !editingDoc && <SchemeOfWorkView scheme={item.output} />}
          {item.tool === 'mark_schedule' && item.output && (
            <MarkScheduleView schedule={item.output} mode={showPercents ? 'percent' : 'marks'} />
          )}
          {item.tool === 'class_timetable' && item.output && (
            <ClassTimetableView timetable={item.output} />
          )}
          {item.tool === 'weekly_forecast' && item.output && editingDoc && (
            <DocEditBar saving={savingDoc} onSave={onSaveDoc} onCancel={() => { setEditingDoc(false); setDocDraft(null) }}>
              <WeeklyForecastEditableTable forecast={docDraft} onChange={setDocDraft} />
            </DocEditBar>
          )}
          {item.tool === 'weekly_forecast' && item.output && !editingDoc && (
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
          {item.tool === 'lesson_activities' && item.output && (
            <LessonActivitiesView activities={item.output} showAnswers={showAnswers} />
          )}
          {item.tool === 'homework' && item.output && (
            <HomeworkView hw={item.output} showAnswers={showAnswers} />
          )}
          {item.tool === 'sba_mark_sheet' && item.output && <SbaTrackerView sheet={item.output} />}
          {item.tool === 'sba_plan' && item.output && <SbaPlanView plan={item.output} />}
          {(item.tool === 'assessment' || item.tool === 'exam_paper') && item.output && (
            <AssessmentPaperView assessment={item.output} tool={item.tool} showAnswers={showAnswers} />
          )}
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

      {/* Duplicate guard for Create Worksheet/Homework from a lesson plan.
          Confirm = open the one that exists; the in-message button makes a
          fresh one; Cancel backs out. */}
      <ConfirmDialog
        open={Boolean(dupPrompt)}
        title={`A ${dupPrompt?.tool === 'homework' ? 'Homework activity' : 'Worksheet'} already exists for this Lesson Plan`}
        message={
          <div>
            <p>You already created one from this plan. Open it, or create another.</p>
            {dupPrompt?.title && (
              <div className="mt-2 rounded-lg border theme-border px-3 py-2 text-body-sm">
                <div className="font-bold truncate">{dupPrompt.title}</div>
                <div className="theme-text-muted">
                  {[dupPrompt.when, dupPrompt.status].filter(Boolean).join(' · ')}
                </div>
              </div>
            )}
            <button
              type="button"
              className="studio-btn-ghost mt-3"
              onClick={() => { const t = dupPrompt?.tool; setDupPrompt(null); if (t) goToKitStudio(t) }}
            >
              ＋ Create another {dupPrompt?.tool === 'homework' ? 'Homework activity' : 'Worksheet'}
            </button>
          </div>
        }
        confirmLabel={`Continue ${dupPrompt?.tool === 'homework' ? 'Homework' : 'Worksheet'}`}
        cancelLabel="Cancel"
        variant="primary"
        onConfirm={() => { const url = dupPrompt?.url; setDupPrompt(null); if (url) navigate(url) }}
        onCancel={() => setDupPrompt(null)}
      />

      {studyOpen && item?.tool === 'flashcards' && item.output?.cards?.length > 0 && (
        <FlashcardStudyOverlay
          cards={item.output.cards}
          index={studyIndex}
          isFlipped={studyFlipped}
          masteredCards={masteredCards}
          onPrev={() => { setStudyIndex((i) => Math.max(i - 1, 0)); setStudyFlipped(false) }}
          onNext={() => { setStudyIndex((i) => Math.min(i + 1, item.output.cards.length - 1)); setStudyFlipped(false) }}
          onFlip={() => setStudyFlipped((f) => !f)}
          onClose={() => setStudyOpen(false)}
          onMarkMastered={(i) => markMastered(i, item.output.cards.length)}
          onMarkReview={(i) => markReview(i, item.output.cards.length)}
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

/**
 * The render/export meta for a saved lesson plan.
 *
 * A studio-generated plan carries the exact meta its preview was rendered with
 * — including the resolved paper format (§2.5) — so reproducing the document is
 * a matter of handing it back rather than re-deriving it. The curriculum comes
 * from the plan's own classification: an OBC plan exported as CBC gets the
 * wrong columns and the wrong field names.
 */
function lessonPlanExportMeta(item) {
  const meta = item?.meta && typeof item.meta === 'object' ? item.meta : {}
  const syllabus = String(item?.classification?.syllabusHint || '').toUpperCase()
  return {
    ...meta,
    curriculumMode: syllabus === 'OBC' ? 'previous' : (meta.curriculumMode || 'cbc'),
  }
}

function formatSubject(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Format an ISO edit timestamp (output.meta.lastEditedAt) for display. */
function formatIsoDate(iso) {
  try {
    return new Date(iso).toLocaleString('en-ZM', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return ''
  }
}

/**
 * Sticky Save / Cancel bar wrapping an in-library document editor. Keeps the
 * exports working (they read item.output, which the save updates in place).
 */
function DocEditBar({ saving, onSave, onCancel, children }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap sticky top-0 z-10 py-2" style={{ background: 'var(--surface, #fff)' }}>
        <p className="text-sm font-bold" style={{ color: 'var(--zt-text)' }}>
          ✏️ Editing — you're in control. Changes save to your library and future exports.
        </p>
        <div className="flex gap-2">
          <button onClick={onCancel} className="studio-btn-ghost">Cancel</button>
          <button onClick={onSave} disabled={saving} className="studio-btn-primary disabled:opacity-50">
            {saving ? 'Saving…' : '💾 Save changes'}
          </button>
        </div>
      </div>
      {children}
    </div>
  )
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
      body { margin: 0; padding: 0; background: transparent; }
      .doc-wrap { box-shadow: none !important; margin: 0 auto; }
      @media(max-width:520px){
        #view-plans .workspace{padding:8px 0 40px}
        #view-plans .doc{padding:8mm 4mm !important}
        #view-plans .doc-head .school{font-size:15pt}
      }
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
      // The height reports come from our own srcDoc iframe, which (with
      // sandbox="allow-same-origin") posts with this page's origin. Ignore
      // messages from any other origin — anyone can postMessage a window.
      if (e.origin !== window.location.origin) return
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
