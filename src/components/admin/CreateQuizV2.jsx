import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import {
  clearCreateQuizDraft,
  loadCreateQuizDraft,
  saveCreateQuizDraft,
} from '../../hooks/useCreateQuizDraft'
import { storage } from '../../firebase/config'
import { generateAIQuizQuestions } from '../../utils/aiAssistant'
import {
  createPartGroup,
  createPassageSection,
  createStandaloneSection,
  emptyPassageQuestion,
  getQuestionKey,
  hasOnlyEmptyStarterSection,
  serializeQuizSections,
  shuffleQuizSections,
} from '../../utils/quizSections.js'
import { richTextHasContent } from '../../utils/quizRichText.js'
import { clampInt } from '../../utils/inputs.js'
import { getErrorMessage } from '../../utils/errors.js'
import { validateStandaloneQuestion as sharedValidateStandaloneQuestion, collectQuizIssues } from '../../utils/quizValidation.js'
import { assertNoBlobImageUrls } from '../../utils/importedQuizAssets.js'
import QuizSectionsEditor from '../quiz/QuizSectionsEditor'
import QuizEditorPreviewPanel from '../quiz/QuizEditorPreviewPanel'
import QuizValidationChecklist from '../quiz/QuizValidationChecklist'
import SeoHelmet from '../seo/SeoHelmet'
import {
  QUIZ_DOCUMENT_ACCEPT,
  importQuizDocument,
  revokeImportedQuizAssets,
} from '../quiz/documentQuizImporter'

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
const TERMS = ['1', '2', '3']

const CREATION_MODES = [
  {
    id: 'manual',
    title: 'Create Manually',
    body: 'Write questions and answers yourself.',
    accent: 'theme-border theme-accent-bg theme-accent-text',
  },
  {
    id: 'import',
    title: 'Import Quiz (Word/PDF)',
    body: 'Upload .doc, .docx, or .pdf and convert it into editable questions.',
    accent: 'theme-border theme-accent-bg theme-accent-text',
  },
  {
    id: 'ai',
    title: 'Generate with Zed AI',
    body: 'Create starter questions from a topic, then edit before saving.',
    accent: 'theme-border theme-accent-bg theme-accent-text',
  },
]

const FIELD = 'theme-input w-full rounded-xl border-2 px-3 py-2.5 text-sm placeholder:text-gray-400 outline-none transition-colors focus:border-[var(--accent)]'
const SELECT = 'theme-input rounded-xl border-2 px-3 py-2.5 text-sm outline-none transition-colors focus:border-[var(--accent)]'
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function withCurrentOption(options, currentValue) {
  const normalized = String(currentValue ?? '').trim()
  if (!normalized || options.includes(normalized)) return options
  return [...options, normalized]
}

