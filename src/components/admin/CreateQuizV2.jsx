import { useEffect, useRef, useState } from 'react'
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
  createPassageSection,
  createStandaloneSection,
  getQuestionKey,
  hasOnlyEmptyStarterSection,
  serializeQuizSections,
} from '../../utils/quizSections.js'
import { richTextHasContent } from '../../utils/quizRichText.js'
import { clampInt } from '../../utils/inputs.js'
import { getErrorMessage } from '../../utils/errors.js'
import { validateStandaloneQuestion as sharedValidateStandaloneQuestion } from '../../utils/quizValidation.js'
import QuizSectionsEditor from '../quiz/QuizSectionsEditor'
import QuizEditorPreviewPanel from '../quiz/QuizEditorPreviewPanel'
import {
  QUIZ_DOCUMENT_ACCEPT,
  importQuizDocument,
  revokeImportedQuizAssets,
} from '../quiz/documentQuizImporter'

const SUBJECTS = [
  'Mathematics',
  'English',
  'Integrated Science',
  'Social Studies',
  'Technology Studies',
  'Home Economics',
  'Expressive Arts',
]
const GRADES = ['4', '5', '6']
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
  const [form, setForm] = useState({
    title: '',
    subject: 'Mathematics',
    grade: '5',
    term: '1',
    duration: 30,
    type: 'quiz',
    topic: '',
    mode: '',
    importStatus: '',
    sourceFileName: '',
    sourceContentType: '',
    importWarnings: [],
  })
  const [sections, setSections] = useState([createStandaloneSection()])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [aiForm, setAiForm] = useState({ topic: '', count: 5, type: 'mcq' })
  const [aiGenerating, setAiGenerating] = useState(false)
  const [importingDocument, setImportingDocument] = useState(false)
  const [importSummary, setImportSummary] = useState(null)
  const [importedAssets, setImportedAssets] = useState({})

  const serializedPreview = serializeQuizSections(sections)
  const questionNumbers = buildQuestionNumberMap(serializedPreview.questions)
  const questionCount = serializedPreview.questionCount
  const totalMarks = serializedPreview.totalMarks
  const passageCount = serializedPreview.passages.length
  const imagesCount = countImages(sections)
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
      saveCreateQuizDraft(currentUser.uid, { form, sections, creationMode })
    }, 800)
    return () => clearTimeout(timer)
  }, [form, sections, creationMode, currentUser?.uid])

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
          {
            ...createPassageSection({ id: section.passage.id, questions: [] }).passage.questions[0],
            passageId: section.passage.id,
          },
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
    setSections(currentSections => [...currentSections, createPassageSection()])
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
        topic: current.topic.trim() && hasExistingWork ? current.topic : imported.quiz.topic,
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

  async function uploadImportedQuestionImages(questionsToSave) {
    const assetIds = Array.from(new Set(questionsToSave.map(question => question.imageAssetId).filter(Boolean)))
    if (!assetIds.length) return questionsToSave
    if (!currentUser?.uid) throw new Error('Please sign in before saving imported quiz images.')

    const uploadedById = {}
    const uploadedRefs = []
    try {
      for (const assetId of assetIds) {
        const asset = importedAssets[assetId]
        if (!asset?.blob) {
          throw new Error('An imported question image is no longer available. Please re-import the document.')
        }

        const sourceFile = new File([asset.blob], asset.fileName || `${assetId}.jpg`, {
          type: asset.contentType || 'image/jpeg',
        })
        const uploadBlob = await compressImage(sourceFile)
        const path = `quiz-images/${currentUser.uid}/imports/${Date.now()}-${safeStorageName(assetId)}.jpg`
        const ref = storageRef(storage, path)
        const snapshot = await uploadBytes(ref, uploadBlob, {
          contentType: 'image/jpeg',
          customMetadata: {
            sourceFileName: form.sourceFileName || '',
            sourcePath: asset.sourcePath || '',
          },
        })
        uploadedRefs.push(snapshot.ref)
        uploadedById[assetId] = await getDownloadURL(snapshot.ref)
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

    return questionsToSave.map(question => {
      const uploadedUrl = uploadedById[question.imageAssetId]
      if (!uploadedUrl) return question
      return {
        ...question,
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

    for (const section of sections) {
      if (section.kind === 'passage') {
        const passage = section.passage
        if (passage.imageUploading) {
          show('A passage image is still uploading. Please wait.', true)
          return false
        }
        if (!richTextHasContent(passage.passageText)) {
          show('Each comprehension passage needs passage text before saving.', true)
          return false
        }
        if (!passage.questions.length) {
          show('Each comprehension passage needs at least one linked question.', true)
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
      const serializedSections = serializeQuizSections(sections)
      const questionsForSave = await uploadImportedQuestionImages(serializedSections.questions)
      const totalMarksForSave = questionsForSave.reduce((sum, question) => sum + (question.marks || 1), 0)
      const status = publish ? 'published' : submit ? 'pending' : 'draft'

      const quizId = await createQuiz({
        ...form,
        passages: serializedSections.passages,
        passageCount: serializedSections.passages.length,
        totalMarks: totalMarksForSave,
        questionCount: questionsForSave.length,
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
      const returnPath = isAdmin ? '/admin/content' : '/teacher/content'
      setTimeout(() => navigate(returnPath), 1200)
    } catch (error) {
      console.error(error)
      show(`Failed to save: ${getErrorMessage(error, 'unexpected error')}`, true)
      setSaving(false)
    }
  }

  return (
    <div className="theme-text space-y-5">
      {toast && (
        <div className={`fixed right-4 top-4 z-50 max-w-xs rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-lg ${
          toast.isErr ? 'bg-red-600' : 'theme-accent-fill theme-on-accent'
        }`}>
          {toast.message}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="theme-text-muted min-h-0 bg-transparent p-1 shadow-none hover:theme-text transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
        </button>
        <div>
          <p className="text-eyebrow">Authoring</p>
          <h1 className="text-display-xl theme-text mt-1 flex items-center gap-2">
            <span aria-hidden="true">✏️</span> Create quiz
          </h1>
          <p className="theme-text-muted text-body-sm mt-1">Build quizzes with standalone questions or comprehension passages.</p>
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
        questionNumbers={questionNumbers}
        totalQuestions={questionCount}
        onStandaloneChange={updateStandaloneQuestion}
        onStandaloneRemove={removeStandaloneSection}
        onStandaloneMove={moveSection}
        onStandaloneImageUpload={uploadStandaloneQuestionImage}
        onStandaloneImageRemove={removeStandaloneQuestionImage}
        onPassageChange={updatePassage}
        onPassageToggle={togglePassage}
        onPassageRemove={removePassageSection}
        onPassageMove={moveSection}
        onPassageImageUpload={uploadPassageImage}
        onPassageImageRemove={removePassageImage}
        onPassageQuestionChange={updatePassageQuestion}
        onPassageQuestionRemove={removePassageQuestion}
        onPassageQuestionMove={movePassageQuestion}
        onPassageAddQuestion={addPassageQuestion}
        onAddStandalone={addStandaloneSectionHandler}
        onAddPassage={addPassageSectionHandler}
      />

      <QuizEditorPreviewPanel form={form} serializedSections={serializedPreview} />

      <div className="theme-accent-bg theme-border theme-accent-text flex items-start gap-2 rounded-2xl border px-4 py-3 text-xs">
        <span className="flex-shrink-0 text-base">ℹ️</span>
        <span>Question and passage images upload to Firebase Storage as soon as you select them. Comprehension passages are stored separately on the quiz and linked to their questions when you save.</span>
      </div>

      <div className="flex gap-3 pb-6">
        <button type="button" onClick={() => handleSave({})} disabled={saving || anyUploading} className="theme-card theme-border theme-text hover:border-[var(--accent)] hover:theme-accent-text flex-1 rounded-2xl border-2 py-3.5 font-black transition-all duration-fast ease-out shadow-elev-sm hover:-translate-y-px hover:shadow-elev-md disabled:opacity-50 disabled:pointer-events-none">
          {saving ? 'Saving…' : anyUploading ? 'Uploading…' : '💾 Save draft'}
        </button>
        {isAdmin ? (
          <button type="button" onClick={() => handleSave({ publish: true })} disabled={saving || anyUploading} className="theme-accent-fill theme-on-accent flex-1 rounded-2xl py-3.5 font-black transition-all duration-fast ease-out shadow-elev-sm shadow-elev-inner-hl hover:-translate-y-px hover:shadow-elev-md disabled:opacity-50 disabled:pointer-events-none">
            {saving ? 'Publishing…' : anyUploading ? 'Uploading…' : '🚀 Publish quiz'}
          </button>
        ) : (
          <button type="button" onClick={() => handleSave({ submit: true })} disabled={saving || anyUploading} className="theme-accent-fill theme-on-accent flex-1 rounded-2xl py-3.5 font-black transition-all duration-fast ease-out shadow-elev-sm shadow-elev-inner-hl hover:-translate-y-px hover:shadow-elev-md disabled:opacity-50 disabled:pointer-events-none">
            {saving ? 'Submitting…' : anyUploading ? 'Uploading…' : '📤 Submit for approval'}
          </button>
        )}
      </div>
    </div>
  )
}
