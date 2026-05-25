/**
 * /admin/papers/new and /admin/papers/:paperId/edit — Past Paper Studio.
 *
 * Five-step wizard that walks an admin from raw PDF/image uploads
 * through to a published past paper with an attached quiz:
 *
 *   1. Upload  — PDF or scanned images (JPG/PNG/WEBP) up to 50MB each
 *   2. Details — grade, subject, year, board, title, marks, duration
 *   3. Questions — MCQ prompts + options
 *   4. Answers — correct option + explanation per question
 *   5. Publish — review and commit. Creates the linked quiz with
 *      publicAccess:true so anonymous marketing visitors can run it.
 *
 * Pattern: a draft `pastPapers/{id}` doc is created on Studio mount
 * (new mode) so uploaded Storage assets have a stable place to land.
 * Assets are uploaded immediately, not held in browser memory — a
 * scanned paper can be 30+ images at 5-10MB each.
 *
 * Replaces the older single-page AdminPastPaperEditor.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import {
  ALLOWED_PAPER_MIME,
  MAX_PAPER_FILE_BYTES,
  PAPER_GRADES,
  PAPER_STATUSES,
  createPaper,
  deletePaper,
  deletePaperPdf,
  getPaper,
  updatePaper,
  uploadPaperAsset,
} from '../../utils/pastPapers'
import { SUBJECTS } from '../../config/curriculum'
import { db } from '../../firebase/config'
import { getFunctions, httpsCallable } from 'firebase/functions'
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore'

const fns = getFunctions(undefined, 'us-central1')
// The vision model can take 30-60s on a 12-page scan; bump the SDK
// timeout above the default 70s so the call doesn't abort.
const importPastPaperQuestionsCallable = httpsCallable(
  fns,
  'importPastPaperQuestions',
  { timeout: 240_000 },
)
import SeoHelmet from '../seo/SeoHelmet'

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 25 }, (_, i) => CURRENT_YEAR - i)

const STEPS = [
  { id: 1, label: 'Upload', hint: 'PDF or scanned images' },
  { id: 2, label: 'Details', hint: 'Subject, grade, year' },
  { id: 3, label: 'Questions', hint: 'Prompts and options' },
  { id: 4, label: 'Answers', hint: 'Correct + explanation' },
  { id: 5, label: 'Publish', hint: 'Review and go live' },
]

function emptyQuestion(order) {
  return {
    id: `local-${Math.random().toString(36).slice(2, 9)}`,
    persisted: false,
    type: 'mcq',
    text: '',
    options: ['', '', '', ''],
    correctAnswer: 0,
    explanation: '',
    marks: 1,
    order,
  }
}

function inputCls() {
  return 'w-full rounded-xl border-2 theme-border theme-input px-3 py-2 text-sm focus:outline-none disabled:opacity-50'
}

function formatBytes(n) {
  if (!n) return '0 B'
  const mb = n / (1024 * 1024)
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${(n / 1024).toFixed(0)} KB`
}

function Stepper({ step, onJump, completed }) {
  return (
    <ol className="flex flex-wrap gap-2 text-xs font-bold">
      {STEPS.map((s) => {
        const isCurrent = step === s.id
        const isDone = completed.has(s.id)
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onJump(s.id)}
              className={[
                'flex items-center gap-2 px-3 py-2 rounded-full border-2 transition-colors',
                isCurrent
                  ? 'theme-accent-fill theme-on-accent border-transparent'
                  : isDone
                    ? 'theme-card theme-text border-emerald-300'
                    : 'theme-card theme-text-muted theme-border hover:theme-text',
              ].join(' ')}
            >
              <span className="w-5 h-5 rounded-full bg-black/15 flex items-center justify-center text-[10px] font-black">
                {isDone ? '✓' : s.id}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function DropZone({ disabled, onFiles }) {
  const [isOver, setIsOver] = useState(false)
  const inputRef = useRef(null)
  function handleFiles(list) {
    if (!list || !list.length) return
    onFiles(Array.from(list))
  }
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsOver(true) }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsOver(false)
        if (disabled) return
        handleFiles(e.dataTransfer.files)
      }}
      className={[
        'rounded-radius-md border-2 border-dashed p-8 text-center transition-colors',
        isOver ? 'theme-accent-border theme-bg-subtle' : 'theme-border',
        disabled ? 'opacity-50' : '',
      ].join(' ')}
    >
      <div className="text-4xl mb-2" aria-hidden="true">📤</div>
      <p className="theme-text font-black text-sm">Drag &amp; drop files here</p>
      <p className="theme-text-muted text-xs mt-1">
        PDF, JPG, PNG or WEBP · up to 50 MB each · scanned papers can be multiple images
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ALLOWED_PAPER_MIME.join(',')}
        className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }}
        disabled={disabled}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="mt-4 theme-accent-fill theme-on-accent rounded-full px-5 py-2 text-sm font-black hover:opacity-90 disabled:opacity-50"
      >
        Choose files
      </button>
    </div>
  )
}

export default function PastPaperStudio() {
  const { paperId: routePaperId } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const isNew = !routePaperId

  const [paperId, setPaperId] = useState(routePaperId || null)
  const [step, setStep] = useState(1)
  const [completed, setCompleted] = useState(() => new Set())
  const [bootstrapping, setBootstrapping] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const [details, setDetails] = useState({
    title: '',
    grade: '7',
    subject: SUBJECTS[0].id,
    year: CURRENT_YEAR - 1,
    paperNumber: '',
    examBoard: 'ECZ',
    description: '',
    durationMinutes: '',
    totalMarks: '',
  })
  const [assets, setAssets] = useState([])
  const [questions, setQuestions] = useState(() => [emptyQuestion(0)])
  const [existingQuizId, setExistingQuizId] = useState(null)
  const [originalStatus, setOriginalStatus] = useState(PAPER_STATUSES.DRAFT)
  const [uploading, setUploading] = useState(false)
  const [importing, setImporting] = useState(false)

  // ── Bootstrap: create a draft doc (new) or load existing ─────────
  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      if (!currentUser?.uid) return
      setBootstrapping(true)
      setError('')
      try {
        if (isNew) {
          const id = await createPaper({
            uid: currentUser.uid,
            fields: {
              title: 'Untitled past paper',
              grade: '7',
              subject: SUBJECTS[0].id,
              year: CURRENT_YEAR - 1,
              status: PAPER_STATUSES.DRAFT,
              examBoard: 'ECZ',
              assets: [],
              assetType: 'pdf',
            },
          })
          if (cancelled) return
          setPaperId(id)
        } else {
          const row = await getPaper(routePaperId)
          if (!row) {
            if (!cancelled) setError('Paper not found.')
            return
          }
          if (cancelled) return
          setPaperId(routePaperId)
          setDetails({
            title: row.title || '',
            grade: row.grade || '7',
            subject: row.subject || SUBJECTS[0].id,
            year: row.year || CURRENT_YEAR - 1,
            paperNumber: row.paperNumber ? String(row.paperNumber) : '',
            examBoard: row.examBoard || 'ECZ',
            description: row.description || '',
            durationMinutes: row.durationMinutes ? String(row.durationMinutes) : '',
            totalMarks: row.totalMarks ? String(row.totalMarks) : '',
          })
          setAssets(Array.isArray(row.assets) ? row.assets : [])
          setOriginalStatus(row.status || PAPER_STATUSES.DRAFT)
          setExistingQuizId(row.quizId || null)
          if (row.quizId) {
            try {
              const qs = await getDocs(query(collection(db, 'quizzes', row.quizId, 'questions')))
              if (!cancelled && !qs.empty) {
                const loaded = qs.docs
                  .map((d) => ({ id: d.id, persisted: true, ...d.data() }))
                  .sort((a, b) => (a.order || 0) - (b.order || 0))
                setQuestions(loaded.length ? loaded : [emptyQuestion(0)])
              }
            } catch (err) {
              console.warn('[PastPaperStudio] loading existing questions failed', err)
            }
          }
        }
      } catch (err) {
        console.error('[PastPaperStudio] bootstrap failed', err)
        if (!cancelled) setError(err?.message || 'Could not start the studio.')
      } finally {
        if (!cancelled) setBootstrapping(false)
      }
    }
    bootstrap()
    return () => { cancelled = true }
  }, [currentUser?.uid, isNew, routePaperId])

  function jump(target) {
    if (target <= step) { setStep(target); return }
    if (completed.has(target - 1) || target === step + 1) setStep(target)
  }

  function markCompleted(stepId) {
    setCompleted((prev) => {
      const next = new Set(prev)
      next.add(stepId)
      return next
    })
  }

  // ── Step 1: assets ────────────────────────────────────────────────
  async function handleAddFiles(files) {
    if (!paperId || !currentUser?.uid) return
    setError('')
    setUploading(true)
    const baseIndex = assets.length
    const next = [...assets]
    try {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i]
        if (!ALLOWED_PAPER_MIME.includes(file.type)) {
          setError(`Skipped "${file.name}" — unsupported type (${file.type || 'unknown'}).`)
          continue
        }
        if (file.size > MAX_PAPER_FILE_BYTES) {
          setError(`Skipped "${file.name}" — over 50MB.`)
          continue
        }
        const result = await uploadPaperAsset({
          uid: currentUser.uid,
          paperId,
          file,
          index: baseIndex + i,
        })
        next.push(result)
      }
      setAssets(next)
      const assetType = inferAssetType(next)
      await updatePaper(paperId, { assets: next, assetType })
    } catch (err) {
      console.error('[PastPaperStudio] upload failed', err)
      setError(err?.message || 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function handleRemoveAsset(idx) {
    if (!paperId) return
    const removed = assets[idx]
    if (!removed) return
    setError('')
    const next = assets.filter((_, i) => i !== idx)
    try {
      await deletePaperPdf(removed.path).catch(() => {})
      await updatePaper(paperId, { assets: next, assetType: inferAssetType(next) })
      setAssets(next)
    } catch (err) {
      console.error('[PastPaperStudio] remove failed', err)
      setError('Could not remove that file.')
    }
  }

  function moveAsset(idx, dir) {
    const target = idx + dir
    if (target < 0 || target >= assets.length) return
    const next = [...assets]
    const [item] = next.splice(idx, 1)
    next.splice(target, 0, item)
    setAssets(next)
    updatePaper(paperId, { assets: next }).catch((err) => console.warn('[PastPaperStudio] reorder save failed', err))
  }

  function inferAssetType(list) {
    if (!list.length) return 'pdf'
    if (list.every((a) => a.contentType === 'application/pdf')) return 'pdf'
    if (list.every((a) => a.contentType?.startsWith('image/'))) return list.length > 1 ? 'images' : 'image'
    return 'mixed'
  }

  // ── Step 2: details ───────────────────────────────────────────────
  function setDetail(key, value) { setDetails((d) => ({ ...d, [key]: value })) }

  async function saveDetails() {
    if (!paperId) return
    if (!details.title.trim()) { setError('Title is required.'); return false }
    if (!details.year) { setError('Year is required.'); return false }
    setError('')
    setSaving(true)
    try {
      await updatePaper(paperId, {
        title: details.title.trim(),
        grade: details.grade,
        subject: details.subject,
        year: Number(details.year),
        paperNumber: details.paperNumber ? Number(details.paperNumber) : null,
        examBoard: details.examBoard.trim() || 'ECZ',
        description: details.description.trim() || null,
        durationMinutes: details.durationMinutes ? Number(details.durationMinutes) : null,
        totalMarks: details.totalMarks ? Number(details.totalMarks) : null,
      })
      return true
    } catch (err) {
      console.error('[PastPaperStudio] saveDetails failed', err)
      setError(err?.message || 'Could not save details.')
      return false
    } finally {
      setSaving(false)
    }
  }

  // ── Step 3-4: questions ───────────────────────────────────────────
  function setQuestion(idx, patch) {
    setQuestions((arr) => arr.map((q, i) => (i === idx ? { ...q, ...patch } : q)))
  }
  function setOption(qIdx, optIdx, value) {
    setQuestions((arr) => arr.map((q, i) => {
      if (i !== qIdx) return q
      const options = [...q.options]
      options[optIdx] = value
      return { ...q, options }
    }))
  }
  function addQuestion() {
    setQuestions((arr) => [...arr, emptyQuestion(arr.length)])
  }
  function removeQuestion(idx) {
    setQuestions((arr) => arr.filter((_, i) => i !== idx).map((q, i) => ({ ...q, order: i })))
  }
  function moveQuestion(idx, dir) {
    const target = idx + dir
    setQuestions((arr) => {
      if (target < 0 || target >= arr.length) return arr
      const next = [...arr]
      const [item] = next.splice(idx, 1)
      next.splice(target, 0, item)
      return next.map((q, i) => ({ ...q, order: i }))
    })
  }

  async function importQuestionsWithAi() {
    if (!paperId || importing) return
    if (!assets.length) {
      setError('Upload at least one file before running the AI importer.')
      return
    }
    const hasWork = questions.some((q) => q.text?.trim() || q.options?.some((o) => o.trim()))
    if (hasWork && typeof window !== 'undefined' &&
        !window.confirm('Replace the current question draft with the AI-extracted questions?')) {
      return
    }
    setError('')
    setInfo('')
    setImporting(true)
    try {
      const res = await importPastPaperQuestionsCallable({ paperId })
      const drafts = Array.isArray(res?.data?.questions) ? res.data.questions : []
      if (!drafts.length) {
        setError(res?.data?.warning || 'The AI could not extract any questions from this paper.')
        return
      }
      const next = drafts.map((q, i) => ({
        id: `local-${Math.random().toString(36).slice(2, 9)}`,
        persisted: false,
        type: 'mcq',
        text: q.prompt || '',
        // Pad to 4 options for the editor UI; admins can tweak counts in step 3.
        options: [0, 1, 2, 3].map((k) => q.options?.[k] || ''),
        correctAnswer: Number.isInteger(q.correctAnswer) ? q.correctAnswer : 0,
        explanation: q.explanation || '',
        marks: 1,
        order: i,
        requiresReview: true,
      }))
      setQuestions(next)
      const parts = [`Imported ${next.length} question${next.length === 1 ? '' : 's'}.`]
      if (res?.data?.warning) parts.push(res.data.warning)
      parts.push('Review every answer before publishing.')
      setInfo(parts.join(' '))
    } catch (err) {
      console.error('[PastPaperStudio] import failed', err)
      setError(err?.message || 'AI import failed.')
    } finally {
      setImporting(false)
    }
  }

  function validateQuestionsForStep(currentStep) {
    for (let i = 0; i < questions.length; i += 1) {
      const q = questions[i]
      if (!q.text?.trim()) return `Question ${i + 1} is missing a prompt.`
      if (currentStep >= 3) {
        const filled = (q.options || []).filter((o) => o.trim()).length
        if (filled < 2) return `Question ${i + 1} needs at least 2 options.`
      }
      if (currentStep >= 4) {
        const idx = Number(q.correctAnswer)
        if (!Number.isInteger(idx) || idx < 0 || idx >= q.options.length) {
          return `Question ${i + 1} needs a marked correct answer.`
        }
        if (!String(q.options[idx]).trim()) {
          return `Question ${i + 1} has its correct answer pointing at an empty option.`
        }
      }
    }
    return null
  }

  // ── Step 5: publish ───────────────────────────────────────────────
  async function publish() {
    if (!paperId || !currentUser?.uid) return
    setError('')
    if (!assets.length) { setError('Upload at least one asset before publishing.'); return }
    if (!details.title.trim()) { setError('Title is required.'); return }
    const issue = validateQuestionsForStep(4)
    if (issue) { setError(issue); return }
    if (!questions.length) { setError('Add at least one question.'); return }

    setPublishing(true)
    try {
      const detailsOk = await saveDetails()
      if (!detailsOk) return

      // Create-or-reuse the linked quiz doc.
      const quizId = existingQuizId || doc(collection(db, 'quizzes')).id
      const quizFields = {
        title: `${details.title.trim()} — Quiz`,
        subject: details.subject,
        topic: 'past-paper',
        isPublished: true,
        publicAccess: true,
        quizType: 'past_paper',
        linkedPaperId: paperId,
        createdBy: currentUser.uid,
        questionCount: questions.length,
        updatedAt: serverTimestamp(),
      }
      // Persist grade only when it falls within the rules' allowed set;
      // outside that range (e.g. Grade 12) the rule rejects the write,
      // so omit and rely on the linked paper for the grade label.
      if (['4', '5', '6', '7'].includes(details.grade)) {
        quizFields.grade = details.grade
      }
      const quizRef = doc(db, 'quizzes', quizId)
      if (existingQuizId) {
        await setDoc(quizRef, quizFields, { merge: true })
      } else {
        await setDoc(quizRef, { ...quizFields, createdAt: serverTimestamp() })
      }

      // Rewrite questions: deterministic ids by order so re-publish
      // overwrites cleanly without leaving stale ones from earlier runs.
      const batch = writeBatch(db)
      // Wipe any previously persisted questions that are no longer in
      // the working set (e.g. admin removed Q5 since last publish).
      if (existingQuizId) {
        const existingSnap = await getDocs(collection(db, 'quizzes', quizId, 'questions'))
        const keep = new Set(questions.filter((q) => q.persisted).map((q) => q.id))
        existingSnap.forEach((d) => {
          if (!keep.has(d.id)) batch.delete(d.ref)
        })
      }
      questions.forEach((q, i) => {
        const qid = q.persisted ? q.id : `q${String(i + 1).padStart(3, '0')}`
        const ref = doc(db, 'quizzes', quizId, 'questions', qid)
        batch.set(ref, {
          type: 'mcq',
          text: q.text.trim(),
          options: q.options.map((o) => o.trim()),
          correctAnswer: Number(q.correctAnswer),
          explanation: (q.explanation || '').trim(),
          marks: Math.max(1, Math.min(10, Number(q.marks) || 1)),
          order: i,
          updatedAt: serverTimestamp(),
        }, { merge: true })
      })
      await batch.commit()

      // Final paper update: link quiz, flip to published, refresh
      // counters that the rules ignore but the UI uses.
      await updatePaper(paperId, {
        quizId,
        status: PAPER_STATUSES.PUBLISHED,
      })
      setExistingQuizId(quizId)
      setInfo('Published.')
      navigate('/admin/papers')
    } catch (err) {
      console.error('[PastPaperStudio] publish failed', err)
      setError(err?.message || 'Could not publish.')
    } finally {
      setPublishing(false)
    }
  }

  async function discardDraft() {
    if (!paperId || originalStatus === PAPER_STATUSES.PUBLISHED) return
    if (typeof window !== 'undefined' && !window.confirm('Discard this draft? Uploaded files will be deleted.')) return
    try {
      await deletePaper(paperId, assets.map((a) => a.path))
      navigate('/admin/papers')
    } catch (err) {
      console.error('[PastPaperStudio] discard failed', err)
      setError('Could not discard. Try again.')
    }
  }

  // ── Navigation handlers ───────────────────────────────────────────
  async function goNext() {
    setError('')
    if (step === 1) {
      if (!assets.length) { setError('Upload at least one file first.'); return }
      markCompleted(1)
      setStep(2)
    } else if (step === 2) {
      const ok = await saveDetails()
      if (!ok) return
      markCompleted(2)
      setStep(3)
    } else if (step === 3) {
      const issue = validateQuestionsForStep(3)
      if (issue) { setError(issue); return }
      markCompleted(3)
      setStep(4)
    } else if (step === 4) {
      const issue = validateQuestionsForStep(4)
      if (issue) { setError(issue); return }
      markCompleted(4)
      setStep(5)
    }
  }

  if (bootstrapping) return <p className="theme-text-muted text-sm">Starting studio…</p>
  if (!paperId) return <p className="theme-text-muted text-sm">{error || 'Loading…'}</p>

  return (
    <div className="space-y-5 max-w-4xl">
      <SeoHelmet title={isNew ? 'New past paper' : 'Edit past paper'} path="/admin/papers" noIndex />

      <div>
        <Link to="/admin/papers" className="text-xs font-bold theme-text-muted hover:theme-text">
          ← All papers
        </Link>
        <h1 className="theme-text font-display font-black text-2xl sm:text-3xl mt-1">
          {isNew ? 'New past paper' : 'Edit past paper'}
        </h1>
        <p className="theme-text-muted text-sm mt-1">
          A draft is saved automatically so you can leave and come back. Publish links the quiz
          to the paper so learners (and marketing visitors) can take it inline.
        </p>
      </div>

      <div className="theme-card border theme-border rounded-radius-md p-4">
        <Stepper step={step} onJump={jump} completed={completed} />
      </div>

      {error && (
        <div role="alert" className="border-l-4 border-rose-500 bg-rose-50 text-rose-900 text-sm rounded-r-lg p-3 font-bold">
          {error}
        </div>
      )}
      {info && !error && (
        <div className="border-l-4 border-emerald-500 bg-emerald-50 text-emerald-900 text-sm rounded-r-lg p-3 font-bold">
          {info}
        </div>
      )}

      {step === 1 && (
        <UploadStep
          assets={assets}
          uploading={uploading}
          onAddFiles={handleAddFiles}
          onRemove={handleRemoveAsset}
          onMove={moveAsset}
        />
      )}
      {step === 2 && <DetailsStep details={details} setDetail={setDetail} />}
      {step === 3 && (
        <QuestionsStep
          questions={questions}
          setQuestion={setQuestion}
          setOption={setOption}
          onAdd={addQuestion}
          onRemove={removeQuestion}
          onMove={moveQuestion}
          onImportWithAi={importQuestionsWithAi}
          importing={importing}
          hasAssets={assets.length > 0}
        />
      )}
      {step === 4 && (
        <AnswersStep
          questions={questions}
          setQuestion={setQuestion}
        />
      )}
      {step === 5 && (
        <PublishStep
          details={details}
          assets={assets}
          questions={questions}
          existingQuizId={existingQuizId}
        />
      )}

      <div className="flex flex-wrap items-center gap-3 pt-3 border-t theme-border">
        {step > 1 && (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            className="theme-card border-2 theme-border rounded-full px-4 py-2 text-sm font-black theme-text hover:theme-bg-subtle"
          >
            ← Back
          </button>
        )}
        {step < 5 && (
          <button
            type="button"
            onClick={goNext}
            disabled={saving}
            className="theme-accent-fill theme-on-accent rounded-full px-5 py-2 text-sm font-black hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Continue →'}
          </button>
        )}
        {step === 5 && (
          <button
            type="button"
            onClick={publish}
            disabled={publishing}
            className="rounded-full px-5 py-2 text-sm font-black bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {publishing ? 'Publishing…' : (originalStatus === PAPER_STATUSES.PUBLISHED ? 'Save changes' : 'Publish paper')}
          </button>
        )}
        <Link to="/admin/papers" className="text-sm font-bold theme-text-muted hover:theme-text">
          Cancel
        </Link>
        {originalStatus !== PAPER_STATUSES.PUBLISHED && (
          <button
            type="button"
            onClick={discardDraft}
            className="ml-auto text-xs font-bold text-rose-700 hover:underline"
          >
            Discard draft
          </button>
        )}
      </div>
    </div>
  )
}

// ── Step bodies ─────────────────────────────────────────────────────

function UploadStep({ assets, uploading, onAddFiles, onRemove, onMove }) {
  return (
    <section className="space-y-4">
      <DropZone disabled={uploading} onFiles={onAddFiles} />
      <div className="text-xs theme-text-muted">
        {uploading ? 'Uploading… please wait.' : `Uploaded ${assets.length} file${assets.length === 1 ? '' : 's'}.`}
      </div>
      <ul className="space-y-2">
        {assets.map((a, i) => (
          <li key={a.path} className="theme-card border theme-border rounded-radius-md p-3 flex items-center gap-3">
            <span className="text-xl" aria-hidden="true">
              {a.contentType === 'application/pdf' ? '📄' : '🖼️'}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-black text-sm theme-text truncate">{a.filename}</p>
              <p className="text-xs theme-text-muted">{formatBytes(a.size)} · {a.contentType}</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onMove(i, -1)}
                disabled={i === 0}
                className="px-2 py-1 text-xs font-black theme-text-muted hover:theme-text disabled:opacity-30"
                aria-label="Move up"
              >↑</button>
              <button
                type="button"
                onClick={() => onMove(i, 1)}
                disabled={i === assets.length - 1}
                className="px-2 py-1 text-xs font-black theme-text-muted hover:theme-text disabled:opacity-30"
                aria-label="Move down"
              >↓</button>
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="px-2 py-1 text-xs font-bold text-rose-700 hover:underline"
              >Remove</button>
            </div>
          </li>
        ))}
      </ul>
      {assets.length === 0 && (
        <p className="theme-text-muted text-sm italic">
          No files uploaded yet. Drag a PDF or one or more scanned-page images above to start.
        </p>
      )}
    </section>
  )
}

function FieldRow({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-black theme-text-muted uppercase tracking-widest">
        {label}
        {hint && <span className="ml-2 normal-case text-[11px] font-normal opacity-70">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function DetailsStep({ details, setDetail }) {
  return (
    <section className="space-y-4">
      <FieldRow label="Title" hint="e.g. Mathematics Paper 1 (2023)">
        <input
          type="text"
          value={details.title}
          onChange={(e) => setDetail('title', e.target.value)}
          className={inputCls()}
          required
          placeholder="Mathematics Paper 1"
        />
      </FieldRow>
      <div className="grid sm:grid-cols-3 gap-4">
        <FieldRow label="Grade">
          <select value={details.grade} onChange={(e) => setDetail('grade', e.target.value)} className={inputCls()}>
            {PAPER_GRADES.map((g) => <option key={g} value={g}>Grade {g}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Subject">
          <select value={details.subject} onChange={(e) => setDetail('subject', e.target.value)} className={inputCls()}>
            {SUBJECTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Year">
          <select value={details.year} onChange={(e) => setDetail('year', Number(e.target.value))} className={inputCls()}>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </FieldRow>
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        <FieldRow label="Paper number" hint="optional">
          <input type="number" min="1" max="5" value={details.paperNumber} onChange={(e) => setDetail('paperNumber', e.target.value)} className={inputCls()} placeholder="1" />
        </FieldRow>
        <FieldRow label="Duration (min)" hint="optional">
          <input type="number" min="5" max="480" value={details.durationMinutes} onChange={(e) => setDetail('durationMinutes', e.target.value)} className={inputCls()} placeholder="120" />
        </FieldRow>
        <FieldRow label="Total marks" hint="optional">
          <input type="number" min="0" max="1000" value={details.totalMarks} onChange={(e) => setDetail('totalMarks', e.target.value)} className={inputCls()} placeholder="100" />
        </FieldRow>
      </div>
      <FieldRow label="Exam board" hint="default ECZ">
        <input type="text" value={details.examBoard} onChange={(e) => setDetail('examBoard', e.target.value)} className={inputCls()} placeholder="ECZ" />
      </FieldRow>
      <FieldRow label="Description" hint="shown to learners on the paper page">
        <textarea rows={3} value={details.description} onChange={(e) => setDetail('description', e.target.value)} className={inputCls()} placeholder="Algebra, geometry, and statistics. Closed-book. Calculator allowed." />
      </FieldRow>
    </section>
  )
}

function QuestionsStep({
  questions, setQuestion, setOption, onAdd, onRemove, onMove,
  onImportWithAi, importing, hasAssets,
}) {
  return (
    <section className="space-y-4">
      <div className="theme-card border theme-border rounded-radius-md p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="theme-text font-black text-sm">Import questions with AI</p>
          <p className="theme-text-muted text-xs mt-0.5">
            Read the uploaded paper with Claude and pre-fill the question list.
            You still review every answer before publishing.
          </p>
        </div>
        <button
          type="button"
          onClick={onImportWithAi}
          disabled={importing || !hasAssets}
          className="theme-accent-fill theme-on-accent rounded-full px-4 py-2 text-sm font-black hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {importing ? 'Importing… this can take 30-60 s' : '✨ Import with AI'}
        </button>
      </div>
      <p className="theme-text-muted text-sm">
        Add each multiple-choice question with its options. You&apos;ll mark the correct
        answer and add explanations in the next step.
      </p>
      <ol className="space-y-4">
        {questions.map((q, i) => (
          <li key={q.id} className="theme-card border theme-border rounded-radius-md p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="theme-accent-text font-black text-xs uppercase tracking-widest">Question {i + 1}</span>
              <div className="ml-auto flex items-center gap-1">
                <button type="button" onClick={() => onMove(i, -1)} disabled={i === 0} className="px-2 py-1 text-xs font-black theme-text-muted hover:theme-text disabled:opacity-30">↑</button>
                <button type="button" onClick={() => onMove(i, 1)} disabled={i === questions.length - 1} className="px-2 py-1 text-xs font-black theme-text-muted hover:theme-text disabled:opacity-30">↓</button>
                {questions.length > 1 && (
                  <button type="button" onClick={() => onRemove(i)} className="px-2 py-1 text-xs font-bold text-rose-700 hover:underline">Remove</button>
                )}
              </div>
            </div>
            <FieldRow label="Prompt">
              <textarea
                rows={2}
                value={q.text}
                onChange={(e) => setQuestion(i, { text: e.target.value })}
                className={inputCls()}
                placeholder="What is 2 + 2?"
              />
            </FieldRow>
            <div className="grid sm:grid-cols-2 gap-3">
              {q.options.map((opt, oi) => (
                <FieldRow key={oi} label={`Option ${String.fromCharCode(65 + oi)}`}>
                  <input
                    type="text"
                    value={opt}
                    onChange={(e) => setOption(i, oi, e.target.value)}
                    className={inputCls()}
                    placeholder={`Option ${String.fromCharCode(65 + oi)}`}
                  />
                </FieldRow>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={onAdd}
        className="theme-card border-2 border-dashed theme-border rounded-radius-md w-full p-4 text-sm font-black theme-text-muted hover:theme-text"
      >
        + Add another question
      </button>
    </section>
  )
}

function AnswersStep({ questions, setQuestion }) {
  return (
    <section className="space-y-4">
      <p className="theme-text-muted text-sm">
        Mark the correct option and (optionally) write a short explanation that the learner
        will see after they answer.
      </p>
      <ol className="space-y-4">
        {questions.map((q, i) => (
          <li key={q.id} className="theme-card border theme-border rounded-radius-md p-4 space-y-3">
            <p className="theme-accent-text font-black text-xs uppercase tracking-widest">Question {i + 1}</p>
            <p className="theme-text font-black text-sm">{q.text || <em className="theme-text-muted">No prompt entered yet.</em>}</p>
            <FieldRow label="Correct answer">
              <div className="flex flex-wrap gap-2">
                {q.options.map((opt, oi) => {
                  const filled = String(opt).trim()
                  const isSelected = Number(q.correctAnswer) === oi
                  return (
                    <button
                      key={oi}
                      type="button"
                      onClick={() => setQuestion(i, { correctAnswer: oi })}
                      disabled={!filled}
                      className={[
                        'rounded-full px-3 py-1.5 text-xs font-black border-2 transition-colors',
                        isSelected
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
                          : 'theme-card theme-text-muted theme-border hover:theme-text',
                        !filled ? 'opacity-50 cursor-not-allowed' : '',
                      ].join(' ')}
                    >
                      {String.fromCharCode(65 + oi)} · {filled || <em>(empty)</em>}
                    </button>
                  )
                })}
              </div>
            </FieldRow>
            <FieldRow label="Explanation" hint="optional, shown after the learner answers">
              <textarea
                rows={2}
                value={q.explanation}
                onChange={(e) => setQuestion(i, { explanation: e.target.value })}
                className={inputCls()}
                placeholder="Why is this answer correct? What concept is being tested?"
              />
            </FieldRow>
          </li>
        ))}
      </ol>
    </section>
  )
}

function PublishStep({ details, assets, questions, existingQuizId }) {
  const subjectMeta = useMemo(() => SUBJECTS.find((s) => s.id === details.subject), [details.subject])
  return (
    <section className="space-y-4">
      <div className="theme-card border theme-border rounded-radius-md p-5">
        <p className="theme-accent-text font-black text-xs uppercase tracking-widest mb-2">Paper</p>
        <h3 className="font-display font-black text-2xl theme-text">{details.title || 'Untitled'}</h3>
        <p className="theme-text-muted text-sm mt-1">
          {subjectMeta?.label || details.subject} · Grade {details.grade} · {details.year}
          {details.paperNumber ? ` · Paper ${details.paperNumber}` : ''}
        </p>
        <div className="mt-4 grid sm:grid-cols-3 gap-3 text-xs theme-text-muted">
          <div><span className="font-black theme-text">Exam board:</span> {details.examBoard || 'ECZ'}</div>
          {details.durationMinutes && <div><span className="font-black theme-text">Duration:</span> {details.durationMinutes} min</div>}
          {details.totalMarks && <div><span className="font-black theme-text">Total marks:</span> {details.totalMarks}</div>}
        </div>
        {details.description && <p className="theme-text-muted text-sm mt-3">{details.description}</p>}
      </div>
      <div className="theme-card border theme-border rounded-radius-md p-5">
        <p className="theme-accent-text font-black text-xs uppercase tracking-widest mb-2">Files ({assets.length})</p>
        <ul className="space-y-1 text-sm">
          {assets.map((a, i) => (
            <li key={a.path} className="theme-text flex items-center gap-2">
              <span aria-hidden="true">{a.contentType === 'application/pdf' ? '📄' : '🖼️'}</span>
              <span className="truncate">{i + 1}. {a.filename}</span>
              <span className="text-xs theme-text-muted ml-auto">{formatBytes(a.size)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="theme-card border theme-border rounded-radius-md p-5">
        <p className="theme-accent-text font-black text-xs uppercase tracking-widest mb-2">Quiz ({questions.length} question{questions.length === 1 ? '' : 's'})</p>
        <ol className="space-y-3 text-sm">
          {questions.map((q, i) => {
            const idx = Number(q.correctAnswer)
            const correctText = q.options?.[idx] || '—'
            return (
              <li key={q.id}>
                <p className="theme-text font-black">{i + 1}. {q.text}</p>
                <p className="theme-text-muted text-xs mt-1">
                  Correct: <span className="text-emerald-700 font-bold">{String.fromCharCode(65 + idx)}. {correctText}</span>
                </p>
              </li>
            )
          })}
        </ol>
      </div>
      <p className="theme-text-muted text-xs">
        Publishing will set this paper&apos;s status to <strong>Published</strong> and
        {existingQuizId ? ' update the linked quiz' : ' create a new linked quiz'} with public
        access so anonymous marketing visitors can preview up to 30 questions.
      </p>
    </section>
  )
}
