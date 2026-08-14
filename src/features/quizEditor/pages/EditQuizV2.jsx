import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ref as storageRef, getDownloadURL } from 'firebase/storage'
import { uploadBytes } from '../../../firebase/attestedStorage'
import { useFirestore } from '../../../hooks/useFirestore'
import { useAuth } from '../../../contexts/AuthContext'
import { storage, getAppCheckClientState } from '../../../firebase/config'

/**
 * App Check state for the upload-error describer, which runs inside catch
 * blocks — an exception here would turn a handled upload failure into a
 * crash. Null simply means "can't tell", and uploadErrorMessage then keeps
 * its permissions wording.
 */
function appCheckStateSafe() {
  try { return getAppCheckClientState() } catch { return null }
}
import {
  collectSectionFirestoreIds,
  createPartGroup,
  createPassageSection,
  createStandaloneSection,
  emptyPassageQuestion,
  getPassageQuestionFirestoreId,
  getQuestionKey,
  hasOnlyEmptyStarterSection,
  hydrateQuizSections,
  insertStandaloneSection,
  serializeQuizSections,
  shuffleQuizSections,
} from '../../../utils/quizSections.js'
import { regroupComprehensionSections, moveQuestionToPassage } from '../../../utils/comprehensionGrouping.js'
import { richTextHasContent } from '../../../utils/quizRichText.js'
import { assertFileSignature } from '../../../utils/fileSignature'
import {
  MAX_ENCODE_ATTEMPTS,
  QUIZ_IMAGE_TARGET_BYTES,
  oversizeImageError,
  planNextEncode,
  uploadErrorMessage,
} from '../../../utils/quizImageUpload.js'
import { clampInt } from '../../../utils/inputs.js'
import { getErrorMessage } from '../../../utils/errors.js'
import { classifyOnPublish } from '../../../utils/quizClassification.js'
import { captureQuestionsToBank } from '../../../utils/questionBankService'
import {
  validateStandaloneQuestion as sharedValidateStandaloneQuestion,
  collectQuizIssues,
} from '../../../utils/quizValidation.js'
import { assertNoBlobImageUrls, applyUploadedImageUrls } from '../../../utils/importedQuizAssets.js'
import {
  assetsById,
  buildStandaloneSection,
  uploadImportedPassageImages,
  uploadImportedQuestionImages,
} from '../../../utils/quizDocumentImport.js'
import {
  importQuizDocument,
  revokeImportedQuizAssets,
} from '../../../components/quiz/documentQuizImporter'
import ImportQuizPanel from '../components/ImportQuizPanel'
import QuizSectionsEditor from '../components/QuizSectionsEditor'
import QuizEditorPreviewPanel from '../components/QuizEditorPreviewPanel'
import QuizVerifyModal from '../components/QuizVerifyModal'
import ConfirmDialog from '../../../shared/components/ConfirmDialog'
import Skeleton from '../../../shared/components/Skeleton'
import BulkAnswerKey from '../components/BulkAnswerKey'
import { collectAnswerableQuestions, applyAnswerKeyToSections, collectAiAnswerTargets } from '../lib/answerKeyUtils'
import ReviewPanel from '../components/ReviewPanel'
import { collectReviewItems } from '../lib/reviewUtils'
import StructuralValidationPanel from '../components/StructuralValidationPanel'
import { runQuizValidation } from '../../../utils/quizEngineAdapter.js'
import { mergeStandaloneSections } from '../lib/bulkQuestionOps.js'
import ImageCropModal from '../components/ImageCropModal'
import { getRichPlainText } from '../../../editor/RichContent.jsx'
import { suggestQuizAnswers } from '../../../utils/aiAssistant'
import ImportReviewBanner from '../components/ImportReviewBanner'
import PastPaperReferenceBanner from '../components/PastPaperReferenceBanner'
import QuizEditorActionBar from '../components/QuizEditorActionBar'
import QuizEditorFloatingNav from '../components/QuizEditorFloatingNav'
import QuizValidationChecklist from '../components/QuizValidationChecklist'
import ReimportDiffModal from '../components/ReimportDiffModal'
import { diffImportedSections, mergeImportedSections } from '../lib/quizReimportDiff.js'
import { isSaveableGrade, GRADE_REQUIRED_MESSAGE } from '../../../schemas/quiz.js'
import QuizWizardSteps from '../components/QuizWizardSteps'
import QuizStatusBadge from '../components/QuizStatusBadge'
import QuizPublishStep from '../components/QuizPublishStep'
import { deriveQuizStatus } from '../../../utils/quizStatus'
import { normalizeSubject } from '../../../config/curriculum.js'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import { PAPER_SUBJECTS } from '../../../config/curriculum'
import { gradesForFeature, gradeNumberOf } from '../../../config/canonicalEducation'

// Both lists derive from the learner catalogue + the canonical ladder.
const SUBJECTS = PAPER_SUBJECTS.map((s) => s.label)
// The learner catalogue's grades, from the canonical model — a documented
// FILTER on the one ladder (quizzes and lessons are authored for upper
// primary only), never a list of its own.
const GRADES = gradesForFeature('learner-catalogue').map((g) => gradeNumberOf(g.code))
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

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Could not load image'))
    }
    image.src = objectUrl
  })
}

// Draw `image` at no more than `maxWidth` px wide (never upscaled) and encode
// it once. `sourceHasAlpha` is about the SOURCE, not the output: the canvas
// needs its alpha channel to receive a transparent picture at all, and only
// then can the white flatten below do its job.
function encodeImageOnce(image, { maxWidth, format, quality, sourceHasAlpha }) {
  const naturalWidth = image.naturalWidth || image.width
  const naturalHeight = image.naturalHeight || image.height
  const scale = Math.min(1, maxWidth / naturalWidth)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(naturalHeight * scale))
  const ctx = canvas.getContext('2d', { alpha: sourceHasAlpha })
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

  // JPEG has no alpha channel, so encoding a transparent canvas to JPEG
  // composites transparent pixels onto BLACK. Paint white BEHIND the drawn
  // image first (destination-over only fills the currently-transparent areas,
  // never touching the figure) so a flattened picture lands on white, not a
  // black background that hides dark strokes and labels.
  if (sourceHasAlpha && format !== 'image/png') {
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.globalCompositeOperation = 'source-over'
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Canvas compression failed'))),
      format,
      quality,
    )
  })
}

