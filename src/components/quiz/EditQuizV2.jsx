import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import { storage } from '../../firebase/config'
import {
  createPartGroup,
  createPassageSection,
  createStandaloneSection,
  getQuestionKey,
  hydrateQuizSections,
  serializeQuizSections,
} from '../../utils/quizSections.js'
import { richTextHasContent } from '../../utils/quizRichText.js'
import { clampInt } from '../../utils/inputs.js'
import { getErrorMessage } from '../../utils/errors.js'
import { validateStandaloneQuestion as sharedValidateStandaloneQuestion } from '../../utils/quizValidation.js'
import QuizSectionsEditor from './QuizSectionsEditor'
import QuizEditorPreviewPanel from './QuizEditorPreviewPanel'

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
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const STATUS_META = {
  draft: { label: 'Draft', dot: 'bg-[var(--text-muted)]', pill: 'theme-bg-subtle theme-text-muted theme-border border' },
  pending: { label: 'Pending', dot: 'bg-yellow-400', pill: 'bg-yellow-100 text-yellow-700' },
  published: { label: 'Published', dot: 'bg-green-500', pill: 'bg-green-100 text-green-700' },
  rejected: { label: 'Rejected', dot: 'bg-red-500', pill: 'bg-red-100 text-red-600' },
}

const FIELD = 'theme-input w-full rounded-xl border-2 px-3 py-2.5 text-sm placeholder:text-gray-400 outline-none transition-colors focus:border-[var(--accent)]'
const SELECT = 'theme-input rounded-xl border-2 px-3 py-2.5 text-sm outline-none transition-colors focus:border-[var(--accent)]'

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
    if (section.kind === 'passage') return section.passage?.imageUploading
    return section.question?.imageUploading
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
  const { getQuizById, getQuestions, updateQuizWithQuestions } = useFirestore()
  const { currentUser, isAdmin } = useAuth()

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [form, setForm] = useState({
    title: '',
    subject: 'Mathematics',
    grade: '5',
    term: '1',
    duration: 30,
    type: 'quiz',
    topic: '',
    isDemo: false,
  })
  const [quizStatus, setQuizStatus] = useState('draft')
  const [quizOwner, setQuizOwner] = useState(null)
  const [sections, setSections] = useState([])
  const [parts, setParts] = useState([])
  const [deletedIds, setDeletedIds] = useState([])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [dirty, setDirty] = useState(false)

  const serializedPreview = serializeQuizSections(sections, parts)
  const questionNumbers = buildQuestionNumberMap(serializedPreview.questions)
  const questionCount = serializedPreview.questionCount
  const totalMarks = serializedPreview.totalMarks
  const passageCount = serializedPreview.passages.length
  const newCount = serializedPreview.questions.filter(question => !question._id).length
  const imagesCount = countImages(sections)
  const anyUploading = hasUploadingAssets(sections)
  const statusMeta = STATUS_META[quizStatus] ?? STATUS_META.draft
  const backPath = isAdmin ? '/admin/content' : '/teacher/content'
  const canEdit = isAdmin || quizOwner === currentUser?.uid
  const gradeOptions = withCurrentOption(GRADES, form.grade)
  const subjectOptions = withCurrentOption(SUBJECTS, form.subject)
  const termOptions = withCurrentOption(TERMS, form.term)

  function show(message, isErr = false) {
    setToast({ message, isErr })
    setTimeout(() => setToast(null), 4000)
  }

  function setF(field, value) {
    setForm(current => ({ ...current, [field]: value }))
    setDirty(true)
  }

  useEffect(() => {
    if (!quizId || !currentUser?.uid) return
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
        subject: quiz.subject ?? 'Mathematics',
        grade: quiz.grade ?? '5',
        term: quiz.term ?? '1',
        duration: quiz.duration ?? 30,
        type: quiz.type ?? 'quiz',
        topic: quiz.topic ?? '',
        isDemo: quiz.isDemo ?? false,
        mode: quiz.mode ?? '',
        importStatus: quiz.importStatus ?? '',
        sourceFileName: quiz.sourceFileName ?? '',
        sourceContentType: quiz.sourceContentType ?? '',
        importWarnings: quiz.importWarnings ?? [],
      })
      setQuizStatus(quiz.status ?? (quiz.isPublished ? 'published' : 'draft'))
      setQuizOwner(quiz.createdBy)
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

  async function handleSave(mode = 'draft') {
    if (!validate()) return
    setSaving(true)

    try {
      const serializedSections = serializeQuizSections(sections, parts)
      const isPublished = mode === 'published'
      await updateQuizWithQuestions(
        quizId,
        {
          ...form,
          passages: serializedSections.passages,
          parts: serializedSections.parts,
          passageCount: serializedSections.passages.length,
          status: mode,
          isPublished,
          updatedBy: currentUser.uid,
          ...(mode === 'pending' && { submittedAt: new Date() }),
          ...(mode === 'published' && { approvedBy: currentUser.uid }),
        },
        serializedSections.questions,
        deletedIds,
      )

      setQuizStatus(mode)
      setDeletedIds([])
      setDirty(false)
      show(mode === 'published' ? 'Quiz published!' : mode === 'pending' ? 'Submitted for approval!' : 'Changes saved as draft.')
      setTimeout(() => navigate(backPath), 1400)
    } catch (error) {
      console.error('EditQuiz save error:', error)
      show(`Save failed: ${getErrorMessage(error, 'unexpected error')}`, true)
      setSaving(false)
    }
  }

  async function handleTogglePublish() {
    if (!isAdmin) return
    setSaving(true)
    try {
      const nextStatus = quizStatus === 'published' ? 'draft' : 'published'
      const serializedSections = serializeQuizSections(sections, parts)
      await updateQuizWithQuestions(
        quizId,
        {
          ...form,
          passages: serializedSections.passages,
          parts: serializedSections.parts,
          passageCount: serializedSections.passages.length,
          status: nextStatus,
          isPublished: nextStatus === 'published',
          updatedBy: currentUser.uid,
        },
        serializedSections.questions,
        deletedIds,
      )
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
    <div className="theme-text space-y-5 pb-10">
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
              <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${statusMeta.pill}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dot}`} />
                {statusMeta.label}
              </span>
              {dirty && <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-600">● Unsaved changes</span>}
            </div>
            <p className="theme-text-muted mt-1 text-body-sm">{form.title || 'Untitled quiz'} · {questionCount} questions</p>
          </div>
        </div>
        {isAdmin && (
          <button type="button" onClick={handleTogglePublish} disabled={saving || anyUploading} className={`min-h-0 rounded-xl border-2 px-4 py-2 text-sm font-black transition-all duration-fast ease-out shadow-elev-sm hover:-translate-y-px hover:shadow-elev-md disabled:opacity-40 ${
            quizStatus === 'published' ? 'border-yellow-300 text-yellow-700 hover:bg-yellow-50' : 'border-green-300 text-green-700 hover:bg-green-50'
          }`}>
            {quizStatus === 'published' ? '📦 Unpublish' : '🚀 Publish'}
          </button>
        )}
      </div>

      <div className="theme-card theme-border space-y-4 rounded-2xl border p-5 shadow-elev-sm">
        <h2 className="text-display-md theme-text flex items-center gap-2" style={{ fontSize: 17 }}>
          <span aria-hidden="true">📋</span> Quiz details
        </h2>
        <div className="space-y-3">
          <input value={form.title} onChange={event => setF('title', event.target.value)} placeholder="Quiz title (e.g. Grade 6 Science - Human Body)" className={FIELD} />
          <input value={form.topic || ''} onChange={event => setF('topic', event.target.value)} placeholder="Topic (optional, e.g. Photosynthesis)" className={FIELD} />
          <div className="grid gap-3 sm:grid-cols-4">
            <select value={form.grade} onChange={event => setF('grade', event.target.value)} className={SELECT}>{gradeOptions.map(grade => <option key={grade} value={grade}>Grade {grade}</option>)}</select>
            <select value={form.subject} onChange={event => setF('subject', event.target.value)} className={SELECT}>{subjectOptions.map(subject => <option key={subject} value={subject}>{subject}</option>)}</select>
            <select value={form.term} onChange={event => setF('term', event.target.value)} className={SELECT}>{termOptions.map(term => <option key={term} value={term}>Term {term}</option>)}</select>
            <div className="theme-border flex items-center gap-2 rounded-xl border-2 px-3 py-2.5">
              <span className="theme-text-muted whitespace-nowrap text-xs font-bold">⏱️ Mins</span>
              <input type="number" min={5} max={180} value={form.duration} onChange={event => setF('duration', clampInt(event.target.value, 5, 180, 30))} className="flex-1 bg-transparent text-sm font-black outline-none" />
            </div>
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
        </div>
      </div>

      {form.mode === 'imported_document' && (
        <div className={`rounded-2xl border px-4 py-3 ${
          form.importStatus === 'needs_review' ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'
        }`}>
          <p className={`text-sm font-black ${form.importStatus === 'needs_review' ? 'text-amber-900' : 'text-emerald-900'}`}>Imported from Word/PDF</p>
          <p className={`mt-1 text-xs font-bold leading-relaxed ${form.importStatus === 'needs_review' ? 'text-amber-800' : 'text-emerald-800'}`}>
            Source: {form.sourceFileName || 'document'} · Status: {form.importStatus || 'success'} · Check all marked questions before publishing.
          </p>
        </div>
      )}

      <QuizSectionsEditor
        variant="edit"
        sections={sections}
        parts={parts}
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
        onAddPart={addPart}
        onPartChange={updatePart}
        onPartMove={movePart}
        onPartRemove={removePart}
        onAssignSectionToPart={assignSectionToPart}
      />

      <QuizEditorPreviewPanel form={form} serializedSections={serializedPreview} />

      {deletedIds.length > 0 && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="flex-shrink-0 text-base">🗑️</span>
          <span><strong>{deletedIds.length} question{deletedIds.length > 1 ? 's' : ''}</strong> will be permanently deleted from Firestore when you save.</span>
        </div>
      )}

      <div className="theme-card theme-border space-y-3 rounded-2xl border p-4 shadow-elev-sm">
        <p className="text-eyebrow">Save options</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <button type="button" onClick={() => handleSave('draft')} disabled={saving || anyUploading} className="theme-card theme-border theme-text hover:border-[var(--accent)] hover:theme-accent-text flex min-h-0 items-center justify-center gap-2 rounded-2xl border-2 py-3 font-black transition-all duration-fast ease-out shadow-elev-sm hover:-translate-y-px hover:shadow-elev-md disabled:opacity-40 disabled:pointer-events-none">
            <span aria-hidden="true">💾</span>
            <span>{saving ? 'Saving…' : anyUploading ? 'Uploading…' : 'Save draft'}</span>
          </button>
          {!isAdmin && (
            <button type="button" onClick={() => handleSave('pending')} disabled={saving || anyUploading} className="theme-accent-fill theme-on-accent flex min-h-0 items-center justify-center gap-2 rounded-2xl py-3 font-black transition-all duration-fast ease-out shadow-elev-sm shadow-elev-inner-hl hover:-translate-y-px hover:shadow-elev-md disabled:opacity-40 disabled:pointer-events-none">
              <span aria-hidden="true">📤</span>
              <span>{saving ? 'Submitting…' : 'Submit for approval'}</span>
            </button>
          )}
          {isAdmin && (
            <>
              <button type="button" onClick={() => handleSave('pending')} disabled={saving || anyUploading} className="flex min-h-0 items-center justify-center gap-2 rounded-2xl border-2 border-yellow-400 py-3 font-black text-yellow-700 transition-all duration-fast ease-out shadow-elev-sm hover:-translate-y-px hover:shadow-elev-md hover:bg-yellow-50 disabled:opacity-40 disabled:pointer-events-none">
                <span aria-hidden="true">⏳</span>
                <span>{saving ? 'Saving…' : 'Save as pending'}</span>
              </button>
              <button type="button" onClick={() => handleSave('published')} disabled={saving || anyUploading} className="theme-accent-fill theme-on-accent flex min-h-0 items-center justify-center gap-2 rounded-2xl py-3 font-black transition-all duration-fast ease-out shadow-elev-sm shadow-elev-inner-hl hover:-translate-y-px hover:shadow-elev-md disabled:opacity-40 disabled:pointer-events-none">
                <span aria-hidden="true">🚀</span>
                <span>{saving ? 'Publishing…' : 'Save & publish'}</span>
              </button>
            </>
          )}
        </div>
        <p className={`text-center text-xs font-bold ${dirty ? 'text-warning' : 'text-success'}`}>
          {dirty ? '⚠️ You have unsaved changes.' : '✓ All changes saved.'}
        </p>
      </div>
    </div>
  )
}
