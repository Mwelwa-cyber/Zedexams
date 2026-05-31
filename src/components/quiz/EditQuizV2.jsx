import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import { storage } from '../../firebase/config'
import {
  createPartGroup,
  createPassageSection,
  createStandaloneSection,
  emptyPassageQuestion,
  getQuestionKey,
  hasOnlyEmptyStarterSection,
  hydrateQuizSections,
  serializeQuizSections,
  shuffleQuizSections,
} from '../../utils/quizSections.js'
import { regroupComprehensionSections, moveQuestionToPassage } from '../../utils/comprehensionGrouping.js'
import { richTextHasContent } from '../../utils/quizRichText.js'
import { clampInt } from '../../utils/inputs.js'
import { getErrorMessage } from '../../utils/errors.js'
import { classifyOnPublish } from '../../utils/quizClassification.js'
import {
  validateStandaloneQuestion as sharedValidateStandaloneQuestion,
  collectQuizIssues,
} from '../../utils/quizValidation.js'
import { assertNoBlobImageUrls } from '../../utils/importedQuizAssets.js'
import {
  assetsById,
  buildStandaloneSection,
  uploadImportedPassageImages,
  uploadImportedQuestionImages,
} from '../../utils/quizDocumentImport.js'
import {
  importQuizDocument,
  revokeImportedQuizAssets,
} from './documentQuizImporter'
import ImportQuizPanel from './ImportQuizPanel'
import QuizSectionsEditor from './QuizSectionsEditor'
import QuizEditorPreviewPanel from './QuizEditorPreviewPanel'
import QuizVerifyModal from './QuizVerifyModal'
import BulkAnswerKey from './BulkAnswerKey'
import { collectAnswerableQuestions, applyAnswerKeyToSections } from './answerKeyUtils'
import ImportReviewBanner from './ImportReviewBanner'
import PastPaperReferenceBanner from './PastPaperReferenceBanner'
import QuizEditorActionBar from './QuizEditorActionBar'
import QuizEditorFloatingNav from './QuizEditorFloatingNav'
import QuizValidationChecklist from './QuizValidationChecklist'
import ReimportDiffModal from './ReimportDiffModal'
import { diffImportedSections, mergeImportedSections } from '../../utils/quizReimportDiff.js'
import QuizWizardSteps from './QuizWizardSteps'
import QuizStatusBadge from './assignment/QuizStatusBadge'
import QuizAssignStep from './assignment/QuizAssignStep'
import QuizPublishStep from './assignment/QuizPublishStep'
import { deriveQuizStatus, listAssignmentsForResource } from '../../utils/quizAssignments'
import { normalizeSubject } from '../../config/curriculum.js'
import SeoHelmet from '../seo/SeoHelmet'

const SUBJECTS = [
  'English',
  'Integrated Science',
  'Mathematics',
  'Social Studies',
  'Expressive Art',
  'Technology Studies',
  'Cinyanja',
  'Home Economics',
  'Special Paper 1',
]
const GRADES = ['4', '5', '6', '7']
// Common quiz lengths offered in the duration dropdown so admins pick rather
// than type a free-form number. Any saved value outside this list is still
// preserved and shown via durationOptions below.
const DURATIONS = [5, 10, 15, 20, 25, 30, 40, 45, 60, 75, 90, 120, 150, 180]
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// text-base (16 px) on phones avoids iOS Safari's auto-zoom-on-focus;
// shrinks back to text-sm (14 px) at the sm breakpoint to match desktop layout.
const FIELD = 'theme-input w-full rounded-xl border-2 px-3 py-2.5 text-base sm:text-sm placeholder:text-gray-400 outline-none transition-colors focus:border-[var(--accent)]'
const SELECT = 'theme-input rounded-xl border-2 px-3 py-2.5 text-base sm:text-sm outline-none transition-colors focus:border-[var(--accent)]'

// Auto-save state machine. Kept as a frozen object so a typo (e.g.
// AUTO_SAVE.SVING) fails fast at dev time instead of becoming a silent
// "unknown state" bug in the status-pill renderer.
const AUTO_SAVE = Object.freeze({
  IDLE: 'idle',
  SAVING: 'saving',
  SAVED: 'saved',
  FAILED: 'failed',
})

function withCurrentOption(options, currentValue) {
  const normalized = String(currentValue ?? '').trim()
  if (!normalized || options.includes(normalized)) return options
  return [...options, normalized]
}

function compressImage(file, maxWidth = 1200, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)

    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      let { width, height } = image
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width)
        width = maxWidth
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(image, 0, 0, width, height)
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('Canvas compression failed'))),
        'image/jpeg',
        quality,
      )
    }

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Could not load image'))
    }

    image.src = objectUrl
  })
}

function buildQuestionNumberMap(questions = []) {
  return Object.fromEntries(questions.map((question, index) => [getQuestionKey(question), index + 1]))
}

function collectQuestionIds(section) {
  if (section.kind === 'passage') {
    return (section.passage.questions || []).map(question => question._id).filter(Boolean)
  }
  return section.question?._id ? [section.question._id] : []
}

function hasUploadingAssets(sections = []) {
  return sections.some(section => {
    if (section.kind === 'passage') {
      if (section.passage?.imageUploading) return true
      // Per-option uploads inside a passage's sub-questions must also block
      // auto-save / manual save — otherwise the save can race the upload
      // and persist an option slot whose imageUrl never arrived.
      return (section.passage?.questions || []).some(question =>
        question?.imageUploading || question?.optionImageUploadingIndex != null
      )
    }
    return section.question?.imageUploading || section.question?.optionImageUploadingIndex != null
  })
}

// True while questions or passages still carry an `imageAssetId` from a
// fresh document import — i.e. their image blobs have not yet been
// uploaded to Storage. Used to gate auto-save so the background timer
// doesn't try to push 30+ extracted images on every keystroke; the
// admin commits the import explicitly via "Save draft" / "Update".
function hasPendingImportedAssets(sections = []) {
  function questionHasAsset(question) {
    if (!question) return false
    if (question.imageAssetId) return true
    if (Array.isArray(question.optionMedia)) {
      return question.optionMedia.some(slot => slot && typeof slot === 'object' && slot.imageAssetId)
    }
    return false
  }
  return sections.some(section => {
    if (section.kind === 'passage') {
      if (section.passage?.imageAssetId) return true
      return (section.passage?.questions || []).some(questionHasAsset)
    }
    return questionHasAsset(section.question)
  })
}

function countImages(sections = []) {
  return sections.reduce((total, section) => {
    if (section.kind === 'passage') return total + (section.passage?.imageUrl ? 1 : 0)
    return total + (section.question?.imageUrl ? 1 : 0)
  }, 0)
}

