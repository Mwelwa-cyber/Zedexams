// Assessment Studio v2 — block-based, parchment + oxblood design.
// Visual reference: /assessment-studio-preview.html (HTML mockup).
// Data model is unchanged — sections[] + parts[] still flow through
// serializeQuizSections / saveAssessmentQuestions exactly as before,
// so this view is drop-in compatible with EditAssessment + exports.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'

import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import {
  clearAssessmentDraft,
  loadAssessmentDraft,
  saveAssessmentDraft,
} from '../../hooks/useAssessmentDraft'
import { storage } from '../../firebase/config'
import { generateAIQuizQuestions } from '../../utils/aiAssistant'
import { generateDiagram } from '../../utils/generateDiagram'
import { suggestAnswer as suggestAnswerCall } from '../../utils/suggestAnswer'
import {
  createPartGroup,
  createPassageSection,
  createStandaloneSection,
  emptyPassageQuestion,
  getQuestionKey,
  hasOnlyEmptyStarterSection,
  serializeQuizSections,
} from '../../utils/quizSections.js'
import { richTextHasContent, richTextToPlainText } from '../../utils/quizRichText.js'
import { clampInt } from '../../utils/inputs.js'
import { getErrorMessage } from '../../utils/errors.js'
import { validateStandaloneQuestion as sharedValidateStandaloneQuestion } from '../../utils/quizValidation.js'
import SeoHelmet from '../seo/SeoHelmet'
import {
  QUIZ_DOCUMENT_ACCEPT,
  importQuizDocument,
  revokeImportedQuizAssets,
} from '../quiz/documentQuizImporter'
import { LIBRARY_TYPES } from '../../config/library'
import { classifyForLibrary } from '../../utils/libraryClassification'
import { printAssessmentAsPdf } from '../../utils/assessmentToPdf'
import { downloadAssessmentDocx } from '../../utils/assessmentToDocx'
import { buildPaperLayout, computeSmartWarnings } from '../../utils/assessmentPaperLayout'

import './studio/assessmentStudio.css'

/* ------------------------------------------------------------------
 * Constants — kept compatible with library taxonomy and save schema.
 * ------------------------------------------------------------------ */

const STUDIO_TO_LIBRARY_SUBJECT = {
  English: 'English Language',
  'Integrated Science': 'Integrated Science',
  Mathematics: 'Mathematics',
  'Social Studies': 'Social Studies',
  'Expressive Art': 'Expressive Arts',
  'Technology Studies': 'Technology Studies',
  Cinyanja: 'Zambian Language',
  'Home Economics': 'Home Economics',
}
const STUDIO_TO_LIBRARY_ASSESSMENT_TYPE = {
  weekly: 'monthly',
  monthly: 'monthly',
  mid_term: 'midterm',
  end_of_term: 'end_of_term',
  topic: 'topic',
  mock: 'end_of_term',
  diagnostic: 'topic',
  pre_test: 'topic',
  post_test: 'topic',
  revision: 'topic',
  continuous: 'topic',
  summative: 'end_of_term',
  practical: 'topic',
  oral: 'topic',
  project: 'topic',
}

const SUBJECTS = [
  'English',
  'Integrated Science',
  'Mathematics',
  'Social Studies',
  'Expressive Art',
  'Technology Studies',
  'Cinyanja',
  'Home Economics',
]
const GRADES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']
const GRADE_WORDS = {
  1: 'ONE', 2: 'TWO', 3: 'THREE', 4: 'FOUR', 5: 'FIVE', 6: 'SIX',
  7: 'SEVEN', 8: 'EIGHT', 9: 'NINE', 10: 'TEN', 11: 'ELEVEN', 12: 'TWELVE',
}
const TERMS = ['1', '2', '3']

const ASSESSMENT_TYPES = [
  'weekly', 'monthly', 'mid_term', 'end_of_term', 'topic',
  'mock', 'diagnostic', 'pre_test', 'post_test', 'revision',
  'continuous', 'summative', 'practical', 'oral', 'project',
]
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

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const SECTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

const INSTRUCTION_PRESETS = [
  'Use a pen.',
  'Show all your working clearly.',
  'No calculators allowed.',
  'You have the full duration to complete this paper.',
]

/* ------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------ */