function safeStorageName(value, fallback = 'asset') {
  const cleaned = String(value || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned || fallback
}

function assetsById(assets = []) {
  return Object.fromEntries(assets.map(asset => [asset.id, asset]))
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
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0, width, height)
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

function buildStandaloneSection(question = {}) {
  const type = question.type ?? 'mcq'
  const isTextAnswer = type === 'short_answer' || type === 'diagram'

  return createStandaloneSection({
    ...question,
    sharedInstruction: question.sharedInstruction ?? '',
    text: question.text ?? '',
    options: isTextAnswer
      ? []
      : Array.isArray(question.options) && question.options.length
        ? question.options
        : ['', '', '', ''],
    correctAnswer: isTextAnswer
      ? String(question.correctAnswer ?? '')
      : question.correctAnswer ?? 0,
    explanation: question.explanation ?? '',
    topic: question.topic ?? '',
    marks: question.marks ?? 1,
    type,
    detectedType: question.detectedType ?? type,
    imageUrl: question.imageUrl ?? '',
    imageUploading: false,
    imageUploadStep: '',
    imageAssetId: question.imageAssetId ?? '',
    diagramText: question.diagramText ?? '',
    requiresReview: Boolean(question.requiresReview),
    reviewNotes: question.reviewNotes ?? [],
    importWarnings: question.importWarnings ?? [],
    sourcePage: question.sourcePage ?? null,
  })
}

function buildQuestionNumberMap(questions = []) {
  return Object.fromEntries(questions.map((question, index) => [getQuestionKey(question), index + 1]))
}

function countImages(sections = []) {
  return sections.reduce((total, section) => {
    if (section.kind === 'passage') {
      return total + (section.passage?.imageUrl ? 1 : 0)
    }
    return total + (section.question?.imageUrl ? 1 : 0)
  }, 0)
}

function hasUploadingAssets(sections = []) {
  return sections.some(section => {
    if (section.kind === 'passage') return section.passage?.imageUploading
    return section.question?.imageUploading
  })
}

function ImportQuizPanel({ importing, importSummary, onImport }) {
  const [inputKey, setInputKey] = useState(0)

  return (
    <div className="theme-accent-bg theme-border space-y-4 rounded-2xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="theme-text font-black">Import Quiz (Word/PDF)</h2>
          <p className="theme-text mt-1 max-w-3xl text-sm font-bold leading-relaxed">
            Upload a .doc, .docx, or .pdf file. ZedExams will extract questions, options, short answers, and image-based questions into editable cards, then use smart cleanup on tricky formatting when available.
          </p>
        </div>
        <label className="theme-accent-fill theme-on-accent cursor-pointer rounded-xl px-4 py-2.5 text-sm font-black">
          {importing ? 'Importing...' : 'Choose File'}
          <input
            key={inputKey}
            type="file"
            accept={QUIZ_DOCUMENT_ACCEPT}
            className="hidden"
            disabled={importing}
            onChange={event => {
              const file = event.target.files?.[0]
              if (file) onImport(file)
              setInputKey(current => current + 1)
            }}
          />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="theme-card theme-border rounded-xl border p-3">
          <p className="theme-accent-text text-xs font-black uppercase tracking-wide">Editable import</p>
          <p className="theme-text mt-1 text-xs font-bold leading-relaxed">The document is converted into editable quiz cards, not embedded as a static file.</p>
        </div>
        <div className="theme-card theme-border rounded-xl border p-3">
          <p className="theme-accent-text text-xs font-black uppercase tracking-wide">Images</p>
          <p className="theme-text mt-1 text-xs font-bold leading-relaxed">DOCX images and PDF snapshots attach to matching questions and upload when you save.</p>
        </div>
        <div className="theme-card theme-border rounded-xl border p-3">
          <p className="theme-accent-text text-xs font-black uppercase tracking-wide">Needs review</p>
          <p className="theme-text mt-1 text-xs font-bold leading-relaxed">Unclear answers, diagrams, and imperfect extraction are marked before publishing.</p>
        </div>
      </div>
      {importSummary && (
        <div className={`rounded-xl border px-4 py-3 ${
          importSummary.importStatus === 'needs_review'
            ? 'border-amber-200 bg-amber-50 text-amber-900'
            : 'theme-card theme-border theme-text'
        }`}>
          <p className="text-sm font-black">
            Imported {importSummary.questions} question{importSummary.questions === 1 ? '' : 's'} from {importSummary.fileName}
          </p>
          <p className="mt-1 text-xs font-bold leading-relaxed">
            {importSummary.smartApplied ? 'Smart cleanup applied · ' : ''}
            {importSummary.passages ? `${importSummary.passages} passage${importSummary.passages === 1 ? '' : 's'} detected · ` : ''}
            {importSummary.images} image-based question{importSummary.images === 1 ? '' : 's'} · {importSummary.needsReview} need review · Status: {importSummary.importStatus}
          </p>
          {importSummary.warnings?.length ? (
            <ul className="mt-2 space-y-0.5">
              {importSummary.warnings.slice(0, 3).map((warning, index) => (
                <li key={`${warning}-${index}`} className="text-xs font-bold leading-relaxed">{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  )
}

function CreationModeSelector({ activeMode, onSelect }) {
  return (
    <div className="theme-card theme-border rounded-2xl border p-4 shadow-sm">
      <p className="theme-text-muted text-xs font-black uppercase tracking-wide">Choose how to create this quiz</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {CREATION_MODES.map(mode => {
          const active = activeMode === mode.id
          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => onSelect(mode.id)}
              className={`min-h-0 rounded-xl border-2 p-4 text-left shadow-none transition-all ${
                active ? mode.accent : 'theme-border theme-bg-subtle theme-text hover:border-[var(--accent)]'
              }`}
            >
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-black ${
                active ? 'bg-white/80' : 'theme-card theme-text-muted'
              }`}>
                {active ? 'Selected' : 'Option'}
              </span>
              <h2 className="mt-2 text-sm font-black">{mode.title}</h2>
              <p className="mt-1 text-xs font-bold leading-relaxed opacity-80">{mode.body}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function CreateQuizV2() {
  const { createQuiz, saveQuestions } = useFirestore()
  const { currentUser, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedMode = searchParams.get('mode')

  const [creationMode, setCreationMode] = useState(
    CREATION_MODES.some(mode => mode.id === requestedMode) ? requestedMode : 'manual',
  )

  // Optional deep-link prefill — used by the Notes Studio "Create quiz from
  // these notes" button so the new quiz inherits the note's metadata. Falls
  // back to the historical defaults when a param is missing.
  const prefillTitle   = searchParams.get('title')   || ''
  const prefillSubject = searchParams.get('subject') || 'Mathematics'
  const prefillGrade   = searchParams.get('grade')   || '5'
  const prefillTopic   = searchParams.get('topic')   || ''

  const [form, setForm] = useState({
    title: prefillTitle,
    subject: prefillSubject,
    grade: prefillGrade,
    term: '1',
    duration: 30,
    type: 'quiz',
    topic: prefillTopic,
    // When true, this quiz is visible to learners on Demo Access (free tier).
    // When false (default), it's premium/full-access only. Admins flip this
    // here during creation, and can still toggle it later in EditQuizV2.
    isDemo: false,
    mode: '',
    importStatus: '',
    sourceFileName: '',
    sourceContentType: '',
    importWarnings: [],
  })
  const [sections, setSections] = useState([createStandaloneSection()])
  const [parts, setParts] = useState([])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [aiForm, setAiForm] = useState({ topic: '', count: 5, type: 'mcq' })
  const [aiGenerating, setAiGenerating] = useState(false)
  const [importingDocument, setImportingDocument] = useState(false)
  const [importSummary, setImportSummary] = useState(null)
  const [importedAssets, setImportedAssets] = useState({})

  // Pre-publish checklist: same `collectQuizIssues` source of truth that
  // EditQuizV2 wires up. Lives here so the create flow gets identical
  // inline issue badges + auto-open behaviour as the edit flow — see
  // PRs #657 / #659 for the original wiring on the edit side.
  const [checklistOpen, setChecklistOpen] = useState(false)
  const checklistAutoOpenedRef = useRef(false)

  const serializedPreview = serializeQuizSections(sections, parts)
  const questionNumbers = buildQuestionNumberMap(serializedPreview.questions)
  const questionCount = serializedPreview.questionCount
  const totalMarks = serializedPreview.totalMarks
  const passageCount = serializedPreview.passages.length
  const imagesCount = countImages(sections)

  const validationResult = useMemo(
    () => collectQuizIssues({ form, sections, parts, questionNumbers }),
    [form, sections, parts, questionNumbers],
  )
  const validationIssues = validationResult.issues
  const validationSummary = validationResult.summary
  const errorCount = validationIssues.filter((i) => i.severity !== 'warn').length

  // Per-question issue counts keyed by question.localId. Drives the
  // small "N to fix" badge in each question card header.
  const issueCountsByLocalId = useMemo(() => {
    const map = new Map()
    for (const issue of validationIssues) {
      if (issue.severity === 'warn') continue
      if (!issue.localId) continue
      map.set(issue.localId, (map.get(issue.localId) || 0) + 1)
    }
    return map
  }, [validationIssues])

  // Auto-open the checklist ONCE on import when a freshly-imported
  // document still has issues — matches the edit-flow behaviour from
  // PR #657 so importing a past paper into a new quiz surfaces the
  // fixes-needed list without the teacher having to remember to click
  // the pill at the bottom of the page.
  useEffect(() => {
    if (checklistAutoOpenedRef.current) return
    const isFreshImport = form.importStatus === 'needs_review' && form.mode === 'imported_document'
    if (!isFreshImport) return
    if (errorCount === 0) return
    checklistAutoOpenedRef.current = true
    setChecklistOpen(true)
  }, [form.importStatus, form.mode, errorCount])
  const anyUploading = hasUploadingAssets(sections) || importingDocument
  const gradeOptions = withCurrentOption(GRADES, form.grade)
  const subjectOptions = withCurrentOption(SUBJECTS, form.subject)
  const termOptions = withCurrentOption(TERMS, form.term)

  useEffect(() => () => revokeImportedQuizAssets(importedAssets), [importedAssets])

  // Draft auto-save: restore any previously typed work on mount so a page
  // refresh no longer wipes the editor clean.
  const draftRestoredRef = useRef(false)
  useEffect(() => {
    if (draftRestoredRef.current) return
    if (!currentUser?.uid) return
    draftRestoredRef.current = true

    const draft = loadCreateQuizDraft(currentUser.uid)
    if (!draft) return
    // Only restore into a pristine editor so we never clobber state that
    // the component has already populated (e.g. a fresh AI/import flow).
    if (!hasOnlyEmptyStarterSection(sections)) return

    if (draft.form) setForm(current => ({ ...current, ...draft.form }))
    if (Array.isArray(draft.sections) && draft.sections.length) {
      setSections(draft.sections)
    }
    if (Array.isArray(draft.parts)) {
      setParts(draft.parts)
    }
    if (draft.creationMode) setCreationMode(draft.creationMode)
    show('Restored your unsaved draft.')
    // Intentional: this effect should only fire once per mount per user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid])

  // Debounced write-through so typing stays cheap.
  useEffect(() => {
    if (!currentUser?.uid) return
    if (!draftRestoredRef.current) return
    if (hasOnlyEmptyStarterSection(sections) && !form.title.trim()) {
      // Nothing worth saving yet.
      return
    }
    const timer = setTimeout(() => {
      saveCreateQuizDraft(currentUser.uid, { form, sections, parts, creationMode })
    }, 800)
    return () => clearTimeout(timer)
  }, [form, sections, parts, creationMode, currentUser?.uid])

  function setF(field, value) {
    setForm(current => ({ ...current, [field]: value }))
  }

  function setAi(field, value) {
    setAiForm(current => ({ ...current, [field]: value }))
  }

  function show(message, isErr = false) {
    setToast({ message, isErr })
    setTimeout(() => setToast(null), 3500)
  }

  function scrollToBottom() {
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50)
  }

  // Escape hatch for "I refreshed and a draft I didn't want got restored":
  // wipe the editor back to a blank slate AND drop the auto-saved draft.
  // Clearing React state alone is not enough — the debounced auto-save would
  // just rewrite the draft on the next keystroke — so we also remove the
  // localStorage draft via clearCreateQuizDraft. The reset state is the same
  // empty starter the editor mounts with, so the post-clear auto-save bails
  // out early (nothing worth saving) and the cleared draft stays cleared.
  function clearAll() {
    const hasWork = !hasOnlyEmptyStarterSection(sections) || form.title.trim()
    if (
      hasWork &&
      !window.confirm(
        'Clear everything and start over? This wipes the current questions, quiz details, and any auto-saved draft. This cannot be undone.',
      )
    ) {
      return
    }
    revokeImportedQuizAssets(importedAssets)
    setForm({
      title: '',
      subject: prefillSubject,
      grade: prefillGrade,
      term: '1',
      duration: 30,
      type: 'quiz',
      topic: '',
      isDemo: false,
      mode: '',
      importStatus: '',
      sourceFileName: '',
      sourceContentType: '',
      importWarnings: [],
    })
    setSections([createStandaloneSection()])
    setParts([])
    setImportedAssets({})
    setImportSummary(null)
    setChecklistOpen(false)
    checklistAutoOpenedRef.current = false
    clearCreateQuizDraft(currentUser?.uid)
    show('Cleared. Starting fresh.')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function chooseCreationMode(mode) {
    setCreationMode(mode)
    const nextParams = new URLSearchParams(searchParams)
    if (mode === 'manual') nextParams.delete('mode')
    else nextParams.set('mode', mode)
    setSearchParams(nextParams, { replace: true })
  }

  function updateSection(sectionIndex, updater) {
    setSections(currentSections => currentSections.map((section, index) => (
      index === sectionIndex ? updater(section) : section
    )))
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

  function moveSection(sectionIndex, direction) {
    setSections(currentSections => {
      const nextSections = [...currentSections]
      const targetIndex = sectionIndex + direction
      if (targetIndex < 0 || targetIndex >= nextSections.length) return nextSections
      ;[nextSections[sectionIndex], nextSections[targetIndex]] = [nextSections[targetIndex], nextSections[sectionIndex]]
      return nextSections
    })
  }

  function handleShuffleSections() {
    setSections(currentSections => shuffleQuizSections(currentSections))
  }

  // ── Parts (PRISCA mock-paper section groups) ─────────────────────
  function addPart() {
    setParts(currentParts => [
      ...currentParts,
      createPartGroup({ order: currentParts.length, title: '' }),
    ])
  }

  function updatePart(partId, field, value) {
    setParts(currentParts => currentParts.map(part => (
      part.id === partId ? { ...part, [field]: value } : part
    )))
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
  }

  function removePart(partId) {
    setParts(currentParts => currentParts
      .filter(part => part.id !== partId)
      .map((part, i) => ({ ...part, order: i })))
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
  }

  function removeStandaloneSection(sectionIndex) {
    setSections(currentSections => currentSections.filter((_, index) => index !== sectionIndex))
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
    setSections(currentSections => currentSections.filter((_, index) => index !== sectionIndex))
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
    scrollToBottom()
  }

  function addPassageSectionHandler() {
    const nextSection = createPassageSection()
    setSections(currentSections => hasOnlyEmptyStarterSection(currentSections)
      ? [nextSection]
      : [...currentSections, nextSection])
    scrollToBottom()
  }

  function addMapSectionHandler() {
    const nextSection = createPassageSection({ passageKind: 'map' })
    setSections(currentSections => hasOnlyEmptyStarterSection(currentSections)
      ? [nextSection]
      : [...currentSections, nextSection])
    scrollToBottom()
  }

  async function handleGenerateQuestions() {
    const topic = aiForm.topic.trim()
    if (!topic) {
      show('Add a topic for Zed to generate questions.', true)
      return
    }

    setAiGenerating(true)
    try {
      // generateAIQuizQuestions now returns { questions, warning }. The
      // warning is populated when the requested topic wasn't in the verified
      // CBC knowledge base and the generator fell back to general CBC
      // knowledge — we surface it to the teacher so they can double-check
      // or pick a nearby verified topic next time.
      const { questions: generated, warning: kbWarning } = await generateAIQuizQuestions({
        subject: form.subject,
        grade: form.grade,
        topic,
        count: aiForm.count,
        type: aiForm.type,
      })

      // Keep only AI questions that actually have text and usable options/answer.
      const generatedList = Array.isArray(generated) ? generated : []
      const usableGenerated = generatedList.filter(question => {
        if (!richTextHasContent(question?.text ?? '')) return false
        const t = question?.type || 'mcq'
        if (t === 'short_answer' || t === 'diagram') {
          return String(question?.correctAnswer ?? '').trim().length > 0
        }
        const opts = Array.isArray(question?.options) ? question.options.filter(o => String(o ?? '').trim()) : []
        return opts.length >= 2
      })

      const nextSections = usableGenerated.map(question => buildStandaloneSection({
        ...question,
        options: question.options?.length ? question.options : ['', '', '', ''],
      }))

      if (!nextSections.length) {
        show('Zed could not generate questions. Please try again.', true)
        return
      }
      if (nextSections.length < generatedList.length) {
        const skipped = generatedList.length - nextSections.length
        show(`Zed returned ${skipped} incomplete question${skipped === 1 ? '' : 's'}; ${nextSections.length} kept. Review before saving.`)
      }

      setSections(currentSections => hasOnlyEmptyStarterSection(currentSections)
        ? nextSections
        : [...currentSections, ...nextSections])

      if (!form.title.trim()) {
        setF('title', `Grade ${form.grade} ${form.subject} - ${topic}`)
      }

      const usedFastDraft = nextSections.some(section => section.question.generatedBy === 'fast_draft')
      show(usedFastDraft
        ? `Added ${nextSections.length} quick draft question${nextSections.length === 1 ? '' : 's'}. Review before saving.`
        : `Added ${nextSections.length} AI-generated question${nextSections.length === 1 ? '' : 's'}. Review before saving.`)

      // Surface KB warning as a separate, non-blocking notice so teachers
      // see both "questions added" and "topic wasn't in the verified list".
      if (kbWarning) {
        // Small delay so the success toast lands first and the warning
        // doesn't immediately replace it.
        setTimeout(() => show(kbWarning, false), 600)
      }
    } catch (error) {
      show(getErrorMessage(error, 'AI generation failed. Please try again.'), true)
    } finally {
      setAiGenerating(false)
    }
  }

  async function handleImportDocument(file) {
    const hasExistingWork = !hasOnlyEmptyStarterSection(sections)
    if (hasExistingWork && !window.confirm('Replace the current questions with questions extracted from this document?')) {
      return
    }

    setImportingDocument(true)
    try {
      const imported = await importQuizDocument(file)
      setImportedAssets(assetsById(imported.imageAssets))
      setForm(current => ({
        ...current,
        title: current.title.trim() && hasExistingWork ? current.title : imported.quiz.title,
        // Topic is intentionally left untouched on import — imported papers
        // span many CBC topics; the teacher should keep their own value or
        // leave the field blank rather than have the title stamped in.
        grade: imported.quiz.grade || current.grade,
        subject: imported.quiz.subject || current.subject,
        mode: 'imported_document',
        importStatus: imported.importStatus,
        sourceFileName: imported.quiz.sourceFileName,
        sourceContentType: imported.quiz.sourceContentType,
        importWarnings: imported.warnings,
      }))
      setSections(imported.sections?.length
        ? imported.sections
        : imported.questions.map(question => buildStandaloneSection(question)))
      // Imported PRISCA / ECZ papers can carry SECTION A / PART B headings —
      // surface them as Parts so questions land inside the right group.
      setParts(Array.isArray(imported.parts) ? imported.parts : [])
      setImportSummary({
        ...imported.summary,
        fileName: file.name,
        importStatus: imported.importStatus,
        smartApplied: imported.smartApplied,
        warnings: imported.warnings,
      })
      const importedCount = (imported.sections?.length || imported.questions?.length || 0)
      if (importedCount === 0) {
        show('No questions could be extracted from this document. Check the file or try a different format.', true)
        return
      }
      show(imported.importStatus === 'needs_review'
        ? imported.smartApplied
          ? 'Document imported with smart cleanup. Review flagged questions before publishing.'
          : 'Document imported. Review passages and marked questions before publishing.'
        : imported.smartApplied
          ? 'Document imported with smart cleanup into editable quiz sections.'
          : 'Document imported into editable quiz sections.')
      setTimeout(() => window.scrollTo({ top: document.body.scrollHeight / 3, behavior: 'smooth' }), 80)
    } catch (error) {
      console.error(error)
      show(`Import failed: ${error.message || 'Could not read this document.'}`, true)
    } finally {
      setImportingDocument(false)
    }
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
      show(`Image ready (${Math.round(compressed.size / 1024)} KB)`)
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
      show(`Passage image ready (${Math.round(compressed.size / 1024)} KB)`)
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

  // Build an optionMedia array of the right length (matching options[]), reading
  // the question's existing media so we can patch a single slot without dropping
  // sibling slots.
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
      updateSection(sectionIndex, section => ({
        ...section,
        question: {
          ...section.question,
          optionImageUploadStep: 'uploading',
        },
      }))
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
      show(`Option image ready (${Math.round(compressed.size / 1024)} KB)`)
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
        // Passage questions always have 4 options (the editor renders A-D); if
        // options is empty pad to length 4 so the new entry has a home.
        while (next.length < 4) next.push(null)
        const prevAlt = next[optionIndex]?.alt ?? ''
        next[optionIndex] = { imageUrl, alt: prevAlt }
        return {
          optionMedia: next,
          optionImageUploadingIndex: null,
          optionImageUploadStep: '',
        }
      })
      show(`Option image ready (${Math.round(compressed.size / 1024)} KB)`)
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

  // Uploads in-memory imported image blobs (produced by documentQuizImporter)
  // to Firebase Storage and returns a Map<assetId, downloadUrl>. The kindSlug
  // (e.g. "question", "passage", "option") is interpolated into the filename
  // so we can distinguish where each upload originated when auditing Storage.
  async function uploadImportedAssets(assetIds, kindSlug) {
    const uploadedById = new Map()
    if (!assetIds.length) return uploadedById
    if (!currentUser?.uid) throw new Error('Please sign in before saving imported quiz images.')

    const uploadedRefs = []
    try {
      for (const assetId of assetIds) {
        const asset = importedAssets[assetId]
        if (!asset?.blob) {
          throw new Error('An imported image is no longer available. Please re-import the document.')
        }

        const sourceFile = new File([asset.blob], asset.fileName || `${assetId}.jpg`, {
          type: asset.contentType || 'image/jpeg',
        })
        const uploadBlob = await compressImage(sourceFile)
        const fileName = `${Date.now()}-${kindSlug}-${safeStorageName(assetId)}.jpg`
        const path = `quiz-images/${currentUser.uid}/imports/${fileName}`
        const ref = storageRef(storage, path)
        const snapshot = await uploadBytes(ref, uploadBlob, {
          contentType: 'image/jpeg',
          customMetadata: {
            sourceFileName: form.sourceFileName || '',
            sourcePath: asset.sourcePath || '',
          },
        })
        uploadedRefs.push(snapshot.ref)
        uploadedById.set(assetId, await getDownloadURL(snapshot.ref))
      }
    } catch (error) {
      // Clean up any already-uploaded blobs so they don't orphan in Storage
      // if one of the later uploads fails.
      const { deleteObject } = await import('firebase/storage')
      await Promise.all(uploadedRefs.map(ref =>
        deleteObject(ref).catch(cleanupError => console.warn('Orphaned upload cleanup failed:', cleanupError))
      ))
      throw error
    }

    return uploadedById
  }

  // Resolve every imageAssetId on the question records to a Storage URL and
  // strip the asset id (it's transient — only meaningful while we hold the
  // matching Blob in memory). Phase 3 extends this to also walk each
  // question's optionMedia[] so per-option imports survive the save.
  async function uploadImportedQuestionImages(questionsToSave) {
    const assetIds = new Set()
    questionsToSave.forEach(question => {
      if (question.imageAssetId) assetIds.add(question.imageAssetId)
      if (Array.isArray(question.optionMedia)) {
        question.optionMedia.forEach(slot => {
          if (slot && typeof slot === 'object' && slot.imageAssetId) {
            assetIds.add(slot.imageAssetId)
          }
        })
      }
    })
    const uploadedById = await uploadImportedAssets(Array.from(assetIds), 'question')
    if (!uploadedById.size) return questionsToSave

    return questionsToSave.map(question => {
      const next = { ...question }
      const stemUrl = uploadedById.get(question.imageAssetId)
      if (stemUrl) {
        next.imageUrl = stemUrl
        next.imageAssetId = ''
      }
      if (Array.isArray(question.optionMedia)) {
        next.optionMedia = question.optionMedia.map(slot => {
          if (!slot || typeof slot !== 'object') return slot
          const url = slot.imageAssetId ? uploadedById.get(slot.imageAssetId) : null
          if (!url) return slot
          const { imageAssetId: _unused, ...rest } = slot
          return { ...rest, imageUrl: url }
        })
      }
      return next
    })
  }

  // Same shape as uploadImportedQuestionImages, but for the parallel
  // passages[] list. Without this, a passage diagram extracted by the
  // importer would persist as a dead blob: URL after save.
  async function uploadImportedPassageImages(passagesToSave) {
    const assetIds = Array.from(new Set(passagesToSave.map(passage => passage.imageAssetId).filter(Boolean)))
    const uploadedById = await uploadImportedAssets(assetIds, 'passage')
    if (!uploadedById.size) return passagesToSave

    return passagesToSave.map(passage => {
      const uploadedUrl = uploadedById.get(passage.imageAssetId)
      if (!uploadedUrl) return passage
      return {
        ...passage,
        imageUrl: uploadedUrl,
        imageAssetId: '',
      }
    })
  }

  function validateStandaloneQuestion(question, label) {
    return sharedValidateStandaloneQuestion(question, label, {
      onError: message => show(message, true),
    })
  }

  function validate() {
    if (!form.title.trim()) {
      show('Please enter a quiz title.', true)
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

  async function handleSave({ publish = false, submit = false } = {}) {
    if (!validate()) return
    setSaving(true)

    try {
      const serializedSections = serializeQuizSections(sections, parts)
      const questionsForSave = await uploadImportedQuestionImages(serializedSections.questions)
      const passagesForSave = await uploadImportedPassageImages(serializedSections.passages)
      // Defensive: any blob: URL slipping through here would persist into
      // Firestore and break for every learner on reload. Catch it before
      // we write — the user re-imports rather than ending up with a broken
      // quiz.
      assertNoBlobImageUrls(questionsForSave, passagesForSave)
      const totalMarksForSave = questionsForSave.reduce((sum, question) => sum + (question.marks || 1), 0)
      // Phase 10: fresh count of questions still flagged for review. Persisted
      // so the badge / chip / banner stay truthful as teachers fix flagged
      // questions one by one — the older boolean importStatus was a snapshot
      // taken at first save and never updated.
      const reviewCountForSave = form.mode === 'imported_document'
        ? questionsForSave.filter(question => question.requiresReview).length
        : 0
      const status = publish ? 'published' : submit ? 'pending' : 'draft'

      const quizId = await createQuiz({
        ...form,
        passages: passagesForSave,
        parts: serializedSections.parts,
        passageCount: passagesForSave.length,
        totalMarks: totalMarksForSave,
        questionCount: questionsForSave.length,
        reviewCount: reviewCountForSave,
        importStatus: form.mode === 'imported_document'
          ? (questionsForSave.some(question => question.requiresReview) ? 'needs_review' : (form.importStatus || 'success'))
          : form.importStatus,
        isPublished: publish,
        status,
        createdBy: currentUser.uid,
        ...(submit && { submittedAt: new Date() }),
      })

      await saveQuestions(quizId, questionsForSave)
      setImportedAssets({})
      clearCreateQuizDraft(currentUser.uid)

      show(publish ? 'Quiz published!' : submit ? 'Submitted for approval!' : 'Saved as draft!')
      // CreateQuizV2 is admin-only now (the teacher-side quiz creator was
      // replaced by the Assessment Studio). Always return to admin content.
      const returnPath = '/admin/content'
      setTimeout(() => navigate(returnPath), 1200)
    } catch (error) {
      console.error(error)
      show(`Failed to save: ${getErrorMessage(error, 'unexpected error')}`, true)
      setSaving(false)
    }
  }

  return (
    <div className="theme-text space-y-5">
      <SeoHelmet title="Create quiz" noIndex />
      {toast && (
        <div className={`fixed right-4 top-4 z-50 max-w-xs rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-lg ${
          toast.isErr ? 'bg-red-600' : 'theme-accent-fill theme-on-accent'
        }`}>
          {toast.message}
        </div>
      )}

      {/* Page header — brand on the left, back link on the right */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2.5 no-underline" style={{ color: '#0e2a32' }}>
          <span style={{ fontSize: 22 }}>✏️</span>
          <div className="leading-tight">
            <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 16, margin: 0, color: '#0e2a32' }}>
              ZedExams <span style={{ color: '#ff7a2e' }}>•</span>
            </p>
            <p style={{ fontSize: 11.5, color: '#566f76', margin: 0, fontWeight: 600 }}>
              Quiz Creator
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={clearAll}
            className="rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-100"
            title="Wipe the editor and delete any auto-saved draft"
          >
            🗑 Clear all
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="btn-secondary font-bold"
          >
            ← Back
          </button>
        </div>
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
            ✨ New quiz
          </span>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 36, lineHeight: 1.05, margin: '0 0 8px', letterSpacing: '-.3px' }}>
            Build your quiz
          </h1>
          <p style={{ fontSize: 14.5, opacity: .88, marginBottom: 16, maxWidth: 520, lineHeight: 1.55 }}>
            Create standalone questions or comprehension passages, then publish directly or save as a draft.
          </p>
          <div className="flex gap-4 flex-wrap" style={{ fontSize: 13, opacity: .78, fontWeight: 500 }}>
            <span>📝 Standalone questions</span>
            <span>📖 Comprehension passages</span>
            <span>🤖 AI generation</span>
          </div>
        </div>
        <div
          className="flex-shrink-0 hidden sm:grid place-items-center"
          style={{ width: 130, height: 130, borderRadius: '50%', background: '#fff', fontSize: 60, boxShadow: '0 8px 28px rgba(0,0,0,.25)' }}
        >
          ✏️
        </div>
      </div>

      <CreationModeSelector activeMode={creationMode} onSelect={chooseCreationMode} />

      {creationMode === 'import' && (
        <ImportQuizPanel
          importing={importingDocument}
          importSummary={importSummary}
          onImport={handleImportDocument}
        />
      )}

      <div className="theme-card theme-border space-y-3 rounded-2xl border p-5 shadow-elev-sm">
        <h2 className="text-display-md theme-text" style={{ fontSize: 17 }}>Quiz details</h2>
        <input
          value={form.title}
          onChange={event => setF('title', event.target.value)}
          placeholder="Quiz title (e.g. Grade 5 Mathematics - Fractions Test)"
          className={FIELD}
        />
        <div className="grid gap-3 sm:grid-cols-4">
          <select value={form.grade} onChange={event => setF('grade', event.target.value)} className={SELECT}>
            {gradeOptions.map(grade => <option key={grade} value={grade}>Grade {grade}</option>)}
          </select>
          <select value={form.subject} onChange={event => setF('subject', event.target.value)} className={SELECT}>
            {subjectOptions.map(subject => <option key={subject} value={subject}>{subject}</option>)}
          </select>
          <select value={form.term} onChange={event => setF('term', event.target.value)} className={SELECT}>
            {termOptions.map(term => <option key={term} value={term}>Term {term}</option>)}
          </select>
          <div className="theme-border flex items-center gap-2 rounded-xl border-2 px-3 py-2.5">
            <span className="theme-text-muted whitespace-nowrap text-xs font-bold">⏱️ Mins</span>
            <input
              type="number"
              min={5}
              max={180}
              value={form.duration}
              onChange={event => setF('duration', clampInt(event.target.value, 5, 180, 30))}
              className="flex-1 bg-transparent text-sm font-black outline-none"
            />
          </div>
        </div>
        {/*
          Access toggle. "Demo" means the quiz is visible to learners on the
          free/Demo Access tier; when off, the quiz is premium-only. The same
          toggle exists in EditQuizV2 — setting it here just saves a round
          trip through Edit after creation.
        */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <label className="flex cursor-pointer select-none items-center gap-2" title="Demo quizzes are visible to learners on free/Demo Access. Leave off for premium-only quizzes.">
            <span className="theme-text-muted text-xs font-black">Mark as Demo</span>
            <button type="button" onClick={() => setF('isDemo', !form.isDemo)} className={`relative h-5 w-10 min-h-0 rounded-full p-0 shadow-none transition-colors ${form.isDemo ? 'theme-accent-fill' : 'theme-border theme-bg-subtle border'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${form.isDemo ? 'left-5' : 'left-0.5'}`} />
            </button>
            {form.isDemo && <span className="theme-accent-bg theme-accent-text rounded-full px-2 py-0.5 text-xs font-black">Demo · free-tier visible</span>}
          </label>
        </div>
        <div className="theme-text-muted flex flex-wrap gap-2 pt-1 text-xs">
          <span className="theme-bg-subtle rounded-full px-2 py-1 font-bold">{questionCount} questions</span>
          <span className="theme-bg-subtle rounded-full px-2 py-1 font-bold">{totalMarks} marks total</span>
          {passageCount > 0 && <span className="theme-accent-bg theme-accent-text rounded-full px-2 py-1 font-bold">{passageCount} passage{passageCount === 1 ? '' : 's'}</span>}
          {imagesCount > 0 && <span className="theme-accent-bg theme-accent-text rounded-full px-2 py-1 font-bold">🖼️ {imagesCount} image{imagesCount === 1 ? '' : 's'}</span>}
          {form.mode === 'imported_document' && (
            <span className={`rounded-full px-2 py-1 font-bold ${
              form.importStatus === 'needs_review' ? 'bg-amber-100 text-amber-700' : 'theme-accent-bg theme-accent-text'
            }`}>
              Imported document · {form.importStatus || 'success'}
            </span>
          )}
        </div>
      </div>

      {creationMode === 'ai' && (
        <div className="theme-accent-bg theme-border space-y-3 rounded-2xl border p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="theme-text font-black">✦ AI Quiz Generator</h2>
              <p className="theme-text mt-0.5 text-sm">Generate draft multiple-choice questions, then edit them below before saving.</p>
            </div>
            <span className="theme-card theme-border theme-accent-text hidden rounded-full border px-3 py-1 text-xs font-black sm:inline-flex">Teacher tool</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-5">
            <select value={form.grade} onChange={event => setF('grade', event.target.value)} className={SELECT}>
              {gradeOptions.map(grade => <option key={grade} value={grade}>Grade {grade}</option>)}
            </select>
            <select value={form.subject} onChange={event => setF('subject', event.target.value)} className={SELECT}>
              {subjectOptions.map(subject => <option key={subject} value={subject}>{subject}</option>)}
            </select>
            <input
              value={aiForm.topic}
              onChange={event => setAi('topic', event.target.value)}
              placeholder="Topic, e.g. Fractions"
              className="theme-input col-span-2 rounded-xl border-2 px-3 py-2.5 text-sm placeholder:text-gray-400 outline-none focus:border-[var(--accent)] lg:col-span-1"
            />
            <input
              type="number"
              min={1}
              max={10}
              value={aiForm.count}
              onChange={event => setAi('count', clampInt(event.target.value, 1, 10, 1))}
              className="theme-input rounded-xl border-2 px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
              aria-label="Number of questions"
            />
            <select value={aiForm.type} onChange={event => setAi('type', event.target.value)} className={SELECT}>
              <option value="mcq">Multiple choice</option>
            </select>
          </div>
          <button type="button" onClick={handleGenerateQuestions} disabled={aiGenerating || saving} className="theme-accent-fill theme-on-accent w-full rounded-xl px-5 py-3 font-black transition-all duration-fast ease-out shadow-elev-sm shadow-elev-inner-hl hover:-translate-y-px hover:shadow-elev-md disabled:opacity-60 disabled:pointer-events-none sm:w-auto">
            {aiGenerating ? '✦ Generating…' : '✦ Generate questions'}
          </button>
        </div>
      )}

      <QuizSectionsEditor
        variant="create"
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
      />

      <QuizEditorPreviewPanel form={form} serializedSections={serializedPreview} />

      <div className="theme-accent-bg theme-border theme-accent-text flex items-start gap-2 rounded-2xl border px-4 py-3 text-xs">
        <span className="flex-shrink-0 text-base">ℹ️</span>
        <span>Question and passage images upload to Firebase Storage as soon as you select them. Comprehension passages are stored separately on the quiz and linked to their questions when you save.</span>
      </div>

      {/* Pre-publish checklist pill. Mirrors the edit-flow pill from
          QuizEditorActionBar so the create flow surfaces the same
          fix-it-before-publish signal without dragging the full action
          bar into Create (which has its own large Save/Publish buttons
          below). */}
      {errorCount > 0 && (
        <button
          type="button"
          onClick={() => setChecklistOpen(true)}
          className="inline-flex items-center gap-2 self-start rounded-full bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100"
          aria-label={`Show ${errorCount} validation issue${errorCount === 1 ? '' : 's'}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
          {errorCount} to fix before publishing
        </button>
      )}

      <div className="flex gap-3 pb-6">
        <button type="button" onClick={() => handleSave({})} disabled={saving || anyUploading} className="btn-secondary flex-1 py-3.5 font-black disabled:opacity-50 disabled:pointer-events-none">
          {saving ? 'Saving…' : anyUploading ? 'Uploading…' : '💾 Save draft'}
        </button>
        {isAdmin ? (
          <button type="button" onClick={() => handleSave({ publish: true })} disabled={saving || anyUploading} className="btn-primary flex-1 py-3.5 font-black disabled:opacity-50 disabled:pointer-events-none">
            {saving ? 'Publishing…' : anyUploading ? 'Uploading…' : '🚀 Publish quiz'}
          </button>
        ) : (
          <button type="button" onClick={() => handleSave({ submit: true })} disabled={saving || anyUploading} className="btn-primary flex-1 py-3.5 font-black disabled:opacity-50 disabled:pointer-events-none">
            {saving ? 'Submitting…' : anyUploading ? 'Uploading…' : '📤 Submit for approval'}
          </button>
        )}
      </div>

      {/* Pre-publish checklist modal — same component the edit flow uses.
          Opened by the amber pill above when any issues are pending, and
          auto-opened once on a fresh imported document via the useEffect
          near questionNumbers. */}
      <QuizValidationChecklist
        open={checklistOpen}
        onClose={() => setChecklistOpen(false)}
        issues={validationIssues}
        summary={validationSummary}
      />
    </div>
  )
}
