import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import { storage } from '../../firebase/config'

const SUBJECTS = ['Mathematics', 'English', 'Science', 'Social Studies']
const GRADES   = ['5', '6', '7']
const TERMS    = ['1', '2', '3']

const FIELD  = 'w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-green-500 focus:outline-none'
const SELECT = 'border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-green-500 focus:outline-none'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/**
 * Compress + resize an image client-side using Canvas before uploading.
 * A 4 MB phone photo → ~150–250 KB JPEG. Makes uploads 10–20× faster.
 *
 * @param {File}   file      - Original image file
 * @param {number} maxWidth  - Max output width in px  (default 1200)
 * @param {number} quality   - JPEG quality 0–1        (default 0.85)
 * @returns {Promise<Blob>}
 */
function compressImage(file, maxWidth = 1200, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      let { width, height } = img
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width)
        width  = maxWidth
      }
      const canvas = document.createElement('canvas')
      canvas.width  = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Canvas compression failed')),
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Could not load image')) }
    img.src = objectUrl
  })
}

function emptyQuestion() {
  return {
    text: '', options: ['', '', '', ''], correctAnswer: 0,
    explanation: '', topic: '', marks: 1, type: 'mcq',
    imageUrl: '', imageUploading: false,
  }
}

// ── Image upload widget ────────────────────────────────────────────────────
function QuestionImageUpload({ imageUrl, uploading, uploadStep, onFileSelect, onRemove }) {
  const inputRef = useRef(null)

  function handleChange(e) {
    const file = e.target.files[0]
    if (file) onFileSelect(file)
    e.target.value = ''
  }

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
        {/* Step indicator */}
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
      <div className="relative rounded-xl overflow-hidden border-2 border-green-200 bg-gray-50 group">
        <img
          src={imageUrl}
          alt="Question image preview"
          className="w-full max-h-52 object-contain py-2"
        />
        {/* Overlay buttons */}
        <div className="absolute top-2 right-2 flex gap-1.5 opacity-90 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="bg-white text-gray-700 text-xs font-bold px-3 py-1.5 rounded-lg shadow border border-gray-200 hover:bg-gray-50 min-h-0 transition-colors"
          >
            🔄 Replace
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg shadow min-h-0 transition-colors"
          >
            ✕ Remove
          </button>
        </div>
        <p className="text-xs text-gray-400 text-center pb-1">Question image (optional)</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleChange}
        />
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-full border-2 border-dashed border-gray-200 hover:border-green-400 hover:bg-green-50 rounded-xl p-5 text-center transition-all min-h-0 bg-transparent shadow-none group"
      >
        <div className="text-3xl mb-1.5 group-hover:scale-110 transition-transform inline-block">🖼️</div>
        <p className="text-gray-500 font-bold text-sm">Upload Question Image</p>
        <p className="text-gray-400 text-xs mt-0.5">Optional · JPG, PNG, WEBP · max 5 MB</p>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  )
}