function toEditableText(value) {
  if (!value) return ''
  if (typeof value === 'string') {
    // If it looks like rich text (HTML or Tiptap JSON), strip to plain text.
    // The new builder uses plain textarea; rich formatting is preserved
    // round-trip only on questions that aren't edited here.
    if (value.startsWith('<') || value.trim().startsWith('{')) {
      return richTextToPlainText(value)
    }
    return value
  }
  if (typeof value === 'object') return richTextToPlainText(value)
  return String(value)
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

function buildStandaloneSection(question = {}) {
  const type = question.type ?? 'mcq'
  const isTextAnswer = type === 'short_answer' || type === 'diagram' || type === 'essay'
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

function buildTitleFromForm(form) {
  const gradeWord = GRADE_WORDS[form.grade] || form.grade
  const type = ASSESSMENT_TYPE_LABELS[form.assessmentType] || 'Assessment'
  const termBit = form.term ? `TERM ${form.term}` : ''
  const typeUpper = type.toUpperCase()
  let typeFormatted = typeUpper
  if (form.assessmentType === 'end_of_term' && termBit) {
    typeFormatted = `END OF TERM ${form.term} TEST`
  } else if (form.assessmentType === 'mid_term' && termBit) {
    typeFormatted = `MID-TERM ${form.term} TEST`
  } else if (form.assessmentType === 'mock') {
    typeFormatted = 'MOCK EXAMINATION'
  } else if (termBit) {
    typeFormatted = `${termBit} ${typeUpper}`
  }
  const year = form.year || new Date().getFullYear()
  return `GRADE ${gradeWord} ${typeFormatted} - ${year}`
}

function buildFooterCode(form) {
  const parts = [
    `G${form.grade || ''}`,
    form.subject || '',
    `Term ${form.term || ''}`,
    String(form.year || new Date().getFullYear()),
  ].filter(Boolean)
  return parts.join('/')
}

function plainTextWordCount(value) {
  const text = toEditableText(value)
  if (!text) return 0
  return text.split(/\s+/).filter(Boolean).length
}

/* ------------------------------------------------------------------
 * Top-level component
 * ------------------------------------------------------------------ */

export default function AssessmentStudio() {
  const { createAssessment, saveAssessmentQuestions, getMyAssessments } = useFirestore()
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedView = searchParams.get('view')

  // View + slide-over state
  const [view, setView] = useState(
    ['home', 'builder', 'preview', 'marking-key'].includes(requestedView) ? requestedView : 'home',
  )
  const [slideover, setSlideover] = useState(null) // 'blocks' | 'ai' | 'editor' | null
  const [editorTargetKey, setEditorTargetKey] = useState(null)
  const [insertAfterIndex, setInsertAfterIndex] = useState(null) // for block picker
  const [toast, setToast] = useState(null)

  // Data state (compatible with existing schema)
  const [form, setForm] = useState(() => ({
    title: '',
    subject: 'Integrated Science',
    grade: '4',
    term: '1',
    year: new Date().getFullYear(),
    duration: 60,
    type: 'assessment',
    topic: '',
    assessmentType: 'end_of_term',
    schoolName: '',
    className: '',
    paperName: '',
    assessmentDate: '',
    coverInstructions: '',
    schoolLogoUrl: '',
    showNameField: true,
    showDateField: true,
    showMarksField: true,
    showClassField: false,
    endOfPaperText: '— END OF PAPER —',
    mode: '',
    importStatus: '',
    sourceFileName: '',
    sourceContentType: '',
    importWarnings: [],
  }))
  const [sections, setSections] = useState(() => [createStandaloneSection()])
  const [parts, setParts] = useState([])
  const [saving, setSaving] = useState(false)
  const [aiForm, setAiForm] = useState({ topic: '', count: 5, type: 'mcq' })
  const [aiGenerating, setAiGenerating] = useState(false)
  const [generatingDiagram, setGeneratingDiagram] = useState(false)
  const [importingDocument, setImportingDocument] = useState(false)
  const [importSummary, setImportSummary] = useState(null)
  const [importedAssets, setImportedAssets] = useState({})
  const [exporting, setExporting] = useState(false)
  const [recentPapers, setRecentPapers] = useState([])

  // Derived
  const serializedPreview = useMemo(
    () => serializeQuizSections(sections, parts),
    [sections, parts],
  )
  const questionNumbers = useMemo(
    () => buildQuestionNumberMap(serializedPreview.questions),
    [serializedPreview],
  )
  const questionCount = serializedPreview.questionCount
  const totalMarks = serializedPreview.totalMarks
  const estimatedPages = Math.max(1, Math.ceil((questionCount + totalMarks * 0.4) / 8))
  const autoTitle = form.title.trim() || buildTitleFromForm(form)
  const footerCode = buildFooterCode(form)

  // The single source-of-truth `assessment` document. Preview, PDF, DOCX,
  // warnings, and the marking key all consume this same shape.
  const assessmentDoc = useMemo(() => ({
    title: form.title.trim() || autoTitle,
    subject: form.subject,
    grade: form.grade,
    term: form.term,
    year: form.year,
    duration: form.duration,
    topic: form.topic,
    assessmentType: form.assessmentType,
    schoolName: form.schoolName,
    className: form.className,
    paperName: form.paperName,
    assessmentDate: form.assessmentDate,
    coverInstructions: form.coverInstructions,
    schoolLogoUrl: form.schoolLogoUrl,
    schoolLogoTransform: form.schoolLogoTransform || null,
    endOfPaperText: form.endOfPaperText,
    footerCode,
    showNameField: form.showNameField,
    showDateField: form.showDateField,
    showMarksField: form.showMarksField,
    showClassField: form.showClassField,
    passages: serializedPreview.passages,
    parts: serializedPreview.parts,
    totalMarks,
    questionCount,
  }), [form, footerCode, autoTitle, serializedPreview, totalMarks, questionCount])

  const paperBlocks = useMemo(
    () => buildPaperLayout(assessmentDoc, serializedPreview.questions, { mode: 'paper' }),
    [assessmentDoc, serializedPreview.questions],
  )
  const markingKeyBlocks = useMemo(
    () => buildPaperLayout(assessmentDoc, serializedPreview.questions, { mode: 'scheme' }),
    [assessmentDoc, serializedPreview.questions],
  )
  const warnings = useMemo(
    () => computeSmartWarnings(assessmentDoc, serializedPreview.questions),
    [assessmentDoc, serializedPreview.questions],
  )

  /* ------------ helpers ------------ */
  const showToast = useCallback((message, isErr = false) => {
    setToast({ message, isErr })
    window.clearTimeout(showToast._t)
    showToast._t = window.setTimeout(() => setToast(null), 2500)
  }, [])

  const setF = useCallback((field, value) => {
    setForm(current => ({ ...current, [field]: value }))
  }, [])

  // Sync view ↔ URL
  function changeView(next) {
    setView(next)
    const params = new URLSearchParams(searchParams)
    if (next === 'home') params.delete('view')
    else params.set('view', next)
    setSearchParams(params, { replace: true })
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  function openSlide(name, opts = {}) {
    if (opts.questionKey != null) setEditorTargetKey(opts.questionKey)
    if (opts.insertAfter != null) setInsertAfterIndex(opts.insertAfter)
    else setInsertAfterIndex(null)
    setSlideover(name)
  }
  function closeSlide() {
    setSlideover(null)
    setEditorTargetKey(null)
    setInsertAfterIndex(null)
  }

  /* ------------ draft restore / autosave ------------ */
  const draftRestoredRef = useRef(false)
  useEffect(() => {
    if (draftRestoredRef.current) return
    if (!currentUser?.uid) return
    draftRestoredRef.current = true

    const draft = loadAssessmentDraft(currentUser.uid)
    if (!draft) return
    if (!hasOnlyEmptyStarterSection(sections)) return

    if (draft.form) setForm(current => ({ ...current, ...draft.form }))
    if (Array.isArray(draft.sections) && draft.sections.length) setSections(draft.sections)
    if (Array.isArray(draft.parts)) setParts(draft.parts)
    if (draft.view === 'builder' || draft.view === 'preview') setView(draft.view)
    showToast('Restored your unsaved draft.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid])

  useEffect(() => {
    if (!currentUser?.uid) return
    if (!draftRestoredRef.current) return
    if (hasOnlyEmptyStarterSection(sections) && !form.title.trim() && !form.schoolName.trim()) return
    const timer = setTimeout(() => {
      saveAssessmentDraft(currentUser.uid, { form, sections, parts, view })
    }, 800)
    return () => clearTimeout(timer)
  }, [form, sections, parts, view, currentUser?.uid])

  useEffect(() => () => revokeImportedQuizAssets(importedAssets), [importedAssets])

  /* ------------ recent papers (home view) ------------ */
  useEffect(() => {
    if (view !== 'home') return
    if (!currentUser?.uid) return
    let cancelled = false
    getMyAssessments(currentUser.uid)
      .then(list => {
        if (cancelled) return
        setRecentPapers(Array.isArray(list) ? list.slice(0, 8) : [])
      })
      .catch(err => { console.warn('Failed to load recent papers:', err) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, currentUser?.uid])

  /* ------------ section + part mutators ------------ */
  function updateSection(sectionIndex, updater) {
    setSections(prev => prev.map((section, index) =>
      index === sectionIndex ? updater(section) : section,
    ))
  }
  function updateStandaloneQuestion(sectionIndex, field, value) {
    updateSection(sectionIndex, section => ({
      ...section,
      question: { ...section.question, [field]: value },
    }))
  }
  function moveSection(sectionIndex, direction) {
    setSections(prev => {
      const next = [...prev]
      const target = sectionIndex + direction
      if (target < 0 || target >= next.length) return next
      ;[next[sectionIndex], next[target]] = [next[target], next[sectionIndex]]
      return next
    })
  }
  function removeSectionAt(sectionIndex) {
    setSections(prev => {
      const next = prev.filter((_, index) => index !== sectionIndex)
      return next.length ? next : [createStandaloneSection()]
    })
  }
  function duplicateSectionAt(sectionIndex) {
    setSections(prev => {
      const source = prev[sectionIndex]
      if (!source) return prev
      const cloned = source.kind === 'passage'
        ? createPassageSection({
            ...source.passage,
            id: undefined,
            questions: (source.passage.questions || []).map(q => ({ ...q, _id: null })),
          })
        : buildStandaloneSection({ ...source.question, _id: null })
      const next = [...prev]
      next.splice(sectionIndex + 1, 0, cloned)
      return next
    })
  }

  function insertSectionAfter(afterIndex, section) {
    setSections(prev => {
      if (hasOnlyEmptyStarterSection(prev)) return [section]
      if (afterIndex == null) return [...prev, section]
      const next = [...prev]
      next.splice(afterIndex + 1, 0, section)
      return next
    })
  }

  function addPart() {
    setParts(prev => [
      ...prev,
      createPartGroup({ order: prev.length, title: `Section ${SECTION_LETTERS[prev.length] || ''}`.trim() }),
    ])
  }
  function updatePart(partId, field, value) {
    setParts(prev => prev.map(part => part.id === partId ? { ...part, [field]: value } : part))
  }
  function removePart(partId) {
    setParts(prev => prev.filter(part => part.id !== partId).map((part, i) => ({ ...part, order: i })))
    setSections(prev => prev.map(section => {
      if (section.kind === 'passage' && section.partId === partId) {
        return {
          ...section,
          partId: null,
          passage: {
            ...section.passage,
            questions: (section.passage.questions || []).map(q =>
              q.partId === partId ? { ...q, partId: null } : q,
            ),
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
    setSections(prev => prev.map(section => {
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

  /* ------------ passage child question mutators ------------ */
  function updatePassageQuestion(sectionIndex, questionIndex, field, value) {
    updateSection(sectionIndex, section => ({
      ...section,
      passage: {
        ...section.passage,
        questions: section.passage.questions.map((question, index) =>
          index === questionIndex ? { ...question, [field]: value } : question,
        ),
      },
    }))
  }
  function addPassageQuestion(sectionIndex, type = 'short_answer') {
    updateSection(sectionIndex, section => ({
      ...section,
      passage: {
        ...section.passage,
        questions: [
          ...section.passage.questions,
          emptyPassageQuestion({
            passageId: section.passage.id,
            type,
            options: type === 'mcq' ? ['', '', '', ''] : [],
            correctAnswer: type === 'mcq' ? 0 : '',
          }),
        ],
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

  /* ------------ image upload ------------ */
  async function uploadStandaloneQuestionImage(sectionIndex, file) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      showToast('Only JPG, PNG, and WEBP images are allowed.', true)
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      showToast('Image must be under 15 MB.', true)
      return
    }
    updateStandaloneQuestion(sectionIndex, 'imageUploading', true)
    try {
      const compressed = await compressImage(file)
      const path = `assessment-images/${currentUser.uid}/${Date.now()}-q-${sectionIndex}.jpg`
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
      showToast('Image attached.')
    } catch (error) {
      updateStandaloneQuestion(sectionIndex, 'imageUploading', false)
      showToast(`Upload failed: ${getErrorMessage(error)}`, true)
    }
  }
  function removeStandaloneQuestionImage(sectionIndex) {
    updateSection(sectionIndex, section => ({
      ...section,
      question: { ...section.question, imageUrl: '', imageAssetId: '' },
    }))
  }

  // Per-option image upload (image-only and text+image MCQs).
  // `optionMedia` is a parallel array to `options`: optionMedia[i] = { imageUrl, alt }.
  async function uploadStandaloneOptionImage(sectionIndex, optionIndex, file) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      showToast('Only JPG, PNG, and WEBP images are allowed.', true)
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast('Option image must be under 10 MB.', true)
      return
    }
    try {
      const compressed = await compressImage(file, 600, 0.85)
      const path = `assessment-images/${currentUser.uid}/${Date.now()}-q-${sectionIndex}-opt-${optionIndex}.jpg`
      const snapshot = await uploadBytes(storageRef(storage, path), compressed, { contentType: 'image/jpeg' })
      const imageUrl = await getDownloadURL(snapshot.ref)
      updateSection(sectionIndex, section => {
        const optionCount = Array.isArray(section.question.options) ? section.question.options.length : 4
        const existing = Array.isArray(section.question.optionMedia) ? section.question.optionMedia : []
        const next = Array.from({ length: optionCount }, (_, i) => existing[i] || null)
        next[optionIndex] = { imageUrl, alt: existing[optionIndex]?.alt || '' }
        return { ...section, question: { ...section.question, optionMedia: next } }
      })
      showToast('Option image attached.')
    } catch (error) {
      showToast(`Upload failed: ${getErrorMessage(error)}`, true)
    }
  }
  function removeStandaloneOptionImage(sectionIndex, optionIndex) {
    updateSection(sectionIndex, section => {
      const existing = Array.isArray(section.question.optionMedia) ? section.question.optionMedia : []
      const next = [...existing]
      next[optionIndex] = null
      return { ...section, question: { ...section.question, optionMedia: next } }
    })
  }

  async function uploadSchoolLogo(file) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      showToast('Only JPG, PNG, and WEBP images are allowed.', true)
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast('Logo must be under 10 MB.', true)
      return
    }
    try {
      const compressed = await compressImage(file, 600, 0.9)
      const path = `assessment-images/${currentUser.uid}/logo-${Date.now()}.jpg`
      const snapshot = await uploadBytes(storageRef(storage, path), compressed, { contentType: 'image/jpeg' })
      const url = await getDownloadURL(snapshot.ref)
      setF('schoolLogoUrl', url)
      showToast('School logo uploaded.')
    } catch (error) {
      showToast(`Upload failed: ${getErrorMessage(error)}`, true)
    }
  }

  /* ------------ AI generation ------------ */
  async function handleGenerateQuestions(topicOverride) {
    const topic = (topicOverride || aiForm.topic || form.topic || '').trim()
    if (!topic) {
      showToast('Add a topic so Zed can generate questions.', true)
      return
    }
    setAiGenerating(true)
    try {
      const { questions: generated, warning: kbWarning } = await generateAIQuizQuestions({
        subject: form.subject,
        grade: form.grade,
        topic,
        count: aiForm.count,
        type: aiForm.type,
      })
      const generatedList = Array.isArray(generated) ? generated : []
      const usable = generatedList.filter(q => {
        if (!richTextHasContent(q?.text ?? '')) return false
        const t = q?.type || 'mcq'
        if (t === 'short_answer' || t === 'diagram') {
          return String(q?.correctAnswer ?? '').trim().length > 0
        }
        const opts = Array.isArray(q?.options) ? q.options.filter(o => String(o ?? '').trim()) : []
        return opts.length >= 2
      })
      const nextSections = usable.map(q => buildStandaloneSection({
        ...q,
        options: q.options?.length ? q.options : ['', '', '', ''],
      }))
      if (!nextSections.length) {
        showToast('Zed could not generate questions. Try again.', true)
        return
      }
      setSections(prev => hasOnlyEmptyStarterSection(prev)
        ? nextSections
        : [...prev, ...nextSections])
      if (!form.title.trim()) setF('title', `Grade ${form.grade} ${form.subject} - ${topic}`)
      const skipped = generatedList.length - nextSections.length
      showToast(skipped
        ? `Zed returned ${skipped} incomplete; ${nextSections.length} kept. Review before saving.`
        : `Added ${nextSections.length} AI-generated question${nextSections.length === 1 ? '' : 's'}.`)
      if (kbWarning) setTimeout(() => showToast(kbWarning), 1500)
      closeSlide()
      if (view !== 'builder') changeView('builder')
    } catch (error) {
      showToast(getErrorMessage(error, 'AI generation failed.'), true)
    } finally {
      setAiGenerating(false)
    }
  }

  /* ------------ AI diagram generation (Recraft) ------------ */
  // The generated PNG lives in Firebase Storage; we attach it as the
  // imageUrl of a fresh "structured" question whose text is the prompt
  // itself, so teachers can immediately edit the question wording.
  async function handleGenerateDiagram(prompt) {
    const clean = String(prompt || '').trim()
    if (!clean) {
      showToast('Describe the diagram you want to generate.', true)
      return
    }
    setGeneratingDiagram(true)
    try {
      const { url } = await generateDiagram({ prompt: clean })
      const newSection = buildStandaloneSection({
        type: 'diagram',
        detectedType: 'diagram',
        text: clean,
        imageUrl: url,
        marks: 5,
        options: [],
        correctAnswer: '',
        wordBank: [],
      })
      setSections(prev => hasOnlyEmptyStarterSection(prev)
        ? [newSection]
        : [...prev, newSection])
      showToast('Diagram generated. Edit the question text or word bank to label it.')
      closeSlide()
      if (view !== 'builder') changeView('builder')
    } catch (error) {
      showToast(error?.message || 'Diagram generation failed.', true)
    } finally {
      setGeneratingDiagram(false)
    }
  }

  /* ------------ document import ------------ */
  async function handleImportDocument(file) {
    const hasExistingWork = !hasOnlyEmptyStarterSection(sections)
    if (hasExistingWork && !window.confirm('Replace the current questions with questions extracted from this document?')) return
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
        : imported.questions.map(q => buildStandaloneSection(q)))
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
        showToast('No questions extracted. Try a different file.', true)
        return
      }
      showToast(`Imported ${importedCount} question${importedCount === 1 ? '' : 's'}. Review before saving.`)
      changeView('builder')
      closeSlide()
    } catch (error) {
      console.error(error)
      showToast(`Import failed: ${getErrorMessage(error)}`, true)
    } finally {
      setImportingDocument(false)
    }
  }

  /* ------------ validation + save ------------ */
  function validateStandaloneQuestion(question, label) {
    return sharedValidateStandaloneQuestion(question, label, {
      onError: message => showToast(message, true),
    })
  }
  function validate() {
    if (!autoTitle.trim()) {
      showToast('Set a school name + grade so the title can be generated.', true)
      return false
    }
    if (!String(form.subject || '').trim()) {
      showToast('Subject is required — every paper must show its subject.', true)
      return false
    }
    if (questionCount === 0) {
      showToast('Add at least one question before saving.', true)
      return false
    }
    for (const part of parts) {
      if (!String(part.title ?? '').trim()) {
        showToast('Every section needs a title (e.g. "Section A — Multiple Choice").', true)
        return false
      }
    }
    for (const section of sections) {
      if (section.kind === 'passage') {
        const passage = section.passage
        if (passage.imageUploading) {
          showToast('A passage image is still uploading. Please wait.', true)
          return false
        }
        if (!richTextHasContent(passage.passageText) && !passage.imageUrl) {
          showToast('Each passage needs text or an image before saving.', true)
          return false
        }
        if (!passage.questions.length) {
          showToast('Each passage needs at least one linked question.', true)
          return false
        }
        for (const q of passage.questions) {
          const label = `Passage question ${questionNumbers[q.localId]}`
          if (!validateStandaloneQuestion(q, label)) return false
        }
        continue
      }
      const q = section.question
      if (!validateStandaloneQuestion(q, `Question ${questionNumbers[q.localId]}`)) return false
    }
    return true
  }

  async function uploadImportedQuestionImages(questionsToSave) {
    const assetIds = Array.from(new Set(questionsToSave.map(q => q.imageAssetId).filter(Boolean)))
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
        const path = `assessment-images/${currentUser.uid}/imports/${Date.now()}-${safeStorageName(assetId)}.jpg`
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
      const { deleteObject } = await import('firebase/storage')
      await Promise.all(uploadedRefs.map(ref =>
        deleteObject(ref).catch(cleanupError => console.warn('Orphaned upload cleanup failed:', cleanupError))
      ))
      throw error
    }
    return questionsToSave.map(q => {
      const uploadedUrl = uploadedById[q.imageAssetId]
      if (!uploadedUrl) return q
      return { ...q, imageUrl: uploadedUrl, imageAssetId: '' }
    })
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    try {
      const serialized = serializeQuizSections(sections, parts)
      const questionsForSave = await uploadImportedQuestionImages(serialized.questions)
      const totalMarksForSave = questionsForSave.reduce((sum, q) => sum + (q.marks || 1), 0)
      const library = classifyForLibrary({
        libraryType: LIBRARY_TYPES.ASSESSMENTS,
        grade: `Grade ${form.grade}`,
        term: form.term,
        subject: STUDIO_TO_LIBRARY_SUBJECT[form.subject] || form.subject,
        assessmentType: STUDIO_TO_LIBRARY_ASSESSMENT_TYPE[form.assessmentType] || form.assessmentType,
      })
      const finalTitle = form.title.trim() || autoTitle
      const assessmentId = await createAssessment({
        title: finalTitle,
        subject: form.subject,
        grade: form.grade,
        term: form.term,
        duration: form.duration,
        topic: form.topic,
        assessmentType: form.assessmentType,
        schoolName: form.schoolName,
        className: form.className,
        paperName: form.paperName,
        assessmentDate: form.assessmentDate,
        coverInstructions: form.coverInstructions,
        schoolLogoUrl: form.schoolLogoUrl,
        endOfPaperText: form.endOfPaperText,
        footerCode,
        passages: serialized.passages,
        parts: serialized.parts,
        passageCount: serialized.passages.length,
        totalMarks: totalMarksForSave,
        questionCount: questionsForSave.length,
        mode: form.mode,
        importStatus: form.mode === 'imported_document'
          ? (questionsForSave.some(q => q.requiresReview) ? 'needs_review' : (form.importStatus || 'success'))
          : form.importStatus,
        sourceFileName: form.sourceFileName,
        sourceContentType: form.sourceContentType,
        importWarnings: form.importWarnings,
        createdBy: currentUser.uid,
        library,
      })
      await saveAssessmentQuestions(assessmentId, questionsForSave)
      setImportedAssets({})
      clearAssessmentDraft(currentUser.uid)
      showToast('Saved to your library!')
      setTimeout(() => navigate('/teacher/assessments'), 900)
    } catch (error) {
      console.error(error)
      showToast(`Failed to save: ${getErrorMessage(error)}`, true)
      setSaving(false)
    }
  }

  /* ------------ export (PDF / DOCX / Print) ------------ */
  async function handleExport(kind, mode = 'paper') {
    if (questionCount === 0) {
      showToast('Add at least one question to export.', true)
      return
    }
    setExporting(true)
    try {
      const baseFile = (assessmentDoc.title || 'assessment').replace(/[^a-z0-9-]+/gi, '-').toLowerCase()
      const fileSuffix = mode === 'scheme' ? '-marking-key' : ''
      if (kind === 'pdf') {
        printAssessmentAsPdf(assessmentDoc, serializedPreview.questions, { mode })
        showToast('PDF dialog opened.')
      } else if (kind === 'docx') {
        await downloadAssessmentDocx(assessmentDoc, serializedPreview.questions, `${baseFile}${fileSuffix}.docx`, { mode })
        showToast('Word download started.')
      } else if (kind === 'print') {
        window.print()
      }
    } catch (error) {
      console.error(error)
      showToast(`Export failed: ${getErrorMessage(error)}`, true)
    } finally {
      setExporting(false)
    }
  }

  /* ------------ block picker ------------ */
  function handleBlockPick(blockKey) {
    const baseQuestion = (type, overrides = {}) => buildStandaloneSection({
      type,
      detectedType: type,
      ...overrides,
    })
    let newSection = null
    switch (blockKey) {
      case 'mcq':
        newSection = baseQuestion('mcq', { options: ['', '', '', ''], correctAnswer: 0, marks: 1 })
        break
      case 'short_answer':
        newSection = baseQuestion('short_answer', { options: [], correctAnswer: '', marks: 2 })
        break
      case 'structured':
        newSection = baseQuestion('diagram', { options: [], correctAnswer: '', marks: 5, diagramText: 'Structured response' })
        break
      case 'essay':
        newSection = baseQuestion('essay', { options: [], correctAnswer: '', marks: 6 })
        break
      case 'true_false':
        newSection = baseQuestion('mcq', { options: ['True', 'False', '', ''], correctAnswer: 0, marks: 1 })
        break
      case 'fill_in_blank':
        newSection = baseQuestion('short_answer', { options: [], correctAnswer: '', marks: 1 })
        break
      case 'passage':
        newSection = createPassageSection()
        break
      case 'section': {
        addPart()
        showToast('Section added.')
        closeSlide()
        return
      }
      case 'ai_generate':
        openSlide('ai')
        return
      default:
        showToast('That block type is coming soon.', true)
        return
    }
    if (newSection) {
      insertSectionAfter(insertAfterIndex, newSection)
      showToast('Block added.')
    }
    closeSlide()
  }

  /* ------------ render ------------ */
  return (
    <div className="studio-v2">
      <SeoHelmet title="Assessment Studio" noIndex />

      <TopBar
        title={autoTitle}
        savingDraft={Boolean(saving)}
        onBack={() => navigate('/teacher/assessments')}
        onAi={() => openSlide('ai')}
      />

      {view === 'home' && (
        <HomeView
          recentPapers={recentPapers}
          onNewPaper={() => {
            // Reset to a clean slate
            setSections([createStandaloneSection()])
            setParts([])
            changeView('builder')
          }}
          onOpenPaper={(paperId) => navigate(`/teacher/assessments/${paperId}/edit`)}
          onAi={() => openSlide('ai')}
          onLibrary={() => navigate('/teacher/assessments')}
          questionCount={questionCount}
        />
      )}

      {view === 'builder' && (
        <BuilderView
          form={form}
          setF={setF}
          sections={sections}
          parts={parts}
          questionNumbers={questionNumbers}
          questionCount={questionCount}
          totalMarks={totalMarks}
          estimatedPages={estimatedPages}
          autoTitle={autoTitle}
          footerCode={footerCode}
          warnings={warnings}
          changeView={changeView}
          onAddBlock={(afterIndex) => openSlide('blocks', { insertAfter: afterIndex })}
          onEditQuestion={(key) => openSlide('editor', { questionKey: key })}
          onMoveSection={moveSection}
          onRemoveSection={removeSectionAt}
          onDuplicateSection={duplicateSectionAt}
          onUpdateStandaloneQuestion={updateStandaloneQuestion}
          onUploadStandaloneImage={uploadStandaloneQuestionImage}
          onRemoveStandaloneImage={removeStandaloneQuestionImage}
          onUploadStandaloneOptionImage={uploadStandaloneOptionImage}
          onRemoveStandaloneOptionImage={removeStandaloneOptionImage}
          onUpdateSection={updateSection}
          onUpdatePassageQuestion={updatePassageQuestion}
          onAddPassageQuestion={addPassageQuestion}
          onRemovePassageQuestion={removePassageQuestion}
          onUpdatePart={updatePart}
          onRemovePart={removePart}
          onAssignSectionToPart={assignSectionToPart}
          onUploadLogo={uploadSchoolLogo}
          onRemoveLogo={() => setF('schoolLogoUrl', '')}
          onImportDocument={handleImportDocument}
          importing={importingDocument}
          importSummary={importSummary}
        />
      )}

      {view === 'preview' && (
        <PaperRenderView
          mode="paper"
          blocks={paperBlocks}
          assessment={assessmentDoc}
          changeView={changeView}
          onExport={(kind) => handleExport(kind, 'paper')}
          onSave={handleSave}
          saving={saving}
          exporting={exporting}
          showSave
        />
      )}

      {view === 'marking-key' && (
        <PaperRenderView
          mode="scheme"
          blocks={markingKeyBlocks}
          assessment={assessmentDoc}
          changeView={changeView}
          onExport={(kind) => handleExport(kind, 'scheme')}
          onSave={handleSave}
          saving={saving}
          exporting={exporting}
        />
      )}

      <BottomBar
        view={view}
        warnings={warnings}
        onHome={() => changeView('home')}
        onBuilder={() => changeView('builder')}
        onAdd={() => openSlide('blocks')}
        onPreview={() => changeView('preview')}
        onMarkingKey={() => changeView('marking-key')}
        onAi={() => openSlide('ai')}
      />

      {slideover && <div className="sv-scrim open" onClick={closeSlide} />}

      <BlockPickerSlide
        open={slideover === 'blocks'}
        onClose={closeSlide}
        onPick={handleBlockPick}
      />
      <AiSlide
        open={slideover === 'ai'}
        onClose={closeSlide}
        aiForm={aiForm}
        setAiForm={setAiForm}
        form={form}
        generating={aiGenerating}
        onGenerate={handleGenerateQuestions}
        onImport={handleImportDocument}
        importing={importingDocument}
        onAction={(label) => showToast(`${label} — coming soon.`)}
        onGenerateDiagram={handleGenerateDiagram}
        generatingDiagram={generatingDiagram}
        onOpenMarkingKey={() => { closeSlide(); changeView('marking-key') }}
      />
      <EditorSlide
        open={slideover === 'editor'}
        onClose={closeSlide}
        targetKey={editorTargetKey}
        sections={sections}
        onUpdateStandaloneQuestion={updateStandaloneQuestion}
        onUpdatePassageQuestion={updatePassageQuestion}
        questionNumbers={questionNumbers}
      />

      {toast && (
        <div className={`sv-action-toast show ${toast.isErr ? 'err' : ''}`}>
          {toast.message}
        </div>
      )}
    </div>
  )
}

/* ==================================================================
 * TOP BAR
 * ================================================================== */
function TopBar({ title, savingDraft, onBack, onAi }) {
  return (
    <header className="sv-app-bar">
      <button className="sv-icon-btn" onClick={onBack} aria-label="Back">←</button>
      <div className="sv-app-bar-title">
        <span className="sv-status-dot" aria-hidden="true" />
        {title}
        <span className="sv-badge-mini">{savingDraft ? 'Saving' : 'Draft'}</span>
      </div>
      <button className="sv-icon-btn" onClick={onAi} title="AI assistant">✨</button>
    </header>
  )
}

/* ==================================================================
 * BOTTOM BAR — compact dock + FAB (replaces the big 4-tab bar).
 *
 * Slim chip rail at the bottom for view navigation (Home / Builder /
 * Preview / Key / AI), plus a floating "+" button anchored bottom-right
 * for the primary "Add block" action. Doesn't cover content the way the
 * old chunky tab bar did.
 * ================================================================== */
function BottomBar({ view, warnings = [], onHome, onBuilder, onAdd, onPreview, onMarkingKey, onAi }) {
  const errorCount = warnings.filter(w => w.severity === 'error').length
  return (
    <>
      <nav className="sv-dock">
        <DockBtn icon="🏠" label="Home" onClick={onHome} active={view === 'home'} />
        <DockBtn icon="📄" label="Build" onClick={onBuilder} active={view === 'builder'} />
        <DockBtn icon="👁" label="Preview" onClick={onPreview} active={view === 'preview'} />
        <DockBtn icon="🗝" label="Key" onClick={onMarkingKey} active={view === 'marking-key'} />
        <DockBtn icon="✨" label="AI" onClick={onAi} />
      </nav>
      {view !== 'home' && (
        <button
          className="sv-fab"
          onClick={onAdd}
          aria-label="Add block"
          title="Add block"
        >
          <span>+</span>
          {errorCount > 0 && <span className="sv-fab-badge">{errorCount}</span>}
        </button>
      )}
    </>
  )
}

function DockBtn({ icon, label, onClick, active }) {
  return (
    <button
      className={`sv-dock-btn ${active ? 'active' : ''}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      <span className="sv-dock-ic">{icon}</span>
      <span className="sv-dock-lbl">{label}</span>
    </button>
  )
}

/* ==================================================================
 * HOME VIEW
 * ================================================================== */
function HomeView({ recentPapers, onNewPaper, onOpenPaper, onAi, onLibrary }) {
  const draftCount = recentPapers.filter(p => (p.importStatus || '') === 'needs_review' || !p.questionCount).length
  const totalQuestions = recentPapers.reduce((sum, p) => sum + (p.questionCount || 0), 0)

  return (
    <section className="sv-view">
      <div className="sv-canvas-area">
        <div className="sv-welcome">
          <div className="sv-welcome-eyebrow">📄 Teacher-only · Examination Studio</div>
          <h1 className="serif">
            Build school-ready <em>papers</em> the way teachers think.
          </h1>
          <p>Composable blocks. Real A4 output. AI that drafts sections and writes marking keys — but never publishes to learners.</p>
          <div className="sv-welcome-cta">
            <button className="sv-btn sv-btn-cream" onClick={onNewPaper}>📝 New paper</button>
            <button className="sv-btn sv-btn-ghost" onClick={onAi}>✨ Generate with AI</button>
          </div>
        </div>

        <div className="sv-eyebrow">Quick actions</div>

        <div className="sv-ai-strip" onClick={onAi}>
          <div className="sv-sparkle">✨</div>
          <div className="sv-ai-strip-text">
            <strong>Zed AI is ready to help</strong>
            <span>Generate questions on any CBC topic · auto-balanced sections · marking key included</span>
          </div>
          <button className="sv-btn sv-btn-gold sv-btn-sm">Open →</button>
        </div>

        <div className="sv-stat-strip">
          <Stat value={recentPapers.length} label="Papers" />
          <Stat value={draftCount} label="Need review" />
          <Stat value={totalQuestions} label="Questions saved" />
          <Stat value="—" label="Diagrams" hint="soon" />
        </div>

        <div className="sv-eyebrow">
          Recently edited
          <a href="#" onClick={(e) => { e.preventDefault(); onLibrary() }}>View library →</a>
        </div>

        {recentPapers.length === 0 ? (
          <div style={{
            padding: '40px 24px',
            textAlign: 'center',
            background: 'var(--sv-paper)',
            border: '1px dashed var(--sv-border-strong)',
            borderRadius: 'var(--sv-r-lg)',
            color: 'var(--sv-muted)',
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
            <strong style={{ display: 'block', color: 'var(--sv-text)', marginBottom: 4 }}>
              You haven&apos;t saved any papers yet
            </strong>
            <div style={{ fontSize: 13 }}>
              Click <em>New paper</em> above to start building.
            </div>
          </div>
        ) : (
          <div className="sv-paper-grid">
            {recentPapers.map(paper => (
              <PaperCard key={paper.id} paper={paper} onClick={() => onOpenPaper(paper.id)} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function Stat({ value, label, hint }) {
  return (
    <div className="sv-stat">
      <div className="sv-stat-v">{value}</div>
      <div className="sv-stat-l">{label}{hint ? ` · ${hint}` : ''}</div>
    </div>
  )
}

function PaperCard({ paper, onClick }) {
  const status = paper.importStatus === 'needs_review' ? 'draft' : (paper.questionCount > 0 ? 'ready' : 'draft')
  const tag = paper.subject ? `${paper.subject} · Grade ${paper.grade}` : `Grade ${paper.grade}`
  const updatedAt = paper.updatedAt?.toDate ? paper.updatedAt.toDate() : (paper.createdAt?.toDate ? paper.createdAt.toDate() : null)
  const ago = updatedAt ? formatAgo(updatedAt) : ''
  return (
    <button className="sv-paper-card" onClick={onClick}>
      <div className="sv-thumb">
        <div className="sv-thumb-tag">{tag}</div>
        <div className="sv-mini-doc">
          <div className="sv-l tall" />
          <div className="sv-l" /><div className="sv-l short" />
          <div className="sv-l" /><div className="sv-l" />
          <div className="sv-l short" />
        </div>
      </div>
      <div className="sv-info">
        <h3 className="serif">{paper.title || 'Untitled paper'}</h3>
        <div className="sv-meta">
          {paper.questionCount || 0} questions · {paper.totalMarks || 0} marks · {paper.duration || 0} mins
        </div>
        <div className="sv-row">
          <span><span className={`sv-status-pill ${status}`}>{status === 'ready' ? 'Ready' : 'Draft'}</span></span>
          {ago && <span style={{ marginLeft: 'auto', color: 'var(--sv-muted-2)' }}>{ago}</span>}
        </div>
      </div>
    </button>
  )
}

function formatAgo(date) {
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

/* ==================================================================
 * BUILDER VIEW
 * ================================================================== */
function BuilderView(props) {
  const {
    form, setF, sections, parts, questionNumbers, questionCount, totalMarks,
    estimatedPages, footerCode, changeView, warnings = [],
    onAddBlock, onEditQuestion, onMoveSection, onRemoveSection, onDuplicateSection,
    onUpdateStandaloneQuestion, onUploadStandaloneImage, onRemoveStandaloneImage,
    onUploadStandaloneOptionImage, onRemoveStandaloneOptionImage,
    onUpdateSection, onUpdatePassageQuestion, onAddPassageQuestion, onRemovePassageQuestion,
    onUpdatePart, onRemovePart, onAssignSectionToPart, onUploadLogo, onRemoveLogo,
    onImportDocument, importing, importSummary,
  } = props

  // Group sections by their Part membership for rendering Section headers.
  const grouped = useMemo(() => {
    const groups = []
    const sectionIndexByPart = new Map()
    const ungrouped = []
    sections.forEach((section, index) => {
      const partId = section.kind === 'passage'
        ? section.partId ?? null
        : section.question?.partId ?? null
      if (partId) {
        if (!sectionIndexByPart.has(partId)) sectionIndexByPart.set(partId, [])
        sectionIndexByPart.get(partId).push({ section, index })
      } else {
        ungrouped.push({ section, index })
      }
    })
    if (ungrouped.length) groups.push({ part: null, members: ungrouped })
    parts.forEach(part => {
      const members = sectionIndexByPart.get(part.id) || []
      groups.push({ part, members })
    })
    return groups
  }, [sections, parts])

  return (
    <section className="sv-view">
      <div className="sv-builder-bar">
        <button className="sv-chip active">📄 Builder</button>
        <button className="sv-chip" onClick={() => changeView('preview')}>👁 Preview</button>
        <button className="sv-chip" onClick={() => changeView('marking-key')}>🗝 Marking key</button>
        <span className="sv-pages mono">📃 Est. {estimatedPages} page{estimatedPages === 1 ? '' : 's'} · A4</span>
      </div>

      <div className="sv-doc-canvas">
        <SmartWarningsBanner warnings={warnings} />

        <HeaderBlock form={form} setF={setF} onUploadLogo={onUploadLogo} onRemoveLogo={onRemoveLogo} footerCode={footerCode} importing={importing} importSummary={importSummary} onImportDocument={onImportDocument} />

        <AddHere onAdd={() => onAddBlock(null)} />

        <InstructionsBlock form={form} setF={setF} />

        {grouped.map((group, groupIndex) => (
          <BuilderGroup
            key={group.part?.id ?? `ungrouped-${groupIndex}`}
            group={group}
            groupIndex={groupIndex}
            allParts={parts}
            questionNumbers={questionNumbers}
            paperMeta={{ grade: form.grade, subject: form.subject, language: form.language }}
            onAddBlock={onAddBlock}
            onEditQuestion={onEditQuestion}
            onMoveSection={onMoveSection}
            onRemoveSection={onRemoveSection}
            onDuplicateSection={onDuplicateSection}
            onUpdateStandaloneQuestion={onUpdateStandaloneQuestion}
            onUploadStandaloneImage={onUploadStandaloneImage}
            onRemoveStandaloneImage={onRemoveStandaloneImage}
            onUploadStandaloneOptionImage={onUploadStandaloneOptionImage}
            onRemoveStandaloneOptionImage={onRemoveStandaloneOptionImage}
            onUpdateSection={onUpdateSection}
            onUpdatePassageQuestion={onUpdatePassageQuestion}
            onAddPassageQuestion={onAddPassageQuestion}
            onRemovePassageQuestion={onRemovePassageQuestion}
            onUpdatePart={onUpdatePart}
            onRemovePart={onRemovePart}
            onAssignSectionToPart={onAssignSectionToPart}
          />
        ))}

        <AddHere onAdd={() => onAddBlock(sections.length - 1)} />

        <FooterBlock form={form} setF={setF} footerCode={footerCode} />
      </div>

      <div className="sv-totals-bar">
        <span>📝 <strong>{questionCount}</strong> questions</span>
        <span>📊 <strong>{totalMarks}</strong> marks</span>
        <span>📑 <strong>{parts.length}</strong> sections</span>
        <span>📃 <strong>{estimatedPages}</strong> pages</span>
      </div>
    </section>
  )
}

function AddHere({ onAdd }) {
  return (
    <div className="sv-add-here">
      <button className="sv-plus" onClick={onAdd} aria-label="Insert block here">+</button>
    </div>
  )
}

/* ==================================================================
 * SMART WARNINGS BANNER
 *
 * Computed by computeSmartWarnings(assessmentDoc, questions). Renders
 * one short row per warning at the top of the builder. Errors block
 * save (validated separately); warnings are advisory.
 * ================================================================== */
function SmartWarningsBanner({ warnings }) {
  if (!warnings || !warnings.length) return null
  return (
    <div className="sv-warnings">
      {warnings.map(w => (
        <div key={w.key} className={`sv-warn sv-warn-${w.severity}`}>
          <span className="sv-warn-ic">{w.severity === 'error' ? '⚠' : w.severity === 'warn' ? '⚡' : 'ℹ'}</span>
          <span className="sv-warn-msg">{w.message}</span>
        </div>
      ))}
    </div>
  )
}

function BuilderGroup({ group, allParts, questionNumbers, paperMeta, onAddBlock, onEditQuestion, onMoveSection, onRemoveSection, onDuplicateSection, onUpdateStandaloneQuestion, onUploadStandaloneImage, onRemoveStandaloneImage, onUploadStandaloneOptionImage, onRemoveStandaloneOptionImage, onUpdateSection, onUpdatePassageQuestion, onAddPassageQuestion, onRemovePassageQuestion, onUpdatePart, onRemovePart, onAssignSectionToPart }) {
  const partIndex = allParts.findIndex(p => p.id === group.part?.id)
  const letter = partIndex >= 0 ? SECTION_LETTERS[partIndex] || '·' : null

  const partMarks = useMemo(() => {
    return group.members.reduce((sum, { section }) => {
      if (section.kind === 'passage') {
        return sum + (section.passage.questions || []).reduce((s, q) => s + (q.marks || 1), 0)
      }
      return sum + (section.question.marks || 1)
    }, 0)
  }, [group.members])

  return (
    <>
      {group.part && (
        <div className="sv-block b-section">
          <div className="sv-block-head">
            <span className="sv-ic">📑</span> Section
            <span className="sv-tools">
              <button className="sv-tool danger" title="Delete section" onClick={() => onRemovePart(group.part.id)}>🗑</button>
            </span>
          </div>
          <div className="sv-section-title-row">
            <div className="sv-section-letter">{letter}</div>
            <div className="sv-section-name">
              <input
                className="sv-inline-title"
                value={group.part.title}
                onChange={e => onUpdatePart(group.part.id, 'title', e.target.value)}
                placeholder="Section title (e.g. Multiple Choice Questions)"
              />
              <div className="sv-meta">
                <span>📝 {group.members.length} block{group.members.length === 1 ? '' : 's'}</span>
              </div>
            </div>
            <div className="sv-section-marks">{partMarks} marks</div>
          </div>
          <input
            className="sv-section-instr-input"
            value={typeof group.part.instructions === 'string' ? group.part.instructions : toEditableText(group.part.instructions)}
            onChange={e => onUpdatePart(group.part.id, 'instructions', e.target.value)}
            placeholder="Section instructions (e.g. Choose the correct answer from the options given.)"
          />
        </div>
      )}

      {group.members.map(({ section, index }) => (
        <SectionBlock
          key={section.id || section.kind + '-' + index}
          section={section}
          sectionIndex={index}
          parts={allParts}
          questionNumbers={questionNumbers}
          paperMeta={paperMeta}
          onEditQuestion={onEditQuestion}
          onMoveSection={onMoveSection}
          onRemoveSection={onRemoveSection}
          onDuplicateSection={onDuplicateSection}
          onUpdateStandaloneQuestion={onUpdateStandaloneQuestion}
          onUploadStandaloneImage={onUploadStandaloneImage}
          onRemoveStandaloneImage={onRemoveStandaloneImage}
          onUploadStandaloneOptionImage={onUploadStandaloneOptionImage}
          onRemoveStandaloneOptionImage={onRemoveStandaloneOptionImage}
          onUpdateSection={onUpdateSection}
          onUpdatePassageQuestion={onUpdatePassageQuestion}
          onAddPassageQuestion={onAddPassageQuestion}
          onRemovePassageQuestion={onRemovePassageQuestion}
          onAssignSectionToPart={onAssignSectionToPart}
        />
      ))}

      <AddHere onAdd={() => onAddBlock(group.members.length ? group.members[group.members.length - 1].index : null)} />
    </>
  )
}

/* ==================================================================
 * HEADER BLOCK
 * ================================================================== */
function HeaderBlock({ form, setF, onUploadLogo, onRemoveLogo, importing, onImportDocument }) {
  const fileInputRef = useRef(null)
  const docInputRef = useRef(null)

  return (
    <div className="sv-block b-header">
      <div className="sv-block-head">
        <span className="sv-ic">📄</span> Paper Header
      </div>

      <div className="sv-identity-row">
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="sv-logo-drop"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Upload school logo"
          >
            {form.schoolLogoUrl
              ? <img src={form.schoolLogoUrl} alt="School logo" />
              : <>🖼<small>School<br />logo</small></>}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) onUploadLogo(file)
                e.target.value = ''
              }}
            />
          </button>
          {form.schoolLogoUrl && onRemoveLogo && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onRemoveLogo() }}
              aria-label="Remove logo"
              style={{
                position: 'absolute', top: -6, right: -6,
                width: 22, height: 22, borderRadius: '50%',
                background: 'var(--sv-primary)', color: 'white',
                border: '2px solid white', fontSize: 12, lineHeight: 1,
                display: 'grid', placeItems: 'center', cursor: 'pointer',
              }}
            >×</button>
          )}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--sv-s3)' }}>
          <div className="sv-field">
            <label>School name <span className="sv-req">*</span></label>
            <input
              type="text"
              value={form.schoolName}
              onChange={e => setF('schoolName', e.target.value)}
              placeholder="e.g. Jemareen Academy"
            />
          </div>
          <div className="sv-field">
            <label>Class (optional)</label>
            <input
              type="text"
              value={form.className}
              onChange={e => setF('className', e.target.value)}
              placeholder="e.g. 4A"
            />
          </div>
        </div>
      </div>

      <div className="sv-field-grid four" style={{ marginBottom: 'var(--sv-s3)' }}>
        <div className="sv-field">
          <label>Grade</label>
          <select value={form.grade} onChange={e => setF('grade', e.target.value)}>
            {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
          </select>
        </div>
        <div className="sv-field">
          <label>Assessment</label>
          <select value={form.assessmentType} onChange={e => setF('assessmentType', e.target.value)}>
            {ASSESSMENT_TYPES.map(t => <option key={t} value={t}>{ASSESSMENT_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        <div className="sv-field">
          <label>Term</label>
          <select value={form.term} onChange={e => setF('term', e.target.value)}>
            {TERMS.map(t => <option key={t} value={t}>Term {t}</option>)}
          </select>
        </div>
        <div className="sv-field">
          <label>Year</label>
          <input
            type="number"
            value={form.year}
            onChange={e => setF('year', clampInt(e.target.value, 2020, 2099, new Date().getFullYear()))}
          />
        </div>
      </div>

      <div className="sv-field-grid two">
        <div className="sv-field">
          <label>Subject <span className="sv-req">*</span></label>
          <select value={form.subject} onChange={e => setF('subject', e.target.value)}>
            {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="sv-field">
          <label>Paper name <small style={{ color: 'var(--sv-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</small></label>
          <select value={form.paperName} onChange={e => setF('paperName', e.target.value)}>
            <option value="">— None —</option>
            <option>Paper 1</option>
            <option>Paper 2</option>
            <option>Special Paper 1</option>
            <option>Special Paper 2</option>
            <option>Practical Paper</option>
            <option>Revision Paper</option>
          </select>
        </div>
      </div>

      <div className="sv-field-grid two" style={{ marginTop: 'var(--sv-s3)' }}>
        <div className="sv-field">
          <label>Duration (minutes)</label>
          <input
            type="number"
            value={form.duration}
            onChange={e => setF('duration', clampInt(e.target.value, 5, 600, 60))}
          />
        </div>
        <div className="sv-field">
          <label>Date (optional)</label>
          <input
            type="date"
            value={form.assessmentDate}
            onChange={e => setF('assessmentDate', e.target.value)}
          />
        </div>
      </div>

      <div style={{ marginTop: 'var(--sv-s4)' }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 'var(--sv-s2)' }}>
          Learner info fields (printed on paper)
        </label>
        <div className="sv-toggle-list">
          <Toggle label="👤 NAME field"        on={form.showNameField}  onChange={v => setF('showNameField', v)} />
          <Toggle label="📅 DATE field"        on={form.showDateField}  onChange={v => setF('showDateField', v)} />
          <Toggle label="📊 TOTAL MARKS field" on={form.showMarksField} onChange={v => setF('showMarksField', v)} />
          <Toggle label="🏫 CLASS field"       on={form.showClassField} onChange={v => setF('showClassField', v)} />
        </div>
      </div>

      <div className="sv-title-preview-card">
        <div className="sv-auto-label">⚡ Auto-generated header</div>
        <div className="sv-school">{(form.schoolName || 'YOUR SCHOOL NAME').toUpperCase()}</div>
        <div className="sv-title-auto">{buildTitleFromForm(form)}</div>
        {form.subject && <div className="sv-subject-auto">{form.subject.toUpperCase()}</div>}
        {form.paperName && <div className="sv-paper-auto">{form.paperName.toUpperCase()}</div>}
      </div>

      <div style={{ marginTop: 'var(--sv-s4)', padding: 'var(--sv-s3)', background: 'var(--sv-tinted)', borderRadius: 'var(--sv-r)', display: 'flex', gap: 'var(--sv-s2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: 'var(--sv-muted)' }}>
          Have an existing paper? Import a Word or PDF file.
        </span>
        <button
          className="sv-btn sv-btn-outline sv-btn-sm"
          onClick={() => docInputRef.current?.click()}
          disabled={importing}
          style={{ marginLeft: 'auto' }}
        >
          {importing ? 'Importing…' : '📥 Import .doc / .pdf'}
        </button>
        <input
          ref={docInputRef}
          type="file"
          accept={QUIZ_DOCUMENT_ACCEPT}
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) onImportDocument(file)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}

function Toggle({ label, on, onChange }) {
  return (
    <div className="sv-tg-row">
      <div className="sv-lbl">{label}</div>
      <button
        className={`sv-tg ${on ? 'on' : ''}`}
        onClick={() => onChange(!on)}
        aria-pressed={on}
        aria-label={label}
      />
    </div>
  )
}

/* ==================================================================
 * INSTRUCTIONS BLOCK
 * ================================================================== */
function InstructionsBlock({ form, setF }) {
  const appendPreset = (text) => {
    const current = form.coverInstructions.trim()
    setF('coverInstructions', current ? `${current}\n${text}` : text)
  }
  return (
    <div className="sv-block b-instr">
      <div className="sv-block-head">
        <span className="sv-ic">📋</span> General Instructions
      </div>
      <div className="sv-field">
        <textarea
          value={form.coverInstructions}
          onChange={e => setF('coverInstructions', e.target.value)}
          placeholder="Answer all the questions.
Choose and circle the correct answer from the given options A, B, C, and D."
          rows={4}
        />
      </div>
      <div className="sv-preset-row">
        {INSTRUCTION_PRESETS.map(preset => (
          <button
            key={preset}
            className="sv-preset-pill"
            onClick={() => appendPreset(preset)}
            type="button"
          >
            + {preset}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ==================================================================
 * SECTION BLOCK (renders either passage or standalone)
 * ================================================================== */
function SectionBlock(props) {
  const {
    section, sectionIndex, parts, questionNumbers, paperMeta,
    onEditQuestion, onMoveSection, onRemoveSection, onDuplicateSection,
    onUpdateStandaloneQuestion, onUploadStandaloneImage, onRemoveStandaloneImage,
    onUploadStandaloneOptionImage, onRemoveStandaloneOptionImage,
    onUpdateSection, onUpdatePassageQuestion, onAddPassageQuestion, onRemovePassageQuestion,
    onAssignSectionToPart,
  } = props

  if (section.kind === 'passage') {
    return (
      <PassageBlock
        section={section}
        sectionIndex={sectionIndex}
        parts={parts}
        questionNumbers={questionNumbers}
        onEditQuestion={onEditQuestion}
        onMoveSection={onMoveSection}
        onRemoveSection={onRemoveSection}
        onUpdateSection={onUpdateSection}
        onUpdatePassageQuestion={onUpdatePassageQuestion}
        onAddPassageQuestion={onAddPassageQuestion}
        onRemovePassageQuestion={onRemovePassageQuestion}
        onAssignSectionToPart={onAssignSectionToPart}
      />
    )
  }
  return (
    <QuestionBlock
      section={section}
      sectionIndex={sectionIndex}
      parts={parts}
      questionNumbers={questionNumbers}
      paperMeta={paperMeta}
      onEditQuestion={onEditQuestion}
      onMoveSection={onMoveSection}
      onRemoveSection={onRemoveSection}
      onDuplicateSection={onDuplicateSection}
      onUpdateQuestion={(field, value) => onUpdateStandaloneQuestion(sectionIndex, field, value)}
      onUploadImage={file => onUploadStandaloneImage(sectionIndex, file)}
      onRemoveImage={() => onRemoveStandaloneImage(sectionIndex)}
      onUploadOptionImage={(optIndex, file) => onUploadStandaloneOptionImage(sectionIndex, optIndex, file)}
      onRemoveOptionImage={optIndex => onRemoveStandaloneOptionImage(sectionIndex, optIndex)}
      onAssignSectionToPart={onAssignSectionToPart}
    />
  )
}

function PassageBlock({ section, sectionIndex, parts, questionNumbers, onEditQuestion, onMoveSection, onRemoveSection, onUpdateSection, onUpdatePassageQuestion, onAddPassageQuestion, onRemovePassageQuestion, onAssignSectionToPart }) {
  const passage = section.passage
  const passageText = toEditableText(passage.passageText)
  const wordCount = plainTextWordCount(passage.passageText)

  return (
    <>
      <div className="sv-block b-passage">
        <div className="sv-block-head">
          <span className="sv-ic">📖</span> Comprehension Passage
          <span className="sv-tools">
            <button className="sv-tool" title="Move up" onClick={() => onMoveSection(sectionIndex, -1)}>↑</button>
            <button className="sv-tool" title="Move down" onClick={() => onMoveSection(sectionIndex, 1)}>↓</button>
            <button className="sv-tool danger" title="Delete passage" onClick={() => onRemoveSection(sectionIndex)}>🗑</button>
          </span>
        </div>
        <div className="sv-passage-content">
          <div className="sv-passage-title">
            <input
              value={passage.title || ''}
              onChange={e => onUpdateSection(sectionIndex, s => ({ ...s, passage: { ...s.passage, title: e.target.value } }))}
              placeholder="Passage title"
            />
            <span className="sv-pword-count">~{wordCount} words</span>
          </div>
          <textarea
            className="sv-passage-text"
            value={passageText}
            onChange={e => onUpdateSection(sectionIndex, s => ({ ...s, passage: { ...s.passage, passageText: e.target.value } }))}
            placeholder="Paste or type the passage text here. The Tiptap rich-text editor is available in EditAssessment for richer formatting."
            rows={6}
          />
        </div>

        {parts.length > 0 && (
          <div style={{ marginTop: 'var(--sv-s3)', display: 'flex', alignItems: 'center', gap: 'var(--sv-s2)', fontSize: 12.5, color: 'var(--sv-muted)' }}>
            <span>Belongs to:</span>
            <select
              value={section.partId || ''}
              onChange={e => onAssignSectionToPart(section.id, e.target.value)}
              style={{ padding: '4px 8px', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', background: 'var(--sv-tinted)', fontSize: 12.5 }}
            >
              <option value="">— No section —</option>
              {parts.map(p => <option key={p.id} value={p.id}>{p.title || 'Untitled section'}</option>)}
            </select>
          </div>
        )}
      </div>

      {passage.questions.map((question, qIndex) => (
        <div key={question.localId || qIndex} className="sv-block b-question nested" style={{ marginLeft: 'calc(var(--sv-s4) * 2)' }}>
          <div className="sv-block-head">
            <span className="sv-ic">✏</span> Passage Question
            <span className="sv-tools">
              <button className="sv-tool" title="Edit in detail" onClick={() => onEditQuestion(question.localId)}>✏</button>
              <button className="sv-tool danger" title="Delete question" onClick={() => onRemovePassageQuestion(sectionIndex, qIndex)}>🗑</button>
            </span>
          </div>
          <div className="sv-q-card-top">
            <div className="sv-q-num">{questionNumbers[question.localId] || qIndex + 1}.</div>
            <div className="sv-q-type-tag mcq">{(question.type || 'mcq').toUpperCase()}</div>
            <label className="sv-q-marks-input">
              marks
              <input
                type="number"
                value={question.marks || 1}
                onChange={e => onUpdatePassageQuestion(sectionIndex, qIndex, 'marks', clampInt(e.target.value, 0, 100, 1))}
              />
            </label>
          </div>
          <textarea
            className="sv-q-text-input"
            value={toEditableText(question.text)}
            onChange={e => onUpdatePassageQuestion(sectionIndex, qIndex, 'text', e.target.value)}
            placeholder="Question text"
          />

          {(question.type === 'mcq' || !question.type) ? (
            <McqOptions
              question={question}
              onChangeOption={(optIndex, value) => {
                const next = [...(question.options || ['', '', '', ''])]
                next[optIndex] = value
                onUpdatePassageQuestion(sectionIndex, qIndex, 'options', next)
              }}
              onSelectCorrect={(optIndex) => onUpdatePassageQuestion(sectionIndex, qIndex, 'correctAnswer', optIndex)}
            />
          ) : (
            <ShortAnswerInputs
              correctAnswer={question.correctAnswer}
              onChange={value => onUpdatePassageQuestion(sectionIndex, qIndex, 'correctAnswer', value)}
            />
          )}
        </div>
      ))}

      <div style={{ marginLeft: 'calc(var(--sv-s4) * 2)', marginBottom: 'var(--sv-s3)' }}>
        <button
          className="sv-btn sv-btn-outline sv-btn-sm"
          onClick={() => onAddPassageQuestion(sectionIndex, 'mcq')}
        >
          + Add MCQ to passage
        </button>
        <button
          className="sv-btn sv-btn-outline sv-btn-sm"
          onClick={() => onAddPassageQuestion(sectionIndex, 'short_answer')}
          style={{ marginLeft: 6 }}
        >
          + Add short answer
        </button>
      </div>
    </>
  )
}

// Question fields whose edits invalidate any prior AI answer suggestion.
// Module-scope so the array is allocated once per page load, not per render.
const FIELDS_THAT_INVALIDATE_SUGGESTION = ['text', 'options', 'correctAnswer', 'wordBank']

// Module-scope colour palette for the AI suggestion notice — kept out of
// the component body so it isn't reallocated per render.
const AI_CONFIDENCE_META = {
  high: { bg: '#ECFDF5', border: '#A7F3D0', text: '#065F46', label: 'High confidence' },
  medium: { bg: '#FFFBEB', border: '#FCD34D', text: '#92400E', label: 'Medium confidence' },
  low: { bg: '#FEF2F2', border: '#FCA5A5', text: '#991B1B', label: 'Low confidence — verify carefully' },
}

// Inline notice rendered below a question's answer area when Claude has
// suggested the correct answer. Stays visible until the teacher either
// edits anything answer-related (auto-cleared) or hits "Confirm".
function AiSuggestionNotice({ rationale, confidence, onConfirm }) {
  const m = AI_CONFIDENCE_META[confidence] || AI_CONFIDENCE_META.low
  return (
    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 'var(--sv-r-sm)', background: m.bg, border: `1px solid ${m.border}`, color: m.text, fontSize: 12, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>✨ AI suggested · {m.label}</div>
        <div style={{ opacity: 0.9 }}>{rationale}</div>
      </div>
      <button
        type="button"
        onClick={onConfirm}
        style={{ background: 'transparent', border: `1px solid ${m.border}`, color: m.text, padding: '3px 8px', borderRadius: 'var(--sv-r-sm)', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        ✓ Confirm
      </button>
    </div>
  )
}

function QuestionBlock({ section, sectionIndex, parts, questionNumbers, paperMeta, onEditQuestion, onMoveSection, onRemoveSection, onDuplicateSection, onUpdateQuestion, onUploadImage, onRemoveImage, onUploadOptionImage, onRemoveOptionImage, onAssignSectionToPart }) {
  const question = section.question
  const type = question.type || 'mcq'
  const isMcq = type === 'mcq'
  const isEssay = type === 'essay'
  const isShortAnswer = type === 'short_answer' || type === 'fill' || type === 'short'
  const isStructured = type === 'diagram' && !isShortAnswer
  const imageInputRef = useRef(null)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestError, setSuggestError] = useState('')
  // AI suggestion lives in component-local state, NOT on the question
  // object. This keeps the AI badge out of the persisted paper schema
  // (no Firestore drift) and also clears the badge naturally when the
  // teacher closes the paper and reopens it — which is the right default
  // for an unconfirmed model output.
  const [aiSuggestion, setAiSuggestion] = useState(null)
  // Guards setState after unmount during an in-flight suggestion call.
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  function updateQuestion(field, value) {
    if (aiSuggestion && FIELDS_THAT_INVALIDATE_SUGGESTION.includes(field)) {
      setAiSuggestion(null)
    }
    onUpdateQuestion(field, value)
  }

  async function handleSuggestAnswer() {
    const text = String(question.text || '').trim()
    if (!text) {
      setSuggestError('Add the question text first, then ask AI for the answer.')
      return
    }
    if (isMcq) {
      const nonEmpty = (question.options || []).filter(o => String(o || '').trim()).length
      if (nonEmpty < 2) {
        setSuggestError('Fill in at least two options before asking AI.')
        return
      }
    }
    setSuggestError('')
    setSuggesting(true)
    try {
      const result = await suggestAnswerCall({
        type,
        text,
        options: isMcq ? question.options : undefined,
        wordBank: Array.isArray(question.wordBank) ? question.wordBank : undefined,
        grade: paperMeta?.grade,
        subject: paperMeta?.subject,
        language: paperMeta?.language,
      })
      if (!mountedRef.current) return
      // Write the predicted answer to the question via the raw prop —
      // bypasses the local wrapper that would otherwise clear the
      // suggestion badge on a correctAnswer change.
      onUpdateQuestion('correctAnswer', result.answer)
      setAiSuggestion({
        rationale: result.rationale,
        confidence: result.confidence,
      })
    } catch (err) {
      if (mountedRef.current) {
        setSuggestError(err?.message || 'Could not suggest an answer.')
      }
    } finally {
      if (mountedRef.current) setSuggesting(false)
    }
  }

  const typeMeta = {
    mcq: { tag: 'mcq', label: 'Multiple Choice' },
    short_answer: { tag: 'struct', label: 'Short Answer' },
    diagram: { tag: 'struct', label: 'Structured / Diagram' },
    essay: { tag: 'essay', label: 'Essay' },
  }
  const meta = typeMeta[type] || typeMeta.mcq

  return (
    <div className="sv-block b-question nested">
      <div className="sv-block-head">
        <span className="sv-ic">❓</span> {meta.label}
        <span className="sv-tools">
          <button className="sv-tool" title="Move up" onClick={() => onMoveSection(sectionIndex, -1)}>↑</button>
          <button className="sv-tool" title="Move down" onClick={() => onMoveSection(sectionIndex, 1)}>↓</button>
          <button className="sv-tool" title="Edit in detail" onClick={() => onEditQuestion(question.localId)}>✏</button>
          <button className="sv-tool" title="Duplicate" onClick={() => onDuplicateSection(sectionIndex)}>📋</button>
          <button className="sv-tool danger" title="Delete" onClick={() => onRemoveSection(sectionIndex)}>🗑</button>
        </span>
      </div>

      <div className="sv-q-card-top">
        <div className="sv-q-num">{questionNumbers[question.localId] || sectionIndex + 1}.</div>
        <div className={`sv-q-type-tag ${meta.tag}`}>{meta.label.toUpperCase()}</div>
        <select
          value={type}
          onChange={e => onUpdateQuestion('type', e.target.value)}
          style={{ background: 'var(--sv-tinted)', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: '3px 8px', fontSize: 11.5 }}
        >
          <option value="mcq">Multiple choice</option>
          <option value="short_answer">Short answer</option>
          <option value="diagram">Structured / diagram</option>
          <option value="essay">Essay</option>
        </select>
        <label className="sv-q-marks-input">
          marks
          <input
            type="number"
            value={question.marks || 1}
            onChange={e => onUpdateQuestion('marks', clampInt(e.target.value, 0, 100, 1))}
          />
        </label>
        <button
          type="button"
          onClick={handleSuggestAnswer}
          disabled={suggesting}
          title={isEssay
            ? 'Ask AI to suggest marking notes / a sample answer for this essay'
            : 'Ask AI to suggest the correct answer for this question'}
          style={{
            marginLeft: 'auto',
            background: suggesting ? 'var(--sv-tinted)' : 'var(--sv-paper)',
            border: '1px solid var(--sv-border)',
            borderRadius: 'var(--sv-r-sm)',
            padding: '3px 10px',
            fontSize: 11.5,
            cursor: suggesting ? 'default' : 'pointer',
            color: 'var(--sv-text)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {suggesting
            ? '⏳ Thinking…'
            : (isEssay ? '✨ Suggest marking notes' : '✨ Suggest answer')}
        </button>
      </div>

      <textarea
        className="sv-q-text-input"
        value={toEditableText(question.text)}
        onChange={e => updateQuestion('text', e.target.value)}
        placeholder="Question text"
      />

      {(isMcq || isStructured) && (
        question.imageUrl ? (
          <div className="sv-q-media filled filled-wrap">
            <img src={question.imageUrl} alt="" />
            <button
              className="sv-media-remove"
              onClick={onRemoveImage}
              title="Remove image"
              type="button"
            >
              ×
            </button>
          </div>
        ) : question.imageUploading ? (
          <div className="sv-q-media">
            <div className="sv-ic">⏳</div>
            <div>Uploading image…</div>
          </div>
        ) : (
          <button type="button" className="sv-q-media" onClick={() => imageInputRef.current?.click()}>
            <div className="sv-ic">🖼</div>
            <div>Add a diagram or image (optional)</div>
            <small>JPG, PNG or WEBP · up to 15 MB</small>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) onUploadImage(file)
                e.target.value = ''
              }}
            />
          </button>
        )
      )}

      {isMcq && (
        <McqOptions
          question={question}
          onChangeOption={(optIndex, value) => {
            const next = [...(question.options || ['', '', '', ''])]
            next[optIndex] = value
            updateQuestion('options', next)
          }}
          onSelectCorrect={(optIndex) => updateQuestion('correctAnswer', optIndex)}
          onUploadOptionImage={onUploadOptionImage}
          onRemoveOptionImage={onRemoveOptionImage}
        />
      )}

      {isShortAnswer && (
        <ShortAnswerInputs
          correctAnswer={question.correctAnswer}
          onChange={value => updateQuestion('correctAnswer', value)}
        />
      )}

      {isStructured && !isMcq && (
        <>
          <div className="sv-field" style={{ marginBottom: 'var(--sv-s2)' }}>
            <label>Word bank (optional, separate with · or comma)</label>
            <input
              type="text"
              value={Array.isArray(question.wordBank) ? question.wordBank.join(' · ') : (question.wordBank || '')}
              onChange={e => updateQuestion('wordBank', e.target.value.split(/[·,]/).map(s => s.trim()).filter(Boolean))}
              placeholder="e.g. Lungs · Mouth · Nose · Trachea · Bronchi"
            />
          </div>
          <ShortAnswerInputs
            correctAnswer={question.correctAnswer}
            onChange={value => updateQuestion('correctAnswer', value)}
            label="Expected response / marking notes"
            lines={4}
          />
        </>
      )}

      {isEssay && (
        <div className="sv-answer-lines">
          <div className="sv-answer-meta">📏 Answer space: One page (rendered on print)</div>
          <textarea
            value={String(question.correctAnswer ?? '')}
            onChange={e => updateQuestion('correctAnswer', e.target.value)}
            placeholder="Marking notes / sample answer (not printed on the question paper)"
            rows={3}
            style={{ width: '100%', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: 8, fontSize: 13, background: 'var(--sv-paper)', fontFamily: 'inherit', resize: 'vertical' }}
          />
        </div>
      )}

      {suggestError && (
        <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 'var(--sv-r-sm)', background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', fontSize: 12 }}>
          ⚠ {suggestError}
        </div>
      )}

      {aiSuggestion && (
        <AiSuggestionNotice
          rationale={aiSuggestion.rationale}
          confidence={aiSuggestion.confidence}
          onConfirm={() => setAiSuggestion(null)}
        />
      )}

      <div className="sv-q-footer">
        {question.topic && <span className="sv-q-mapping-tag">🎯 {question.topic}</span>}
        {parts.length > 0 && (
          <select
            value={question.partId || ''}
            onChange={e => onAssignSectionToPart(section.id, e.target.value)}
            style={{ padding: '3px 8px', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', background: 'var(--sv-tinted)', fontSize: 11.5, color: 'var(--sv-muted)' }}
          >
            <option value="">No section</option>
            {parts.map(p => <option key={p.id} value={p.id}>{p.title || 'Untitled'}</option>)}
          </select>
        )}
        <div className="sv-q-mini-actions">
          <button onClick={() => onEditQuestion(question.localId)}>✏ Edit details</button>
        </div>
      </div>
    </div>
  )
}

function McqOptions({ question, onChangeOption, onSelectCorrect, onUploadOptionImage, onRemoveOptionImage }) {
  const options = Array.isArray(question.options) && question.options.length
    ? question.options
    : ['', '', '', '']
  const optionMedia = Array.isArray(question.optionMedia) ? question.optionMedia : []
  const correctIndex = typeof question.correctAnswer === 'number' ? question.correctAnswer : 0
  return (
    <div className="sv-mcq-options">
      {options.map((option, optIndex) => {
        const media = optionMedia[optIndex]
        return (
          <McqOptionRow
            key={optIndex}
            optIndex={optIndex}
            option={option}
            media={media}
            isCorrect={correctIndex === optIndex}
            onChangeOption={onChangeOption}
            onSelectCorrect={onSelectCorrect}
            onUploadOptionImage={onUploadOptionImage}
            onRemoveOptionImage={onRemoveOptionImage}
          />
        )
      })}
    </div>
  )
}

function McqOptionRow({ optIndex, option, media, isCorrect, onChangeOption, onSelectCorrect, onUploadOptionImage, onRemoveOptionImage }) {
  const fileRef = useRef(null)
  return (
    <div
      className={`sv-mcq-option ${isCorrect ? 'correct' : ''}`}
      onClick={() => onSelectCorrect(optIndex)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectCorrect(optIndex) } }}
      style={{ gridTemplateColumns: '24px auto 1fr auto' }}
    >
      <div className="sv-letter">{SECTION_LETTERS[optIndex]}</div>
      {media?.imageUrl ? (
        <div style={{ position: 'relative', width: 44, height: 44, borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
          <img src={media.imageUrl} alt={media.alt || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          {onRemoveOptionImage && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onRemoveOptionImage(optIndex) }}
              style={{
                position: 'absolute', top: -4, right: -4,
                width: 18, height: 18, borderRadius: '50%',
                background: 'var(--sv-primary)', color: 'white',
                border: '2px solid white', fontSize: 10, lineHeight: 1,
                display: 'grid', placeItems: 'center', cursor: 'pointer',
              }}
              aria-label="Remove option image"
            >×</button>
          )}
        </div>
      ) : onUploadOptionImage ? (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); fileRef.current?.click() }}
          title="Add image for this option"
          style={{
            width: 32, height: 32, borderRadius: 4,
            border: '1.5px dashed var(--sv-border-strong)',
            background: 'transparent', color: 'var(--sv-muted)',
            display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0,
            fontSize: 14,
          }}
        >
          🖼
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file && onUploadOptionImage) onUploadOptionImage(optIndex, file)
              e.target.value = ''
            }}
          />
        </button>
      ) : <span />}
      <input
        className="sv-opt-text"
        type="text"
        value={option}
        onChange={e => onChangeOption(optIndex, e.target.value)}
        onClick={e => e.stopPropagation()}
        placeholder={media?.imageUrl ? `Optional caption for ${SECTION_LETTERS[optIndex]}` : `Option ${SECTION_LETTERS[optIndex]}`}
      />
      {isCorrect && <div className="sv-check">✓</div>}
    </div>
  )
}

function ShortAnswerInputs({ correctAnswer, onChange, label, lines = 2 }) {
  return (
    <div className="sv-answer-lines">
      <div className="sv-answer-meta">📏 {label || 'Expected answer (used for marking key)'}</div>
      <textarea
        value={String(correctAnswer ?? '')}
        onChange={e => onChange(e.target.value)}
        placeholder="Type the expected answer or marking notes"
        rows={lines}
        style={{ width: '100%', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: 8, fontSize: 13, background: 'var(--sv-paper)', fontFamily: 'inherit', resize: 'vertical' }}
      />
    </div>
  )
}

/* ==================================================================
 * FOOTER BLOCK
 * ================================================================== */
function FooterBlock({ form, setF, footerCode }) {
  return (
    <div className="sv-block b-footer">
      <div className="sv-block-head">
        <span className="sv-ic">⚓</span> Paper Footer
      </div>
      <div className="sv-field-grid two">
        <div className="sv-field">
          <label>Footer code (auto-generated)</label>
          <input type="text" value={footerCode} readOnly style={{ background: 'var(--sv-canvas-2)', color: 'var(--sv-muted)' }} />
        </div>
        <div className="sv-field">
          <label>End-of-paper text</label>
          <input
            type="text"
            value={form.endOfPaperText}
            onChange={e => setF('endOfPaperText', e.target.value)}
            placeholder="— END OF PAPER —"
          />
        </div>
      </div>
    </div>
  )
}

/* ==================================================================
 * PREVIEW VIEW
 * ================================================================== */
/* ==================================================================
 * PAPER RENDER VIEW (preview + marking key)
 *
 * Walks the shared `buildPaperLayout` blocks so the in-studio rendering
 * matches the PDF and DOCX exports pixel-for-pixel. The `mode` prop
 * switches between the printable paper and the marking key.
 * ================================================================== */
function PaperRenderView({ mode, blocks, assessment, changeView, onExport, onSave, saving, exporting, showSave }) {
  const isKey = mode === 'scheme'
  return (
    <section className="sv-view">
      <div className="sv-builder-bar">
        <button className="sv-chip" onClick={() => changeView('builder')}>📄 Builder</button>
        <button className={`sv-chip ${!isKey ? 'active' : ''}`} onClick={() => changeView('preview')}>👁 Preview</button>
        <button className={`sv-chip ${isKey ? 'active' : ''}`} onClick={() => changeView('marking-key')}>🗝 Marking key</button>
        <span className="sv-pages mono">📃 A4 · Portrait</span>
      </div>

      <div className="sv-preview-shell">
        <div className="sv-paper">
          {blocks.map((block, i) => <PaperBlock key={i} block={block} />)}
        </div>

        <div style={{ maxWidth: 720, margin: 'var(--sv-s4) auto 0', display: 'flex', gap: 'var(--sv-s2)', flexWrap: 'wrap' }}>
          <button className="sv-btn sv-btn-primary" onClick={() => onExport('pdf')} disabled={exporting}>
            {exporting ? '⏳ Working…' : `📄 ${isKey ? 'Download key PDF' : 'Download PDF'}`}
          </button>
          <button className="sv-btn sv-btn-dark" onClick={() => onExport('docx')} disabled={exporting}>
            📝 {isKey ? 'Download key Word' : 'Download Word'}
          </button>
          <button className="sv-btn sv-btn-outline" onClick={() => onExport('print')}>
            🖨 Print
          </button>
          {showSave && (
            <button className="sv-btn sv-btn-primary" onClick={onSave} disabled={saving} style={{ marginLeft: 'auto' }}>
              {saving ? 'Saving…' : `💾 Save · ${assessment.totalMarks || 0} marks`}
            </button>
          )}
          <button className="sv-btn sv-btn-outline" onClick={() => changeView('builder')} style={showSave ? {} : { marginLeft: 'auto' }}>
            ✏ Edit paper
          </button>
        </div>
      </div>
    </section>
  )
}

// Single-block renderer — switches on block.kind. Mirrors the shapes
// returned by buildPaperLayout in src/utils/assessmentPaperLayout.js.
function PaperBlock({ block }) {
  switch (block.kind) {
    case 'header': return <PaperHeaderBlock block={block} />
    case 'learnerFields': return <PaperLearnerFieldsBlock block={block} />
    case 'instructions': return <PaperInstructionsBlock block={block} />
    case 'sectionHeader': return <PaperSectionHead block={block} />
    case 'passage': return <PaperPassageBlock block={block} />
    case 'question': return <PaperQuestionBlock block={block} />
    case 'endOfPaper': return (
      <div style={{ textAlign: 'center', marginTop: 24, paddingTop: 12, borderTop: '1px solid #000', fontSize: 11.5, fontStyle: 'italic', color: '#555' }}>
        {block.text}
      </div>
    )
    case 'footerCode': return <div className="sv-paper-footer-code">{block.code}</div>
    default: return null
  }
}

function PaperHeaderBlock({ block }) {
  return (
    <div className="sv-paper-banner">
      <div className="sv-banner-left">
        <div className="sv-paper-logo">
          {block.logoUrl ? <img src={block.logoUrl} alt="School logo" /> : <span>📚</span>}
        </div>
      </div>
      <div className="sv-paper-banner-text">
        <div className="sv-pbn-school">{(block.schoolName || 'YOUR SCHOOL NAME').toUpperCase()}</div>
        <div className="sv-pbn-title">{block.title}</div>
        {block.subject && <div className="sv-pbn-subject">{block.subject}</div>}
        {block.paperName && <div className="sv-pbn-paper">{block.paperName}</div>}
      </div>
      <div className="sv-banner-right" aria-hidden="true" />
    </div>
  )
}

function PaperLearnerFieldsBlock({ block }) {
  return (
    <>
      {(block.name || block.date) && (
        <div className="sv-paper-name-row">
          {block.name && <><span>NAME:</span><div className="sv-line" /></>}
          {block.date && <><span>DATE:</span><div className="sv-line" style={{ maxWidth: 180 }} /></>}
        </div>
      )}
      {block.classField && (
        <div className="sv-paper-name-row" style={{ marginTop: 0 }}>
          <span>CLASS:</span><div className="sv-line" />
        </div>
      )}
      {block.marks && (
        <div className="sv-paper-total-marks">
          TOTAL MARKS: _________ / {block.totalMarks || '____'}
        </div>
      )}
    </>
  )
}

// Render instructions with inline-bold (A) (B) (C) (D). The raw text comes
// from the form's coverInstructions textarea — split on blank lines for
// paragraphs, then bold every (A)/(B)/(C)/(D) tag inline.
function PaperInstructionsBlock({ block }) {
  const paragraphs = String(block.text || '').split(/\n\s*\n/).filter(p => p.trim())
  return (
    <div className="sv-paper-instr-box">
      <span className="sv-instr-label">{block.isMarkingKey ? 'Marking key' : 'Instructions'}</span>
      {paragraphs.map((p, i) => (
        <p key={i}>{renderInlineOptionLetters(p.replace(/\n/g, ' '))}</p>
      ))}
    </div>
  )
}

function renderInlineOptionLetters(text) {
  const parts = []
  const pattern = /\(([A-D])\)/g
  let cursor = 0
  let match
  let key = 0
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) parts.push(<span key={key++}>{text.slice(cursor, match.index)}</span>)
    parts.push(<strong key={key++} className="sv-opt-tag">({match[1]})</strong>)
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) parts.push(<span key={key++}>{text.slice(cursor)}</span>)
  return parts
}

function PaperSectionHead({ block }) {
  return (
    <div className="sv-paper-section">
      <div className="sv-paper-section-head">
        Section {block.letter}{block.title ? ` — ${block.title}` : ''}
        <span className="sv-marks">({block.marks} mark{block.marks === 1 ? '' : 's'})</span>
      </div>
      {block.instructions && (
        <div className="sv-paper-section-instr">{block.instructions}</div>
      )}
    </div>
  )
}

function PaperPassageBlock({ block }) {
  return (
    <div className="sv-paper-passage">
      {block.title && <strong className="sv-pass-h">{block.title}</strong>}
      {block.text && block.text.split('\n\n').map((p, i) => <p key={i}>{p}</p>)}
      {block.imageUrl && (
        <div style={{ marginTop: 8, textAlign: 'center' }}>
          <img src={block.imageUrl} alt="" style={{ maxWidth: '100%' }} />
        </div>
      )}
    </div>
  )
}

function PaperQuestionBlock({ block }) {
  const marks = block.marks ?? 1
  return (
    <div className="sv-paper-q">
      <div className="sv-qline">
        <strong>{block.number}.</strong> {block.text || '(no question text)'}
        {marks > 1 && <em className="sv-qmarks">({marks}&nbsp;marks)</em>}
      </div>
      {block.imageUrl && (
        <div className="sv-paper-diagram"><img src={block.imageUrl} alt="" /></div>
      )}
      {block.wordBank?.length > 0 && (
        <div style={{ display: 'inline-block', border: '1px solid #000', padding: '4px 10px', margin: '4px 0', fontSize: 12 }}>
          <strong>Word bank:</strong> {block.wordBank.join(' · ')}
        </div>
      )}
      {block.type === 'mcq' && <PaperMcqOptions block={block} />}
      {(block.type === 'short_answer' || block.type === 'fill') && (
        <div className="sv-paper-answer-lines">
          {Array.from({ length: block.answerLines || 2 }).map((_, i) => <div className="sv-paper-answer-line" key={i} />)}
        </div>
      )}
      {block.type === 'diagram' && (
        <div className="sv-paper-answer-lines">
          {Array.from({ length: block.answerLines || 4 }).map((_, i) => <div className="sv-paper-answer-line" key={i} />)}
        </div>
      )}
      {block.type === 'essay' && (
        <div className="sv-paper-answer-lines">
          {Array.from({ length: block.answerLines || 8 }).map((_, i) => <div className="sv-paper-answer-line" key={i} />)}
        </div>
      )}
      {block.showAnswer && <PaperAnswerBlock block={block} />}
    </div>
  )
}

function PaperMcqOptions({ block }) {
  const correct = Number(block.correctAnswer)
  if (block.optionsMode === 'image') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, margin: '8px 0' }}>
        {(block.options || []).map((opt, i) => {
          const media = block.optionMedia?.[i]
          const isCorrect = block.showAnswer && correct === i
          return (
            <div key={i} style={{ border: `${isCorrect ? '2px solid #047857' : '1px solid #999'}`, borderRadius: 3, padding: 4, textAlign: 'center', background: '#fafafa' }}>
              <div style={{ aspectRatio: '1', display: 'grid', placeItems: 'center', background: 'white', borderRadius: 2, marginBottom: 2 }}>
                {media?.imageUrl
                  ? <img src={media.imageUrl} alt={media.alt || ''} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                  : <span style={{ fontSize: 24, color: '#999' }}>?</span>}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: isCorrect ? '#047857' : undefined }}>
                {SECTION_LETTERS[i]}.{opt ? ` ${opt}` : ''}{isCorrect ? ' ✓' : ''}
              </div>
            </div>
          )
        })}
      </div>
    )
  }
  if (block.optionsMode === 'mixed') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, margin: '6px 0' }}>
        {(block.options || []).map((opt, i) => {
          const media = block.optionMedia?.[i]
          const isCorrect = block.showAnswer && correct === i
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: 6, alignItems: 'center', padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3 }}>
              <strong style={{ color: isCorrect ? '#047857' : undefined }}>{SECTION_LETTERS[i]}.</strong>
              {media?.imageUrl
                ? <img src={media.imageUrl} alt={media.alt || ''} style={{ width: 40, height: 40, objectFit: 'contain' }} />
                : <span style={{ width: 40, height: 40, display: 'inline-block' }} />}
              <span style={{ color: isCorrect ? '#047857' : undefined, fontWeight: isCorrect ? 700 : 400 }}>
                {opt}{isCorrect ? ' ✓' : ''}
              </span>
            </div>
          )
        })}
      </div>
    )
  }
  const long = (block.options || []).some(o => String(o).length > 18)
  return (
    <div className={`sv-paper-options ${long ? 'stacked' : ''}`}>
      {(block.options || []).map((opt, i) => {
        const isCorrect = block.showAnswer && correct === i
        return (
          <div key={i} style={isCorrect ? { color: '#047857', fontWeight: 700 } : undefined}>
            <span className="sv-opt-letter">{SECTION_LETTERS[i]}.</span> {opt}{isCorrect ? '  ✓' : ''}
          </div>
        )
      })}
    </div>
  )
}

function PaperAnswerBlock({ block }) {
  let body = null
  if (block.type === 'mcq') {
    const i = Number(block.correctAnswer)
    const letter = SECTION_LETTERS[i] || '?'
    const opt = block.options?.[i] ?? ''
    body = <><strong>Answer:</strong> {letter}. {String(opt)}</>
  } else {
    body = <><strong>Expected answer:</strong> {String(block.correctAnswer ?? '')}</>
  }
  return (
    <div style={{ margin: '4px 0 4px 14px', padding: '4px 8px', background: '#ecfdf5', borderLeft: '3px solid #047857', fontSize: 12, color: '#047857' }}>
      <div>{body}</div>
      {block.explanation && (
        <div style={{ color: '#555', fontStyle: 'italic', fontSize: 11, marginTop: 2 }}>
          Notes: {block.explanation}
        </div>
      )}
    </div>
  )
}

/* ==================================================================
 * BLOCK PICKER SLIDE-OVER
 * ================================================================== */
function BlockPickerSlide({ open, onClose, onPick }) {
  return (
    <aside className={`sv-slideover ${open ? 'open' : ''}`}>
      <div className="sv-slideover-head">
        <button className="sv-icon-btn" onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 6, fontSize: 20 }}>✕</button>
        <h3 className="serif">Add a block<small>Drop into the document at the chosen position</small></h3>
      </div>
      <div className="sv-slideover-body">
        <div className="sv-block-cat">Structure</div>
        <div className="sv-block-picker-grid">
          <BlockPickerItem icon="📑" title="Section" hint="Container with title & instructions" onClick={() => onPick('section')} />
          <BlockPickerItem icon="📌" title="Part" hint="Coming soon" disabled />
          <BlockPickerItem icon="📋" title="Instructions" hint="Always rendered at top of paper" disabled />
          <BlockPickerItem icon="↵" title="Page break" hint="Coming soon" disabled />
        </div>

        <div className="sv-block-cat">Questions</div>
        <div className="sv-block-picker-grid">
          <BlockPickerItem icon="🔘" title="Multiple Choice" hint="4 options, text" onClick={() => onPick('mcq')} />
          <BlockPickerItem icon="✏" title="Short Answer" hint="1–3 lines" onClick={() => onPick('short_answer')} />
          <BlockPickerItem icon="📋" title="Structured" hint="Multi-part with marks" onClick={() => onPick('structured')} />
          <BlockPickerItem icon="📝" title="Essay" hint="Long-form with rubric" onClick={() => onPick('essay')} />
          <BlockPickerItem icon="✅" title="True / False" hint="Binary statement" onClick={() => onPick('true_false')} />
          <BlockPickerItem icon="📐" title="Fill in Blank" hint="Gap-fill sentence" onClick={() => onPick('fill_in_blank')} />
          <BlockPickerItem icon="↔" title="Matching" hint="Coming soon" disabled />
          <BlockPickerItem icon="🔢" title="Numeric" hint="Coming soon" disabled />
          <BlockPickerItem icon="🔤" title="Sequence" hint="Coming soon" disabled />
        </div>

        <div className="sv-block-cat">Media &amp; reading</div>
        <div className="sv-block-picker-grid">
          <BlockPickerItem icon="📖" title="Passage" hint="Comprehension passage" onClick={() => onPick('passage')} />
          <BlockPickerItem icon="🖼" title="Diagram-based" hint="Label or describe an image" onClick={() => onPick('structured')} />
          <BlockPickerItem icon="🎨" title="Draw & Label" hint="Coming soon" disabled />
          <BlockPickerItem icon="🗺" title="Map Question" hint="Coming soon" disabled />
          <BlockPickerItem icon="📊" title="Data / Table" hint="Coming soon" disabled />
          <BlockPickerItem icon="👁" title="Image Identify" hint="Coming soon" disabled />
        </div>

        <div className="sv-block-cat">AI-powered</div>
        <div className="sv-block-picker-grid">
          <BlockPickerItem
            icon="✨"
            title="Generate questions"
            hint="AI drafts from topic"
            gold
            onClick={() => onPick('ai_generate')}
          />
          <BlockPickerItem icon="🎨" title="Generate diagram" hint="Coming soon" gold disabled />
        </div>
      </div>
    </aside>
  )
}

function BlockPickerItem({ icon, title, hint, onClick, disabled, gold }) {
  return (
    <button
      className={`sv-bp-item ${gold ? 'gold' : ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      type="button"
    >
      <div className="sv-bp-ic">{icon}</div>
      <strong>{title}</strong>
      <small>{hint}</small>
    </button>
  )
}

/* ==================================================================
 * AI ASSISTANT SLIDE-OVER
 * ================================================================== */
function AiSlide({ open, onClose, aiForm, setAiForm, form, generating, onGenerate, onImport, importing, onAction, onGenerateDiagram, generatingDiagram, onOpenMarkingKey }) {
  const docInputRef = useRef(null)
  return (
    <aside className={`sv-slideover ${open ? 'open' : ''}`}>
      <div className="sv-slideover-head">
        <button className="sv-icon-btn" onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 6, fontSize: 20 }}>✕</button>
        <h3 className="serif">✨ Zed AI Assistant<small>Context-aware help for this paper</small></h3>
      </div>
      <div className="sv-slideover-body">
        <div className="sv-ai-msg">
          <strong>Generate questions on a CBC topic</strong>
          Pick a topic, count and type — I&apos;ll draft them and drop them into the builder. Always review before saving.
        </div>

        <div className="sv-field" style={{ marginBottom: 12 }}>
          <label>Topic</label>
          <input
            type="text"
            value={aiForm.topic}
            onChange={e => setAiForm(prev => ({ ...prev, topic: e.target.value }))}
            placeholder={`e.g. ${form.subject === 'Mathematics' ? 'Fractions' : 'Body systems'}`}
          />
        </div>
        <div className="sv-field-grid two">
          <div className="sv-field">
            <label>Count</label>
            <input
              type="number"
              min={1}
              max={10}
              value={aiForm.count}
              onChange={e => setAiForm(prev => ({ ...prev, count: clampInt(e.target.value, 1, 10, 5) }))}
            />
          </div>
          <div className="sv-field">
            <label>Type</label>
            <select
              value={aiForm.type}
              onChange={e => setAiForm(prev => ({ ...prev, type: e.target.value }))}
            >
              <option value="mcq">Multiple choice</option>
            </select>
          </div>
        </div>
        <button
          className="sv-btn sv-btn-primary sv-btn-full"
          onClick={() => onGenerate()}
          disabled={generating}
          style={{ marginTop: 12 }}
        >
          {generating ? '✦ Generating…' : '✦ Generate questions'}
        </button>

        <div className="sv-block-cat">Other tools</div>
        <div className="sv-ai-action-grid">
          <button
            className="sv-ai-action"
            onClick={() => docInputRef.current?.click()}
            disabled={importing}
          >
            <div className="sv-ic">📥</div>
            <div><strong>{importing ? 'Importing…' : 'Import Word / PDF'}</strong><small>Convert an existing paper into editable blocks</small></div>
            <input
              ref={docInputRef}
              type="file"
              accept={QUIZ_DOCUMENT_ACCEPT}
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) onImport(file)
                e.target.value = ''
              }}
            />
          </button>
          <button className="sv-ai-action" onClick={onOpenMarkingKey}>
            <div className="sv-ic">📑</div>
            <div><strong>Open marking key</strong><small>Auto-generated answers + explanations</small></div>
          </button>
          <DiagramGeneratorAction
            disabled={generatingDiagram}
            onGenerate={onGenerateDiagram}
          />
          <button className="sv-ai-action" disabled onClick={() => onAction('Balance paper difficulty')}>
            <div className="sv-ic">⚖</div>
            <div><strong>Balance paper difficulty</strong><small>Coming soon</small></div>
          </button>
          <button className="sv-ai-action" disabled onClick={() => onAction('Map to competencies')}>
            <div className="sv-ic">🎯</div>
            <div><strong>Map to competencies</strong><small>Coming soon</small></div>
          </button>
          <button className="sv-ai-action" disabled onClick={() => onAction('Detect duplicates')}>
            <div className="sv-ic">🔍</div>
            <div><strong>Detect duplicates</strong><small>Coming soon</small></div>
          </button>
        </div>
      </div>
    </aside>
  )
}

/* ==================================================================
 * DIAGRAM GENERATOR (inline mini-form inside AiSlide)
 *
 * Takes a free-form description ("Cross-section of human skin labelled
 * epidermis, dermis, hypodermis"), calls the Recraft-backed callable,
 * and the resulting Storage URL is added as the question image of a
 * fresh "structured" question via the parent's onGenerate handler.
 * ================================================================== */
function DiagramGeneratorAction({ disabled, onGenerate }) {
  const [prompt, setPrompt] = useState('')
  const [open, setOpen] = useState(false)
  return (
    <div className={`sv-ai-action ${open ? 'expanded' : ''}`} style={{ display: 'block', padding: 'var(--sv-s3)' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--sv-s3)', width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <div className="sv-ic">🎨</div>
        <div style={{ flex: 1 }}>
          <strong style={{ display: 'block', fontWeight: 600 }}>Generate diagram</strong>
          <small style={{ color: 'var(--sv-muted)', fontSize: 12 }}>B&W line art via Recraft</small>
        </div>
        <span style={{ color: 'var(--sv-muted)' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Describe the diagram (e.g. Cross-section of human skin labelled epidermis, dermis, hypodermis)"
            rows={3}
            style={{ width: '100%', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: 8, fontSize: 13, background: 'var(--sv-paper)', fontFamily: 'inherit', resize: 'vertical' }}
            disabled={disabled}
          />
          <button
            type="button"
            className="sv-btn sv-btn-primary sv-btn-full"
            disabled={disabled || !prompt.trim()}
            onClick={() => onGenerate(prompt.trim()).then(() => setPrompt(''))}
          >
            {disabled ? '⏳ Generating…' : '✨ Generate diagram'}
          </button>
          <small style={{ color: 'var(--sv-muted)', fontSize: 11 }}>
            The image is added as a new structured question with the prompt as its question text. Counts toward your monthly diagram quota.
          </small>
        </div>
      )}
    </div>
  )
}

/* ==================================================================
 * QUESTION EDITOR SLIDE-OVER
 * ================================================================== */
function EditorSlide({ open, onClose, targetKey, sections, onUpdateStandaloneQuestion, onUpdatePassageQuestion, questionNumbers }) {
  // Find the target question
  const target = useMemo(() => {
    if (!targetKey) return null
    for (let i = 0; i < sections.length; i += 1) {
      const section = sections[i]
      if (section.kind === 'passage') {
        const idx = (section.passage.questions || []).findIndex(q => q.localId === targetKey)
        if (idx >= 0) {
          return { kind: 'passage', sectionIndex: i, questionIndex: idx, question: section.passage.questions[idx] }
        }
      } else if (section.question?.localId === targetKey) {
        return { kind: 'standalone', sectionIndex: i, question: section.question }
      }
    }
    return null
  }, [targetKey, sections])

  if (!open || !target) {
    return (
      <aside className={`sv-slideover ${open ? 'open' : ''}`}>
        <div className="sv-slideover-head">
          <button className="sv-icon-btn" onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 6, fontSize: 20 }}>✕</button>
          <h3 className="serif">Edit Question<small>Select a question to edit</small></h3>
        </div>
        <div className="sv-slideover-body">
          <p style={{ color: 'var(--sv-muted)', fontSize: 13 }}>No question selected.</p>
        </div>
      </aside>
    )
  }

  const update = (field, value) => {
    if (target.kind === 'passage') {
      onUpdatePassageQuestion(target.sectionIndex, target.questionIndex, field, value)
    } else {
      onUpdateStandaloneQuestion(target.sectionIndex, field, value)
    }
  }

  const num = questionNumbers[target.question.localId] || ''
  const question = target.question
  const type = question.type || 'mcq'

  return (
    <aside className={`sv-slideover ${open ? 'open' : ''}`}>
      <div className="sv-slideover-head">
        <button className="sv-icon-btn" onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 6, fontSize: 20 }}>✕</button>
        <h3 className="serif">Edit Question<small>Q{num} · {type.toUpperCase()}</small></h3>
      </div>
      <div className="sv-slideover-body">
        <div className="sv-field">
          <label>Question text</label>
          <textarea
            value={toEditableText(question.text)}
            onChange={e => update('text', e.target.value)}
            rows={4}
          />
        </div>

        {target.kind === 'standalone' && (
          <div className="sv-field" style={{ marginTop: 12 }}>
            <label>Question type</label>
            <select
              value={type}
              onChange={e => update('type', e.target.value)}
            >
              <option value="mcq">Multiple choice</option>
              <option value="short_answer">Short answer</option>
              <option value="diagram">Structured / diagram</option>
              <option value="essay">Essay</option>
            </select>
          </div>
        )}

        <div className="sv-field-grid two" style={{ marginTop: 12 }}>
          <div className="sv-field">
            <label>Marks</label>
            <input
              type="number"
              value={question.marks || 1}
              onChange={e => update('marks', clampInt(e.target.value, 0, 100, 1))}
            />
          </div>
          <div className="sv-field">
            <label>Topic (optional)</label>
            <input
              type="text"
              value={question.topic || ''}
              onChange={e => update('topic', e.target.value)}
              placeholder="e.g. Respiratory system"
            />
          </div>
        </div>

        {type === 'mcq' && (
          <>
            <div className="sv-block-cat" style={{ marginTop: 16 }}>Options</div>
            <McqOptions
              question={question}
              onChangeOption={(optIndex, value) => {
                const next = [...(question.options || ['', '', '', ''])]
                next[optIndex] = value
                update('options', next)
              }}
              onSelectCorrect={(optIndex) => update('correctAnswer', optIndex)}
            />
          </>
        )}

        {(type === 'short_answer' || type === 'fill' || type === 'diagram') && (
          <div className="sv-field" style={{ marginTop: 12 }}>
            <label>Expected answer (used for marking key)</label>
            <textarea
              value={String(question.correctAnswer ?? '')}
              onChange={e => update('correctAnswer', e.target.value)}
              rows={3}
            />
          </div>
        )}

        <div className="sv-field" style={{ marginTop: 12 }}>
          <label>Explanation (optional, for marking key)</label>
          <textarea
            value={toEditableText(question.explanation)}
            onChange={e => update('explanation', e.target.value)}
            rows={2}
            placeholder="Why is this the correct answer?"
          />
        </div>
      </div>
      <div className="sv-slideover-foot">
        <button className="sv-btn sv-btn-primary sv-btn-full" onClick={onClose}>Done</button>
      </div>
    </aside>
  )
}
