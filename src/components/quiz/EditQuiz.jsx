/**
 * EditQuiz.jsx
 * Load an existing quiz + its questions, edit everything, and save back.
 * Shared by admin (/admin/quizzes/:quizId/edit)
 *           and teacher (/teacher/quizzes/:quizId/edit — own quizzes only)
 */
import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import { storage } from '../../firebase/config'

// ── Constants ──────────────────────────────────────────────────────────────
const SUBJECTS = [
  'Mathematics', 'English', 'Integrated Science', 'Social Studies',
  'Technology Studies', 'Home Economics', 'Expressive Arts',
]
const GRADES = ['4', '5', '6', '7']
const TERMS  = ['1', '2', '3']
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const STATUS_META = {
  draft:     { label: 'Draft',     dot: 'bg-gray-400',   pill: 'bg-gray-100 text-gray-600'   },
  pending:   { label: 'Pending',   dot: 'bg-yellow-400', pill: 'bg-yellow-100 text-yellow-700' },
  published: { label: 'Published', dot: 'bg-green-500',  pill: 'bg-green-100 text-green-700'  },
  rejected:  { label: 'Rejected',  dot: 'bg-red-500',    pill: 'bg-red-100 text-red-600'    },
}

const FIELD  = 'w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none transition-colors'
const SELECT = 'border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none transition-colors'

// ── Image compress helper ──────────────────────────────────────────────────
function compressImage(file, maxWidth = 1200, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        b => b ? resolve(b) : reject(new Error('Canvas compression failed')),
        'image/jpeg', quality,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')) }
    img.src = url
  })
}

function emptyQuestion() {
  return {
    _id: null,               // null → new question (no Firestore doc yet)
    text: '', options: ['', '', '', ''], correctAnswer: 0,
    explanation: '', topic: '', marks: 1, type: 'mcq',
    imageUrl: '', imageUploading: false, imageUploadStep: '',
    diagramText: '',
  }
}

// ── Image upload widget ────────────────────────────────────────────────────
function QuestionImageUpload({ imageUrl, uploading, uploadStep, onFileSelect, onRemove }) {
  const inputRef = useRef(null)
  function handleChange(e) { const f = e.target.files[0]; if (f) onFileSelect(f); e.target.value = '' }

  if (uploading) {
    const isCompressing = uploadStep === 'compressing'
    return (
      <div className="border-2 border-blue-200 bg-blue-50 rounded-xl p-4 text-center space-y-2">
        <div className="flex items-center justify-center gap-2">
          <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-blue-700 text-sm font-bold">
            {isCompressing ? 'Compressing image…' : 'Uploading…'}
          </p>
        </div>
        <div className="flex items-center justify-center gap-2 text-xs text-blue-500">
          <span className={`flex items-center gap-1 ${!isCompressing ? 'text-green-500 font-bold' : 'font-bold'}`}>
            {!isCompressing ? '✓' : '●'} Compress
          </span>
          <span className="text-blue-300">→</span>
          <span className={`flex items-center gap-1 ${!isCompressing ? 'font-bold' : 'text-blue-300'}`}>
            {!isCompressing ? '●' : '○'} Upload
          </span>
        </div>
      </div>
    )
  }

  if (imageUrl) {
    return (
      <div className="relative rounded-xl overflow-hidden border-2 border-blue-200 bg-gray-50 group">
        <img src={imageUrl} alt="Question diagram" className="w-full max-h-52 object-contain py-2" />
        <div className="absolute top-2 right-2 flex gap-1.5 opacity-90 group-hover:opacity-100 transition-opacity">
          <button type="button" onClick={() => inputRef.current?.click()}
            className="bg-white text-gray-700 text-xs font-bold px-3 py-1.5 rounded-lg shadow border border-gray-200 hover:bg-gray-50 min-h-0">
            🔄 Replace
          </button>
          <button type="button" onClick={onRemove}
            className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg shadow min-h-0">
            ✕ Remove
          </button>
        </div>
        <p className="text-xs text-gray-400 text-center pb-1">Question image</p>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleChange} />
      </div>
    )
  }

  return (
    <div>
      <button type="button" onClick={() => inputRef.current?.click()}
        className="w-full border-2 border-dashed border-gray-200 hover:border-blue-400 hover:bg-blue-50 rounded-xl p-4 text-center transition-all min-h-0 bg-transparent shadow-none group">
        <div className="text-2xl mb-1 group-hover:scale-110 transition-transform inline-block">🖼️</div>
        <p className="text-gray-500 font-bold text-xs">Upload Diagram / Image</p>
        <p className="text-gray-400 text-xs mt-0.5">Optional · JPG, PNG, WEBP · max 5 MB</p>
      </button>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleChange} />
    </div>
  )
}

