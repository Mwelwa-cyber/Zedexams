/**
 * /admin/papers/new and /admin/papers/:paperId/edit — Past Paper Studio.
 *
 * Four-step wizard that walks an admin from raw PDF / Word / image
 * uploads through to a published past paper with an attached quiz:
 *
 *   1. Upload  — PDF, Word, or scanned images up to 50MB each. The
 *                step also previews each upload inline so the admin
 *                can see exactly what the learner will see.
 *   2. Details — grade, subject, year, board, title, marks, duration
 *   3. Quiz    — Open Quiz Editor + Import-with-AI handoff
 *   4. Publish — flip the linked quiz to publicAccess + isPublished,
 *                flip the paper to status='published'.
 *
 * Pattern: a draft `pastPapers/{id}` doc is created on Studio mount
 * (new mode) so uploaded Storage assets have a stable place to land.
 * Assets are uploaded immediately, not held in browser memory — a
 * scanned paper can be 30+ images at 5-10MB each.
 *
 * Replaces the older single-page AdminPastPaperEditor.
 */

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import {
  ALLOWED_PAPER_MIME,
  ASSET_ROLES,
  MAX_PAPER_FILE_BYTES,
  PAPER_GRADES,
  PAPER_STATUSES,
  createPaper,
  deletePaper,
  deletePaperPdf,
  getAssetRole,
  getPaper,
  resolvePaperUrl,
  splitAssetsByRole,
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
} from 'firebase/firestore'