function StatPill({ label, value, color }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${color}`}>{value} {label}</span>
}

export default function EditQuizV2() {
  const { quizId } = useParams()
  const navigate = useNavigate()
  const { getQuizById, getQuestions, updateQuiz, updateQuizWithQuestions } = useFirestore()
  const { currentUser, isAdmin } = useAuth()

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [form, setForm] = useState({
    title: '',
    subject: 'Mathematics',
    grade: '5',
    duration: 30,
    type: 'quiz',
    topic: '',
    isDemo: false,
  })
  const [quizStatus, setQuizStatus] = useState('draft')
  const [quizOwner, setQuizOwner] = useState(null)
  // Captured from the loaded quiz so a publish from the editor can preserve
  // an existing Daily Exam pin and respect a manual exam-only override.
  const [origClassification, setOrigClassification] = useState({ quizType: undefined, examOnly: undefined })
  const [sections, setSections] = useState([])
  const [parts, setParts] = useState([])
  const [deletedIds, setDeletedIds] = useState([])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [verifyOpen, setVerifyOpen] = useState(false)
  // Imported-image upload progress. Set to { completed, total } while a
  // save flushes the Storage uploads for blob-backed import assets, so
  // the action bar can show "Uploading images… 4 / 32" instead of
  // freezing on "Saving…" for the 30-60s a 30-image past paper takes.
  // null when no batch is in flight.
  const [uploadProgress, setUploadProgress] = useState(null)
  // Re-import diff modal state. Set when handleImportDocument finds
  // that the new file overlaps an existing quiz; cleared by either of
  // the modal's three buttons (Update matched / Replace all / Cancel).
  const [pendingImport, setPendingImport] = useState(null)
  const [pendingDiff, setPendingDiff] = useState(null)
  // Auto-save + checklist UI state.
  //   autoSaveState: one of AUTO_SAVE (idle | saving | saved | failed)
  //   checklistOpen: whether the pre-publish modal is visible
  const [autoSaveState, setAutoSaveState] = useState(AUTO_SAVE.IDLE)
  // Holds the message from the most recent failed auto-save so the action
  // bar (and the console) can surface what actually went wrong instead of
  // a vague "Auto-save failed". Cleared on every successful save.
  const [autoSaveError, setAutoSaveError] = useState('')
  const [checklistOpen, setChecklistOpen] = useState(false)
  // Guard so we only auto-open the checklist ONCE per mount when an
  // imported quiz loads with outstanding issues — repeated re-opens
  // after the user manually closed it would be annoying.
  const checklistAutoOpenedRef = useRef(false)
  // Track when the user last interacted so we don't fire an auto-save
  // mid-keystroke. `dirtySince` is reset to now() on every change.
  const dirtySinceRef = useRef(0)
  // Mirrors `dirty` so the load effect can check it WITHOUT adding it
  // to its deps. Reading via ref lets the effect skip re-loads after
  // a fresh import while still re-firing on quiz id / auth changes.
  const dirtyRef = useRef(false)
  useEffect(() => { dirtyRef.current = dirty }, [dirty])
  // Guards against re-entrant auto-saves: only one in-flight save at a
  // time, and we skip auto-save while a manual save is running.
  const autoSavingRef = useRef(false)
  // Set to false on unmount so an in-flight auto-save can't call
  // setDirty/setDeletedIds after the component is gone, and an
  // already-queued network round-trip doesn't fire-and-forget a write
  // to Firestore for a quiz the teacher already navigated away from.
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])
  // Always-current reference to performAutoSave. The auto-save effect
  // would otherwise close over a stale `performAutoSave` (the one from
  // the render where `dirty` first flipped true), making the timer save
  // outdated `form`/`sections`/`parts`/`deletedIds` and then call
  // `setDirty(false)` — silently dropping subsequent edits. Updating
  // this ref every render keeps the timer reading the latest snapshot
  // without recreating the interval on every keystroke.
  const performAutoSaveRef = useRef(null)
  // Four-step wizard: create → preview → assign → publish. The current
  // step lives in component state so navigating back via the stepper
  // doesn't lose the editor's in-memory state.
  const [wizardStep, setWizardStep] = useState('create')
  const [activeAssignmentCount, setActiveAssignmentCount] = useState(0)
  // Word/PDF import state. documentQuizImporter returns extracted
  // questions plus an in-memory map of image blobs keyed by assetId;
  // we hold the blobs here and upload them when the editor saves.
  const [importingDocument, setImportingDocument] = useState(false)
  // Progress for the scanned-PDF vision import: { phase: 'rendering'|'reading',
  // current, total }. null at all other times.
  const [importProgress, setImportProgress] = useState(null)
  const [importSummary, setImportSummary] = useState(null)
  const [importedAssets, setImportedAssets] = useState({})
  // Past-paper quizzes opened with no questions yet land on this
  // editor straight from the Studio — surface the import panel
  // expanded so the admin can drop in the source doc immediately.
  // Other edits keep it collapsed so it doesn't clutter the page.
  const [importPanelOpen, setImportPanelOpen] = useState(false)

  const serializedPreview = serializeQuizSections(sections, parts)
  const questionNumbers = buildQuestionNumberMap(serializedPreview.questions)
  const questionCount = serializedPreview.questionCount
  const totalMarks = serializedPreview.totalMarks
  const passageCount = serializedPreview.passages.length
  const newCount = serializedPreview.questions.filter(question => !question._id).length
  const imagesCount = countImages(sections)
  const anyUploading = hasUploadingAssets(sections)
  const derivedStatus = deriveQuizStatus(
    { status: quizStatus, isPublished: quizStatus === 'published' },
    { activeAssignments: activeAssignmentCount },
  )
  // Admin-only flow: teacher quiz creation was replaced by the Assessment
  // Studio. Non-admins shouldn't reach this route, but we still gate access
  // below; the back link is the admin content list. Quizzes opened from
  // the Past Paper Studio carry a `linkedPaperId` so we route the back
  // arrow straight back to the Studio's edit page in that case.
  const backPath = form.linkedPaperId
    ? `/admin/papers/${form.linkedPaperId}/edit`
    : '/admin/content'
  const canEdit = isAdmin || quizOwner === currentUser?.uid
  const gradeOptions = withCurrentOption(GRADES, form.grade)
  const subjectOptions = withCurrentOption(SUBJECTS, form.subject)
  // Keep any legacy/custom saved duration selectable even if it isn't one of
  // the preset options, so editing an older quiz never silently rewrites it.
  const durationOptions = DURATIONS.includes(Number(form.duration))
    ? DURATIONS
    : [...DURATIONS, Number(form.duration)].sort((a, b) => a - b)

  function show(message, isErr = false) {
    setToast({ message, isErr })
    setTimeout(() => setToast(null), 4000)
  }

  // Bump the "last edited" timestamp whenever any editable state changes.
  // The auto-save effect debounces against this — we save 25 s after the
  // teacher stops typing (and again every 25 s if they keep editing).
  useEffect(() => {
    dirtySinceRef.current = Date.now()
  }, [form, sections, parts])

  // Collect all validation issues at once. Memoised so the action bar's
  // "X to fix" pill doesn't recompute on every keystroke.
  const validationResult = useMemo(
    () => collectQuizIssues({ form, sections, parts, questionNumbers }),
    [form, sections, parts, questionNumbers],
  )
  const validationIssues = validationResult.issues
  const validationSummary = validationResult.summary
  const errorCount = validationIssues.filter((i) => i.severity !== 'warn').length

  // Per-question issue counts, keyed by question.localId. Feeds the inline
  // red badge in each card header so a teacher can see at a glance which
  // cards still need attention without opening the checklist modal.
  const issueCountsByLocalId = useMemo(() => {
    const map = new Map()
    for (const issue of validationIssues) {
      if (issue.severity === 'warn') continue
      if (!issue.localId) continue
      map.set(issue.localId, (map.get(issue.localId) || 0) + 1)
    }
    return map
  }, [validationIssues])

  function setF(field, value) {
    setForm(current => ({ ...current, [field]: value }))
    setDirty(true)
  }

  useEffect(() => {
    if (!quizId || !currentUser?.uid) return
    // Once the editor has unsaved local work (e.g. just after a fresh
    // import), skip the re-load. AuthContext can flip `isAdmin` from
    // false to true a tick after mount on slow profile fetches, and
    // because isAdmin is in this effect's deps, the load would re-fire
    // and clobber the imported sections with the empty Firestore copy
    // — leaving the editor on "No questions yet" two seconds after the
    // cards rendered. Re-loads are only safe when there's nothing to
    // lose.
    if (dirtyRef.current) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setNotFound(false)
      const [quiz, questions] = await Promise.all([getQuizById(quizId), getQuestions(quizId)])
      if (cancelled) return
      if (!quiz) {
        setNotFound(true)
        setLoading(false)
        return
      }
      if (!isAdmin && quiz.createdBy !== currentUser.uid) {
        setNotFound(true)
        setLoading(false)
        return
      }

      setForm({
        title: quiz.title ?? '',
        // Repair any legacy/imported subject slug ("mathematics") back to its
        // canonical display label ("Mathematics") so the <select> matches an
        // option and the value round-trips through validation + learner filters.
        subject: normalizeSubject(quiz.subject ?? 'Mathematics'),
        grade: quiz.grade ?? '5',
        duration: quiz.duration ?? 30,
        type: quiz.type ?? 'quiz',
        topic: quiz.topic ?? '',
        isDemo: quiz.isDemo ?? false,
        // When ON, the learner runner randomises question order at attempt
        // time (within Parts/passages). Default OFF preserves document order.
        shuffleQuestions: quiz.shuffleQuestions ?? false,
        mode: quiz.mode ?? '',
        importStatus: quiz.importStatus ?? '',
        sourceFileName: quiz.sourceFileName ?? '',
        sourceContentType: quiz.sourceContentType ?? '',
        importWarnings: quiz.importWarnings ?? [],
        // Past-paper conversion provenance — read by PastPaperReferenceBanner
        // so it can render quick-access links to the original paper PDF
        // and the mark scheme. Optional on every other quiz; renders nothing
        // when sourcePastPaperId is falsy.
        sourcePastPaperId: quiz.sourcePastPaperId ?? null,
        sourcePastPaperPdfPath: quiz.sourcePastPaperPdfPath ?? null,
        sourceMarkSchemePath: quiz.sourceMarkSchemePath ?? null,
        // Past Paper Studio link: when set, the quiz is the authoring
        // surface for that paper. We use this on the back link so
        // admin can hop straight back to the Studio.
        linkedPaperId: quiz.linkedPaperId ?? null,
      })
      setQuizStatus(quiz.status ?? (quiz.isPublished ? 'published' : 'draft'))
      setQuizOwner(quiz.createdBy)
      setOrigClassification({ quizType: quiz.quizType, examOnly: quiz.examOnly })
      const hydrated = hydrateQuizSections(questions, quiz.passages || [], quiz.parts || [])
      setSections(hydrated.sections)
      setParts(hydrated.parts)
      setDeletedIds([])
      setDirty(false)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [quizId, getQuizById, getQuestions, currentUser?.uid, isAdmin])

  // Track how many active assignments point at this quiz so the status
  // badge can flip from "Published" → "Active" once at least one class
  // is on the hook. Reloaded lazily after the AssignmentWizard fires.
  const refreshAssignmentCount = useCallback(() => {
    if (!quizId) return
    listAssignmentsForResource(quizId)
      .then((rows) => setActiveAssignmentCount(rows.length))
      .catch((err) => {
        console.warn('[EditQuizV2] active assignment count load failed', err)
      })
  }, [quizId])

  useEffect(() => {
    refreshAssignmentCount()
  }, [refreshAssignmentCount])

  // Release the blob: object URLs created by documentQuizImporter when
  // this editor unmounts — otherwise an imported quiz that wasn't saved
  // would leak the preview blobs until the tab is closed.
  useEffect(() => () => revokeImportedQuizAssets(importedAssets), [importedAssets])

  // Auto-expand the Word/PDF import panel for past-paper-linked quizzes
  // that are still empty. The admin almost always arrived here from the
  // Past Paper Studio expecting to upload the source paper or markscheme.
  useEffect(() => {
    if (loading) return
    if (form.linkedPaperId && hasOnlyEmptyStarterSection(sections)) {
      setImportPanelOpen(true)
    }
  }, [loading, form.linkedPaperId, sections])

  // Auto-open the checklist ONCE on first load when the quiz arrived
  // from an import and still has unresolved issues. Teachers were
  // missing the small "X to fix" pill at the bottom of the screen on
  // freshly-imported papers and shipping unreviewed content. The
  // checklistAutoOpenedRef guard means a manual close stays closed.
  useEffect(() => {
    if (loading) return
    if (checklistAutoOpenedRef.current) return
    const isFreshImport = form.importStatus === 'needs_review' && form.mode === 'imported_document'
    if (!isFreshImport) return
    if (errorCount === 0) return
    checklistAutoOpenedRef.current = true
    setChecklistOpen(true)
  }, [loading, form.importStatus, form.mode, errorCount])

  function updateSection(sectionIndex, updater) {
    setSections(currentSections => currentSections.map((section, index) => (
      index === sectionIndex ? updater(section) : section
    )))
    setDirty(true)
  }

  function updateStandaloneQuestion(sectionIndex, field, value) {
    updateSection(sectionIndex, section => ({
      ...section,
      question: {
        ...section.question,
        [field]: value,
      },
    }))
  }

  // Bulk answer-key entry. Applies a { localId: optionIndex } map across every
  // section in one pass (pure helper), addressing questions by stable localId
  // so nothing reorders and only matched questions change. Routes through the
  // normal dirty -> autosave path; no separate save logic.
  function applyAnswerKeyMap(keyToIndex) {
    if (!keyToIndex || !Object.keys(keyToIndex).length) return
    setSections(current => applyAnswerKeyToSections(current, keyToIndex).sections)
    setDirty(true)
  }
  function handleSetOneAnswer(localId, index) {
    if (!localId) return
    applyAnswerKeyMap({ [localId]: index })
  }
  const answerableQuestions = useMemo(() => collectAnswerableQuestions(sections), [sections])

  function moveSection(sectionIndex, direction) {
    setSections(currentSections => {
      const nextSections = [...currentSections]
      const targetIndex = sectionIndex + direction
      if (targetIndex < 0 || targetIndex >= nextSections.length) return nextSections
      ;[nextSections[sectionIndex], nextSections[targetIndex]] = [nextSections[targetIndex], nextSections[sectionIndex]]
      return nextSections
    })
    setDirty(true)
  }

  function handleShuffleSections() {
    setSections(currentSections => shuffleQuizSections(currentSections))
    setDirty(true)
  }

  function handleAutoGroupComprehension() {
    setSections(currentSections => regroupComprehensionSections(currentSections).sections)
    setDirty(true)
    show('Comprehension questions re-grouped by passage.')
  }

  function handleMoveQuestionToPassage(fromSectionId, questionLocalId, toSectionId) {
    setSections(currentSections =>
      moveQuestionToPassage(currentSections, fromSectionId, questionLocalId, toSectionId))
    setDirty(true)
  }

  // Reset the whole editor back to an empty quiz: clears the title,
  // details, and every question. Saved questions are queued for
  // deletion (mirroring the "replace" import path) so the next save
  // removes them from Firestore. Past-paper provenance + studio
  // linkage are preserved so a cleared quiz keeps its tie to its
  // source (and the back button still routes correctly). Guarded
  // behind a confirm because it can't be undone.
  function handleClearForm() {
    if (typeof window !== 'undefined' && !window.confirm(
      'Clear the whole quiz?\n\n'
        + '• The title, topic, and details reset to defaults.\n'
        + '• Every question is removed.\n'
        + "• Saved questions are deleted on the next save and this can't be undone.\n"
        + '\nNavigate away without saving to discard the clear instead.',
    )) return
    setDeletedIds(current => [...current, ...sections.flatMap(collectQuestionIds)])
    setForm(current => ({
      title: '',
      subject: 'Mathematics',
      grade: '5',
      duration: 30,
      type: 'quiz',
      topic: '',
      isDemo: false,
      // Preserve provenance + linkage so a cleared quiz stays tied to
      // its source past paper / studio after the reset.
      sourcePastPaperId: current.sourcePastPaperId ?? null,
      sourcePastPaperPdfPath: current.sourcePastPaperPdfPath ?? null,
      sourceMarkSchemePath: current.sourceMarkSchemePath ?? null,
      linkedPaperId: current.linkedPaperId ?? null,
    }))
    setSections([createStandaloneSection()])
    setParts([])
    setWizardStep('create')
    setDirty(true)
    show('Quiz cleared. Save to apply, or leave without saving to discard.')
  }

  // ── Parts (PRISCA mock-paper section groups) ─────────────────────
  function addPart() {
    setParts(currentParts => [
      ...currentParts,
      createPartGroup({ order: currentParts.length, title: '' }),
    ])
    setDirty(true)
  }

  function updatePart(partId, field, value) {
    setParts(currentParts => currentParts.map(part => (
      part.id === partId ? { ...part, [field]: value } : part
    )))
    setDirty(true)
  }

  function movePart(partId, direction) {
    setParts(currentParts => {
      const sorted = [...currentParts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      const index = sorted.findIndex(part => part.id === partId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= sorted.length) return currentParts
      ;[sorted[index], sorted[target]] = [sorted[target], sorted[index]]
      return sorted.map((part, i) => ({ ...part, order: i }))
    })
    setDirty(true)
  }

  function removePart(partId) {
    setParts(currentParts => currentParts
      .filter(part => part.id !== partId)
      .map((part, i) => ({ ...part, order: i })))
    // Detach any sections that pointed at the deleted Part.
    setSections(currentSections => currentSections.map(section => {
      if (section.kind === 'passage' && section.partId === partId) {
        return {
          ...section,
          partId: null,
          passage: {
            ...section.passage,
            questions: (section.passage.questions || []).map(q => (
              q.partId === partId ? { ...q, partId: null } : q
            )),
          },
        }
      }
      if (section.kind === 'standalone' && section.question?.partId === partId) {
        return { ...section, question: { ...section.question, partId: null } }
      }
      return section
    }))
    setDirty(true)
  }

  function assignSectionToPart(sectionId, partId) {
    setSections(currentSections => currentSections.map(section => {
      if (section.id !== sectionId) return section
      if (section.kind === 'passage') {
        return {
          ...section,
          partId: partId || null,
          passage: {
            ...section.passage,
            questions: (section.passage.questions || []).map(q => ({ ...q, partId: partId || null })),
          },
        }
      }
      return { ...section, question: { ...section.question, partId: partId || null } }
    }))
    setDirty(true)
  }

  function removeStandaloneSection(sectionIndex) {
    setDeletedIds(current => [...current, ...collectQuestionIds(sections[sectionIndex])])
    setSections(currentSections => currentSections.filter((_, index) => index !== sectionIndex))
    setDirty(true)
  }

  function updatePassage(sectionIndex, field, value) {
    updateSection(sectionIndex, section => ({
      ...section,
      passage: {
        ...section.passage,
        [field]: value,
      },
    }))
  }

  function togglePassage(sectionIndex) {
    updateSection(sectionIndex, section => ({
      ...section,
      passage: {
        ...section.passage,
        collapsed: !section.passage.collapsed,
      },
    }))
  }

  function removePassageSection(sectionIndex) {
    setDeletedIds(current => [...current, ...collectQuestionIds(sections[sectionIndex])])
    setSections(currentSections => currentSections.filter((_, index) => index !== sectionIndex))
    setDirty(true)
  }

  function addPassageQuestion(sectionIndex) {
    updateSection(sectionIndex, section => ({
      ...section,
      passage: {
        ...section.passage,
        questions: [
          ...section.passage.questions,
          emptyPassageQuestion({ passageId: section.passage.id }),
        ],
      },
    }))
  }

  function updatePassageQuestion(sectionIndex, questionIndex, field, value) {
    updateSection(sectionIndex, section => ({
      ...section,
      passage: {
        ...section.passage,
        questions: section.passage.questions.map((question, index) => (
          index === questionIndex ? { ...question, [field]: value } : question
        )),
      },
    }))
  }

  function removePassageQuestion(sectionIndex, questionIndex) {
    const question = sections[sectionIndex]?.passage?.questions?.[questionIndex]
    if (question?._id) {
      setDeletedIds(current => [...current, question._id])
    }
    updateSection(sectionIndex, section => ({
      ...section,
      passage: {
        ...section.passage,
        questions: section.passage.questions.filter((_, index) => index !== questionIndex),
      },
    }))
  }

  function movePassageQuestion(sectionIndex, questionIndex, direction) {
    updateSection(sectionIndex, section => {
      const nextQuestions = [...section.passage.questions]
      const targetIndex = questionIndex + direction
      if (targetIndex < 0 || targetIndex >= nextQuestions.length) return section
      ;[nextQuestions[questionIndex], nextQuestions[targetIndex]] = [nextQuestions[targetIndex], nextQuestions[questionIndex]]
      return {
        ...section,
        passage: {
          ...section.passage,
          questions: nextQuestions,
        },
      }
    })
  }

  function addStandaloneSectionHandler() {
    setSections(currentSections => [...currentSections, createStandaloneSection()])
    setDirty(true)
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50)
  }

  function addPassageSectionHandler() {
    setSections(currentSections => [...currentSections, createPassageSection()])
    setDirty(true)
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50)
  }

  function addMapSectionHandler() {
    setSections(currentSections => [...currentSections, createPassageSection({ passageKind: 'map' })])
    setDirty(true)
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50)
  }

  async function uploadStandaloneQuestionImage(sectionIndex, file) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      show('Only JPG, PNG, and WEBP images are allowed.', true)
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      show('Image must be under 15 MB.', true)
      return
    }

    updateSection(sectionIndex, section => ({
      ...section,
      question: {
        ...section.question,
        imageUploading: true,
        imageUploadStep: 'compressing',
        imageUrl: '',
        imageAssetId: '',
      },
    }))

    try {
      const compressed = await compressImage(file)
      updateStandaloneQuestion(sectionIndex, 'imageUploadStep', 'uploading')
      const path = `quiz-images/${currentUser.uid}/${Date.now()}-standalone-${sectionIndex}.jpg`
      const snapshot = await uploadBytes(storageRef(storage, path), compressed, { contentType: 'image/jpeg' })
      const imageUrl = await getDownloadURL(snapshot.ref)
      updateSection(sectionIndex, section => ({
        ...section,
        question: {
          ...section.question,
          imageUrl,
          imageAssetId: '',
          imageUploading: false,
          imageUploadStep: '',
        },
      }))
      show(`Image uploaded (${Math.round(compressed.size / 1024)} KB)`)
    } catch (error) {
      updateSection(sectionIndex, section => ({
        ...section,
        question: {
          ...section.question,
          imageUploading: false,
          imageUploadStep: '',
        },
      }))
      show(`Upload failed: ${error.message}`, true)
    }
  }

  function removeStandaloneQuestionImage(sectionIndex) {
    updateSection(sectionIndex, section => ({
      ...section,
      question: {
        ...section.question,
        imageUrl: '',
        imageAssetId: '',
      },
    }))
  }

  async function uploadPassageImage(sectionIndex, file) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      show('Only JPG, PNG, and WEBP images are allowed.', true)
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      show('Image must be under 15 MB.', true)
      return
    }

    updateSection(sectionIndex, section => ({
      ...section,
      passage: {
        ...section.passage,
        imageUploading: true,
        imageUploadStep: 'compressing',
        imageUrl: '',
      },
    }))

    try {
      const compressed = await compressImage(file)
      updateSection(sectionIndex, section => ({
        ...section,
        passage: {
          ...section.passage,
          imageUploadStep: 'uploading',
        },
      }))
      const path = `quiz-images/${currentUser.uid}/${Date.now()}-passage-${sectionIndex}.jpg`
      const snapshot = await uploadBytes(storageRef(storage, path), compressed, { contentType: 'image/jpeg' })
      const imageUrl = await getDownloadURL(snapshot.ref)
      updateSection(sectionIndex, section => ({
        ...section,
        passage: {
          ...section.passage,
          imageUrl,
          imageUploading: false,
          imageUploadStep: '',
        },
      }))
      show(`Passage image uploaded (${Math.round(compressed.size / 1024)} KB)`)
    } catch (error) {
      updateSection(sectionIndex, section => ({
        ...section,
        passage: {
          ...section.passage,
          imageUploading: false,
          imageUploadStep: '',
        },
      }))
      show(`Upload failed: ${error.message}`, true)
    }
  }

  function removePassageImage(sectionIndex) {
    updateSection(sectionIndex, section => ({
      ...section,
      passage: {
        ...section.passage,
        imageUrl: '',
      },
    }))
  }

  function buildOptionMediaSlots(question) {
    const existing = Array.isArray(question.optionMedia) ? question.optionMedia : []
    const optionCount = Array.isArray(question.options) ? question.options.length : 0
    return Array.from({ length: optionCount }, (_, i) => existing[i] ?? null)
  }

  async function uploadStandaloneOptionImage(sectionIndex, optionIndex, file) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      show('Only JPG, PNG, and WEBP images are allowed.', true)
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      show('Image must be under 15 MB.', true)
      return
    }

    updateSection(sectionIndex, section => ({
      ...section,
      question: {
        ...section.question,
        optionImageUploadingIndex: optionIndex,
        optionImageUploadStep: 'compressing',
      },
    }))

    try {
      const compressed = await compressImage(file)
      updateStandaloneQuestion(sectionIndex, 'optionImageUploadStep', 'uploading')
      const path = `quiz-images/${currentUser.uid}/${Date.now()}-standalone-${sectionIndex}-opt-${optionIndex}.jpg`
      const snapshot = await uploadBytes(storageRef(storage, path), compressed, { contentType: 'image/jpeg' })
      const imageUrl = await getDownloadURL(snapshot.ref)

      updateSection(sectionIndex, section => {
        const next = buildOptionMediaSlots(section.question)
        const prevAlt = next[optionIndex]?.alt ?? ''
        next[optionIndex] = { imageUrl, alt: prevAlt }
        return {
          ...section,
          question: {
            ...section.question,
            optionMedia: next,
            optionImageUploadingIndex: null,
            optionImageUploadStep: '',
          },
        }
      })
      show(`Option image uploaded (${Math.round(compressed.size / 1024)} KB)`)
    } catch (error) {
      updateSection(sectionIndex, section => ({
        ...section,
        question: {
          ...section.question,
          optionImageUploadingIndex: null,
          optionImageUploadStep: '',
        },
      }))
      show(`Upload failed: ${error.message}`, true)
    }
  }

  function removeStandaloneOptionImage(sectionIndex, optionIndex) {
    updateSection(sectionIndex, section => {
      const next = buildOptionMediaSlots(section.question)
      next[optionIndex] = null
      return {
        ...section,
        question: {
          ...section.question,
          optionMedia: next,
        },
      }
    })
  }

  async function uploadPassageQuestionOptionImage(sectionIndex, questionIndex, optionIndex, file) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      show('Only JPG, PNG, and WEBP images are allowed.', true)
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      show('Image must be under 15 MB.', true)
      return
    }

    const patchQuestion = (patch) =>
      updateSection(sectionIndex, section => ({
        ...section,
        passage: {
          ...section.passage,
          questions: section.passage.questions.map((question, index) =>
            index === questionIndex ? { ...question, ...patch(question) } : question
          ),
        },
      }))

    patchQuestion(() => ({
      optionImageUploadingIndex: optionIndex,
      optionImageUploadStep: 'compressing',
    }))

    try {
      const compressed = await compressImage(file)
      patchQuestion(() => ({ optionImageUploadStep: 'uploading' }))
      const path = `quiz-images/${currentUser.uid}/${Date.now()}-passage-${sectionIndex}-q-${questionIndex}-opt-${optionIndex}.jpg`
      const snapshot = await uploadBytes(storageRef(storage, path), compressed, { contentType: 'image/jpeg' })
      const imageUrl = await getDownloadURL(snapshot.ref)

      patchQuestion(question => {
        const next = buildOptionMediaSlots(question)
        while (next.length < 4) next.push(null)
        const prevAlt = next[optionIndex]?.alt ?? ''
        next[optionIndex] = { imageUrl, alt: prevAlt }
        return {
          optionMedia: next,
          optionImageUploadingIndex: null,
          optionImageUploadStep: '',
        }
      })
      show(`Option image uploaded (${Math.round(compressed.size / 1024)} KB)`)
    } catch (error) {
      patchQuestion(() => ({
        optionImageUploadingIndex: null,
        optionImageUploadStep: '',
      }))
      show(`Upload failed: ${error.message}`, true)
    }
  }

  function removePassageQuestionOptionImage(sectionIndex, questionIndex, optionIndex) {
    updateSection(sectionIndex, section => ({
      ...section,
      passage: {
        ...section.passage,
        questions: section.passage.questions.map((question, index) => {
          if (index !== questionIndex) return question
          const next = buildOptionMediaSlots(question)
          if (next.length > optionIndex) next[optionIndex] = null
          return { ...question, optionMedia: next }
        }),
      },
    }))
  }

  function validateStandaloneQuestion(question, label) {
    return sharedValidateStandaloneQuestion(question, label, {
      onError: message => show(message, true),
    })
  }

  function validate() {
    if (!form.title.trim()) {
      show('Quiz title is required.', true)
      return false
    }
    if (questionCount === 0) {
      show('Add at least one question before saving.', true)
      return false
    }

    for (const part of parts) {
      if (!String(part.title ?? '').trim()) {
        show('Every Part needs a title (e.g. "QUESTIONS 1-15").', true)
        return false
      }
      const hasMembers = sections.some(section => {
        if (section.kind === 'passage') return section.partId === part.id
        return section.question?.partId === part.id
      })
      if (!hasMembers) {
        show(`Part "${part.title}" has no questions assigned. Move at least one section into it or delete the Part.`, true)
        return false
      }
    }

    for (const section of sections) {
      if (section.kind === 'passage') {
        const passage = section.passage
        const isMap = passage.passageKind === 'map'
        if (passage.imageUploading) {
          show(isMap
            ? 'A map image is still uploading. Please wait.'
            : 'A passage image is still uploading. Please wait.', true)
          return false
        }
        if (isMap) {
          if (!passage.imageUrl) {
            show('Each map section needs a map image before saving.', true)
            return false
          }
        } else if (!richTextHasContent(passage.passageText)) {
          show('Each comprehension passage needs passage text before saving.', true)
          return false
        }
        if (!passage.questions.length) {
          show(isMap
            ? 'Each map section needs at least one linked question.'
            : 'Each comprehension passage needs at least one linked question.', true)
          return false
        }
        for (const question of passage.questions) {
          const label = `Passage question ${questionNumbers[question.localId]}`
          if (!validateStandaloneQuestion(question, label)) return false
        }
        continue
      }

      const question = section.question
      const label = `Question ${questionNumbers[question.localId]}`
      if (!validateStandaloneQuestion(question, label)) return false
    }

    return true
  }

  // Parse a Word/PDF document into editable quiz sections. Mirrors the
  // create-flow handler but is safer about overwriting existing work
  // (always confirms) and preserves past-paper context — when the quiz
  // is already linked to a paper we keep the admin's chosen subject /
  // grade / topic rather than letting the importer's guesses overwrite
  // them.
  // When a re-import is in flight, we stash the freshly-imported payload
  // here so the diff modal can choose between merge / replace / cancel.
  // null when no decision is pending.
  // pendingImport: { imported, file } | null
  // pendingDiff: result of diffImportedSections(sections, imported.sections)
  // — pre-computed once so the modal renders synchronously without
  //   re-running the diff on every keystroke.

  // Apply an imported payload to editor state using one of two
  // strategies: 'replace' (the legacy behaviour, wipes sections + parts
  // and adopts the import verbatim) or 'merge' (preserves manual edits
  // on questions the new file didn't change; see quizReimportDiff.js).
  function applyImportedPayload(imported, file, strategy) {
    // Release the previous import's blob URLs before adopting new ones.
    revokeImportedQuizAssets(importedAssets)
    setImportedAssets(assetsById(imported.imageAssets))

    const linkedToPaper = Boolean(form.linkedPaperId)
    setForm(current => ({
      ...current,
      // Past-paper quizzes already carry an admin-chosen title /
      // subject / grade — don't let the importer's guesses overwrite
      // them. For fresh quizzes, fall back to the importer's metadata
      // only when the field is empty.
      title: linkedToPaper || current.title?.trim()
        ? current.title
        : imported.quiz.title,
      // Topic is intentionally left untouched on import — imported papers
      // span many CBC topics; the teacher should keep their own value or
      // leave the field blank rather than have the title stamped in.
      grade: linkedToPaper ? current.grade : (imported.quiz.grade || current.grade),
      subject: normalizeSubject(linkedToPaper ? current.subject : (imported.quiz.subject || current.subject)),
      mode: 'imported_document',
      importStatus: imported.importStatus,
      sourceFileName: imported.quiz.sourceFileName,
      sourceContentType: imported.quiz.sourceContentType,
      importWarnings: imported.warnings,
    }))

    const incomingSections = imported.sections?.length
      ? imported.sections
      : imported.questions.map(question => buildStandaloneSection(question))

    if (strategy === 'replace') {
      // Replaced sections / parts: the previous question records are
      // gone, so their Firestore ids need to land in deletedIds so the
      // next save cleans them up.
      const removedIds = sections.flatMap(collectQuestionIds)
      setDeletedIds(current => [...current, ...removedIds])
      setSections(incomingSections)
      setParts(Array.isArray(imported.parts) ? imported.parts : [])
    } else {
      // Merge strategy: matched questions are updated in place (Firestore
      // id retained, manual topic preserved); incoming-only questions
      // append; existing-only questions stay. No Firestore ids are
      // queued for deletion — the merge by construction doesn't drop
      // any existing records.
      setSections(mergeImportedSections(sections, incomingSections))
      // Parts: take the union (existing first, then incoming-only).
      const existingPartIds = new Set((parts || []).map(p => p.id))
      const incomingParts = Array.isArray(imported.parts) ? imported.parts : []
      const mergedParts = [...parts, ...incomingParts.filter(p => !existingPartIds.has(p.id))]
      setParts(mergedParts)
    }

    setImportSummary({
      ...imported.summary,
      fileName: file.name,
      importStatus: imported.importStatus,
      smartApplied: imported.smartApplied,
      warnings: imported.warnings,
    })

    const importedCount = incomingSections.length
    if (importedCount === 0) {
      show('No questions could be extracted from this document. Check the file or try a different format.', true)
      return
    }
    setDirty(true)
    const verb = strategy === 'merge' ? 'merged' : 'imported'
    show(imported.importStatus === 'needs_review'
      ? imported.smartApplied
        ? `Document ${verb} with smart cleanup. Review flagged questions before publishing.`
        : `Document ${verb}. Review passages and marked questions before publishing.`
      : imported.smartApplied
        ? `Document ${verb} with smart cleanup into editable quiz sections.`
        : `Document ${verb} into editable quiz sections.`)
  }

  async function handleImportDocument(file, importOptions = {}) {
    if (!file) return
    if (importingDocument) return

    setImportingDocument(true)
    setImportProgress(null)
    try {
      const imported = await importQuizDocument(file, {
        ...importOptions,
        onProgress: setImportProgress,
      })

      const hasExistingWork = !hasOnlyEmptyStarterSection(sections)
      const incomingSections = imported.sections?.length
        ? imported.sections
        : imported.questions.map(question => buildStandaloneSection(question))
      const diff = diffImportedSections(sections, incomingSections)
      const hasMatchableQuestions = (diff.added.length + diff.changed.length + diff.unchanged.length + diff.removed.length) > 0

      // First import (or an existing quiz with nothing matchable) goes
      // straight to the legacy replace path — no decision is needed
      // because there's nothing to preserve.
      if (!hasExistingWork || !hasMatchableQuestions) {
        applyImportedPayload(imported, file, 'replace')
        return
      }

      // Otherwise hand off to the diff modal. The modal owns the next
      // step; the apply call happens in onMerge / onReplace below.
      setPendingImport({ imported, file })
      setPendingDiff(diff)
    } catch (error) {
      console.error('[EditQuizV2] document import failed', error)
      show(`Import failed: ${getErrorMessage(error, 'Could not read this document.')}`, true)
    } finally {
      setImportingDocument(false)
      setImportProgress(null)
    }
  }

  // Upload any blob-backed imported images to Storage, then return the
  // serialized sections with imageAssetIds rewritten to real imageUrls.
  // No-op (cheap) when the quiz wasn't built from an imported document.
  async function serializeWithImportedAssetUploads() {
    const serialized = serializeQuizSections(sections, parts)

    // Count distinct imageAssetIds across both question stems / option
    // media AND passages so the progress chip reflects the FULL batch,
    // not just whichever half is currently uploading. Without this the
    // chip would jump from "x / 20" → "1 / 5" mid-save when the
    // function moves from questions to passages.
    const allAssetIds = new Set()
    serialized.questions.forEach((q) => {
      if (q.imageAssetId) allAssetIds.add(q.imageAssetId)
      if (Array.isArray(q.optionMedia)) {
        q.optionMedia.forEach((slot) => {
          if (slot?.imageAssetId) allAssetIds.add(slot.imageAssetId)
        })
      }
    })
    serialized.passages.forEach((p) => {
      if (p.imageAssetId) allAssetIds.add(p.imageAssetId)
    })
    const totalImages = allAssetIds.size

    if (totalImages > 0) {
      setUploadProgress({ completed: 0, total: totalImages })
    }
    let completedTotal = 0
    const onProgress = totalImages > 0
      ? () => {
          completedTotal += 1
          setUploadProgress({ completed: completedTotal, total: totalImages })
        }
      : undefined

    const uploadCtx = {
      storage,
      uid: currentUser?.uid,
      assets: importedAssets,
      sourceFileName: form.sourceFileName || '',
      onProgress,
    }
    try {
      const questions = await uploadImportedQuestionImages(serialized.questions, uploadCtx)
      const passages = await uploadImportedPassageImages(serialized.passages, uploadCtx)
      // Defensive: any leftover blob: URL would persist to Firestore and
      // break for every learner on reload. Catch it here instead.
      assertNoBlobImageUrls(questions, passages)
      return { ...serialized, questions, passages }
    } finally {
      // Always clear so a save-failure doesn't leave the progress chip
      // stuck on the action bar. The catch in the calling save handler
      // surfaces the actual error.
      setUploadProgress(null)
    }
  }

  // After updateQuizWithQuestions creates new Firestore docs for questions that
  // had no _id yet (e.g. freshly imported), patch those IDs back into the
  // sections state. Without this every subsequent auto-save re-creates the
  // same questions instead of updating them, producing the "60 → 2000" count
  // explosion.
  function applyAssignedIds(idMap) {
    if (!idMap || idMap.length === 0) return
    const byLocalId = new Map(idMap.map(({ localId, id }) => [localId, id]))
    setSections(current =>
      current.map(section => {
        if (section.kind === 'standalone') {
          const q = section.question
          if (q?.localId && !q._id && byLocalId.has(q.localId)) {
            return { ...section, question: { ...q, _id: byLocalId.get(q.localId) } }
          }
          return section
        }
        if (section.kind === 'passage') {
          const qs = section.passage?.questions || []
          let changed = false
          const patched = qs.map(q => {
            if (q?.localId && !q._id && byLocalId.has(q.localId)) {
              changed = true
              return { ...q, _id: byLocalId.get(q.localId) }
            }
            return q
          })
          if (!changed) return section
          return { ...section, passage: { ...section.passage, questions: patched } }
        }
        return section
      })
    )
  }

  // Background auto-save: same write as a manual "Save draft" but without
  // validation, without navigation, and without flipping the published
  // status. Skipped while a manual save / upload is in flight, or when
  // the form is too incomplete (no title, no questions) — auto-saving
  // empty drafts would just thrash Firestore.
  async function performAutoSave() {
    if (autoSavingRef.current || saving) return
    if (anyUploading) return
    // After a fresh document import the editor holds image blobs that
    // must be uploaded before the quiz is persisted. Pushing 30+
    // extracted images on the background timer would block typing for
    // ~30 s — wait for an explicit "Save draft" / "Update" instead.
    if (hasPendingImportedAssets(sections)) return
    if (!dirty) return
    // Published quizzes are LIVE — silently pushing every keystroke into
    // production would let a teacher's mid-edit "fix" reach learners
    // before they've checked it. Editing a published quiz requires a
    // manual "Update" click; auto-save stays in the drafts/pending lane.
    if (quizStatus === 'published') return
    // Refuse if there's literally nothing to save (avoids clobbering a
    // freshly created quiz with an empty payload on first mount).
    if (!String(form.title || '').trim() && sections.length === 0) return

    autoSavingRef.current = true
    setAutoSaveState(AUTO_SAVE.SAVING)
    try {
      const serializedSections = await serializeWithImportedAssetUploads()
      // Defense in depth: the quiz schema requires title.min(1). An imported
      // doc whose detected title cleaned down to whitespace would otherwise
      // throw "Invalid quiz update at title" and silently fail every autosave.
      // Coerce an empty/whitespace title to a safe default derived from the
      // source filename so autosave can never fail on title. (We intentionally
      // do NOT relax the schema's min(1).)
      const safeTitle = String(form.title || '').trim()
        || String(form.sourceFileName || '').replace(/\.(docx?|pdf)$/i, '').trim()
        || 'Untitled quiz'
      const idMap = await updateQuizWithQuestions(
        quizId,
        {
          ...form,
          title: safeTitle,
          passages: serializedSections.passages,
          parts: serializedSections.parts,
          passageCount: serializedSections.passages.length,
          reviewCount: computeReviewCount(serializedSections.questions),
          // Auto-save never flips publish status — and we already bail
          // above for `published`, so this branch only runs for drafts /
          // pending. The status passthrough preserves whichever of those
          // two the quiz is currently in.
          status: quizStatus,
          isPublished: false,
          updatedBy: currentUser.uid,
        },
        serializedSections.questions,
        deletedIds,
      )
      if (!mountedRef.current) return
      applyAssignedIds(idMap)
      setDeletedIds([])
      setDirty(false)
      setAutoSaveState(AUTO_SAVE.SAVED)
      setAutoSaveError('')
    } catch (error) {
      // Print BOTH the message and the full error so Firestore / Storage /
      // schema-validation errors are inspectable in the browser console.
      // The vague "Auto-save failed" pill in the action bar was leaving
      // teachers (and us, on bug reports) with nothing to act on.
      const message = getErrorMessage(error, 'unknown auto-save error')
      console.error('[EditQuizV2] auto-save failed:', message, error)
      if (mountedRef.current) {
        setAutoSaveError(message)
        setAutoSaveState(AUTO_SAVE.FAILED)
      }
    } finally {
      // Concurrent invocations are gated by the autoSavingRef check at the
      // top of the function, so resetting it here is safe.
      // eslint-disable-next-line require-atomic-updates
      autoSavingRef.current = false
    }
  }

  // Keep the ref pointing at the freshest performAutoSave on every
  // committed render. The auto-save interval below dereferences this
  // ref each tick so it always sees the latest form/sections/parts/
  // deletedIds rather than a closure captured when `dirty` first
  // flipped true.
  //
  // NOTE: this useEffect intentionally has NO dependency array (not an
  // empty one — none at all). React fires this on every commit, so the
  // ref tracks the latest `performAutoSave` after every render. An
  // empty deps array would freeze the ref at the first render's
  // closure; that bug is exactly what this pattern exists to avoid.
  useEffect(() => {
    performAutoSaveRef.current = performAutoSave
  })

  // Debounced auto-save. Fires when the form has been dirty + idle for
  // 5 s. We also tick a 25 s heartbeat so continuous typing still
  // triggers a save every 25 s — teachers shouldn't lose more than
  // half a minute of work even if they never stop typing.
  useEffect(() => {
    if (!dirty || !quizId || !canEdit) return
    const idleTimer = setInterval(() => {
      const idleMs = Date.now() - dirtySinceRef.current
      if (idleMs >= 5000) {
        performAutoSaveRef.current?.()
      }
    }, 5000)
    const heartbeat = setInterval(() => {
      performAutoSaveRef.current?.()
    }, 25000)
    return () => {
      clearInterval(idleTimer)
      clearInterval(heartbeat)
    }
  }, [dirty, quizId, canEdit])

  // Phase 10: shared count helper called from every save path. Imported
  // docs persist a fresh count of how many questions still carry
  // requiresReview so the badge/banner stay honest as teachers fix the
  // flagged questions over multiple save cycles. Non-imports always
  // persist 0 — the field is universal so the summarizer doesn't have to
  // care which path created the doc.
  function computeReviewCount(questionsForSave) {
    if (form.mode !== 'imported_document') return 0
    return questionsForSave.filter(q => q?.requiresReview).length
  }

  // Phase 9: ImportReviewBanner calls this when the teacher clicks
  // "Mark as reviewed". Patches the quiz doc to clear the importStatus
  // flag, the importWarnings array, and the persisted review count
  // (Phase 10) so all three signals agree the doc is clean. Then mirrors
  // the change in local form state so the banner unmounts immediately
  // (no waiting for a reload). Pre-existing question records and
  // per-question requiresReview flags are left alone — those still surface
  // on the individual question cards via reviewNotes / importWarnings.
  async function handleMarkImportReviewed() {
    if (!quizId) return
    try {
      await updateQuiz(quizId, { importStatus: 'success', importWarnings: [], reviewCount: 0 })
      setForm(curr => ({ ...curr, importStatus: 'success', importWarnings: [], reviewCount: 0 }))
      show('Cleared the review flag.')
    } catch (err) {
      show(`Could not update: ${getErrorMessage(err, 'unexpected error')}`, true)
    }
  }

  async function handleSave(mode = 'draft') {
    // Publishing triggers the full pre-publish checklist; lower-trust
    // modes (draft / pending) keep the legacy toast-on-first-error flow.
    if (mode === 'published') {
      if (errorCount > 0) {
        setChecklistOpen(true)
        return
      }
    } else if (!validate()) {
      return
    }
    if (anyUploading) {
      show('Wait for image uploads to finish before saving.', true)
      return
    }
    if (saving) return
    setSaving(true)

    try {
      const serializedSections = await serializeWithImportedAssetUploads()
      const isPublished = mode === 'published'
      // Publishing must classify the quiz the same way the admin
      // ManageContent flow does, otherwise it lands as isPublished:true with
      // no quizType — an orphan that getQuizzes filters out, so no learner
      // ever sees it. Saving as draft/pending clears the assignment so the
      // quiz can't sit in the (quizType:'practice', isPublished:false) orphan
      // state that trips firestore rules-as-filters in getQuizzes.
      const assignmentPatch = isPublished
        ? classifyOnPublish({
            currentQuizType: origClassification.quizType,
            examOnly: origClassification.examOnly,
            questionCount: serializedSections.questions.length,
          })
        : { quizType: null, isDailyExam: false, dailyExamDate: null }
      const saveIdMap = await updateQuizWithQuestions(
        quizId,
        {
          ...form,
          passages: serializedSections.passages,
          parts: serializedSections.parts,
          passageCount: serializedSections.passages.length,
          reviewCount: computeReviewCount(serializedSections.questions),
          status: mode,
          isPublished,
          updatedBy: currentUser.uid,
          ...assignmentPatch,
          ...(mode === 'pending' && { submittedAt: new Date() }),
          ...(mode === 'published' && { approvedBy: currentUser.uid }),
        },
        serializedSections.questions,
        deletedIds,
      )
      applyAssignedIds(saveIdMap)

      setQuizStatus(mode)
      setDeletedIds([])
      // Imported image blobs are now persisted in Storage; release the
      // in-memory blob: URLs so unmount cleanup has nothing to do.
      setImportedAssets({})
      setDirty(false)
      setAutoSaveState(AUTO_SAVE.SAVED)
      setAutoSaveError('')
      show(mode === 'published' ? 'Quiz published!' : mode === 'pending' ? 'Submitted for approval!' : 'Changes saved as draft.')
      setTimeout(() => navigate(backPath), 1400)
    } catch (error) {
      console.error('EditQuiz save error:', error)
      show(`Save failed: ${getErrorMessage(error, 'unexpected error')}`, true)
    } finally {
      // ALWAYS reset the saving flag — earlier branch only reset on error,
      // which meant a successful save left the button disabled until the
      // navigation timeout fired. Pre-navigate state should already be
      // clean.
      setSaving(false)
    }
  }

  async function handleTogglePublish() {
    if (!isAdmin) return
    setSaving(true)
    try {
      const nextStatus = quizStatus === 'published' ? 'draft' : 'published'
      const serializedSections = await serializeWithImportedAssetUploads()
      // Publishing classifies the quiz (practice vs exam-only, preserving a
      // Daily Exam pin) so it actually shows up for learners. Unpublishing
      // clears the assignment fields, otherwise the quiz keeps
      // quizType:'practice' with isPublished:false — the orphan state that
      // trips firestore rules-as-filters and blanks the learner library.
      const assignmentPatch = nextStatus === 'published'
        ? classifyOnPublish({
            currentQuizType: origClassification.quizType,
            examOnly: origClassification.examOnly,
            questionCount: serializedSections.questions.length,
          })
        : { quizType: null, isDailyExam: false, dailyExamDate: null }
      const toggleIdMap = await updateQuizWithQuestions(
        quizId,
        {
          ...form,
          passages: serializedSections.passages,
          parts: serializedSections.parts,
          passageCount: serializedSections.passages.length,
          reviewCount: computeReviewCount(serializedSections.questions),
          status: nextStatus,
          isPublished: nextStatus === 'published',
          updatedBy: currentUser.uid,
          ...assignmentPatch,
        },
        serializedSections.questions,
        deletedIds,
      )
      applyAssignedIds(toggleIdMap)
      setQuizStatus(nextStatus)
      setDeletedIds([])
      setDirty(false)
      show(nextStatus === 'published' ? 'Quiz published!' : 'Quiz unpublished.')
    } catch (error) {
      show(getErrorMessage(error, 'Failed to update publish status.'), true)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(item => (
          <div key={item} className="theme-card theme-border theme-bg-subtle h-24 animate-pulse rounded-2xl border p-5" />
        ))}
      </div>
    )
  }

  if (notFound || !canEdit) {
    return (
      <div className="theme-text py-20 text-center">
        <div className="mb-3 text-5xl" aria-hidden="true">🔒</div>
        <h2 className="text-display-xl theme-text mb-2">{notFound ? 'Quiz not found' : 'Access denied'}</h2>
        <p className="theme-text-muted text-body mb-5">
          {notFound ? 'This quiz does not exist or has been deleted.' : 'You can only edit quizzes you created.'}
        </p>
        <button type="button" onClick={() => navigate(backPath)} className="theme-accent-fill theme-on-accent rounded-xl px-6 py-2.5 text-sm font-black transition-all duration-fast ease-out shadow-elev-sm shadow-elev-inner-hl hover:-translate-y-px hover:shadow-elev-md">
          ← Back to Content
        </button>
      </div>
    )
  }

  return (
    // Bottom padding makes room for the sticky QuizEditorActionBar — without
    // it the bar floats over the page's own Save buttons on short quizzes.
    <div className="theme-text space-y-5 pb-32 sm:pb-28">
      <SeoHelmet title={form.title ? `Edit: ${form.title}` : 'Edit quiz'} noIndex />
      {toast && (
        <div className={`fixed right-4 top-4 z-50 max-w-xs rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-lg ${
          toast.isErr ? 'bg-red-600' : 'theme-accent-fill theme-on-accent'
        }`}>
          {toast.message}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <button type="button" onClick={() => navigate(backPath)} aria-label="Back" className="theme-text-muted mt-1 min-h-0 bg-transparent p-1 shadow-none hover:theme-text transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
          </button>
          <div>
            <p className="text-eyebrow">Editing</p>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <h1 className="text-display-xl theme-text flex items-center gap-2">
                <span aria-hidden="true">✏️</span> Edit quiz
              </h1>
              <QuizStatusBadge status={derivedStatus} />
              {form.linkedPaperId && (
                <Link
                  to={`/admin/papers/${form.linkedPaperId}/edit`}
                  className="rounded-full theme-bg-subtle theme-text-muted hover:theme-text px-2.5 py-1 text-xs font-bold"
                >
                  ← Past Paper Studio
                </Link>
              )}
              {dirty && <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-600">● Unsaved changes</span>}
            </div>
            <p className="theme-text-muted mt-1 text-body-sm">{form.title || 'Untitled quiz'} · {questionCount} questions</p>
          </div>
        </div>
      </div>

      <QuizWizardSteps
        activeStep={wizardStep}
        completedSteps={[
          ...(questionCount > 0 ? ['create'] : []),
          ...(questionCount > 0 ? ['preview'] : []),
          ...(activeAssignmentCount > 0 ? ['assign'] : []),
          ...(quizStatus === 'published' ? ['publish'] : []),
        ]}
        onStepChange={setWizardStep}
      />

      <div className="surface space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-display-md theme-text flex items-center gap-2" style={{ fontSize: 17 }}>
            <span aria-hidden="true">📋</span> Quiz details
          </h2>
          {canEdit && (
            <button
              type="button"
              onClick={handleClearForm}
              disabled={saving}
              className="rounded-full border border-red-200 px-3 py-1.5 text-xs font-black text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:pointer-events-none min-h-0"
              title="Reset the title, details, and remove every question"
            >
              <span aria-hidden="true">🗑️</span> Clear quiz
            </button>
          )}
        </div>
        <div className="space-y-3">
          <input value={form.title} onChange={event => setF('title', event.target.value)} placeholder="Quiz title (e.g. Grade 6 Science - Human Body)" className={FIELD} />
          <input value={form.topic || ''} onChange={event => setF('topic', event.target.value)} placeholder="Topic (optional, e.g. Photosynthesis)" className={FIELD} />
          <div className="grid gap-3 sm:grid-cols-3">
            <select value={form.grade} onChange={event => setF('grade', event.target.value)} className={SELECT}>{gradeOptions.map(grade => <option key={grade} value={grade}>Grade {grade}</option>)}</select>
            <select value={form.subject} onChange={event => setF('subject', event.target.value)} className={SELECT}>{subjectOptions.map(subject => <option key={subject} value={subject}>{subject}</option>)}</select>
            <select value={Number(form.duration) || 30} onChange={event => setF('duration', clampInt(event.target.value, 5, 180, 30))} className={SELECT} aria-label="Quiz duration in minutes">{durationOptions.map(mins => <option key={mins} value={mins}>⏱️ {mins} minutes</option>)}</select>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <StatPill label="questions" value={questionCount} color="theme-accent-bg theme-accent-text" />
            <StatPill label="marks" value={totalMarks} color="theme-bg-subtle theme-text" />
            <StatPill label="mins" value={form.duration} color="bg-orange-100 text-orange-700" />
            {passageCount > 0 && <StatPill label="passages" value={passageCount} color="bg-orange-100 text-orange-700" />}
            {newCount > 0 && <StatPill label="new" value={newCount} color="theme-accent-bg theme-accent-text" />}
            {deletedIds.length > 0 && <StatPill label="queued for deletion" value={deletedIds.length} color="bg-red-100 text-red-600" />}
            {imagesCount > 0 && <StatPill label="images" value={imagesCount} color="theme-accent-bg theme-accent-text" />}
          </div>
          <label className="flex cursor-pointer select-none items-center gap-2" title="Demo quizzes are visible to free users">
            <span className="theme-text-muted text-xs font-black">Mark as Demo</span>
            <button type="button" onClick={() => setF('isDemo', !form.isDemo)} className={`relative h-5 w-10 min-h-0 rounded-full p-0 shadow-none transition-colors ${form.isDemo ? 'theme-accent-fill' : 'theme-border theme-bg-subtle border'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${form.isDemo ? 'left-5' : 'left-0.5'}`} />
            </button>
            {form.isDemo && <span className="theme-accent-bg theme-accent-text rounded-full px-2 py-0.5 text-xs font-black">Demo</span>}
          </label>
          <label className="flex cursor-pointer select-none items-center gap-2" title="Randomise question order for each learner at attempt time (Parts and passages stay grouped)">
            <span className="theme-text-muted text-xs font-black">Shuffle questions</span>
            <button type="button" onClick={() => setF('shuffleQuestions', !form.shuffleQuestions)} className={`relative h-5 w-10 min-h-0 rounded-full p-0 shadow-none transition-colors ${form.shuffleQuestions ? 'theme-accent-fill' : 'theme-border theme-bg-subtle border'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${form.shuffleQuestions ? 'left-5' : 'left-0.5'}`} />
            </button>
            {form.shuffleQuestions && <span className="theme-accent-bg theme-accent-text rounded-full px-2 py-0.5 text-xs font-black">On</span>}
          </label>
        </div>
      </div>

      {/* Phase 9: replaces the previous static "Imported from Word/PDF"
          banner with an actionable one that lists warnings and lets the
          teacher clear the review flag once they've fixed the flagged
          questions. Renders nothing for clean imports — the badge on the
          list view (Phase 7) is enough of an info-only signal. */}
      <PastPaperReferenceBanner quiz={form} />
      <ImportReviewBanner record={form} onMarkReviewed={handleMarkImportReviewed} busy={saving} />

      {wizardStep === 'create' && (
        <>
          {/* Word/PDF document import: the same flow CreateQuizV2 ships,
              available here so past-paper quizzes (opened from the Past
              Paper Studio) can be populated by uploading the source
              paper directly into the editor. Collapsed by default for
              quizzes that already have questions; auto-expanded when
              the editor lands empty on a paper-linked quiz. */}
          <details
            className="theme-card theme-border rounded-2xl border"
            open={importPanelOpen}
            onToggle={(event) => setImportPanelOpen(event.currentTarget.open)}
          >
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm font-black theme-text">
              <span className="flex items-center gap-2">
                <span aria-hidden="true">📄</span>
                <span>Import from Word/PDF</span>
                {form.linkedPaperId && (
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-violet-700">
                    Past paper
                  </span>
                )}
              </span>
              <span className="theme-text-muted text-xs font-bold">
                {importingDocument ? 'Importing…' : importSummary ? 'Re-import' : 'Upload a document'}
              </span>
            </summary>
            <div className="border-t theme-border p-4">
              <ImportQuizPanel
                importing={importingDocument}
                importProgress={importProgress}
                importSummary={importSummary}
                onImport={handleImportDocument}
                title={form.linkedPaperId ? 'Import past paper document' : 'Import Quiz (Word/PDF)'}
                intro={form.linkedPaperId
                  ? 'Upload the past paper (.doc, .docx, or .pdf). ZedExams will extract questions, options, and image-based items into editable cards. You can also re-import a different version any time.'
                  : 'Upload a .doc, .docx, or .pdf file. ZedExams will extract questions, options, short answers, and image-based questions into editable cards, then use smart cleanup on tricky formatting when available.'}
              />
            </div>
          </details>
          {/* Bulk answer-key entry (collapsible). Especially useful after a
              scanned import, where every answer lands blank. */}
          <details className="theme-card theme-border overflow-hidden rounded-2xl border">
            <summary className="flex cursor-pointer items-center justify-between gap-3 p-4">
              <span className="theme-text font-black">🔑 Answer key</span>
              <span className="theme-text-muted text-xs font-bold">Set every answer fast</span>
            </summary>
            <div className="border-t theme-border p-4">
              <BulkAnswerKey
                questions={answerableQuestions}
                onSetOne={handleSetOneAnswer}
                onApplyMany={applyAnswerKeyMap}
              />
            </div>
          </details>
          <QuizSectionsEditor
            variant="edit"
            sections={sections}
            parts={parts}
            quizContext={{ subject: form.subject, grade: form.grade }}
            questionNumbers={questionNumbers}
            issueCountsByLocalId={issueCountsByLocalId}
            totalQuestions={questionCount}
            onStandaloneChange={updateStandaloneQuestion}
            onStandaloneRemove={removeStandaloneSection}
            onStandaloneMove={moveSection}
            onStandaloneImageUpload={uploadStandaloneQuestionImage}
            onStandaloneImageRemove={removeStandaloneQuestionImage}
            onStandaloneOptionImageUpload={uploadStandaloneOptionImage}
            onStandaloneOptionImageRemove={removeStandaloneOptionImage}
            onPassageChange={updatePassage}
            onPassageToggle={togglePassage}
            onPassageRemove={removePassageSection}
            onPassageMove={moveSection}
            onPassageImageUpload={uploadPassageImage}
            onPassageImageRemove={removePassageImage}
            onPassageQuestionChange={updatePassageQuestion}
            onPassageQuestionRemove={removePassageQuestion}
            onPassageQuestionMove={movePassageQuestion}
            onPassageQuestionOptionImageUpload={uploadPassageQuestionOptionImage}
            onPassageQuestionOptionImageRemove={removePassageQuestionOptionImage}
            onPassageAddQuestion={addPassageQuestion}
            onAddStandalone={addStandaloneSectionHandler}
            onAddPassage={addPassageSectionHandler}
            onAddMap={addMapSectionHandler}
            onAddPart={addPart}
            onPartChange={updatePart}
            onPartMove={movePart}
            onPartRemove={removePart}
            onAssignSectionToPart={assignSectionToPart}
            onShuffleSections={handleShuffleSections}
            onAutoGroupComprehension={handleAutoGroupComprehension}
            onMoveQuestionToPassage={handleMoveQuestionToPassage}
          />
          {deletedIds.length > 0 && (
            <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span className="flex-shrink-0 text-base">🗑️</span>
              <span><strong>{deletedIds.length} question{deletedIds.length > 1 ? 's' : ''}</strong> will be permanently deleted from Firestore when you save.</span>
            </div>
          )}
        </>
      )}

      {wizardStep === 'preview' && (
        <>
          <div className="surface space-y-2 p-4 sm:p-5">
            <p className="text-eyebrow">Step 2 of 4</p>
            <h2 className="theme-text text-display-md flex items-center gap-2">
              <span aria-hidden="true">👁️</span> Preview quiz
            </h2>
            <p className="theme-text-muted text-body-sm max-w-prose">
              This is how the quiz will look to a learner. Spot mistakes
              now — return to <strong>Step 1: Create</strong> to fix them.
            </p>
          </div>
          <QuizEditorPreviewPanel form={form} serializedSections={serializedPreview} />
        </>
      )}

      {wizardStep === 'assign' && (
        <QuizAssignStep
          quiz={{
            id: quizId,
            title: form.title,
            subject: form.subject,
            grade: form.grade,
            isPublished: quizStatus === 'published',
            status: quizStatus,
          }}
          dirty={dirty}
          onAssignmentsChanged={refreshAssignmentCount}
        />
      )}

      {wizardStep === 'publish' && (
        <QuizPublishStep
          status={derivedStatus}
          dirty={dirty}
          saving={saving}
          uploading={anyUploading}
          questionCount={questionCount}
          totalMarks={totalMarks}
          isAdmin={isAdmin}
          onSaveDraft={() => handleSave('draft')}
          onSubmitForReview={() => handleSave('pending')}
          onPublish={() => {
            if (!validate()) return
            setVerifyOpen(true)
          }}
          onUnpublish={handleTogglePublish}
          activeAssignmentCount={activeAssignmentCount}
        />
      )}

      <div className="surface flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleSave('draft')}
            disabled={saving || anyUploading}
            className="btn-secondary min-h-0 px-4 py-2 font-black disabled:opacity-40 disabled:pointer-events-none"
          >
            <span aria-hidden="true">💾</span>
            <span>{saving ? 'Saving…' : anyUploading ? 'Uploading…' : 'Save draft'}</span>
          </button>
          <p className={`text-xs font-bold ${dirty ? 'text-warning' : 'text-success'}`}>
            {dirty ? '⚠️ Unsaved changes' : '✓ All changes saved'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {wizardStep !== 'create' && (
            <button
              type="button"
              onClick={() => {
                const order = ['create', 'preview', 'assign', 'publish']
                const i = order.indexOf(wizardStep)
                if (i > 0) setWizardStep(order[i - 1])
              }}
              className="theme-card border theme-border rounded-full px-4 py-2 text-sm font-black hover:theme-bg-subtle min-h-[44px]"
            >
              ← Back
            </button>
          )}
          {wizardStep !== 'publish' ? (
            <button
              type="button"
              onClick={() => {
                const order = ['create', 'preview', 'assign', 'publish']
                const i = order.indexOf(wizardStep)
                if (i < order.length - 1) setWizardStep(order[i + 1])
              }}
              className="theme-accent-fill theme-on-accent rounded-full px-5 py-2 text-sm font-black hover:opacity-90 min-h-[44px]"
            >
              Continue →
            </button>
          ) : null}
        </div>
      </div>

      <QuizVerifyModal
        open={verifyOpen}
        quizId={quizId}
        form={form}
        sections={sections}
        parts={parts}
        onClose={() => setVerifyOpen(false)}
        onFixIssues={() => setVerifyOpen(false)}
        onPublish={() => { setVerifyOpen(false); handleSave('published') }}
      />

      {/* Sticky bottom action bar — replaces the "scroll to the very end
          to publish" pattern. Stays visible while editing. */}
      <QuizEditorActionBar
        onSaveDraft={() => handleSave('draft')}
        onPublish={() => handleSave('published')}
        // Jump straight to the wizard's Preview step — already the
        // canonical place that renders the live preview, so we don't
        // need a second preview surface on the action bar. Hidden when
        // already on Preview so the button doesn't no-op.
        onPreview={wizardStep === 'preview' ? null : () => setWizardStep('preview')}
        onShowChecklist={() => setChecklistOpen(true)}
        saving={saving}
        uploading={anyUploading}
        uploadProgress={uploadProgress}
        dirty={dirty}
        autoSaveState={autoSaveState}
        autoSaveError={autoSaveError}
        issueCount={errorCount}
        canPublish={isAdmin}
        isPublished={quizStatus === 'published'}
      />

      {/* Floating Top / Bottom + quick-save shortcuts. Only mounted when
          the page is taller than the viewport. */}
      <QuizEditorFloatingNav
        onSaveDraft={() => handleSave('draft')}
        onPublish={isAdmin ? () => handleSave('published') : null}
        busy={saving || anyUploading}
        showPublish={isAdmin}
      />

      {/* Pre-publish checklist. Opened either by clicking the "X to fix"
          pill in the action bar or by attempting Publish with errors. */}
      <QuizValidationChecklist
        open={checklistOpen}
        onClose={() => setChecklistOpen(false)}
        issues={validationIssues}
        summary={validationSummary}
      />

      {/* Re-import diff modal — surfaced when a teacher re-uploads a
          DOCX into a quiz that already has matching questions. Lets
          them merge (preserve manual edits) instead of being forced
          into the legacy nuke-and-replace. */}
      <ReimportDiffModal
        open={Boolean(pendingImport && pendingDiff)}
        fileName={pendingImport?.file?.name || ''}
        diff={pendingDiff}
        onMerge={() => {
          if (!pendingImport) return
          applyImportedPayload(pendingImport.imported, pendingImport.file, 'merge')
          setPendingImport(null)
          setPendingDiff(null)
        }}
        onReplace={() => {
          if (!pendingImport) return
          applyImportedPayload(pendingImport.imported, pendingImport.file, 'replace')
          setPendingImport(null)
          setPendingDiff(null)
        }}
        onCancel={() => {
          // Release the freshly-imported blob URLs we never adopted.
          if (pendingImport?.imported?.imageAssets) {
            revokeImportedQuizAssets(assetsById(pendingImport.imported.imageAssets))
          }
          setPendingImport(null)
          setPendingDiff(null)
        }}
      />
    </div>
  )
}