// Prepare an upload blob without needlessly degrading the picture. PNG sources
// (diagrams, scanned line-art, cropped figures) stay lossless PNG; everything
// else is encoded as high-quality JPEG. The width cap is generous so fine
// detail and text in figures survive. Returns a Blob whose `.type` tells the
// caller which format/extension to store.
//
// It RE-ENCODES until the result fits (planNextEncode's ladder) rather than
// encoding once and letting Storage decide. The old version encoded a JPEG
// with no size check at all, and gave a PNG exactly one fallback attempt —
// so an oversize blob reached the bucket and came back as a bare
// `storage/unauthorized`, which the editor then reported as a size problem
// whether or not it was one. Anything this resolves is under the cap, which
// is what lets uploadErrorMessage say a refusal is NOT about size.
async function compressImage(file, {
  maxWidth = 1600,
  quality = 0.92,
  maxBytes = QUIZ_IMAGE_TARGET_BYTES,
} = {}) {
  const image = await loadImageFromFile(file)
  // WebP carries alpha too — treating it as opaque flattened transparent
  // WebP crops onto black on their way to JPEG.
  const sourceHasAlpha = file.type === 'image/png' || file.type === 'image/webp'

  let format = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  let width = maxWidth
  let currentQuality = quality
  let blob = await encodeImageOnce(image, { maxWidth: width, format, quality: currentQuality, sourceHasAlpha })

  for (let attempt = 0; attempt < MAX_ENCODE_ATTEMPTS; attempt += 1) {
    const step = planNextEncode({ bytes: blob.size, format, quality: currentQuality, width, maxBytes })
    if (step.action === 'accept') return blob
    if (step.action === 'fail') throw oversizeImageError(blob.size)
    format = step.format
    currentQuality = step.quality
    width = step.maxWidth
    blob = await encodeImageOnce(image, { maxWidth: width, format, quality: currentQuality, sourceHasAlpha })
  }
  if (blob.size > maxBytes) throw oversizeImageError(blob.size)
  return blob
}

// Derive the storage extension + contentType from a processed upload blob so
// lossless PNG crops keep their format end-to-end (no silent re-encode to JPEG).
function uploadFormat(blob) {
  return blob?.type === 'image/png'
    ? { ext: 'png', contentType: 'image/png' }
    : { ext: 'jpg', contentType: 'image/jpeg' }
}

function buildQuestionNumberMap(questions = []) {
  return Object.fromEntries(questions.map((question, index) => [getQuestionKey(question), index + 1]))
}