// ── Question card ──────────────────────────────────────────────────────────
function QuestionCard({ q, qi, total, onChange, onRemove, onMove, onImageUpload, onImageRemove, isNew }) {
  function set(field, val) { onChange(qi, field, val) }
  function setOpt(oi, val) {
    const opts = [...q.options]; opts[oi] = val; onChange(qi, 'options', opts)
  }
  const isTF = q.type === 'truefalse'

  return (
    <div className={`bg-white rounded-2xl border-2 p-5 space-y-4 shadow-sm transition-colors ${
      isNew ? 'border-blue-200 ring-2 ring-blue-100' : 'border-gray-100'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`font-black text-xs px-3 py-1 rounded-full ${
            isNew ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
          }`}>
            {isNew ? '✦ NEW' : `Q${qi + 1}`}
          </span>
          {!isNew && <span className="text-gray-400 text-xs font-bold">of {total}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <select value={q.type}
            onChange={e => {
              set('type', e.target.value)
              if (e.target.value === 'truefalse') {
                onChange(qi, 'options', ['True', 'False']); onChange(qi, 'correctAnswer', 0)
              } else if (q.options.length < 4) { onChange(qi, 'options', ['', '', '', '']) }
            }}
            className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:border-blue-500 focus:outline-none">
            <option value="mcq">MCQ</option>
            <option value="truefalse">True / False</option>
          </select>
          <button onClick={() => onMove(qi, -1)} disabled={qi === 0}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-sm min-h-0 bg-transparent shadow-none p-1">↑</button>
          <button onClick={() => onMove(qi, 1)} disabled={qi === total - 1}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-sm min-h-0 bg-transparent shadow-none p-1">↓</button>
          {total > 1 && (
            <button onClick={() => onRemove(qi)}
              className="text-red-400 hover:text-red-600 text-xs font-bold min-h-0 bg-transparent shadow-none p-1 hover:bg-red-50 rounded-lg px-2 transition-colors">
              ✕ Remove
            </button>
          )}
        </div>
      </div>

      {/* Image */}
      <QuestionImageUpload
        imageUrl={q.imageUrl} uploading={q.imageUploading} uploadStep={q.imageUploadStep}
        onFileSelect={file => onImageUpload(qi, file)}
        onRemove={() => onImageRemove(qi)}
      />

      {/* Question text */}
      <textarea value={q.text} onChange={e => set('text', e.target.value)}
        placeholder="Write your question here…"
        rows={3}
        className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none resize-none leading-relaxed transition-colors" />

      {/* Options */}
      <div className="space-y-2">
        <p className="text-xs font-bold text-gray-500">Answer choices — select the correct one</p>
        {q.options.map((opt, oi) => (
          <label key={oi}
            className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
              q.correctAnswer === oi ? 'border-green-400 bg-green-50' : 'border-gray-100 hover:border-gray-200'
            }`}>
            <input type="radio" name={`correct-${qi}`} checked={q.correctAnswer === oi}
              onChange={() => set('correctAnswer', oi)} className="accent-green-600 flex-shrink-0" />
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${
              q.correctAnswer === oi ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600'
            }`}>
              {isTF ? (oi === 0 ? 'T' : 'F') : ['A','B','C','D'][oi]}
            </span>
            <input value={opt} onChange={e => setOpt(oi, e.target.value)}
              placeholder={isTF ? (oi === 0 ? 'True' : 'False') : `Option ${['A','B','C','D'][oi]}`}
              disabled={isTF}
              className="flex-1 bg-transparent border-none outline-none text-sm text-gray-800 disabled:text-gray-500" />
            {q.correctAnswer === oi && <span className="text-green-500 text-xs font-black flex-shrink-0">✓ Correct</span>}
          </label>
        ))}
      </div>

      {/* Diagram text + explanation + meta */}
      <div className="space-y-2">
        <textarea value={q.diagramText || ''} onChange={e => set('diagramText', e.target.value)}
          placeholder="Diagram description (optional) — e.g. [Diagram: A cross-section of a flower…]"
          rows={2}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-600 focus:border-blue-500 focus:outline-none resize-none transition-colors" />
        <input value={q.explanation} onChange={e => set('explanation', e.target.value)}
          placeholder="Explanation (optional) — shown after answering"
          className={FIELD} />
        <div className="flex gap-2">
          <input value={q.topic} onChange={e => set('topic', e.target.value)}
            placeholder="Topic (e.g. Fractions)"
            className="flex-1 border border-gray-200 rounded-lg px-2.5 py-2 text-xs focus:border-blue-500 focus:outline-none transition-colors" />
          <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2.5 py-2">
            <span className="text-xs text-gray-500 font-bold">Marks:</span>
            <input type="number" min={1} max={10} value={q.marks}
              onChange={e => set('marks', +e.target.value)}
              className="w-10 text-xs font-black text-center focus:outline-none bg-transparent" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Stats bar ──────────────────────────────────────────────────────────────
function StatPill({ label, value, color = 'bg-gray-100 text-gray-600' }) {
  return (
    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${color}`}>{value} {label}</span>
  )
}