// PDF.js viewer is ~400 kB gzipped — only load it once the admin
// actually reaches step 1 with a PDF asset on screen.
const PdfJsViewer = lazy(() => import('../papers/PdfJsViewer'))

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
  { id: 1, label: 'Upload', hint: 'PDF, Word or images' },
  { id: 2, label: 'Details', hint: 'Subject, grade, year' },
  { id: 3, label: 'Quiz', hint: 'AI import + Quiz Editor' },
  { id: 4, label: 'Publish', hint: 'Review and go live' },
]

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
        PDF, Word (.doc/.docx), JPG, PNG or WEBP · up to 50 MB each · scanned papers can be multiple images
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
  // Linked quiz: question authoring happens in the Quiz Editor, not in
  // the Studio. We keep the id + question count here so step 3 can
  // surface "N questions in the quiz" and a one-click handoff.
  const [existingQuizId, setExistingQuizId] = useState(null)
  const [quizCount, setQuizCount] = useState(0)
  const [originalStatus, setOriginalStatus] = useState(PAPER_STATUSES.DRAFT)
  const [uploading, setUploading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [linkingQuiz, setLinkingQuiz] = useState(false)

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
              if (!cancelled) setQuizCount(qs.size)
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

  function setAssetRole(idx, role) {
    if (!assets[idx]) return
    const next = assets.map((a, i) => (i === idx ? { ...a, role } : a))
    setAssets(next)
    updatePaper(paperId, { assets: next }).catch(
      (err) => console.warn('[PastPaperStudio] role save failed', err),
    )
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
  // ── Step 3: linked quiz handoff ───────────────────────────────────

  // Lazy-create the quiz that the Quiz Editor will manage. Called on
  // first entry to step 3. We use the existing `quizzes/` rules + the
  // Studio's admin context so the editor is fully feature-complete
  // (image options, rich text, multiple types).
  async function ensureLinkedQuiz() {
    if (!paperId || !currentUser?.uid) return null
    if (existingQuizId) return existingQuizId
    setLinkingQuiz(true)
    try {
      const quizId = doc(collection(db, 'quizzes')).id
      const fields = {
        title: `${details.title.trim() || 'Untitled past paper'} — Quiz`,
        subject: details.subject,
        topic: 'past-paper',
        isPublished: false,
        publicAccess: false,
        quizType: 'past_paper',
        linkedPaperId: paperId,
        createdBy: currentUser.uid,
        questionCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
      // The quizzes rule's _validGrade accepts 4-7 only. For non-G4-7
      // papers (e.g. Grade 12) we leave grade off — the paper carries
      // the grade label and the quiz is reached via the linked paper.
      if (['4', '5', '6', '7'].includes(details.grade)) {
        fields.grade = details.grade
      }
      await setDoc(doc(db, 'quizzes', quizId), fields)
      await updatePaper(paperId, { quizId })
      setExistingQuizId(quizId)
      return quizId
    } catch (err) {
      console.error('[PastPaperStudio] linked-quiz create failed', err)
      setError(err?.message || 'Could not create the linked quiz.')
      return null
    } finally {
      setLinkingQuiz(false)
    }
  }

  async function refreshQuizCount() {
    if (!existingQuizId) return
    try {
      const snap = await getDocs(collection(db, 'quizzes', existingQuizId, 'questions'))
      setQuizCount(snap.size)
    } catch (err) {
      console.warn('[PastPaperStudio] refreshQuizCount failed', err)
    }
  }

  async function openQuizEditor() {
    setError('')
    const quizId = await ensureLinkedQuiz()
    if (quizId) navigate(`/admin/quizzes/${quizId}/edit`)
  }

  async function importQuestionsWithAi() {
    if (!paperId || importing) return
    if (!assets.length) {
      setError('Upload at least one file before running the AI importer.')
      return
    }
    const quizId = await ensureLinkedQuiz()
    if (!quizId) return
    if (quizCount > 0 && typeof window !== 'undefined' &&
        !window.confirm(`This will replace all ${quizCount} existing questions with the AI-extracted ones. Continue?`)) {
      return
    }
    setError('')
    setInfo('')
    setImporting(true)
    try {
      const res = await importPastPaperQuestionsCallable({ paperId, quizId })
      const written = Number(res?.data?.questionsWritten || 0)
      if (!written) {
        setError(res?.data?.warning || 'The AI could not extract any questions from this paper.')
        return
      }
      setQuizCount(written)
      const parts = [`Imported ${written} question${written === 1 ? '' : 's'} into the quiz.`]
      if (res?.data?.warning) parts.push(res.data.warning)
      parts.push('Open the Quiz Editor to review answers and add images before publishing.')
      setInfo(parts.join(' '))
    } catch (err) {
      console.error('[PastPaperStudio] import failed', err)
      setError(err?.message || 'AI import failed.')
    } finally {
      setImporting(false)
    }
  }

  // ── Step 4: publish ───────────────────────────────────────────────
  async function publish() {
    if (!paperId || !currentUser?.uid) return
    setError('')
    if (!assets.length) { setError('Upload at least one asset before publishing.'); return }
    if (!details.title.trim()) { setError('Title is required.'); return }
    if (!existingQuizId) {
      setError('No quiz is linked to this paper yet — finish step 3 first.')
      return
    }
    if (quizCount === 0) {
      setError('The linked quiz has no questions yet. Open the Quiz Editor or run the AI importer first.')
      return
    }

    setPublishing(true)
    try {
      const detailsOk = await saveDetails()
      if (!detailsOk) return

      // Flip the linked quiz from authoring mode to public.
      await setDoc(doc(db, 'quizzes', existingQuizId), {
        isPublished: true,
        publicAccess: true,
        title: `${details.title.trim()} — Quiz`,
        subject: details.subject,
        linkedPaperId: paperId,
        quizType: 'past_paper',
        updatedAt: serverTimestamp(),
      }, { merge: true })

      // Paper goes public.
      await updatePaper(paperId, {
        quizId: existingQuizId,
        status: PAPER_STATUSES.PUBLISHED,
      })
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
      // Lazy-create the linked quiz the moment we enter step 3 so
      // the "Open Quiz Editor" button is immediately useful.
      ensureLinkedQuiz()
    } else if (step === 3) {
      if (quizCount === 0) {
        setError('Add at least one question to the linked quiz before continuing.')
        return
      }
      markCompleted(3)
      setStep(4)
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
          onSetRole={setAssetRole}
        />
      )}
      {step === 2 && <DetailsStep details={details} setDetail={setDetail} />}
      {step === 3 && (
        <QuizStep
          paperId={paperId}
          quizId={existingQuizId}
          quizCount={quizCount}
          hasAssets={assets.length > 0}
          linkingQuiz={linkingQuiz}
          importing={importing}
          onOpenEditor={openQuizEditor}
          onImportWithAi={importQuestionsWithAi}
          onRefreshCount={refreshQuizCount}
        />
      )}
      {step === 4 && (
        <PublishStep
          paperId={paperId}
          details={details}
          assets={assets}
          quizId={existingQuizId}
          quizCount={quizCount}
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
        {step < 4 && (
          <button
            type="button"
            onClick={goNext}
            disabled={saving}
            className="theme-accent-fill theme-on-accent rounded-full px-5 py-2 text-sm font-black hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Continue →'}
          </button>
        )}
        {step === 4 && (
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

function RolePill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-full border-2 px-2.5 py-0.5 text-[11px] font-black transition-colors',
        active
          ? 'theme-accent-fill theme-on-accent border-transparent'
          : 'theme-card theme-text-muted theme-border hover:theme-text',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function UploadStep({ assets, uploading, onAddFiles, onRemove, onMove, onSetRole }) {
  return (
    <section className="space-y-4">
      <DropZone disabled={uploading} onFiles={onAddFiles} />
      <div className="text-xs theme-text-muted">
        {uploading ? 'Uploading… please wait.' : `Uploaded ${assets.length} file${assets.length === 1 ? '' : 's'}. Mark each as Paper or Mark scheme below.`}
      </div>
      <ul className="space-y-2">
        {assets.map((a, i) => {
          const role = getAssetRole(a)
          return (
            <li key={a.path} className="theme-card border theme-border rounded-radius-md p-3 flex flex-wrap items-center gap-3">
              <span className="text-xl" aria-hidden="true">
                {a.contentType === 'application/pdf'
                  ? '📄'
                  : a.contentType?.startsWith('image/')
                    ? '🖼️'
                    : '📝'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-black text-sm theme-text truncate">{a.filename}</p>
                <p className="text-xs theme-text-muted">{formatBytes(a.size)} · {a.contentType}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <RolePill active={role === ASSET_ROLES.PAPER} onClick={() => onSetRole(i, ASSET_ROLES.PAPER)}>
                  Paper
                </RolePill>
                <RolePill active={role === ASSET_ROLES.MARK_SCHEME} onClick={() => onSetRole(i, ASSET_ROLES.MARK_SCHEME)}>
                  Mark scheme
                </RolePill>
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
          )
        })}
      </ul>
      {assets.length === 0 && (
        <p className="theme-text-muted text-sm italic">
          No files uploaded yet. Drag a PDF, Word doc, or one or more scanned-page images above to start.
        </p>
      )}
      {assets.length > 0 && <AssetPreviews assets={assets} />}
    </section>
  )
}

/**
 * AssetPreviews — inline preview of every uploaded paper file.
 *
 * Resolves a signed Storage URL for each asset in parallel, then renders
 * the appropriate viewer:
 *   - application/pdf → lazy PdfJsViewer
 *   - image/* → inline <img> with lazy loading + readable max width
 *   - Word docs (or anything else) → placeholder copy. The AI importer
 *     in step 3 handles the text content; the admin uploads images
 *     manually inside the Quiz Editor afterwards.
 *
 * Why inline rather than a separate preview tab: a paper that survives
 * the upload + retention checks is one that the admin can SEE here, in
 * the same place they fix typos in filenames or reorder pages. No
 * round-trip through "publish, navigate, find the bug, come back."
 */
function AssetPreviews({ assets }) {
  const [urls, setUrls] = useState({})
  useEffect(() => {
    let cancelled = false
    const next = {}
    // Resolve every URL in parallel; failures fall back to null so the
    // preview shows an "unavailable" placeholder instead of crashing.
    Promise.all(assets.map(async (a) => {
      try {
        next[a.path] = await resolvePaperUrl(a.path)
      } catch (err) {
        console.warn('[PastPaperStudio] preview URL failed', a.path, err)
        next[a.path] = null
      }
    }))
      .then(() => { if (!cancelled) setUrls(next) })
      .catch(() => { /* per-asset errors already swallowed above */ })
    return () => { cancelled = true }
  }, [assets])

  const { paper: paperAssets, markScheme: msAssets } = splitAssetsByRole(assets)

  function renderAsset(a, idx) {
    const url = urls[a.path]
    const isPdf = a.contentType === 'application/pdf'
    const isImg = a.contentType?.startsWith('image/')
    return (
      <figure
        key={a.path}
        className="theme-card border theme-border rounded-radius-md overflow-hidden"
      >
        <figcaption className="theme-bg-subtle text-xs font-black theme-text-muted uppercase tracking-widest px-3 py-2 border-b theme-border">
          {idx + 1}. {a.filename}
        </figcaption>
        {url === undefined ? (
          <div className="h-40 flex items-center justify-center theme-text-muted text-sm">
            Loading preview…
          </div>
        ) : url === null ? (
          <div className="h-32 flex items-center justify-center theme-text-muted text-sm">
            Could not load this file&apos;s preview.
          </div>
        ) : isPdf ? (
          <Suspense fallback={
            <div className="h-[60vh] flex items-center justify-center theme-text-muted text-sm">
              Loading PDF viewer…
            </div>
          }>
            <PdfJsViewer url={url} title={a.filename} />
          </Suspense>
        ) : isImg ? (
          <img
            src={url}
            alt={a.filename}
            loading="lazy"
            decoding="async"
            className="w-full h-auto theme-bg-subtle"
          />
        ) : (
          <div className="p-6 text-center text-sm theme-text-muted space-y-1">
            <p className="theme-text font-black">Word document</p>
            <p>Preview not available — Word files render in the AI importer (step 3) instead.</p>
          </div>
        )}
      </figure>
    )
  }

  return (
    <div className="space-y-4 pt-2">
      <div>
        <p className="theme-text font-black text-sm">Preview</p>
        <p className="theme-text-muted text-xs">
          This is exactly how the paper will look to learners on /papers/:id.
        </p>
      </div>
      {paperAssets.length > 0 && (
        <div className="space-y-3">
          <p className="theme-accent-text font-black text-xs uppercase tracking-widest">
            Paper ({paperAssets.length})
          </p>
          {paperAssets.map((a, i) => renderAsset(a, i))}
        </div>
      )}
      {msAssets.length > 0 && (
        <div className="space-y-3">
          <p className="theme-accent-text font-black text-xs uppercase tracking-widest">
            Mark scheme ({msAssets.length})
          </p>
          {msAssets.map((a, i) => renderAsset(a, i))}
        </div>
      )}
    </div>
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

function QuizStep({
  paperId, quizId, quizCount, hasAssets, linkingQuiz, importing,
  onOpenEditor, onImportWithAi, onRefreshCount,
}) {
  return (
    <section className="space-y-4">
      <div className="theme-card border theme-border rounded-radius-md p-5 space-y-3">
        <p className="theme-accent-text font-black text-xs uppercase tracking-widest">Quiz authoring</p>
        <p className="theme-text font-black text-base">
          {quizCount > 0
            ? `${quizCount} question${quizCount === 1 ? '' : 's'} in the linked quiz`
            : 'No questions yet'}
        </p>
        <p className="theme-text-muted text-sm">
          Build the quiz in the full Quiz Editor — it supports images per option,
          rich text, multiple question types, and reordering. Use AI import to
          pre-fill MCQs from the uploaded paper, then open the editor to attach
          pictures and review answers.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={onOpenEditor}
            disabled={linkingQuiz}
            className="theme-accent-fill theme-on-accent rounded-full px-4 py-2 text-sm font-black hover:opacity-90 disabled:opacity-50"
          >
            {linkingQuiz ? 'Linking quiz…' : (quizId ? 'Open Quiz Editor →' : 'Create quiz + open editor →')}
          </button>
          <button
            type="button"
            onClick={onImportWithAi}
            disabled={importing || !hasAssets}
            className="theme-card border-2 theme-border rounded-full px-4 py-2 text-sm font-black theme-text hover:theme-bg-subtle disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {importing ? 'Importing… 30-60 s' : '✨ Import with AI'}
          </button>
          {quizCount > 0 && (
            <a
              href={`/papers/${paperId}/quiz`}
              target="_blank"
              rel="noreferrer"
              className="theme-card border-2 theme-border rounded-full px-4 py-2 text-sm font-black theme-text hover:theme-bg-subtle"
            >
              👀 Preview as learner ↗
            </a>
          )}
          {quizId && (
            <button
              type="button"
              onClick={onRefreshCount}
              className="text-xs font-bold theme-text-muted hover:theme-text ml-auto"
            >
              Refresh count
            </button>
          )}
        </div>
        {!hasAssets && (
          <p className="text-xs font-bold text-amber-700">
            Upload at least one file in step 1 before running the AI importer.
          </p>
        )}
      </div>
      <div className="theme-card border theme-border rounded-radius-md p-4 text-sm theme-text-muted">
        <p className="font-black theme-text mb-1">Tip</p>
        Open the Quiz Editor in a new browser tab if you want to keep the Studio
        open at the same time. When you come back, click <em>Refresh count</em>
        to see how many questions the editor now holds.
      </div>
    </section>
  )
}

function PublishStep({ paperId, details, assets, quizId, quizCount }) {
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
              <span aria-hidden="true">{a.contentType === 'application/pdf' ? '📄' : a.contentType?.startsWith('image/') ? '🖼️' : '📝'}</span>
              <span className="truncate">{i + 1}. {a.filename}</span>
              <span className="text-xs theme-text-muted ml-auto">{formatBytes(a.size)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="theme-card border theme-border rounded-radius-md p-5">
        <p className="theme-accent-text font-black text-xs uppercase tracking-widest mb-2">Linked quiz</p>
        <p className="theme-text font-black text-sm">
          {quizCount} question{quizCount === 1 ? '' : 's'} ready
        </p>
        {quizId && (
          <p className="theme-text-muted text-xs mt-1 font-mono break-all">
            quiz id: {quizId}
          </p>
        )}
      </div>
      {quizCount > 0 && (
        <a
          href={`/papers/${paperId}/quiz`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 theme-card border-2 theme-border rounded-full px-4 py-2 text-sm font-black theme-text hover:theme-bg-subtle"
        >
          👀 Preview as learner ↗
        </a>
      )}
      <p className="theme-text-muted text-xs">
        Publishing flips the paper to <strong>Published</strong> and turns on
        <strong> publicAccess</strong> on the linked quiz, so anonymous marketing
        visitors can preview up to 30 questions before the paywall.
      </p>
    </section>
  )
}