// Local alias so existing call-sites don't need to change.
const collectQuestionIds = collectSectionFirestoreIds

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
  // Set when the load() body throws (malformed/legacy question data, an
  // unexpected passage shape, a hydrate error). Without this the editor would
  // hang forever on the loading skeleton — load() would reject unhandled and
  // `loading` would never flip false. Rendered as a recoverable error card.
  const [loadError, setLoadError] = useState(false)
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
  // Clear-whole-quiz waits on ConfirmDialog approval (distinct from
  // pendingImport, which drives the import-diff modal below).
  const [pendingClearQuiz, setPendingClearQuiz] = useState(false)
  // Set when the questions subcollection came back EMPTY but the quiz doc's
  // own counters say it should have content (questionCount / reviewCount /
  // passages). getQuestions() swallows a failed read and returns [] — without
  // this guard the editor would hydrate an "empty" quiz and the 25 s autosave
  // would then overwrite questionCount → 0 and blank passages[], silently
  // destroying a populated past paper. When true we block autosave and warn
  // the admin to reload instead of saving over real data. See the load effect.
  const [suspectEmptyLoad, setSuspectEmptyLoad] = useState(false)
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
  // Three-step wizard: create → preview → publish. The current step
  // lives in component state so navigating back via the stepper
  // doesn't lose the editor's in-memory state.
  const [wizardStep, setWizardStep] = useState('create')
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

  // Memoised: serializeQuizSections walks every section and returns a fresh
  // object each call. Recomputing it on every keystroke (and the question-number
  // map derived from it) handed PassageSectionCard a new `questionNumbers`
  // identity each render, defeating its React.memo. Recompute only when the
  // underlying sections/parts actually change.
  const serializedPreview = useMemo(
    () => serializeQuizSections(sections, parts),
    [sections, parts],
  )
  // Stable identity: the numbering map's *values* only change when questions
  // are added/removed/reordered — never while typing. Keep the previous object
  // reference when the contents are unchanged so memoised passage cards (which
  // receive the whole map) don't re-render on every keystroke.
  const questionNumbersRef = useRef({})
  const questionNumbers = useMemo(() => {
    const next = buildQuestionNumberMap(serializedPreview.questions)
    const prev = questionNumbersRef.current
    const prevKeys = Object.keys(prev)
    const sameContents = prevKeys.length === Object.keys(next).length
      && prevKeys.every(key => prev[key] === next[key])
    if (sameContents) return prev
    questionNumbersRef.current = next
    return next
  }, [serializedPreview])
  const questionCount = serializedPreview.questionCount
  const totalMarks = serializedPreview.totalMarks

  // Mirror the latest `sections` into a ref so event handlers (delete/remove)
  // can read the current snapshot without listing `sections` in their
  // useCallback deps. That keeps their identity stable across keystrokes
  // (so memoised cards don't re-render) AND lets us call setDeletedIds OUTSIDE
  // the setSections updater — an updater that calls another setState is impure,
  // which StrictMode double-invokes in dev, double-queuing the deleted ids.
  const sectionsRef = useRef(sections)
  sectionsRef.current = sections

  // Stable object identity: only changes when subject or grade actually changes,
  // not on every keystroke. Prevents every card from re-rendering just because
  // the parent rendered.
  const quizContext = useMemo(
    () => ({ subject: form.subject, grade: form.grade }),
    [form.subject, form.grade],
  )
  const passageCount = serializedPreview.passages.length
  const newCount = serializedPreview.questions.filter(question => !question._id).length
  const imagesCount = countImages(sections)
  const anyUploading = hasUploadingAssets(sections)
  const derivedStatus = deriveQuizStatus({
    status: quizStatus,
    isPublished: quizStatus === 'published',
  })
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

  const show = useCallback(function show(message, isErr = false) {
    setToast({ message, isErr })
    setTimeout(() => setToast(null), 4000)
  }, [])

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

  // Live structural validation from the shared Document Understanding Engine
  // (the same checks the importers gate on): missing/duplicate/out-of-order
  // printed numbers, incomplete MCQs, [UNCLEAR] spans, answer-key blocks.
  // Derived-only — never written back into sections (that would dirty the
  // autosave loop on every recompute).
  const engineValidation = useMemo(
    () => runQuizValidation(sections, { questionNumbers }),
    [sections, questionNumbers],
  )

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
      setLoadError(false)
      try {
      const [quiz, questions] = await Promise.all([getQuizById(quizId), getQuestions(quizId)])
      if (cancelled) return
      if (!quiz) {
        // getQuizById returns null both for a genuinely-missing quiz AND for a
        // swallowed read error (it catches internally). Don't tell a teacher
        // their paper was "deleted" when the real cause is a dropped
        // connection — show the recoverable "reload" card instead.
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          setLoadError(true)
        } else {
          setNotFound(true)
        }
        return
      }
      if (!isAdmin && quiz.createdBy !== currentUser.uid) {
        setNotFound(true)
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
      // Detect a failed/partial questions read: the subcollection came back
      // empty, yet the doc's own counters insist it has content. getQuestions()
      // returns [] on a read error just as it does for a genuinely empty quiz,
      // so we can't tell them apart from the array alone — but a doc that
      // claims questionCount/reviewCount/passages while presenting zero loaded
      // questions is almost certainly a failed load, not an empty paper.
      // Flag it so autosave can't overwrite the real data with this empty view.
      const docClaimsContent =
        (Number(quiz.questionCount) || 0) > 0 ||
        (Number(quiz.reviewCount) || 0) > 0 ||
        (Array.isArray(quiz.passages) && quiz.passages.length > 0)
      setSuspectEmptyLoad(questions.length === 0 && docClaimsContent)
      } catch (error) {
        // Malformed/legacy data (bad passage shape, hydrate error) must not
        // freeze the editor on the skeleton forever. Surface a recoverable
        // error card instead of an unhandled rejection.
        if (cancelled) return
        console.error('[EditQuizV2] load failed', error)
        setLoadError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [quizId, getQuizById, getQuestions, currentUser?.uid, isAdmin])

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

  const updateSection = useCallback(function updateSection(sectionIndex, updater) {
    setSections(currentSections => currentSections.map((section, index) => (
      index === sectionIndex ? updater(section) : section
    )))
    setDirty(true)
  }, [])

  const updateStandaloneQuestion = useCallback(function updateStandaloneQuestion(sectionIndex, field, value) {
    setSections(currentSections => currentSections.map((section, index) => (
      index === sectionIndex
        ? { ...section, question: { ...section.question, [field]: value } }
        : section
    )))
    setDirty(true)
  }, [])

  // Address a section by its STABLE id, not its array position. In-flight image
  // uploads capture the section they started on; if the teacher reorders,
  // deletes, or merges sections while an upload is running, an index-based write
  // would land on the wrong section — leaving the real section's
  // `imageUploading` flag stuck true forever (Save disabled + autosave blocked).
  // A no-op when the section was removed mid-upload, which is the safe outcome.
  const updateSectionById = useCallback(function updateSectionById(sectionId, updater) {
    if (!sectionId) return
    setSections(currentSections => currentSections.map(section => (
      section.id === sectionId ? updater(section) : section
    )))
    setDirty(true)
  }, [])

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

  // Review panel: list questions still needing attention and scroll to one
  // when its row is clicked. Read-only — the data-question-id anchors live on
  // the question cards in QuizSectionsEditor; this never mutates state.
  const reviewData = useMemo(() => collectReviewItems(sections), [sections])
  function scrollToQuestion(localId) {
    if (!localId || typeof document === 'undefined') return
    const selector = `[data-question-id="${(typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(localId) : localId}"]`
    const el = document.querySelector(selector)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('ring-2', 'ring-amber-400')
    setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400'), 1600)
  }

  // In-editor image crop. Opening sets the target; the modal returns a cropped
  // Blob that we run through the SAME upload path as a normal image, so the
  // cropped picture replaces the original. Cancel changes nothing.
  const [cropTarget, setCropTarget] = useState(null)
  // `source` is the question/passage the crop was opened from — carries the
  // AI-located figureMeta box (Phase 10: "the initial crop rectangle must use
  // the detected sourceFigureBox when available") and the printed question /
  // page numbers shown in the modal header.
  const requestStandaloneImageCrop = useCallback(function requestStandaloneImageCrop(sectionIndex, imageUrl, source) {
    if (!imageUrl) return
    setCropTarget({ kind: 'standalone', sectionIndex, imageUrl, source })
  }, [])
  const requestPassageImageCrop = useCallback(function requestPassageImageCrop(sectionIndex, imageUrl, source) {
    if (!imageUrl) return
    setCropTarget({ kind: 'passage', sectionIndex, imageUrl, source })
  }, [])

  // "Crop from page": opens the crop modal on a rendered page of the SOURCE
  // PAPER, so a question whose picture the importer couldn't attach (it only
  // reported "there is a picture here") — or any question at all — gets its
  // image by cropping it straight out of the uploaded paper, instead of the
  // admin re-photographing it. Works for quizzes created by the Past Paper
  // Studio (linkedPaperId) and by the legacy converter (sourcePastPaperId),
  // including papers imported before this feature existed.
  const sourcePaperId = form.sourcePastPaperId || form.linkedPaperId || null
  // Holds a Promise<provider>, not the provider, so the ref can be claimed
  // SYNCHRONOUSLY before the dynamic import's await — see openSourcePageCrop.
  const paperPageProviderRef = useRef(null)
  const [pageCropLoading, setPageCropLoading] = useState(false)
  useEffect(() => () => {
    paperPageProviderRef.current?.then((provider) => provider.dispose?.()).catch(() => {})
  }, [])
  const openSourcePageCrop = useCallback(async function openSourcePageCrop(kind, sectionIndex, source, pageOverride) {
    if (!sourcePaperId || pageCropLoading) return
    const page = Number.parseInt(
      pageOverride ?? source?.figureMeta?.sourcePage ?? source?.sourcePage,
      10,
    )
    if (!Number.isInteger(page) || page < 1) return
    setPageCropLoading(true)
    try {
      if (!paperPageProviderRef.current) {
        // Claimed before any await. `pageCropLoading` is React state, so a
        // second click in the same tick still reads it false and gets past the
        // guard above; a check-then-assign either side of the import's await
        // would then build a SECOND provider and orphan the first, whose object
        // URLs only its own dispose() revokes — and the unmount cleanup can
        // only reach the one still in the ref.
        const pending = import('../lib/paperPageProvider.js')
          .then(({ createPaperPageProvider }) => createPaperPageProvider(sourcePaperId))
        // A failed import must not poison the ref — released so a retry rebuilds,
        // the same rule renderPage() already applies to its own page cache.
        pending.catch(() => {
          if (paperPageProviderRef.current === pending) paperPageProviderRef.current = null
        })
        paperPageProviderRef.current = pending
      }
      const provider = await paperPageProviderRef.current
      const [imageUrl, pageCount] = await Promise.all([
        provider.getPageImage(page),
        provider.getPageCount().catch(() => null),
      ])
      setCropTarget({ kind, sectionIndex, imageUrl, source, fromPaper: true, page, pageCount })
    } catch (error) {
      show(`Could not open page ${page} of the source paper — ${error?.message || 'try re-uploading the paper.'}`, true)
    } finally {
      setPageCropLoading(false)
    }
  }, [sourcePaperId, pageCropLoading, show])
  const requestStandaloneCropFromPage = useCallback(function requestStandaloneCropFromPage(sectionIndex, question) {
    openSourcePageCrop('standalone', sectionIndex, question)
  }, [openSourcePageCrop])
  const requestPassageCropFromPage = useCallback(function requestPassageCropFromPage(sectionIndex, passage) {
    openSourcePageCrop('passage', sectionIndex, passage)
  }, [openSourcePageCrop])
  async function handleCroppedImage(blob) {
    const target = cropTarget
    setCropTarget(null)
    if (!target || !blob) return
    // The crop modal returns a lossless PNG; keep it PNG through the upload path.
    const file = new File([blob], 'cropped.png', { type: blob.type || 'image/png' })
    // The upload helpers catch internally, but wrap defensively so a future
    // refactor that lets one throw can't become an unhandled rejection with no
    // feedback to the teacher.
    try {
      if (target.kind === 'standalone') {
        await uploadStandaloneQuestionImage(target.sectionIndex, file)
      } else if (target.kind === 'passage') {
        await uploadPassageImage(target.sectionIndex, file)
      }
    } catch (error) {
      show(uploadErrorMessage(error, appCheckStateSafe()), true)
    }
  }

  // AI suggest-all: answer every still-blank MCQ in one batched call, then
  // apply via the same identity-preserving path as the manual answer key.
  // Suggestions only — questions stay flagged for the admin to verify.
  const [suggestingAnswers, setSuggestingAnswers] = useState(false)
  async function handleSuggestAnswers() {
    if (suggestingAnswers) return
    const targets = collectAiAnswerTargets(sections, getRichPlainText, { onlyUnanswered: true })
    if (!targets.length) {
      show('Every multiple-choice question already has an answer set.')
      return
    }
    setSuggestingAnswers(true)
    try {
      const { answers, count } = await suggestQuizAnswers({
        questions: targets,
        subject: form.subject || '',
        grade: form.grade || '',
      })
      if (count > 0) {
        applyAnswerKeyMap(answers)
        show(`AI suggested ${count} answer${count === 1 ? '' : 's'} — please verify each before publishing.`)
      } else {
        show('The AI could not confidently answer these questions. Set them manually.', true)
      }
    } catch (error) {
      show(`Could not suggest answers: ${getErrorMessage(error, 'AI is unavailable right now.')}`, true)
    } finally {
      setSuggestingAnswers(false)
    }
  }

  const moveSection = useCallback(function moveSection(sectionIndex, direction) {
    setSections(currentSections => {
      const nextSections = [...currentSections]
      const targetIndex = sectionIndex + direction
      if (targetIndex < 0 || targetIndex >= nextSections.length) return nextSections
      ;[nextSections[sectionIndex], nextSections[targetIndex]] = [nextSections[targetIndex], nextSections[sectionIndex]]
      return nextSections
    })
    setDirty(true)
  }, [])

  const handleShuffleSections = useCallback(function handleShuffleSections() {
    setSections(currentSections => shuffleQuizSections(currentSections))
    setDirty(true)
  }, [])

  const handleAutoGroupComprehension = useCallback(function handleAutoGroupComprehension() {
    setSections(currentSections => regroupComprehensionSections(currentSections).sections)
    setDirty(true)
    show('Comprehension questions re-grouped by passage.')
  }, [show])

  const handleMoveQuestionToPassage = useCallback(function handleMoveQuestionToPassage(fromSectionId, questionLocalId, toSectionId) {
    setSections(currentSections =>
      moveQuestionToPassage(currentSections, fromSectionId, questionLocalId, toSectionId))
    setDirty(true)
  }, [])

  // Reset the whole editor back to an empty quiz: clears the title,
  // details, and every question. Saved questions are queued for
  // deletion (mirroring the "replace" import path) so the next save
  // removes them from Firestore. Past-paper provenance + studio
  // linkage are preserved so a cleared quiz keeps its tie to its
  // source (and the back button still routes correctly). Guarded
  // behind a confirm because it can't be undone.
  function handleClearForm() {
    setPendingClearQuiz(true)
  }

  function performClearForm() {
    setPendingClearQuiz(false)
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
  const addPart = useCallback(function addPart() {
    setParts(currentParts => [
      ...currentParts,
      createPartGroup({ order: currentParts.length, title: '' }),
    ])
    setDirty(true)
  }, [])

  const updatePart = useCallback(function updatePart(partId, field, value) {
    setParts(currentParts => currentParts.map(part => (
      part.id === partId ? { ...part, [field]: value } : part
    )))
    setDirty(true)
  }, [])

  const movePart = useCallback(function movePart(partId, direction) {
    setParts(currentParts => {
      const sorted = [...currentParts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      const index = sorted.findIndex(part => part.id === partId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= sorted.length) return currentParts
      ;[sorted[index], sorted[target]] = [sorted[target], sorted[index]]
      return sorted.map((part, i) => ({ ...part, order: i }))
    })
    setDirty(true)
  }, [])

  const removePart = useCallback(function removePart(partId) {
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
  }, [])

  const assignSectionToPart = useCallback(function assignSectionToPart(sectionId, partId) {
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
  }, [])

  const removeStandaloneSection = useCallback(function removeStandaloneSection(sectionIndex) {
    // Read the current snapshot from the ref (never a stale closure over
    // `sections`), so the handler identity stays stable. setDeletedIds runs
    // outside the setSections updater to keep that updater pure.
    const ids = collectQuestionIds(sectionsRef.current[sectionIndex])
    if (ids.length) setDeletedIds(current => [...current, ...ids])
    setSections(currentSections => currentSections.filter((_, index) => index !== sectionIndex))
    setDirty(true)
  }, [])

  // Bulk "Merge selected" from the selection toolbar: combine the selected
  // standalone questions into the first one (paper order). The pure helper
  // returns the absorbed questions' Firestore ids, which join the same
  // deletion queue single-card removal uses — so the merged-away docs are
  // actually deleted on save, not orphaned.
  const mergeSelectedSections = useCallback(function mergeSelectedSections(sectionIds) {
    const result = mergeStandaloneSections(sectionsRef.current, sectionIds)
    if (!result.mergedCount) return
    if (result.removedQuestionIds.length) {
      setDeletedIds(current => [...current, ...result.removedQuestionIds])
    }
    setSections(result.sections)
    setDirty(true)
    show(`Merged ${result.mergedCount + 1} questions into one — flagged for review.`)
  }, [show])

  const updatePassage = useCallback(function updatePassage(sectionIndex, field, value) {
    setSections(currentSections => currentSections.map((section, index) => (
      index === sectionIndex
        ? { ...section, passage: { ...section.passage, [field]: value } }
        : section
    )))
    setDirty(true)
  }, [])

  const togglePassage = useCallback(function togglePassage(sectionIndex) {
    setSections(currentSections => currentSections.map((section, index) => (
      index === sectionIndex
        ? { ...section, passage: { ...section.passage, collapsed: !section.passage.collapsed } }
        : section
    )))
    setDirty(true)
  }, [])

  const removePassageSection = useCallback(function removePassageSection(sectionIndex) {
    // Read the current snapshot from the ref; setDeletedIds outside the
    // updater keeps the setSections updater pure (StrictMode-safe).
    const ids = collectQuestionIds(sectionsRef.current[sectionIndex])
    if (ids.length) setDeletedIds(current => [...current, ...ids])
    setSections(currentSections => currentSections.filter((_, index) => index !== sectionIndex))
    setDirty(true)
  }, [])

  const updatePassageQuestion = useCallback(function updatePassageQuestion(sectionIndex, questionIndex, field, value) {
    updateSection(sectionIndex, section => ({
      ...section,
      passage: {
        ...section.passage,
        questions: section.passage.questions.map((question, index) => (
          index === questionIndex ? { ...question, [field]: value } : question
        )),
      },
    }))
  }, [updateSection])

  const removePassageQuestion = useCallback(function removePassageQuestion(sectionIndex, questionIndex) {
    // Read the current snapshot from the ref; setDeletedIds outside the
    // updater keeps the setSections updater pure (StrictMode-safe).
    const id = getPassageQuestionFirestoreId(sectionsRef.current, sectionIndex, questionIndex)
    if (id) setDeletedIds(current => [...current, id])
    setSections(currentSections => currentSections.map((s, i) => {
      if (i !== sectionIndex) return s
      return {
        ...s,
        passage: {
          ...s.passage,
          questions: s.passage.questions.filter((_, qi) => qi !== questionIndex),
        },
      }
    }))
    setDirty(true)
  }, [])

  const movePassageQuestion = useCallback(function movePassageQuestion(sectionIndex, questionIndex, direction) {
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
  }, [updateSection])

  const addPassageQuestion = useCallback(function addPassageQuestion(sectionIndex) {
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
  }, [updateSection])

  const addStandaloneSectionHandler = useCallback(function addStandaloneSectionHandler() {
    setSections(currentSections => [...currentSections, createStandaloneSection()])
    setDirty(true)
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50)
  }, [])

  // Insert a blank question BETWEEN existing ones (or at the start of a Part),
  // so a teacher fixing an importer gap doesn't have to add at the bottom and
  // walk the card up. `anchorId` is the section it's placed relative to,
  // `mode` is 'after' | 'before', and `partId` keeps it in the same Part /
  // Section group. Question numbers recompute from order, so the new card takes
  // the next printed number automatically. After insert we scroll to + briefly
  // highlight the fresh card so the teacher sees where it landed.
  const insertStandaloneAt = useCallback(function insertStandaloneAt({ anchorId = null, mode = 'after', partId = null } = {}) {
    const result = insertStandaloneSection(sectionsRef.current, { anchorId, mode, partId })
    setSections(result.sections)
    setDirty(true)
    // sectionsRef is a ref (always current) and scrollToQuestion only touches
    // the DOM, so an empty dep list is correct — the closure never goes stale.
    setTimeout(() => scrollToQuestion(result.insertedQuestionId), 60)
  }, [])

  const addPassageSectionHandler = useCallback(function addPassageSectionHandler() {
    setSections(currentSections => [...currentSections, createPassageSection()])
    setDirty(true)
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50)
  }, [])

  const addMapSectionHandler = useCallback(function addMapSectionHandler() {
    setSections(currentSections => [...currentSections, createPassageSection({ passageKind: 'map' })])
    setDirty(true)
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50)
  }, [])

  const uploadStandaloneQuestionImage = useCallback(async function uploadStandaloneQuestionImage(sectionIndex, file) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      show('Only JPG, PNG, and WEBP images are allowed.', true)
      return
    }
    try {
      // Declared type is the client's word — verify the real bytes (STOR-003).
      await assertFileSignature(file, ALLOWED_TYPES, { label: 'a JPG, PNG or WebP image' })
    } catch (err) {
      show(err.message, true)
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      show('Image must be under 15 MB.', true)
      return
    }

    // Capture the existing image so a failed upload can restore it instead of
    // silently dropping the diagram the teacher already had. We clear the
    // preview while uploading, but on error the old image must come back.
    const prevQuestion = sectionsRef.current?.[sectionIndex]?.question || {}
    const prevImageUrl = prevQuestion.imageUrl || ''
    const prevImageAssetId = prevQuestion.imageAssetId || ''
    // Resolve the section by stable id so reordering/deleting a section mid
    // upload can't strand its `imageUploading` flag on the wrong card.
    const sectionId = sectionsRef.current?.[sectionIndex]?.id

    updateSectionById(sectionId, section => ({
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
      const { ext, contentType } = uploadFormat(compressed)
      updateSectionById(sectionId, section => ({
        ...section,
        question: { ...section.question, imageUploadStep: 'uploading' },
      }))
      const path = `quiz-images/${currentUser.uid}/${Date.now()}-standalone-${sectionIndex}.${ext}`
      const snapshot = await uploadBytes(storageRef(storage, path), compressed, { contentType })
      const imageUrl = await getDownloadURL(snapshot.ref)
      updateSectionById(sectionId, section => ({
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
      updateSectionById(sectionId, section => ({
        ...section,
        question: {
          ...section.question,
          // Restore the prior image — a failed upload must not erase it.
          imageUrl: prevImageUrl,
          imageAssetId: prevImageAssetId,
          imageUploading: false,
          imageUploadStep: '',
        },
      }))
      show(uploadErrorMessage(error, appCheckStateSafe()), true)
    }
  }, [show, updateSectionById, currentUser])

  const removeStandaloneQuestionImage = useCallback(function removeStandaloneQuestionImage(sectionIndex) {
    updateSection(sectionIndex, section => ({
      ...section,
      question: {
        ...section.question,
        imageUrl: '',
        imageAssetId: '',
      },
    }))
  }, [updateSection])

  const uploadPassageImage = useCallback(async function uploadPassageImage(sectionIndex, file) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      show('Only JPG, PNG, and WEBP images are allowed.', true)
      return
    }
    try {
      // Declared type is the client's word — verify the real bytes (STOR-003).
      await assertFileSignature(file, ALLOWED_TYPES, { label: 'a JPG, PNG or WebP image' })
    } catch (err) {
      show(err.message, true)
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      show('Image must be under 15 MB.', true)
      return
    }

    // Preserve the existing passage image so a failed upload restores it
    // rather than dropping the diagram/map the teacher already attached.
    const prevPassageImageUrl = sectionsRef.current?.[sectionIndex]?.passage?.imageUrl || ''
    // Resolve by stable id so a mid-upload reorder/delete can't strand the flag.
    const sectionId = sectionsRef.current?.[sectionIndex]?.id

    updateSectionById(sectionId, section => ({
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
      updateSectionById(sectionId, section => ({
        ...section,
        passage: {
          ...section.passage,
          imageUploadStep: 'uploading',
        },
      }))
      const { ext, contentType } = uploadFormat(compressed)
      const path = `quiz-images/${currentUser.uid}/${Date.now()}-passage-${sectionIndex}.${ext}`
      const snapshot = await uploadBytes(storageRef(storage, path), compressed, { contentType })
      const imageUrl = await getDownloadURL(snapshot.ref)
      updateSectionById(sectionId, section => ({
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
      updateSectionById(sectionId, section => ({
        ...section,
        passage: {
          ...section.passage,
          // Restore the prior image — a failed upload must not erase it.
          imageUrl: prevPassageImageUrl,
          imageUploading: false,
          imageUploadStep: '',
        },
      }))
      show(uploadErrorMessage(error, appCheckStateSafe()), true)
    }
  }, [show, updateSectionById, currentUser])

  const removePassageImage = useCallback(function removePassageImage(sectionIndex) {
    updateSection(sectionIndex, section => ({
      ...section,
      passage: {
        ...section.passage,
        imageUrl: '',
      },
    }))
  }, [updateSection])

  function buildOptionMediaSlots(question) {
    const existing = Array.isArray(question.optionMedia) ? question.optionMedia : []
    const optionCount = Array.isArray(question.options) ? question.options.length : 0
    return Array.from({ length: optionCount }, (_, i) => existing[i] ?? null)
  }

  const uploadStandaloneOptionImage = useCallback(async function uploadStandaloneOptionImage(sectionIndex, optionIndex, file) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      show('Only JPG, PNG, and WEBP images are allowed.', true)
      return
    }
    try {
      // Declared type is the client's word — verify the real bytes (STOR-003).
      await assertFileSignature(file, ALLOWED_TYPES, { label: 'a JPG, PNG or WebP image' })
    } catch (err) {
      show(err.message, true)
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      show('Image must be under 15 MB.', true)
      return
    }

    // Resolve by stable id so a mid-upload reorder/delete can't strand the flag.
    const sectionId = sectionsRef.current?.[sectionIndex]?.id

    updateSectionById(sectionId, section => ({
      ...section,
      question: {
        ...section.question,
        optionImageUploadingIndex: optionIndex,
        optionImageUploadStep: 'compressing',
      },
    }))

    try {
      const compressed = await compressImage(file)
      const { ext, contentType } = uploadFormat(compressed)
      updateSectionById(sectionId, section => ({
        ...section,
        question: { ...section.question, optionImageUploadStep: 'uploading' },
      }))
      const path = `quiz-images/${currentUser.uid}/${Date.now()}-standalone-${sectionIndex}-opt-${optionIndex}.${ext}`
      const snapshot = await uploadBytes(storageRef(storage, path), compressed, { contentType })
      const imageUrl = await getDownloadURL(snapshot.ref)

      updateSectionById(sectionId, section => {
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
      updateSectionById(sectionId, section => ({
        ...section,
        question: {
          ...section.question,
          optionImageUploadingIndex: null,
          optionImageUploadStep: '',
        },
      }))
      show(uploadErrorMessage(error, appCheckStateSafe()), true)
    }
  }, [show, updateSectionById, currentUser])

  const removeStandaloneOptionImage = useCallback(function removeStandaloneOptionImage(sectionIndex, optionIndex) {
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
  }, [updateSection])

  const uploadPassageQuestionOptionImage = useCallback(async function uploadPassageQuestionOptionImage(sectionIndex, questionIndex, optionIndex, file) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      show('Only JPG, PNG, and WEBP images are allowed.', true)
      return
    }
    try {
      // Declared type is the client's word — verify the real bytes (STOR-003).
      await assertFileSignature(file, ALLOWED_TYPES, { label: 'a JPG, PNG or WebP image' })
    } catch (err) {
      show(err.message, true)
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      show('Image must be under 15 MB.', true)
      return
    }

    // Resolve the section by stable id so a mid-upload reorder/delete can't
    // strand the flag on the wrong passage (the question is still addressed by
    // its position within that passage).
    const sectionId = sectionsRef.current?.[sectionIndex]?.id
    const patchQuestion = (patch) =>
      updateSectionById(sectionId, section => ({
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
      const { ext, contentType } = uploadFormat(compressed)
      patchQuestion(() => ({ optionImageUploadStep: 'uploading' }))
      const path = `quiz-images/${currentUser.uid}/${Date.now()}-passage-${sectionIndex}-q-${questionIndex}-opt-${optionIndex}.${ext}`
      const snapshot = await uploadBytes(storageRef(storage, path), compressed, { contentType })
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
      show(uploadErrorMessage(error, appCheckStateSafe()), true)
    }
  }, [show, updateSectionById, currentUser])

  const removePassageQuestionOptionImage = useCallback(function removePassageQuestionOptionImage(sectionIndex, questionIndex, optionIndex) {
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
  }, [updateSection])

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
      // Prefer the grade the importer read. If it couldn't read one, keep the
      // quiz's existing grade only when it's already valid; otherwise clear it
      // so the save prompts for the real grade rather than a wrong default
      // riding through (the silent-mislabel path).
      grade: linkedToPaper
        ? current.grade
        : (imported.quiz.grade || (isSaveableGrade(current.grade) ? current.grade : '')),
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

    // An explicit import deliberately repopulates the editor, so the
    // "questions failed to load" guard no longer applies — the admin is
    // intentionally supplying fresh content to save. Unlock saving.
    setSuspectEmptyLoad(false)

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

  async function handleImportDocument(fileOrFiles, importOptions = {}) {
    const files = Array.isArray(fileOrFiles) ? fileOrFiles.filter(Boolean) : (fileOrFiles ? [fileOrFiles] : [])
    if (!files.length) return
    if (importingDocument) return

    // A name-only stand-in for summary/diff display when several pictures are
    // imported at once (the real Files are passed to the importer below).
    const file = files.length > 1
      ? { name: `${files[0].name} (+${files.length - 1} more)` }
      : files[0]

    setImportingDocument(true)
    setImportProgress(null)
    try {
      const imported = await importQuizDocument(files, {
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

    // Accumulate every assetId→Storage-URL the upload resolves so the caller can
    // rewrite the LIVE sections after save (see applyUploadedImageUrls) — without
    // this, the on-screen imported figures keep pointing at blob: URLs the save
    // revokes and render broken until a reload.
    const uploadedById = new Map()
    const uploadCtx = {
      storage,
      uid: currentUser?.uid,
      assets: importedAssets,
      sourceFileName: form.sourceFileName || '',
      onProgress,
      collect: uploadedById,
    }
    try {
      const questions = await uploadImportedQuestionImages(serialized.questions, uploadCtx)
      const passages = await uploadImportedPassageImages(serialized.passages, uploadCtx)
      // Defensive: any leftover blob: URL would persist to Firestore and
      // break for every learner on reload. Catch it here instead.
      assertNoBlobImageUrls(questions, passages)
      return { ...serialized, questions, passages, uploadedById }
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
    // No signed-in session → the write would throw on updatedBy/uid mid-flight.
    // Silently skip; the manual save surfaces a friendly prompt instead.
    if (!currentUser?.uid) return
    // The questions subcollection failed to load (empty view over a doc that
    // claims content). Saving now would persist that empty view and wipe the
    // real questions/passages. Never autosave in this state — the admin must
    // reload. See suspectEmptyLoad in the load effect.
    if (suspectEmptyLoad) return
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
    // No valid grade yet (scanned paper the importer couldn't grade) → the
    // write would be rejected. Skip QUIETLY with a gentle hint rather than
    // flashing a red "Auto-save failed" pill on every heartbeat; the manual
    // save gives the same, actionable message and the grade selector fixes it.
    if (!isSaveableGrade(form.grade)) {
      setAutoSaveState(AUTO_SAVE.IDLE)
      setAutoSaveError(GRADE_REQUIRED_MESSAGE)
      return
    }

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
    // Same protection as autosave: if the questions failed to load, an explicit
    // save would still overwrite the real questions/passages with the empty
    // view. Refuse and tell the admin to reload rather than lose the paper.
    if (suspectEmptyLoad) {
      show('This quiz\'s questions didn\'t load — reload the page before saving so you don\'t overwrite them.', true)
      return
    }
    // Pre-check sign-in: the save writes updatedBy/approvedBy and uploads
    // imported images (which throw "Please sign in…" mid-flight if the session
    // dropped). Fail fast with a friendly toast instead of a mid-save throw.
    if (!currentUser?.uid) {
      show('Your session has expired. Please sign in again before saving.', true)
      return
    }
    // Grade is required and must be one the platform supports (4–7). A scanned
    // paper whose grade the importer couldn't read arrives with an empty grade,
    // which the Firestore rule rejects with an opaque "Missing or insufficient
    // permissions". Surface the real, fixable reason instead — and point the
    // admin at the grade selector — for EVERY save mode (publish skips
    // validate(), so this guard lives here, before the mode branch).
    if (!isSaveableGrade(form.grade)) {
      show(GRADE_REQUIRED_MESSAGE, true)
      return
    }
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

      // Central Question Bank — capture finalized questions in the background
      // (no Share button). Only on publish/submit, not on every draft autosave,
      // so we don't flood the bank with near-identical work-in-progress rows.
      // Fire-and-forget: capture must never delay navigation or surface errors.
      if (mode !== 'draft') {
        captureQuestionsToBank(
          currentUser.uid,
          serializedSections.questions,
          { subject: form.subject, grade: form.grade },
          'quiz_studio',
        )
      }

      setQuizStatus(mode)
      setDeletedIds([])
      // Rewrite the LIVE sections' imported figures from their transient blob:
      // URLs to the uploaded Storage URLs BEFORE releasing the blobs below —
      // otherwise every imported figure on screen (and any that re-mounts, e.g.
      // the crop modal) points at a revoked blob and renders broken until the
      // navigate-away resolves. No-op when nothing was imported.
      if (serializedSections.uploadedById?.size) {
        setSections(prev => applyUploadedImageUrls(prev, serializedSections.uploadedById))
      }
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
    // Guard against persisting an empty-view over a quiz whose questions never
    // loaded (see suspectEmptyLoad). Publishing/unpublishing rewrites the
    // questions + passages too, so it would clobber the same way a save does.
    if (suspectEmptyLoad) {
      show('This quiz\'s questions didn\'t load — reload the page before changing its status.', true)
      return
    }
    const nextStatus = quizStatus === 'published' ? 'draft' : 'published'
    // Publishing writes the quiz doc through the same grade-gated schema as a
    // save, so an invalid grade (undetected scanned-import grade) would fail
    // the write. Surface the fixable reason up front instead — but ONLY when
    // publishing: unpublishing (taking content DOWN) must never be blocked by
    // a bad grade on a legacy doc.
    if (nextStatus === 'published' && !isSaveableGrade(form.grade)) {
      show(GRADE_REQUIRED_MESSAGE, true)
      return
    }
    setSaving(true)
    try {
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
          <Skeleton key={item} height={96} className="!rounded-2xl" />
        ))}
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="theme-text py-20 text-center">
        <div className="mb-3 text-5xl" aria-hidden="true">⚠️</div>
        <h2 className="text-display-xl theme-text mb-2">Couldn&apos;t open this quiz</h2>
        <p className="theme-text-muted text-body mb-5">
          Something went wrong loading it — this can happen with an older or
          partly-imported quiz. Your saved work is safe; try reloading.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => window.location.reload()} className="theme-accent-fill theme-on-accent rounded-xl px-6 py-2.5 text-sm font-black transition-all duration-fast ease-out shadow-elev-sm shadow-elev-inner-hl hover:-translate-y-px hover:shadow-elev-md">
            ↻ Reload
          </button>
          <button type="button" onClick={() => navigate(backPath)} className="theme-border theme-text rounded-xl border px-6 py-2.5 text-sm font-black">
            ← Back to Content
          </button>
        </div>
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

      {suspectEmptyLoad && (
        <div
          role="alert"
          className="mb-4 rounded-xl border-2 border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <strong className="block font-black">This quiz’s questions didn’t load.</strong>
          The editor is showing an empty view, but this paper still has questions and
          passages saved. Editing has been locked so an accidental save can’t overwrite
          them.{' '}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="font-bold underline underline-offset-2"
          >
            Reload the page
          </button>{' '}
          to try again. If it keeps happening, run{' '}
          <code className="rounded bg-red-100 px-1">scripts/repair-quiz-passages-and-counts.mjs</code>{' '}
          to repair the paper’s counts and restore its passages.
        </div>
      )}

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
                onSuggest={handleSuggestAnswers}
                suggesting={suggestingAnswers}
              />
            </div>
          </details>
          {/* Review panel (collapsible). Jump straight to questions that still
              need an answer, a flagged-extraction check, or alt text. */}
          <details className="theme-card theme-border overflow-hidden rounded-2xl border" open={reviewData.items.length > 0}>
            <summary className="flex cursor-pointer items-center justify-between gap-3 p-4">
              <span className="theme-text font-black">🔎 Needs review</span>
              <span className="theme-text-muted text-xs font-bold">
                {reviewData.items.length ? `${reviewData.items.length} to check` : 'All clear'}
              </span>
            </summary>
            <div className="border-t theme-border p-4">
              <ReviewPanel
                items={reviewData.items}
                total={reviewData.total}
                onJump={scrollToQuestion}
              />
            </div>
          </details>
          {/* Structural validation (collapsible) — the shared Document
              Understanding Engine's live checks over the whole quiz: printed
              numbering (missing/duplicate/out-of-order), incomplete MCQs,
              [UNCLEAR] spans, answer-key blocks. Opens itself when there is
              a hard blocker so a bad import can't be missed. */}
          <details
            className="theme-card theme-border overflow-hidden rounded-2xl border"
            open={engineValidation.blockers.length > 0}
          >
            <summary className="flex cursor-pointer items-center justify-between gap-3 p-4">
              <span className="theme-text font-black">📐 Structure check</span>
              <span className={`text-xs font-bold ${
                engineValidation.blockers.length
                  ? 'text-rose-700'
                  : engineValidation.items.length
                    ? 'text-amber-700'
                    : 'theme-text-muted'
              }`}>
                {engineValidation.blockers.length
                  ? `${engineValidation.blockers.length} blocker${engineValidation.blockers.length === 1 ? '' : 's'}`
                  : engineValidation.items.length
                    ? `${engineValidation.items.length} to check`
                    : 'All clear'}
              </span>
            </summary>
            <div className="border-t theme-border p-4">
              <StructuralValidationPanel
                result={engineValidation}
                onJump={scrollToQuestion}
              />
            </div>
          </details>
          <QuizSectionsEditor
            variant="edit"
            sections={sections}
            parts={parts}
            quizContext={quizContext}
            questionNumbers={questionNumbers}
            issueCountsByLocalId={issueCountsByLocalId}
            totalQuestions={questionCount}
            onStandaloneChange={updateStandaloneQuestion}
            onStandaloneRemove={removeStandaloneSection}
            onStandaloneMove={moveSection}
            onStandaloneImageUpload={uploadStandaloneQuestionImage}
            onStandaloneImageRemove={removeStandaloneQuestionImage}
            onStandaloneImageCrop={requestStandaloneImageCrop}
            onStandaloneCropFromPage={sourcePaperId ? requestStandaloneCropFromPage : undefined}
            onStandaloneOptionImageUpload={uploadStandaloneOptionImage}
            onStandaloneOptionImageRemove={removeStandaloneOptionImage}
            onPassageChange={updatePassage}
            onPassageToggle={togglePassage}
            onPassageRemove={removePassageSection}
            onPassageMove={moveSection}
            onPassageImageUpload={uploadPassageImage}
            onPassageImageRemove={removePassageImage}
            onPassageImageCrop={requestPassageImageCrop}
            onPassageCropFromPage={sourcePaperId ? requestPassageCropFromPage : undefined}
            onPassageQuestionChange={updatePassageQuestion}
            onPassageQuestionRemove={removePassageQuestion}
            onPassageQuestionMove={movePassageQuestion}
            onPassageQuestionOptionImageUpload={uploadPassageQuestionOptionImage}
            onPassageQuestionOptionImageRemove={removePassageQuestionOptionImage}
            onPassageAddQuestion={addPassageQuestion}
            onInsertStandalone={insertStandaloneAt}
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
            onMergeSections={mergeSelectedSections}
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
                const order = ['create', 'preview', 'publish']
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
                const order = ['create', 'preview', 'publish']
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

      {cropTarget && (
        <ImageCropModal
          // Remount on page navigation so the fresh page image loads with a
          // clean crop state (a stale loadFailed/rect never leaks across pages).
          key={cropTarget.imageUrl}
          imageUrl={cropTarget.imageUrl}
          onCropped={handleCroppedImage}
          onCancel={() => setCropTarget(null)}
          initialBox={
            // The AI-detected box only means anything on the page it was
            // reported for — never pre-select it on a different page.
            cropTarget.page == null ||
            cropTarget.page === (cropTarget.source?.figureMeta?.sourcePage ??
              (Number.isFinite(Number(cropTarget.source?.sourcePage)) ? Number(cropTarget.source.sourcePage) : null))
              ? cropTarget.source?.figureMeta?.box || null
              : null
          }
          pageNumber={
            cropTarget.page ??
            cropTarget.source?.figureMeta?.sourcePage ??
            (Number.isFinite(Number(cropTarget.source?.sourcePage)) ? Number(cropTarget.source.sourcePage) : null)
          }
          questionNumber={Number.isFinite(cropTarget.source?.sourceQuestionNumber) ? cropTarget.source.sourceQuestionNumber : null}
          onPrevPage={
            cropTarget.fromPaper && cropTarget.page > 1
              ? () => openSourcePageCrop(cropTarget.kind, cropTarget.sectionIndex, cropTarget.source, cropTarget.page - 1)
              : undefined
          }
          onNextPage={
            cropTarget.fromPaper && (cropTarget.pageCount == null || cropTarget.page < cropTarget.pageCount)
              ? () => openSourcePageCrop(cropTarget.kind, cropTarget.sectionIndex, cropTarget.source, cropTarget.page + 1)
              : undefined
          }
        />
      )}

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

      <ConfirmDialog
        open={pendingClearQuiz}
        title="Clear the whole quiz?"
        message={
          <ul className="list-disc pl-4 space-y-1">
            <li>The title, topic, and details reset to defaults.</li>
            <li>Every question is removed.</li>
            <li>Saved questions are deleted on the next save and this can't be undone.</li>
            <li>Navigate away without saving to discard the clear instead.</li>
          </ul>
        }
        confirmLabel="Clear quiz"
        variant="danger"
        onConfirm={performClearForm}
        onCancel={() => setPendingClearQuiz(false)}
      />
    </div>
  )
}