// ── Main EditQuiz component ────────────────────────────────────────────────
export default function EditQuiz() {
  const { quizId } = useParams()
  const { getQuizById, getQuestions, updateQuizWithQuestions, submitForApproval, approveContent } = useFirestore()
  const { currentUser, isAdmin } = useAuth()
  const navigate = useNavigate()

  // ── Loading state ──────────────────────────────────────────────────────
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)

  // ── Form state ─────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    title: '', subject: 'Mathematics', grade: '5', term: '1', duration: 30, type: 'quiz', topic: '',
  })
  const [quizStatus, setQuizStatus] = useState('draft')   // current Firestore status
  const [quizOwner,  setQuizOwner]  = useState(null)

  // ── Questions state ────────────────────────────────────────────────────
  const [questions, setQuestions]   = useState([])
  const [deletedIds, setDeletedIds] = useState([])  // Firestore question doc IDs to delete on save

  // ── UI state ───────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [toast, setToast]   = useState(null)
  const [dirty, setDirty]   = useState(false)   // unsaved changes indicator

  function show(msg, isErr = false) { setToast({ msg, isErr }); setTimeout(() => setToast(null), 4000) }
  function setF(field, val) { setForm(f => ({ ...f, [field]: val })); setDirty(true) }

  // ── Load quiz + questions ──────────────────────────────────────────────
  useEffect(() => {
    if (!quizId) return
    async function load() {
      setLoading(true)
      const [quiz, qs] = await Promise.all([getQuizById(quizId), getQuestions(quizId)])
      if (!quiz) { setNotFound(true); setLoading(false); return }

      // Permission: teacher can only edit their own quiz
      if (!isAdmin && quiz.createdBy !== currentUser?.uid) {
        setNotFound(true); setLoading(false); return
      }

      setForm({
        title:    quiz.title    ?? '',
        subject:  quiz.subject  ?? 'Mathematics',
        grade:    quiz.grade    ?? '5',
        term:     quiz.term     ?? '1',
        duration: quiz.duration ?? 30,
        type:     quiz.type     ?? 'quiz',
        topic:    quiz.topic    ?? '',
      })
      setQuizStatus(quiz.status ?? (quiz.isPublished ? 'published' : 'draft'))
      setQuizOwner(quiz.createdBy)

      // Map Firestore docs → local question objects
      setQuestions(qs.map(q => ({
        _id:           q.id,                    // Firestore doc ID
        text:          q.text          ?? '',
        options:       q.options       ?? ['', '', '', ''],
        correctAnswer: q.correctAnswer ?? 0,
        explanation:   q.explanation   ?? '',
        topic:         q.topic         ?? '',
        marks:         q.marks         ?? 1,
        type:          q.type          ?? 'mcq',
        imageUrl:      q.imageUrl      ?? '',
        diagramText:   q.diagramText   ?? '',
        imageUploading: false,
        imageUploadStep: '',
      })))
      setDeletedIds([])
      setDirty(false)
      setLoading(false)
    }
    load()
  }, [quizId])

  // ── Question mutations ─────────────────────────────────────────────────
  function handleQChange(qi, field, val) {
    setQuestions(qs => qs.map((q, i) => i === qi ? { ...q, [field]: val } : q))
    setDirty(true)
  }

  function addQuestion() {
    setQuestions(qs => [...qs, emptyQuestion()])
    setDirty(true)
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50)
  }

  function removeQuestion(qi) {
    const q = questions[qi]
    if (q._id) setDeletedIds(ids => [...ids, q._id])     // queue for deletion on save
    setQuestions(qs => qs.filter((_, i) => i !== qi))
    setDirty(true)
  }

  function moveQuestion(qi, dir) {
    setQuestions(qs => {
      const arr = [...qs]; const target = qi + dir
      if (target < 0 || target >= arr.length) return arr
      ;[arr[qi], arr[target]] = [arr[target], arr[qi]]
      return arr
    })
    setDirty(true)
  }

  // ── Image upload ───────────────────────────────────────────────────────
  async function uploadQuestionImage(qi, file) {
    if (!ALLOWED_TYPES.includes(file.type)) { show('❌ Only JPG, PNG, WEBP allowed.', true); return }
    if (file.size > 15 * 1024 * 1024) { show('❌ Image must be under 15 MB.', true); return }
    setQuestions(qs => qs.map((q, i) => i === qi
      ? { ...q, imageUploading: true, imageUploadStep: 'compressing', imageUrl: '' } : q))
    try {
      const compressed = await compressImage(file)
      setQuestions(qs => qs.map((q, i) => i === qi ? { ...q, imageUploadStep: 'uploading' } : q))
      const path = `quiz-images/${currentUser.uid}/${Date.now()}-q${qi}.jpg`
      const snap = await uploadBytes(storageRef(storage, path), compressed, { contentType: 'image/jpeg' })
      const url  = await getDownloadURL(snap.ref)
      setQuestions(qs => qs.map((q, i) => i === qi
        ? { ...q, imageUrl: url, imageUploading: false, imageUploadStep: '' } : q))
      show(`✅ Image uploaded (${Math.round(compressed.size / 1024)} KB)`)
    } catch (e) {
      setQuestions(qs => qs.map((q, i) => i === qi ? { ...q, imageUploading: false, imageUploadStep: '' } : q))
      show('❌ Upload failed: ' + e.message, true)
    }
  }

  function removeQuestionImage(qi) { handleQChange(qi, 'imageUrl', '') }

  // ── Validation ─────────────────────────────────────────────────────────
  function validate() {
    if (!form.title.trim()) { show('❌ Quiz title is required.', true); return false }
    if (questions.length === 0) { show('❌ Add at least one question.', true); return false }
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      if (q.imageUploading) { show(`❌ Q${i+1} image is still uploading — please wait.`, true); return false }
      if (!q.text.trim())   { show(`❌ Q${i+1} question text is empty.`, true); return false }
      if (q.type === 'mcq' && q.options.some(o => !o.trim())) {
        show(`❌ Q${i+1} has empty option(s).`, true); return false
      }
    }
    return true
  }

  // ── Save logic ─────────────────────────────────────────────────────────
  // mode: 'draft' | 'pending' | 'published'
  async function handleSave(mode = 'draft') {
    if (!validate()) return
    setSaving(true)
    try {
      const newStatus   = mode
      const isPublished = mode === 'published'

      await updateQuizWithQuestions(
        quizId,
        {
          ...form,
          status:      newStatus,
          isPublished,
          updatedBy:   currentUser.uid,
          ...(mode === 'pending' && { submittedAt: new Date() }),
          ...(mode === 'published' && { approvedBy: currentUser.uid }),
        },
        questions,
        deletedIds,
      )

      setQuizStatus(newStatus)
      setDeletedIds([])
      setDirty(false)

      const msgs = {
        draft:     '💾 Changes saved as draft.',
        pending:   '📤 Submitted for approval!',
        published: '🚀 Quiz published!',
      }
      show(msgs[mode] ?? '✅ Saved!')

      // Redirect after brief toast
      setTimeout(() => {
        navigate(isAdmin ? '/admin/content' : '/teacher/content')
      }, 1400)
    } catch (e) {
      console.error('EditQuiz save error:', e)
      show('❌ Save failed: ' + e.message, true)
      setSaving(false)
    }
  }

  // ── Publish / Unpublish toggle (admin-only, no full save) ──────────────
  async function handleTogglePublish() {
    if (!isAdmin) return
    setSaving(true)
    try {
      const next = quizStatus === 'published' ? 'draft' : 'published'
      await updateQuizWithQuestions(
        quizId,
        { ...form, status: next, isPublished: next === 'published', updatedBy: currentUser.uid },
        questions,
        deletedIds,
      )
      setQuizStatus(next)
      setDeletedIds([])
      setDirty(false)
      show(next === 'published' ? '🚀 Quiz published!' : '📦 Quiz unpublished.')
    } catch (e) {
      show('❌ ' + e.message, true)
    } finally {
      setSaving(false)
    }
  }

  // ── Derived values ─────────────────────────────────────────────────────
  const totalMarks   = questions.reduce((s, q) => s + (q.marks || 1), 0)
  const newCount     = questions.filter(q => !q._id).length
  const anyUploading = questions.some(q => q.imageUploading)
  const statusMeta   = STATUS_META[quizStatus] ?? STATUS_META.draft
  const backPath     = isAdmin ? '/admin/content' : '/teacher/content'
  const canEdit      = isAdmin || quizOwner === currentUser?.uid

  // ── Loading / error states ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        {[1,2,3].map(i => (
          <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 animate-pulse h-24" />
        ))}
      </div>
    )
  }

  if (notFound || !canEdit) {
    return (
      <div className="text-center py-20">
        <div className="text-5xl mb-3">🔒</div>
        <h2 className="text-xl font-black text-gray-700 mb-2">
          {notFound ? 'Quiz not found' : 'Access denied'}
        </h2>
        <p className="text-gray-500 text-sm mb-5">
          {notFound
            ? 'This quiz does not exist or has been deleted.'
            : 'You can only edit quizzes you created.'}
        </p>
        <button onClick={() => navigate(backPath)}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2.5 rounded-xl text-sm min-h-0 transition-colors">
          ← Back to Content
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-10">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 font-bold px-5 py-3 rounded-2xl shadow-lg text-sm max-w-xs animate-slide-up ${
          toast.isErr ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Page header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <button onClick={() => navigate(backPath)}
            className="text-gray-400 hover:text-gray-600 p-1 min-h-0 bg-transparent shadow-none mt-1">←</button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-black text-gray-800">✏️ Edit Quiz</h1>
              <span className={`text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1.5 ${statusMeta.pill}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />
                {statusMeta.label}
              </span>
              {dirty && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-orange-100 text-orange-600">
                  ● Unsaved changes
                </span>
              )}
            </div>
            <p className="text-gray-500 text-sm mt-0.5">
              {form.title || 'Untitled quiz'} · {questions.length} questions
            </p>
          </div>
        </div>

        {/* Quick publish toggle (admin only) */}
        {isAdmin && (
          <button onClick={handleTogglePublish} disabled={saving || anyUploading}
            className={`text-sm font-black px-4 py-2 rounded-xl border-2 min-h-0 transition-colors disabled:opacity-40 ${
              quizStatus === 'published'
                ? 'border-yellow-300 text-yellow-700 hover:bg-yellow-50'
                : 'border-green-300 text-green-700 hover:bg-green-50'
            }`}>
            {quizStatus === 'published' ? '📦 Unpublish' : '🚀 Publish'}
          </button>
        )}
      </div>

      {/* ── Quiz metadata card ─────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4 shadow-sm">
        <h2 className="font-black text-gray-700 flex items-center gap-2">
          📋 Quiz Details
        </h2>

        <div className="space-y-3">
          <input value={form.title} onChange={e => setF('title', e.target.value)}
            placeholder="Quiz title (e.g. Grade 6 Science — Human Body)"
            className={FIELD} />

          <input value={form.topic || ''} onChange={e => setF('topic', e.target.value)}
            placeholder="Topic (optional, e.g. Photosynthesis)"
            className={FIELD} />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <select value={form.grade} onChange={e => setF('grade', e.target.value)} className={SELECT}>
              {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
            </select>
            <select value={form.subject} onChange={e => setF('subject', e.target.value)} className={SELECT}>
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={form.term} onChange={e => setF('term', e.target.value)} className={SELECT}>
              {TERMS.map(t => <option key={t} value={t}>Term {t}</option>)}
            </select>
            <div className="flex items-center gap-2 border-2 border-gray-200 rounded-xl px-3 py-2.5">
              <span className="text-xs text-gray-500 font-bold whitespace-nowrap">⏱️ Mins</span>
              <input type="number" min={5} max={180} value={form.duration}
                onChange={e => setF('duration', +e.target.value)}
                className="flex-1 text-sm font-black focus:outline-none bg-transparent" />
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex gap-2 flex-wrap">
          <StatPill label="questions" value={questions.length} color="bg-blue-100 text-blue-700" />
          <StatPill label="marks"     value={totalMarks}       color="bg-purple-100 text-purple-700" />
          <StatPill label="mins"      value={form.duration}    color="bg-orange-100 text-orange-700" />
          {newCount > 0 && <StatPill label="new" value={newCount} color="bg-green-100 text-green-700" />}
          {deletedIds.length > 0 && (
            <StatPill label="queued for deletion" value={deletedIds.length} color="bg-red-100 text-red-600" />
          )}
        </div>
      </div>

      {/* ── Questions ─────────────────────────────────────────────────────── */}
      {questions.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border-2 border-dashed border-gray-200">
          <div className="text-4xl mb-2">📭</div>
          <p className="font-bold text-gray-600 mb-1">No questions yet</p>
          <p className="text-gray-400 text-sm">Click "Add Question" below to start building this quiz.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {questions.map((q, qi) => (
            <QuestionCard
              key={qi}
              q={q} qi={qi} total={questions.length}
              isNew={!q._id}
              onChange={handleQChange}
              onRemove={removeQuestion}
              onMove={moveQuestion}
              onImageUpload={uploadQuestionImage}
              onImageRemove={removeQuestionImage}
            />
          ))}
        </div>
      )}

      {/* Add question */}
      <button onClick={addQuestion}
        className="w-full border-2 border-dashed border-blue-300 text-blue-600 font-black py-4 rounded-2xl hover:border-blue-400 hover:bg-blue-50 transition-all min-h-0">
        ＋ Add Question
      </button>

      {/* ── Deletion summary ──────────────────────────────────────────────── */}
      {deletedIds.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <span className="text-base flex-shrink-0">🗑️</span>
          <span>
            <strong>{deletedIds.length} question{deletedIds.length > 1 ? 's' : ''}</strong> will be permanently
            deleted from Firestore when you save. This cannot be undone.
          </span>
        </div>
      )}

      {/* ── Save actions ──────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm space-y-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Save Options</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Save draft */}
          <button onClick={() => handleSave('draft')} disabled={saving || anyUploading}
            className="border-2 border-gray-300 text-gray-700 font-black py-3 rounded-2xl hover:bg-gray-50 disabled:opacity-40 min-h-0 transition-colors flex items-center justify-center gap-2">
            <span>💾</span>
            <span>{saving ? 'Saving…' : anyUploading ? 'Uploading…' : 'Save Draft'}</span>
          </button>

          {/* Teacher: submit for approval | Admin: save as pending */}
          {!isAdmin && (
            <button onClick={() => handleSave('pending')} disabled={saving || anyUploading}
              className="border-2 border-blue-500 text-blue-700 font-black py-3 rounded-2xl hover:bg-blue-50 disabled:opacity-40 min-h-0 transition-colors flex items-center justify-center gap-2">
              <span>📤</span>
              <span>{saving ? 'Submitting…' : 'Submit for Approval'}</span>
            </button>
          )}

          {/* Admin: publish */}
          {isAdmin && (
            <>
              <button onClick={() => handleSave('pending')} disabled={saving || anyUploading}
                className="border-2 border-yellow-400 text-yellow-700 font-black py-3 rounded-2xl hover:bg-yellow-50 disabled:opacity-40 min-h-0 transition-colors flex items-center justify-center gap-2">
                <span>⏳</span>
                <span>{saving ? 'Saving…' : 'Save as Pending'}</span>
              </button>
              <button onClick={() => handleSave('published')} disabled={saving || anyUploading}
                className="bg-green-600 hover:bg-green-700 text-white font-black py-3 rounded-2xl disabled:opacity-40 min-h-0 transition-colors flex items-center justify-center gap-2 shadow-sm">
                <span>🚀</span>
                <span>{saving ? 'Publishing…' : 'Save & Publish'}</span>
              </button>
            </>
          )}
        </div>

        <p className="text-xs text-gray-400 text-center">
          {dirty ? '⚠️ You have unsaved changes.' : '✓ All changes saved.'}
        </p>
      </div>
    </div>
  )
}