// ── Question card ──────────────────────────────────────────────────────────
function QuestionCard({ q, qi, total, onChange, onRemove, onMove, onImageUpload, onImageRemove }) {
  function set(field, val) { onChange(qi, field, val) }
  function setOpt(oi, val) {
    const opts = [...q.options]
    opts[oi] = val
    onChange(qi, 'options', opts)
  }

  const isTF = q.type === 'truefalse'
  const isSA = q.type === 'short_answer'

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4 shadow-sm">
      {/* Card header */}
      <div className="flex items-center justify-between">
        <span className="bg-green-100 text-green-700 font-black text-xs px-3 py-1 rounded-full">
          Q{qi + 1} of {total}
        </span>
        <div className="flex items-center gap-2">
          <select
            value={q.type}
            onChange={e => {
              const t = e.target.value
              set('type', t)
              if (t === 'truefalse') {
                onChange(qi, 'options', ['True', 'False'])
                onChange(qi, 'correctAnswer', 0)
              } else if (t === 'short_answer') {
                onChange(qi, 'options', [])
                onChange(qi, 'correctAnswer', '')
              } else if (q.options.length < 4) {
                onChange(qi, 'options', ['', '', '', ''])
              }
            }}
            className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:border-green-500 focus:outline-none"
          >
            <option value="mcq">MCQ (4 options)</option>
            <option value="truefalse">True / False</option>
            <option value="short_answer">Short Answer (AI checked)</option>
          </select>
          <button onClick={() => onMove(qi, -1)} disabled={qi === 0}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-sm min-h-0 bg-transparent shadow-none p-1">↑</button>
          <button onClick={() => onMove(qi, 1)} disabled={qi === total - 1}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-sm min-h-0 bg-transparent shadow-none p-1">↓</button>
          {total > 1 && (
            <button onClick={() => onRemove(qi)}
              className="text-red-400 hover:text-red-600 text-xs font-bold min-h-0 bg-transparent shadow-none p-1">✕</button>
          )}
        </div>
      </div>

      {/* Image upload */}
      <QuestionImageUpload
        imageUrl={q.imageUrl}
        uploading={q.imageUploading}
        uploadStep={q.imageUploadStep}
        onFileSelect={file => onImageUpload(qi, file)}
        onRemove={() => onImageRemove(qi)}
      />

      {/* Question text */}
      <textarea
        value={q.text}
        onChange={e => set('text', e.target.value)}
        placeholder={q.imageUrl ? 'Describe what is shown in the image above, or ask your question…' : 'Write your question here…'}
        rows={3}
        className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-green-500 focus:outline-none resize-none leading-relaxed"
      />

      {/* Options / Answer field */}
      {isSA ? (
        <div className="space-y-2">
          <p className="text-xs font-bold text-gray-500 flex items-center gap-1.5">
            🤖 Short Answer — AI will check student responses against this answer
          </p>
          <div className="flex items-center gap-2 p-3 rounded-xl border-2 border-green-300 bg-green-50">
            <span className="text-green-600 text-lg flex-shrink-0">✅</span>
            <input
              value={typeof q.correctAnswer === 'string' ? q.correctAnswer : ''}
              onChange={e => set('correctAnswer', e.target.value)}
              placeholder="Type the correct answer (e.g. Photosynthesis)"
              className="flex-1 bg-transparent border-none outline-none text-sm text-gray-800 font-semibold"
            />
          </div>
          <p className="text-xs text-gray-400">
            The AI will accept synonyms, minor spelling mistakes, and equivalent phrasings automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-bold text-gray-500">Answer choices — click the radio to mark the correct one</p>
          {q.options.map((opt, oi) => (
            <label
              key={oi}
              className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                q.correctAnswer === oi ? 'border-green-400 bg-green-50' : 'border-gray-100 hover:border-gray-200'
              }`}
            >
              <input
                type="radio"
                name={`correct-${qi}`}
                checked={q.correctAnswer === oi}
                onChange={() => set('correctAnswer', oi)}
                className="accent-green-600 flex-shrink-0"
              />
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${
                q.correctAnswer === oi ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600'
              }`}>
                {isTF ? (oi === 0 ? 'T' : 'F') : ['A', 'B', 'C', 'D'][oi]}
              </span>
              <input
                value={opt}
                onChange={e => setOpt(oi, e.target.value)}
                placeholder={isTF ? (oi === 0 ? 'True' : 'False') : `Option ${['A', 'B', 'C', 'D'][oi]}`}
                disabled={isTF}
                className="flex-1 bg-transparent border-none outline-none text-sm text-gray-800 disabled:text-gray-500"
              />
              {q.correctAnswer === oi && (
                <span className="text-green-500 text-xs font-black flex-shrink-0">✓ Correct</span>
              )}
            </label>
          ))}
        </div>
      )}

      {/* Explanation + meta row */}
      <div className="space-y-2">
        <input
          value={q.explanation}
          onChange={e => set('explanation', e.target.value)}
          placeholder="Explanation (optional) — shown after answering in practice mode"
          className={FIELD}
        />
        <div className="flex gap-2">
          <input
            value={q.topic}
            onChange={e => set('topic', e.target.value)}
            placeholder="Topic (e.g. Fractions)"
            className="flex-1 border border-gray-200 rounded-lg px-2.5 py-2 text-xs focus:border-green-500 focus:outline-none"
          />
          <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2.5 py-2">
            <span className="text-xs text-gray-500 font-bold">Marks:</span>
            <input
              type="number" min={1} max={10} value={q.marks}
              onChange={e => set('marks', +e.target.value)}
              className="w-10 text-xs font-black text-center focus:outline-none bg-transparent"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────
