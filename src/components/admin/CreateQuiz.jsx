import { useEffect, useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import { storage } from '../../firebase/config'
import { generateAIQuizQuestions } from '../../utils/aiAssistant'
import { QUIZ_DOCUMENT_ACCEPT, importQuizDocument, revokeImportedQuizAssets } from '../quiz/documentQuizImporter'

const SUBJECTS = [
  'Mathematics',
  'English',
  'Integrated Science',
  'Social Studies',
  'Technology Studies',
  'Home Economics',
  'Expressive Arts',
]
const GRADES   = ['4', '5', '6']
const TERMS    = ['1', '2', '3']

const CREATION_MODES = [
  {
    id: 'manual',
    title: 'Create Manually',
    body: 'Write questions and answers yourself.',
    accent: 'border-blue-200 bg-blue-50 text-blue-900',
  },
  {
    id: 'import',
    title: 'Import Quiz (Word/PDF)',
    body: 'Upload .doc, .docx, or .pdf and convert it into editable questions.',
    accent: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  },
  {
    id: 'ai',
    title: 'Generate with Zed AI',
    body: 'Create starter questions from a topic, then edit before saving.',
    accent: 'border-sky-200 bg-sky-50 text-sky-900',
  },
]

const FIELD  = 'w-full border-2 border-gray-200 rounded-xl bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-green-500 focus:outline-none'
const SELECT = 'border-2 border-gray-200 rounded-xl bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-green-500 focus:outline-none'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

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
    detectedType: 'mcq',
    imageUrl: '', imageUploading: false, imageUploadStep: '',
    imageAssetId: '',
    diagramText: '',
    requiresReview: false,
    reviewNotes: [],
    importWarnings: [],
    sourcePage: null,
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
  const isSA = q.type === 'short_answer' || q.type === 'diagram'

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
              } else if (t === 'short_answer' || t === 'diagram') {
                onChange(qi, 'options', [])
                onChange(qi, 'correctAnswer', '')
              } else if (q.options.length < 4) {
                onChange(qi, 'options', ['', '', '', ''])
                onChange(qi, 'correctAnswer', 0)
              }
            }}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900 focus:border-green-500 focus:outline-none"
          >
            <option value="mcq">MCQ (4 options)</option>
            <option value="truefalse">True / False</option>
            <option value="short_answer">Short Answer (AI checked)</option>
            <option value="diagram">Diagram / Image</option>
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

      {q.requiresReview && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-black text-amber-900">Needs review</p>
          <ul className="mt-1 space-y-0.5">
            {(q.reviewNotes || q.importWarnings || ['Check this imported question before publishing.']).slice(0, 3).map((note, index) => (
              <li key={`${note}-${index}`} className="text-xs font-bold leading-relaxed text-amber-800">{note}</li>
            ))}
          </ul>
        </div>
      )}

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
        className="w-full resize-none rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-gray-900 placeholder-gray-400 focus:border-green-500 focus:outline-none"
      />

      {/* Options / Answer field */}
      {isSA ? (
        <div className="space-y-2">
          <p className="text-xs font-bold text-gray-500 flex items-center gap-1.5">
            🤖 Short Answer — expected answer recommended for accurate AI checking
          </p>
          <div className="flex items-center gap-2 p-3 rounded-xl border-2 border-green-300 bg-green-50">
            <span className="text-green-600 text-lg flex-shrink-0">✅</span>
            <input
              value={typeof q.correctAnswer === 'string' ? q.correctAnswer : ''}
              onChange={e => set('correctAnswer', e.target.value)}
              placeholder="Expected answer (recommended, e.g. Respiration)"
              className="flex-1 border-none bg-transparent text-sm font-semibold text-gray-900 placeholder-gray-500 outline-none"
            />
          </div>
          <p className="text-xs text-gray-400">
            If left blank, AI will judge from the question, subject, and grade.
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
                className="flex-1 border-none bg-transparent text-sm text-gray-900 placeholder-gray-500 outline-none disabled:text-gray-700"
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
        <textarea
          value={q.diagramText || ''}
          onChange={e => set('diagramText', e.target.value)}
          placeholder="Diagram description (optional) — e.g. Imported image, page snapshot, or label instructions"
          rows={2}
          className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 placeholder-gray-400 outline-none focus:border-green-500"
        />
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
            className="flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-900 placeholder-gray-400 focus:border-green-500 focus:outline-none"
          />
          <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2.5 py-2">
            <span className="text-xs text-gray-500 font-bold">Marks:</span>
            <input
              type="number" min={1} max={10} value={q.marks}
              onChange={e => set('marks', +e.target.value)}
              className="w-10 bg-transparent text-center text-xs font-black text-gray-900 focus:outline-none"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function ImportQuizPanel({ importing, importSummary, onImport }) {
  const inputRef = useRef(null)

  function handleFile(event) {
    const file = event.target.files?.[0]
    if (file) onImport(file)
    event.target.value = ''
  }

  return (
    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-black text-emerald-950">Import Quiz (Word/PDF)</h2>
          <p className="mt-1 max-w-3xl text-sm font-bold leading-relaxed text-emerald-800">
            Upload a .doc, .docx, or .pdf file. ZedExams will extract questions, options, short answers, and image-based questions into editable quiz cards.
          </p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={importing}
          className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"
        >
          {importing ? 'Importing...' : 'Choose File'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={QUIZ_DOCUMENT_ACCEPT}
          className="hidden"
          onChange={handleFile}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-white/70 bg-white/80 p-3">
          <p className="text-xs font-black uppercase tracking-wide text-emerald-700">Editable import</p>
          <p className="mt-1 text-xs font-bold leading-relaxed text-emerald-800">The document is converted into normal quiz questions, not embedded as a static file.</p>
        </div>
        <div className="rounded-xl border border-white/70 bg-white/80 p-3">
          <p className="text-xs font-black uppercase tracking-wide text-emerald-700">Images</p>
          <p className="mt-1 text-xs font-bold leading-relaxed text-emerald-800">DOCX images and PDF diagram snapshots attach to matching questions and upload when you save.</p>
        </div>
        <div className="rounded-xl border border-white/70 bg-white/80 p-3">
          <p className="text-xs font-black uppercase tracking-wide text-emerald-700">Needs review</p>
          <p className="mt-1 text-xs font-bold leading-relaxed text-emerald-800">Unclear answers, diagrams, and imperfect extraction are marked before publishing.</p>
        </div>
      </div>

      {importSummary && (
        <div className={`rounded-xl border px-4 py-3 ${
          importSummary.importStatus === 'needs_review'
            ? 'border-amber-200 bg-amber-50 text-amber-900'
            : 'border-emerald-200 bg-white text-emerald-900'
        }`}>
          <p className="text-sm font-black">
            Imported {importSummary.questions} question{importSummary.questions === 1 ? '' : 's'} from {importSummary.fileName}
          </p>
          <p className="mt-1 text-xs font-bold leading-relaxed">
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
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wide text-gray-500">Choose how to create this quiz</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {CREATION_MODES.map(mode => {
          const active = activeMode === mode.id
          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => onSelect(mode.id)}
              className={`min-h-0 rounded-xl border-2 p-4 text-left shadow-none transition-all ${
                active ? mode.accent : 'border-gray-100 bg-gray-50 text-gray-700 hover:border-gray-200'
              }`}
            >
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-black ${
                active ? 'bg-white/80' : 'bg-white text-gray-500'
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

// ── Main component ─────────────────────────────────────────────────────────
export default function CreateQuiz() {
  const { createQuiz, saveQuestions } = useFirestore()
  const { currentUser, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedMode = searchParams.get('mode')
  const [creationMode, setCreationMode] = useState(
    CREATION_MODES.some(mode => mode.id === requestedMode) ? requestedMode : 'manual',
  )

  const [form, setForm] = useState({
    title: '', subject: 'Mathematics', grade: '5', term: '1', duration: 30, type: 'quiz', topic: '',
    mode: '', importStatus: '', sourceFileName: '', sourceContentType: '', importWarnings: [],
  })
  const [questions, setQuestions] = useState([emptyQuestion()])
  const [saving, setSaving]       = useState(false)
  const [toast, setToast]         = useState(null)
  const [aiForm, setAiForm]       = useState({ topic: '', count: 5, type: 'mcq' })
  const [aiGenerating, setAiGenerating] = useState(false)
  const [importingDocument, setImportingDocument] = useState(false)
  const [importSummary, setImportSummary] = useState(null)
  const [importedAssets, setImportedAssets] = useState({})

  useEffect(() => {
    return () => revokeImportedQuizAssets(importedAssets)
  }, [importedAssets])

  function setF(field, val) { setForm(f => ({ ...f, [field]: val })) }
  function setAi(field, val) { setAiForm(f => ({ ...f, [field]: val })) }
  function chooseCreationMode(mode) {
    setCreationMode(mode)
    const nextParams = new URLSearchParams(searchParams)
    if (mode === 'manual') nextParams.delete('mode')
    else nextParams.set('mode', mode)
    setSearchParams(nextParams, { replace: true })
  }
  function show(msg, isErr = false) {
    setToast({ msg, isErr })
    setTimeout(() => setToast(null), 3500)
  }

  function hasOnlyEmptyStarter(qs) {
    if (qs.length !== 1) return false
    const q = qs[0]
    return !q.text.trim() &&
      !q.explanation.trim() &&
      !q.topic.trim() &&
      q.options.every(opt => !opt.trim())
  }

  async function handleGenerateQuestions() {
    const topic = aiForm.topic.trim()
    if (!topic) {
      show('❌ Add a topic for Zed to generate questions.', true)
      return
    }

    setAiGenerating(true)
    try {
      const generated = await generateAIQuizQuestions({
        subject: form.subject,
        grade: form.grade,
        topic,
        count: aiForm.count,
        type: aiForm.type,
      })
      const nextQuestions = generated.map(q => ({
        ...emptyQuestion(),
        ...q,
        options: q.options?.length ? q.options : ['', '', '', ''],
        imageUrl: '',
        imageUploading: false,
      }))
      setQuestions(qs => hasOnlyEmptyStarter(qs) ? nextQuestions : [...qs, ...nextQuestions])
      if (!form.title.trim()) {
        setF('title', `Grade ${form.grade} ${form.subject} — ${topic}`)
      }
      const fastDraft = nextQuestions.some(q => q.generatedBy === 'fast_draft')
      show(fastDraft
        ? `⚡ Added ${nextQuestions.length} quick draft question${nextQuestions.length !== 1 ? 's' : ''}. Review before saving.`
        : `✦ Added ${nextQuestions.length} AI-generated question${nextQuestions.length !== 1 ? 's' : ''}. Review before saving.`)
    } catch (error) {
      show('❌ ' + error.message, true)
    } finally {
      setAiGenerating(false)
    }
  }

  async function handleImportDocument(file) {
    const hasExistingWork = !hasOnlyEmptyStarter(questions)
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
        topic: current.topic?.trim() && hasExistingWork ? current.topic : imported.quiz.topic,
        grade: imported.quiz.grade || current.grade,
        subject: imported.quiz.subject || current.subject,
        mode: 'imported_document',
        importStatus: imported.importStatus,
        sourceFileName: imported.quiz.sourceFileName,
        sourceContentType: imported.quiz.sourceContentType,
        importWarnings: imported.warnings,
      }))
      setQuestions(imported.questions.map(question => ({
        ...emptyQuestion(),
        ...question,
        imageUploading: false,
        imageUploadStep: '',
      })))
      setImportSummary({
        ...imported.summary,
        fileName: file.name,
        importStatus: imported.importStatus,
        warnings: imported.warnings,
      })
      show(imported.importStatus === 'needs_review'
        ? 'Document imported. Review marked questions before publishing.'
        : 'Document imported into editable quiz questions.')
      setTimeout(() => window.scrollTo({ top: document.body.scrollHeight / 3, behavior: 'smooth' }), 80)
    } catch (error) {
      console.error(error)
      show('❌ Import failed: ' + (error.message || 'Could not read this document.'), true)
    } finally {
      setImportingDocument(false)
    }
  }

  function handleQChange(qi, field, val) {
    setQuestions(qs => qs.map((q, i) => i === qi ? { ...q, [field]: val } : q))
  }

  async function uploadImportedQuestionImages(questionsToSave) {
    const assetIds = Array.from(new Set(questionsToSave.map(q => q.imageAssetId).filter(Boolean)))
    if (!assetIds.length) return questionsToSave
    if (!currentUser?.uid) throw new Error('Please sign in before saving imported quiz images.')

    const uploadedById = {}
    for (const assetId of assetIds) {
      const asset = importedAssets[assetId]
      if (!asset?.blob) throw new Error('An imported question image is no longer available. Please re-import the document.')

      const sourceFile = new File([asset.blob], asset.fileName || `${assetId}.jpg`, {
        type: asset.contentType || 'image/jpeg',
      })
      const uploadBlob = await compressImage(sourceFile)
      const path = `quiz-images/${currentUser.uid}/imports/${Date.now()}-${safeStorageName(assetId)}.jpg`
      const snap = await uploadBytes(storageRef(storage, path), uploadBlob, {
        contentType: 'image/jpeg',
        customMetadata: {
          sourceFileName: form.sourceFileName || '',
          sourcePath: asset.sourcePath || '',
        },
      })
      uploadedById[assetId] = await getDownloadURL(snap.ref)
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

  // ── Image upload (with client-side compression) ───────────────────────────
  async function uploadQuestionImage(qi, file) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      show('❌ Only JPG, PNG, and WEBP images are allowed.', true); return
    }
    if (file.size > 15 * 1024 * 1024) {
      show('❌ Image must be under 15 MB.', true); return
    }
    setQuestions(qs => qs.map((q, i) => i === qi
      ? { ...q, imageUploading: true, imageUploadStep: 'compressing', imageUrl: '', imageAssetId: '' } : q))
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
        ? { ...q, imageUrl: url, imageAssetId: '', imageUploading: false, imageUploadStep: '' } : q))

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
    handleQChange(qi, 'imageAssetId', '')
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
      const questionsForSave = await uploadImportedQuestionImages(questions)
      const totalMarks = questionsForSave.reduce((s, q) => s + (q.marks || 1), 0)
      const status     = publish ? 'published' : submit ? 'pending' : 'draft'
      const quizId = await createQuiz({
        ...form,
        totalMarks,
        questionCount: questionsForSave.length,
        importStatus: form.mode === 'imported_document'
          ? (questionsForSave.some(q => q.requiresReview) ? 'needs_review' : (form.importStatus || 'success'))
          : form.importStatus,
        isPublished: publish,
        status,
        createdBy:   currentUser.uid,
        ...(submit && { submittedAt: new Date() }),
      })
      await saveQuestions(quizId, questionsForSave.map(q => ({
        text:          q.text.trim(),
        imageUrl:      q.imageUrl || null,
        options:       q.type === 'short_answer' || q.type === 'diagram' ? [] : q.options,
        correctAnswer: q.type === 'short_answer' || q.type === 'diagram' ? String(q.correctAnswer ?? '').trim() : q.correctAnswer,
        explanation:   q.explanation.trim(),
        topic:         q.topic.trim(),
        marks:         q.marks || 1,
        type:          q.type,
        detectedType:  q.detectedType || q.type,
        diagramText:   q.diagramText || '',
        requiresReview: Boolean(q.requiresReview),
        reviewNotes:   q.reviewNotes || [],
        importWarnings: q.importWarnings || [],
        sourcePage:    q.sourcePage || null,
      })))
      setImportedAssets({})
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
  const anyUploading  = questions.some(q => q.imageUploading) || importingDocument

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

      <CreationModeSelector activeMode={creationMode} onSelect={chooseCreationMode} />

      {creationMode === 'import' && (
        <ImportQuizPanel
          importing={importingDocument}
          importSummary={importSummary}
          onImport={handleImportDocument}
        />
      )}

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
          {form.mode === 'imported_document' && (
            <span className={`px-2 py-1 rounded-full font-bold ${
              form.importStatus === 'needs_review' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
            }`}>
              Imported document · {form.importStatus || 'success'}
            </span>
          )}
        </div>
      </div>

      {/* AI quiz generator */}
      {creationMode === 'ai' && (
      <div className="bg-sky-50 rounded-2xl border border-sky-100 p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-black text-sky-900">✦ AI Quiz Generator</h2>
            <p className="text-sky-700 text-sm mt-0.5">
              Generate draft multiple-choice questions, then edit them below before saving.
            </p>
          </div>
          <span className="hidden sm:inline-flex bg-white/80 text-sky-700 border border-sky-100 text-xs font-black px-3 py-1 rounded-full">
            Teacher tool
          </span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <select value={form.grade} onChange={e => setF('grade', e.target.value)} className={SELECT}>
            {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
          </select>
          <select value={form.subject} onChange={e => setF('subject', e.target.value)} className={SELECT}>
            {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            value={aiForm.topic}
            onChange={e => setAi('topic', e.target.value)}
            placeholder="Topic, e.g. Fractions"
            className="col-span-2 rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-sky-500 focus:outline-none lg:col-span-1"
          />
          <input
            type="number"
            min={1}
            max={10}
            value={aiForm.count}
            onChange={e => setAi('count', +e.target.value)}
            className="rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-sky-500 focus:outline-none"
            aria-label="Number of questions"
          />
          <select value={aiForm.type} onChange={e => setAi('type', e.target.value)} className={SELECT}>
            <option value="mcq">Multiple choice</option>
          </select>
        </div>
        <button
          type="button"
          onClick={handleGenerateQuestions}
          disabled={aiGenerating || saving}
          className="w-full sm:w-auto bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-black px-5 py-3 rounded-xl min-h-0 transition-colors"
        >
          {aiGenerating ? '✦ Generating...' : '✦ Generate Questions'}
        </button>
      </div>
      )}

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