export default function CreateQuiz() {
  const { createQuiz, saveQuestions } = useFirestore()
  const { currentUser, isAdmin } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    title: '', subject: 'Mathematics', grade: '5', term: '1', duration: 30, type: 'quiz',
  })
  const [questions, setQuestions] = useState([emptyQuestion()])
  const [saving, setSaving]       = useState(false)
  const [toast, setToast]         = useState(null)

  function setF(field, val) { setForm(f => ({ ...f, [field]: val })) }
  function show(msg, isErr = false) {
    setToast({ msg, isErr })
    setTimeout(() => setToast(null), 3500)
  }

  function handleQChange(qi, field, val) {
    setQuestions(qs => qs.map((q, i) => i === qi ? { ...q, [field]: val } : q))
  }

  // ── Image upload (with client-side compression) ───────────────────────────
  async function uploadQuestionImage(qi, file) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      show('❌ Only JPG, PNG, and WEBP images are allowed.', true); return
    }
    if (file.size > 15 * 1024 * 1024) {
      show('❌ Image must be under 15 MB.', true); return
    }
    setQuestions(qs => qs.map((q, i) => i === qi
      ? { ...q, imageUploading: true, imageUploadStep: 'compressing', imageUrl: '' } : q))
    try {
      // 1. Compress client-side → much smaller payload to upload
      const compressed = await compressImage(file)

      setQuestions(qs => qs.map((q, i) => i === qi
        ? { ...q, imageUploadStep: 'uploading' } : q))

      // 2. Upload the tiny JPEG blob
      const path = `quiz-images/${currentUser.uid}/${Date.now()}-q${qi}.jpg`
      const snap = await uploadBytes(storageRef(storage, path), compressed, { contentType: 'image/jpeg' })
      const url  = await getDownloadURL(snap.ref)

      setQuestions(qs => qs.map((q, i) => i === qi
        ? { ...q, imageUrl: url, imageUploading: false, imageUploadStep: '' } : q))

      const kb = Math.round(compressed.size / 1024)
      show(`✅ Image ready (${kb} KB)`)
    } catch (e) {
      setQuestions(qs => qs.map((q, i) => i === qi
        ? { ...q, imageUploading: false, imageUploadStep: '' } : q))
      show('❌ Upload failed: ' + e.message, true)
    }
  }

  function removeQuestionImage(qi) {
    handleQChange(qi, 'imageUrl', '')
  }

  // ── Question management ───────────────────────────────────────────────────
  function addQuestion() {
    setQuestions(qs => [...qs, emptyQuestion()])
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50)
  }

  function removeQuestion(qi) {
    setQuestions(qs => qs.filter((_, i) => i !== qi))
  }

  function moveQuestion(qi, dir) {
    setQuestions(qs => {
      const arr = [...qs]
      const target = qi + dir
      if (target < 0 || target >= arr.length) return arr
      ;[arr[qi], arr[target]] = [arr[target], arr[qi]]
      return arr
    })
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function validate() {
    if (!form.title.trim()) { show('❌ Please enter a quiz title.', true); return false }
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      if (q.imageUploading) { show(`❌ Question ${i + 1} image is still uploading. Please wait.`, true); return false }
      if (!q.text.trim())   { show(`❌ Question ${i + 1} is missing question text.`, true); return false }
      if (q.type === 'mcq' && q.options.some(o => !o.trim())) {
        show(`❌ Question ${i + 1} has empty options.`, true); return false
      }
    }
    return true
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  // publish=true  → admin publishes directly (isPublished:true, status:'published')
  // submit=true   → teacher submits for approval (isPublished:false, status:'pending')
  // neither       → save draft (isPublished:false, status:'draft')
  async function handleSave({ publish = false, submit = false } = {}) {
    if (!validate()) return
    setSaving(true)
    try {
      const totalMarks = questions.reduce((s, q) => s + (q.marks || 1), 0)
      const status     = publish ? 'published' : submit ? 'pending' : 'draft'
      const quizId = await createQuiz({
        ...form,
        totalMarks,
        questionCount: questions.length,
        isPublished: publish,
        status,
        createdBy:   currentUser.uid,
        ...(submit && { submittedAt: new Date() }),
      })
      await saveQuestions(quizId, questions.map(q => ({
        text:          q.text.trim(),
        imageUrl:      q.imageUrl || null,
        options:       q.options,
        correctAnswer: q.correctAnswer,
        explanation:   q.explanation.trim(),
        topic:         q.topic.trim(),
        marks:         q.marks || 1,
        type:          q.type,
      })))
      const msg = publish ? '✅ Quiz published!' : submit ? '📤 Submitted for approval!' : '✅ Saved as draft!'
      show(msg)
      const returnPath = isAdmin ? '/admin/content' : '/teacher/content'
      setTimeout(() => navigate(returnPath), 1200)
    } catch (e) {
      console.error(e)
      show('❌ Failed to save: ' + e.message, true)
      setSaving(false)
    }
  }

  const totalMarks    = questions.reduce((s, q) => s + (q.marks || 1), 0)
  const imagesCount   = questions.filter(q => q.imageUrl).length
  const anyUploading  = questions.some(q => q.imageUploading)

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 font-bold px-5 py-3 rounded-2xl shadow-lg text-sm max-w-xs animate-slide-up ${
          toast.isErr ? 'bg-red-600 text-white' : 'bg-green-700 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Page header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)}
          className="text-gray-400 hover:text-gray-600 p-1 min-h-0 bg-transparent shadow-none">←</button>
        <div>
          <h1 className="text-2xl font-black text-gray-800">✏️ Create Quiz</h1>
          <p className="text-gray-500 text-sm">Build a quiz with text and/or images per question</p>
        </div>
      </div>

      {/* Quiz metadata */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
        <h2 className="font-black text-gray-700">Quiz Details</h2>
        <input
          value={form.title}
          onChange={e => setF('title', e.target.value)}
          placeholder="Quiz title (e.g. Grade 5 Mathematics — Fractions Test)"
          className={FIELD}
        />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <select value={form.grade}    onChange={e => setF('grade', e.target.value)}    className={SELECT}>
            {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
          </select>
          <select value={form.subject}  onChange={e => setF('subject', e.target.value)}  className={SELECT}>
            {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={form.term}     onChange={e => setF('term', e.target.value)}      className={SELECT}>
            {TERMS.map(t => <option key={t} value={t}>Term {t}</option>)}
          </select>
          <div className="flex items-center gap-2 border-2 border-gray-200 rounded-xl px-3 py-2.5">
            <span className="text-xs text-gray-500 font-bold whitespace-nowrap">⏱️ Mins</span>
            <input
              type="number" min={5} max={180} value={form.duration}
              onChange={e => setF('duration', +e.target.value)}
              className="flex-1 text-sm font-black focus:outline-none bg-transparent"
            />
          </div>
        </div>
        <div className="flex gap-2 flex-wrap text-xs text-gray-500 pt-1">
          <span className="bg-gray-100 px-2 py-1 rounded-full font-bold">{questions.length} questions</span>
          <span className="bg-gray-100 px-2 py-1 rounded-full font-bold">{totalMarks} marks total</span>
          {imagesCount > 0 && (
            <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-bold">
              🖼️ {imagesCount} with images
            </span>
          )}
        </div>
      </div>

      {/* Questions */}
      <div className="space-y-4">
        {questions.map((q, qi) => (
          <QuestionCard
            key={qi}
            q={q} qi={qi} total={questions.length}
            onChange={handleQChange}
            onRemove={removeQuestion}
            onMove={moveQuestion}
            onImageUpload={uploadQuestionImage}
            onImageRemove={removeQuestionImage}
          />
        ))}
      </div>

      {/* Add question */}
      <button onClick={addQuestion}
        className="w-full border-2 border-dashed border-green-300 text-green-600 font-black py-4 rounded-2xl hover:border-green-400 hover:bg-green-50 transition-all min-h-0">
        ＋ Add Question
      </button>

      {/* Upload note */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3 text-xs text-blue-600 flex items-start gap-2">
        <span className="text-base flex-shrink-0">ℹ️</span>
        <span>Images are uploaded to Firebase Storage immediately when you select them. Questions without images are fine — images are always optional.</span>
      </div>

      {/* Save actions */}
      <div className="flex gap-3 pb-6">
        <button
          onClick={() => handleSave({})}
          disabled={saving || anyUploading}
          className="flex-1 border-2 border-green-600 text-green-600 font-black py-3.5 rounded-2xl disabled:opacity-50 min-h-0 hover:bg-green-50 transition-colors"
        >
          {saving ? '⏳ Saving…' : anyUploading ? '⏳ Uploading…' : '💾 Save Draft'}
        </button>
        {isAdmin ? (
          <button
            onClick={() => handleSave({ publish: true })}
            disabled={saving || anyUploading}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-black py-3.5 rounded-2xl disabled:opacity-50 min-h-0 transition-colors"
          >
            {saving ? '⏳ Publishing…' : anyUploading ? '⏳ Uploading…' : '🚀 Publish Quiz'}
          </button>
        ) : (
          <button
            onClick={() => handleSave({ submit: true })}
            disabled={saving || anyUploading}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-black py-3.5 rounded-2xl disabled:opacity-50 min-h-0 transition-colors"
          >
            {saving ? '⏳ Submitting…' : anyUploading ? '⏳ Uploading…' : '📤 Submit for Approval'}
          </button>
        )}
      </div>
    </div>
  )
}
