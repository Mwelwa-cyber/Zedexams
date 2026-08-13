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
 *   3. Quiz    — Open Quiz Editor + Import-with-AI handoff, OR skip
 *   4. Publish — flip the linked quiz to publicAccess + isPublished,
 *                flip the paper to status='published'.
 *
 * Pattern: a draft `pastPapers/{id}` doc is created on Studio mount
 * (new mode) so uploaded Storage assets have a stable place to land.
 * Assets are uploaded immediately, not held in browser memory — a
 * scanned paper can be 30+ images at 5-10MB each.
 *
 * The Quiz step is OPTIONAL. An admin batch-uploading an archive can skip
 * it and publish; the paper goes live immediately with a "Quiz coming soon"
 * note for learners, shows a "Quiz pending" badge in /admin/papers, and the
 * quiz gets attached later via `/admin/papers/:id/edit?step=quiz` without
 * redoing Upload or Details.
 *
 * Which quiz field the Studio writes matters. The authoring quiz is parked
 * on the paper as `pendingQuizId` and only PROMOTED to `quizId` (together
 * with `quizStatus: 'attached'`, in one write) once it actually has
 * questions. The Studio mints its linked quiz the moment step 3 opens, so
 * writing that id straight to `quizId` would put an empty quiz behind the
 * learner's "Start Quiz" button for as long as the admin took to fill it in.
 *
 * Replaces the older single-page AdminPastPaperEditor.
 */

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import ConfirmDialog from '../ui/ConfirmDialog'
import {
  ALLOWED_PAPER_MIME,
  ASSET_ROLES,
  MAX_PAPER_FILE_BYTES,
  PAPER_GRADES,
  PAPER_STATUSES,
  createPaper,
  deletePaper,
  deletePaperPdf,
  findPaperByKey,
  getAssetRole,
  getPaper,
  resolvePaperUrl,
  splitAssetsByRole,
  updatePaper,
  uploadPaperAsset,
} from '../../utils/pastPapers'
import {
  SOURCE_CONFIDENCE,
  getPaperSource,
  isOfficialSource,
  listPaperNumbers,
  listPaperSources,
  normalizePaperNumberToken,
  paperNumberLabel,
} from '../../config/paperSources'
import { PaperSourceBadge } from '../../features/papers'
import {
  canDerivePaperKey,
  derivedPaperTitle,
  paperKey as buildPaperKey,
} from '../../utils/pastPaperNormalize'
import {
  QUIZ_PENDING_COPY,
  attachQuizFields,
  paperQuizIsAttached,
  pendingQuizFields,
  resolveStudioQuizId,
} from '../../utils/pastPaperQuizStatus'
import { PAPER_SUBJECTS } from '../../config/curriculum'
import { db } from '../../firebase/config'
import { getFunctions, httpsCallable } from 'firebase/functions'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'

// PDF.js viewer is ~400 kB gzipped — only load it once the admin
// actually reaches step 1 with a PDF asset on screen.
const PdfJsViewer = lazy(() => import('../../shared/components/PdfJsViewer'))

const fns = getFunctions(undefined, 'us-central1')
// A long paper runs several vision/extraction calls in sequence (one per page
// batch, plus coverage rounds), so the importer can take a few minutes. Bump
// the SDK timeout to match the function's 540s budget so the call doesn't abort
// mid-import on a 60+ question paper.
const importPastPaperQuestionsCallable = httpsCallable(
  fns,
  'importPastPaperQuestions',
  { timeout: 540_000 },
)
import SeoHelmet from '../seo/SeoHelmet'
import { ImportReportCard } from './pastPaperReport'

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

/**
 * Turn a Storage upload failure into something an admin can act on.
 *
 * `storage/unauthorized` arrives as "User does not have permission to access
 * 'papers/<uid>/<paperId>/assets/0-<filename>'" — a sentence that names the
 * path and nothing that would tell you WHY. It is returned for every arm of
 * the rule alike: the wrong role, an unverified email, a suspended account, a
 * content type outside the allowlist. That opacity is what made the
 * superAdmin-vs-admin gap in storage.rules read as a broken uploader, so the
 * message now says what to check instead of restating the path.
 */
function describeUploadError(err) {
  const code = err?.code || ''
  if (code === 'storage/unauthorized') {
    return 'Storage refused this upload. Your account needs the admin (or teacher) '
      + 'role AND a verified email address, and the file must be a PDF, Word doc, '
      + 'JPG, PNG or WEBP under 50MB. If you are signed in as an admin, sign out '
      + 'and back in once — a recently-changed role only reaches Storage after the '
      + 'sign-in token refreshes.'
  }
  if (code === 'storage/retry-limit-exceeded' || code === 'storage/canceled') {
    return 'The upload timed out before it finished. Check the connection and try '
      + 'again — anything that already uploaded has been kept.'
  }
  if (code === 'storage/quota-exceeded') {
    return 'The storage bucket is out of space. Nothing was uploaded.'
  }
  return err?.message || 'Upload failed.'
}

function formatBytes(n) {
  if (!n) return '0 B'
  const mb = n / (1024 * 1024)
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${(n / 1024).toFixed(0)} KB`
}

const QUIZ_STEP_ID = 3

/**
 * The step rail. A skipped Quiz step is drawn as deliberately-postponed
 * rather than done: dashed amber border, a "later" tag, and no tick. A ✓
 * there would say the quiz was finished, which is the one thing the admin
 * needs to remember it wasn't.
 */
function Stepper({ step, onJump, completed, quizSkipped }) {
  return (
    <ol className="flex flex-wrap gap-2 text-xs font-bold">
      {STEPS.map((s) => {
        const isCurrent = step === s.id
        const isSkipped = s.id === QUIZ_STEP_ID && quizSkipped
        const isDone = completed.has(s.id) && !isSkipped
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onJump(s.id)}
              className={[
                'flex items-center gap-2 px-3 py-2 rounded-full border-2 transition-colors',
                isCurrent
                  ? 'theme-accent-fill theme-on-accent border-transparent'
                  : isSkipped
                    ? 'theme-card theme-text-muted border-dashed border-amber-400'
                    : isDone
                      ? 'theme-card theme-text border-emerald-300'
                      : 'theme-card theme-text-muted theme-border hover:theme-text',
              ].join(' ')}
            >
              <span className="w-5 h-5 rounded-full bg-black/15 flex items-center justify-center text-[10px] font-black">
                {isDone ? '✓' : s.id}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
              {isSkipped && (
                <span className="rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide">
                  later
                </span>
              )}
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

/**
 * `?step=quiz` (or `?step=3`) — the deep link "Add quiz" uses from
 * /admin/papers to land straight on the Quiz step of an already-published
 * paper. Anything else is ignored and the wizard opens at step 1.
 */
function stepFromQuery(value) {
  if (!value) return null
  const raw = String(value).trim().toLowerCase()
  const byLabel = STEPS.find((s) => s.label.toLowerCase() === raw)
  if (byLabel) return byLabel.id
  const n = Number(raw)
  return STEPS.some((s) => s.id === n) ? n : null
}

export default function PastPaperStudio() {
  const { paperId: routePaperId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const isNew = !routePaperId

  const [paperId, setPaperId] = useState(routePaperId || null)
  // Captured once, at mount: the deep link decides where the wizard OPENS,
  // and must not yank the admin back to step 3 later if the query string
  // changes under them. A ref also keeps it out of the bootstrap effect's
  // deps — that effect creates a draft paper in new mode, so re-running it
  // on a query change would litter Firestore with empty papers.
  const deepLinkStep = useRef(stepFromQuery(searchParams.get('step')))
  const [step, setStep] = useState(1)
  const [completed, setCompleted] = useState(() => new Set())
  const [bootstrapping, setBootstrapping] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const [details, setDetails] = useState({
    // No `title` — it is derived from the fields below and regenerated on save.
    // `source` starts EMPTY rather than defaulting to 'ecz': a default is a
    // guess, and the one claim this feature exists to stop being guessed is
    // "this is an official ECZ exam".
    source: '',
    session: '',
    grade: '7',
    subject: PAPER_SUBJECTS[0].id,
    year: CURRENT_YEAR - 1,
    paperNumber: '',
    examBoard: 'ECZ',
    description: '',
    durationMinutes: '',
    totalMarks: '',
  })
  // The paper already occupying this paper's key, if any. Looked up as the
  // identity fields change so the warning is visible while the admin is still
  // in the step, not sprung on them at Publish.
  const [duplicate, setDuplicate] = useState(null)
  const [checkingDuplicate, setCheckingDuplicate] = useState(false)
  const [assets, setAssets] = useState([])
  // In-memory File for each just-uploaded asset, keyed by Storage path.
  // Lets the preview render from local bytes instead of round-tripping
  // through Storage (which can fail on a cross-origin fetch). Empty for
  // assets loaded from an existing draft — those fall back to the URL.
  const [localFiles, setLocalFiles] = useState({})
  // Linked quiz: question authoring happens in the Quiz Editor, not in
  // the Studio. We keep the id + question count here so step 3 can
  // surface "N questions in the quiz" and a one-click handoff.
  const [existingQuizId, setExistingQuizId] = useState(null)
  const [quizCount, setQuizCount] = useState(0)
  // The Quiz step was deliberately postponed — either the admin pressed
  // "Skip for now" in this session, or the paper was loaded already carrying
  // quizStatus 'pending'. Drives the muted step pill and the Publish notice.
  const [quizSkipped, setQuizSkipped] = useState(false)
  // Two statuses, on purpose. `originalStatus` is what the paper was when the
  // Studio loaded it and never changes; `paperStatus` is what it is NOW.
  // Unpublishing moves the second one, and the first is what keeps "Discard
  // draft" (a delete, assets and all) away from a paper that has been live —
  // taking a paper off the shelf to fix a typo must not put a destructive
  // button one confirm away from where it wasn't a moment ago.
  const [originalStatus, setOriginalStatus] = useState(PAPER_STATUSES.DRAFT)
  const [paperStatus, setPaperStatus] = useState(PAPER_STATUSES.DRAFT)
  const [unpublishing, setUnpublishing] = useState(false)
  const [confirmUnpublish, setConfirmUnpublish] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [linkingQuiz, setLinkingQuiz] = useState(false)
  // AI import over a non-empty quiz waits on ConfirmDialog — { quizId }.
  const [pendingImport, setPendingImport] = useState(null)
  // Structured report from the last AI import (pages, counts, confidence,
  // issues) — surfaced under the Quiz step so the admin can spot a paper that
  // imported short or with un-keyed answers.
  const [importReport, setImportReport] = useState(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [discarding, setDiscarding] = useState(false)

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
              subject: PAPER_SUBJECTS[0].id,
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
            source: row.source || '',
            session: row.session || '',
            grade: row.grade || '7',
            subject: row.subject || PAPER_SUBJECTS[0].id,
            year: row.year || CURRENT_YEAR - 1,
            // `paperNumber` can be a number (1, 2) or a word ('special',
            // 'mock'), so it is carried as a string and re-tokenised on save.
            paperNumber: row.paperNumber == null ? '' : String(row.paperNumber),
            examBoard: row.examBoard || 'ECZ',
            description: row.description || '',
            durationMinutes: row.durationMinutes ? String(row.durationMinutes) : '',
            totalMarks: row.totalMarks ? String(row.totalMarks) : '',
          })
          setAssets(Array.isArray(row.assets) ? row.assets : [])
          setOriginalStatus(row.status || PAPER_STATUSES.DRAFT)
          setPaperStatus(row.status || PAPER_STATUSES.DRAFT)
          // A paper published with the Quiz step skipped reopens in the
          // skipped state, so the step rail and the Publish notice tell the
          // admin what they left rather than pretending it was never chosen.
          if (!cancelled) setQuizSkipped(!paperQuizIsAttached(row))
          // Upload + Details are already filled in on a saved paper, so mark
          // them done — otherwise the "Add quiz" deep link lands on step 3
          // with a rail that refuses to jump back to what it just skipped.
          if (!cancelled) {
            setCompleted(new Set(paperQuizIsAttached(row) ? [1, 2, 3] : [1, 2]))
            if (deepLinkStep.current) setStep(deepLinkStep.current)
          }
          // The authoring quiz is whichever the paper points at: the attached
          // one, or the draft parked in pendingQuizId by an earlier skip.
          const studioQuizId = resolveStudioQuizId(row)
          if (studioQuizId) {
            // Verify the linked quiz still exists. If an admin deleted
            // it from /admin/content, the paper still carries the dead
            // id and step 3 would mislead with "0 questions in the quiz"
            // → "Open Quiz Editor" → "Quiz not found". Treat a missing
            // quiz as unlinked so ensureLinkedQuiz() creates a fresh one.
            try {
              const quizSnap = await getDoc(doc(db, 'quizzes', studioQuizId))
              if (quizSnap.exists()) {
                if (!cancelled) setExistingQuizId(studioQuizId)
                const qs = await getDocs(query(collection(db, 'quizzes', studioQuizId, 'questions')))
                if (!cancelled) setQuizCount(qs.size)
              } else if (!cancelled) {
                setExistingQuizId(null)
              }
            } catch (err) {
              console.warn('[PastPaperStudio] loading existing quiz failed', err)
              if (!cancelled) setExistingQuizId(null)
            }
          } else {
            setExistingQuizId(null)
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
    const nextFiles = { ...localFiles }
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
        // Keep the local File so the preview renders instantly from
        // memory rather than re-downloading what we just uploaded.
        nextFiles[result.path] = file
      }
      setAssets(next)
      setLocalFiles(nextFiles)
      const assetType = inferAssetType(next)
      await updatePaper(paperId, { assets: next, assetType })
    } catch (err) {
      console.error('[PastPaperStudio] upload failed', err)
      setError(describeUploadError(err))
      // Keep whatever DID upload before the failure — on a 30-image scanned
      // paper, losing nine successful uploads because the tenth was refused
      // means starting the whole thing again.
      if (next.length > assets.length) {
        setAssets(next)
        setLocalFiles(nextFiles)
        updatePaper(paperId, { assets: next, assetType: inferAssetType(next) })
          .catch((e) => console.warn('[PastPaperStudio] partial-upload save failed', e))
      }
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
      setLocalFiles((prev) => {
        if (!(removed.path in prev)) return prev
        const copy = { ...prev }
        delete copy[removed.path]
        return copy
      })
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

  /**
   * The identity fields, normalised into the shape `updatePaper` expects.
   * One builder so the duplicate probe and the save agree on what the paper
   * IS — a probe that keys on a different object from the one written is a
   * duplicate check that can pass and then write a duplicate.
   */
  const identityFields = useMemo(() => ({
    grade: details.grade,
    subject: details.subject,
    year: Number(details.year),
    source: details.source || null,
    paperNumber: normalizePaperNumberToken(details.paperNumber),
  }), [details.grade, details.subject, details.year, details.source, details.paperNumber])

  // Probe for an existing paper with the same key while the admin is still in
  // the step. Debounced only by React's own batching — this is one indexed
  // equality read on a field change, not a keystroke handler.
  useEffect(() => {
    let cancelled = false
    if (!identityFields.source || !canDerivePaperKey(identityFields)) {
      setDuplicate(null)
      return () => { cancelled = true }
    }
    setCheckingDuplicate(true)
    findPaperByKey(buildPaperKey(identityFields), { excludeId: paperId })
      .then((hit) => { if (!cancelled) setDuplicate(hit) })
      .catch((err) => {
        console.warn('[PastPaperStudio] duplicate probe failed', err)
        // A failed probe is not a clean bill of health, but it is also not a
        // reason to block an admin. The warning simply doesn't appear; the
        // key is still written and the migration's collision report catches
        // anything that slips through.
        if (!cancelled) setDuplicate(null)
      })
      .finally(() => { if (!cancelled) setCheckingDuplicate(false) })
    return () => { cancelled = true }
  }, [identityFields, paperId])

  async function saveDetails() {
    if (!paperId) return
    if (!details.source) { setError('Source is required — choose where this paper came from.'); return false }
    if (!details.year) { setError('Year is required.'); return false }
    setError('')
    setSaving(true)
    try {
      await updatePaper(paperId, {
        ...identityFields,
        // A human chose this source in this wizard. Nothing else in the app
        // may write 'explicit' — the migration writes 'inferred' at best.
        sourceConfidence: SOURCE_CONFIDENCE.EXPLICIT,
        session: details.session.trim().toLowerCase() || null,
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
    // The paper may carry a stale `quizId` pointing at a quiz that an
    // admin has since deleted from /admin/content. Verify the doc still
    // exists before handing it back — otherwise the editor opens on a
    // dead id and shows "Quiz not found". If it's gone, fall through
    // to create a fresh one (and overwrite the dead pointer below).
    if (existingQuizId) {
      try {
        const snap = await getDoc(doc(db, 'quizzes', existingQuizId))
        if (snap.exists()) return existingQuizId
      } catch (err) {
        console.warn('[PastPaperStudio] linked-quiz existence check failed', err)
      }
      setExistingQuizId(null)
      setQuizCount(0)
    }
    setLinkingQuiz(true)
    try {
      const quizId = doc(collection(db, 'quizzes')).id
      // Source-paper reference fields: what PastPaperReferenceBanner and the
      // Quiz Editor's "Crop from page" use to reach the uploaded paper from
      // inside the editor. The legacy converter (paperToQuizConverter) always
      // set these; Studio-created quizzes were missing them, which is why the
      // banner never rendered for them.
      const paperPdfAsset = assets.find(
        a => a.role !== ASSET_ROLES.MARK_SCHEME && String(a.contentType || '').toLowerCase() === 'application/pdf',
      ) || null
      const markSchemeAsset = assets.find(a => a.role === ASSET_ROLES.MARK_SCHEME) || null
      const fields = {
        title: `${derivedPaperTitle(identityFields)} — Quiz`,
        subject: details.subject,
        topic: 'past-paper',
        isPublished: false,
        publicAccess: false,
        quizType: 'past_paper',
        linkedPaperId: paperId,
        // Provenance travels with the quiz so a learner's answers on a mock
        // paper's quiz are never pooled with their answers on the real exam
        // when weak topics are computed.
        paperSource: details.source || null,
        paperIsOfficial: isOfficialSource(details.source),
        sourcePastPaperId: paperId,
        sourcePastPaperPdfPath: paperPdfAsset?.path || null,
        sourceMarkSchemePath: markSchemeAsset?.path || null,
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
      // Park the id, don't attach it. This quiz has zero questions right now;
      // `quizId` is what every learner surface routes on, so it is only
      // written at publish time, once there is something behind it.
      await updatePaper(paperId, { pendingQuizId: quizId })
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
    if (quizCount > 0) {
      setPendingImport({ quizId })
      return
    }
    runImport(quizId)
  }

  async function runImport(quizId) {
    setError('')
    setInfo('')
    setImportReport(null)
    setImporting(true)
    try {
      const res = await importPastPaperQuestionsCallable({ paperId, quizId })
      const written = Number(res?.data?.questionsWritten || 0)
      setImportReport(res?.data?.report || null)
      // The engine gate blocked the write (missing questions / answer key / no
      // questions). Nothing was saved and the existing quiz is untouched — do
      // NOT advance as if the import succeeded; surface the blockers instead.
      if (res?.data?.gated) {
        setError(res?.data?.warning || 'Import paused — fix the problems in the report and re-run.')
        return
      }
      if (!written) {
        setError(res?.data?.warning || 'The AI could not extract any questions from this paper.')
        return
      }
      setQuizCount(written)
      const parts = [`Imported ${written} question${written === 1 ? '' : 's'} into the quiz.`]
      if (res?.data?.warning) parts.push(res.data.warning)

      // Figure-attach pass: the importer LOCATES printed maps/figures
      // ({passageId, sourcePage, box}); the browser crops each one out of the
      // uploaded paper and writes it onto its passage so the map is actually
      // visible — the old flow dropped figures entirely ("I can't see the
      // map"). Best-effort: a failed crop is reported, never fatal, and the
      // figureMeta persisted on the passage lets a re-run try again.
      const figures = Array.isArray(res?.data?.report?.figures) ? res.data.report.figures : []
      if (figures.length) {
        try {
          const { attachPaperFigures } = await import('../../utils/paperFigureAttach.js')
          const fig = await attachPaperFigures({
            uid: currentUser.uid, paperId, quizId, figures, assets, localFiles,
          })
          if (fig.attached) parts.push(`Attached ${fig.attached} figure/map image${fig.attached === 1 ? '' : 's'} under the right questions.`)
          if (fig.failed || fig.skipped) {
            parts.push(`${fig.failed + fig.skipped} figure${fig.failed + fig.skipped === 1 ? '' : 's'} could not be attached automatically — add them in the Quiz Editor.`)
          }
          // The server only LOCATES figures (no rasteriser); fold the real
          // attach outcome into the displayed verification report so
          // "diagrams attached / needing review" reflects what actually
          // happened, not the server's placeholder (0 attached / all pending).
          setImportReport((prev) => (prev ? {
            ...prev,
            diagramsAttached: fig.attached,
            diagramsNeedingReview: fig.failed + fig.skipped,
          } : prev))
        } catch (err) {
          console.warn('[PastPaperStudio] figure attach failed', err)
          parts.push('The paper\'s figures could not be attached automatically — add them in the Quiz Editor.')
        }
      }

      parts.push('Open the Quiz Editor to review answers and add images before publishing.')
      setInfo(parts.join(' '))
    } catch (err) {
      console.error('[PastPaperStudio] import failed', err)
      setError(err?.message || 'AI import failed.')
    } finally {
      setImporting(false)
      setPendingImport(null)
    }
  }

  // ── Step 3: skip ──────────────────────────────────────────────────
  // "Skip for now" postpones the quiz; it does NOT discard it. Anything
  // already imported or typed stays on the linked quiz doc (which is why the
  // draft id is parked rather than dropped), so coming back finds the work.
  function skipQuizStep() {
    setError('')
    setQuizSkipped(true)
    markCompleted(3)
    setStep(4)
  }

  // ── Step 4: publish ───────────────────────────────────────────────
  // A quiz is attached only when it actually has questions. Everything else
  // publishes as `pending`: live to learners now, with a "Quiz coming soon"
  // note where the quiz launcher sits.
  async function publish() {
    if (!paperId || !currentUser?.uid) return
    setError('')
    if (!assets.length) { setError('Upload at least one asset before publishing.'); return }
    // A source is what makes a published paper readable at all: the Firestore
    // rules refuse a learner read of a paper that does not state one, so
    // publishing without it would produce a "live" paper nobody can open.
    if (!details.source) { setError('Choose a source in step 2 before publishing.'); return }
    // The duplicate warning is advisory in the Details step and BLOCKING here.
    // Publishing is the moment a second copy of a paper becomes a second row
    // in a learner's subject card.
    if (duplicate) {
      setError('A paper with these details already exists. Change the source, paper number or year, or edit the existing paper.')
      return
    }

    const attachingQuiz = Boolean(existingQuizId) && quizCount > 0
    const paperTitle = derivedPaperTitle(identityFields)

    setPublishing(true)
    try {
      const detailsOk = await saveDetails()
      if (!detailsOk) return

      if (attachingQuiz) {
        // Flip the linked quiz from authoring mode to public.
        await setDoc(doc(db, 'quizzes', existingQuizId), {
          isPublished: true,
          publicAccess: true,
          title: `${paperTitle} — Quiz`,
          subject: details.subject,
          linkedPaperId: paperId,
          quizType: 'past_paper',
          paperSource: details.source || null,
          paperIsOfficial: isOfficialSource(details.source),
          updatedAt: serverTimestamp(),
        }, { merge: true })
      }

      // Paper goes public. quizId + quizStatus travel together in this ONE
      // update — a two-step write would leave the paper readable as attached
      // with no id behind it (or the reverse), and a stale second tab
      // re-writing the pair is exactly the race this platform has shipped
      // before. `existingQuizId` is parked in `pendingQuizId` on the pending
      // path so re-entering the wizard resumes that quiz instead of minting
      // a second one and orphaning the first.
      await updatePaper(paperId, {
        ...(attachingQuiz
          ? attachQuizFields(existingQuizId)
          : pendingQuizFields(existingQuizId)),
        status: PAPER_STATUSES.PUBLISHED,
      })
      setInfo(attachingQuiz
        ? 'Published.'
        : 'Published. Learners see the paper now — add the quiz any time from All papers.')
      navigate('/admin/papers')
    } catch (err) {
      console.error('[PastPaperStudio] publish failed', err)
      setError(err?.message || 'Could not publish.')
    } finally {
      setPublishing(false)
    }
  }

  // ── Unpublish ─────────────────────────────────────────────────────
  // Takes a live paper off the shelf so an error can be fixed without the
  // archive showing the broken version in the meantime. It is the exact
  // inverse of publish() and nothing else: the paper goes back to `draft`
  // (admin-only per the Firestore read rule) and its quiz stops being public.
  // The quiz LINK is deliberately left alone — quizId and quizStatus stay put,
  // so re-publishing restores the paper as it was rather than dropping the
  // admin back into the Quiz step. Un-attaching is a separate decision.
  //
  // The paper's files, questions, views and downloads are all untouched. That
  // is the difference between this and "Discard draft", which deletes.
  async function unpublish() {
    if (!paperId) return
    setError('')
    setInfo('')
    setUnpublishing(true)
    try {
      // Hide the linked quiz too. Without this the paper vanishes from the
      // archive while `/papers/:id/quiz` keeps serving the questions to
      // anyone holding the link — "unpublished" that only half applies is
      // worse than not offering the button, because it reads as done.
      const liveQuizId = existingQuizId && quizCount > 0 ? existingQuizId : null
      if (liveQuizId) {
        await setDoc(doc(db, 'quizzes', liveQuizId), {
          isPublished: false,
          publicAccess: false,
          updatedAt: serverTimestamp(),
        }, { merge: true })
      }
      await updatePaper(paperId, { status: PAPER_STATUSES.DRAFT })
      setPaperStatus(PAPER_STATUSES.DRAFT)
      setConfirmUnpublish(false)
      // Stay in the Studio — fixing the thing that prompted this is the
      // entire reason the button exists.
      setInfo(liveQuizId
        ? 'Unpublished. Learners can no longer see this paper or take its quiz. Make your changes, then publish again.'
        : 'Unpublished. Learners can no longer see this paper. Make your changes, then publish again.')
    } catch (err) {
      console.error('[PastPaperStudio] unpublish failed', err)
      setError(err?.message || 'Could not unpublish this paper.')
    } finally {
      setUnpublishing(false)
    }
  }

  function discardDraft() {
    // Never offered on a paper that was live when the Studio opened — see the
    // note on `originalStatus`.
    if (!paperId || originalStatus === PAPER_STATUSES.PUBLISHED) return
    setConfirmDiscard(true)
  }

  async function performDiscard() {
    setDiscarding(true)
    try {
      await deletePaper(paperId, assets.map((a) => a.path))
      navigate('/admin/papers')
    } catch (err) {
      console.error('[PastPaperStudio] discard failed', err)
      setError('Could not discard. Try again.')
    } finally {
      setDiscarding(false)
      setConfirmDiscard(false)
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
      // Continuing WITH a quiz still requires a real one — a paper is either
      // published with a finished quiz or published with none. What it must
      // never do is carry a quiz with nothing in it, which is what half-
      // finished authoring would produce.
      if (quizCount === 0) {
        setError(`Add at least one question to the linked quiz, or choose "${QUIZ_PENDING_COPY.skipAction}".`)
        return
      }
      setQuizSkipped(false)
      markCompleted(3)
      setStep(4)
    }
  }

  if (bootstrapping) return <p className="theme-text-muted text-sm">Starting studio…</p>
  if (!paperId) return <p className="theme-text-muted text-sm">{error || 'Loading…'}</p>

  // Live NOW, not "was live when this page loaded" — the Unpublish button and
  // the primary button's label both have to follow an unpublish that just
  // happened, without a reload.
  const isLive = paperStatus === PAPER_STATUSES.PUBLISHED

  return (
    <div className="space-y-5 w-full">
      <SeoHelmet title={isNew ? 'New past paper' : 'Edit past paper'} path="/admin/papers" noIndex />

      <div>
        <Link to="/admin/papers" className="text-xs font-bold theme-text-muted hover:theme-text">
          ← All papers
        </Link>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <h1 className="theme-text font-display font-black text-2xl sm:text-3xl">
            {isNew ? 'New past paper' : 'Edit past paper'}
          </h1>
          {/* Whether learners can see this paper RIGHT NOW. An admin who came
              here to fix an error needs that answered before they read
              anything else on the page. */}
          {!isNew && (
            <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
              isLive ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
            }`}>
              {isLive ? 'Live to learners' : 'Not published'}
            </span>
          )}
        </div>
        <p className="theme-text-muted text-sm mt-1">
          A draft is saved automatically so you can leave and come back. Publish makes the paper
          available to learners; if a quiz is attached, they can take it inline.
        </p>
      </div>

      <div className="theme-card border theme-border rounded-radius-md p-4">
        <Stepper step={step} onJump={jump} completed={completed} quizSkipped={quizSkipped} />
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
          localFiles={localFiles}
          uploading={uploading}
          onAddFiles={handleAddFiles}
          onRemove={handleRemoveAsset}
          onMove={moveAsset}
          onSetRole={setAssetRole}
        />
      )}
      {step === 2 && (
        <DetailsStep
          details={details}
          setDetail={setDetail}
          duplicate={duplicate}
          checkingDuplicate={checkingDuplicate}
        />
      )}
      {step === 3 && (
        <>
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
            onSkip={skipQuizStep}
          />
          {importReport && <ImportReportCard report={importReport} />}
        </>
      )}
      {step === 4 && (
        <PublishStep
          paperId={paperId}
          details={details}
          assets={assets}
          quizId={existingQuizId}
          quizCount={quizCount}
          onGoToQuizStep={() => setStep(3)}
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
            disabled={publishing || unpublishing}
            className="rounded-full px-5 py-2 text-sm font-black bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {publishing ? 'Publishing…' : (isLive ? 'Save changes' : 'Publish paper')}
          </button>
        )}
        {/* Offered on every step, not just Publish: an admin who spots the
            error while re-reading the upload or the quiz shouldn't have to
            walk to step 4 to take the paper down. Not styled as a destructive
            action — it hides, it never deletes, and pressing Publish undoes
            it. */}
        {isLive && (
          <button
            type="button"
            onClick={() => setConfirmUnpublish(true)}
            disabled={publishing || unpublishing}
            className="rounded-full border-2 border-amber-400 px-4 py-2 text-sm font-black text-amber-800 hover:bg-amber-50 disabled:opacity-50"
            title="Hide this paper from learners so you can fix something, then publish it again"
          >
            {unpublishing ? 'Unpublishing…' : 'Unpublish'}
          </button>
        )}
        <Link to="/admin/papers" className="text-sm font-bold theme-text-muted hover:theme-text">
          Cancel
        </Link>
        {originalStatus !== PAPER_STATUSES.PUBLISHED && !isLive && (
          <button
            type="button"
            onClick={discardDraft}
            className="ml-auto text-xs font-bold text-rose-700 hover:underline"
          >
            Discard draft
          </button>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingImport)}
        title="Replace existing questions?"
        message={`This will replace all ${quizCount} existing question${quizCount === 1 ? '' : 's'} with the AI-extracted ones.`}
        confirmLabel="Replace questions"
        variant="danger"
        loading={importing}
        onConfirm={() => pendingImport && runImport(pendingImport.quizId)}
        onCancel={() => setPendingImport(null)}
      />

      <ConfirmDialog
        open={confirmUnpublish}
        title="Unpublish this paper?"
        message={
          (existingQuizId && quizCount > 0
            ? 'Learners will stop seeing this paper in the archive, and its quiz will stop being available. '
            : 'Learners will stop seeing this paper in the archive. ')
          + 'Nothing is deleted — your files, questions and details stay exactly as they are, '
          + 'and you can publish it again once you have made your changes.'
        }
        confirmLabel="Unpublish"
        // Not `danger` — the dialog's red treatment is for writes that lose
        // something. This one hides a paper and is undone by publishing again.
        variant="primary"
        loading={unpublishing}
        onConfirm={unpublish}
        onCancel={() => setConfirmUnpublish(false)}
      />

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard this draft?"
        message="Uploaded files will be deleted."
        confirmLabel="Discard draft"
        variant="danger"
        loading={discarding}
        onConfirm={performDiscard}
        onCancel={() => setConfirmDiscard(false)}
      />
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

function UploadStep({ assets, localFiles, uploading, onAddFiles, onRemove, onMove, onSetRole }) {
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
      {assets.length > 0 && <AssetPreviews assets={assets} localFiles={localFiles} />}
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
function AssetPreviews({ assets, localFiles = {} }) {
  const [urls, setUrls] = useState({})
  useEffect(() => {
    let cancelled = false
    const next = {}
    const objectUrls = []
    // Resolve a preview source for every asset in parallel. Prefer the
    // in-memory File we just uploaded — PDFs render from it via the
    // viewer's `blob` prop (no Storage fetch), and images get a local
    // object URL. Only assets without a local File hit Storage; failures
    // fall back to null so the preview shows an "unavailable" placeholder
    // instead of crashing.
    Promise.all(assets.map(async (a) => {
      const local = localFiles[a.path]
      if (local && a.contentType === 'application/pdf') {
        return // rendered straight from the blob; no URL needed
      }
      if (local && a.contentType?.startsWith('image/')) {
        const objUrl = URL.createObjectURL(local)
        objectUrls.push(objUrl)
        next[a.path] = objUrl
        return
      }
      try {
        next[a.path] = await resolvePaperUrl(a.path)
      } catch (err) {
        console.warn('[PastPaperStudio] preview URL failed', a.path, err)
        next[a.path] = null
      }
    }))
      .then(() => { if (!cancelled) setUrls(next) })
      .catch(() => { /* per-asset errors already swallowed above */ })
    return () => {
      cancelled = true
      objectUrls.forEach((u) => { try { URL.revokeObjectURL(u) } catch { /* ignore */ } })
    }
  }, [assets, localFiles])

  const { paper: paperAssets, markScheme: msAssets } = splitAssetsByRole(assets)

  function renderAsset(a, idx) {
    const url = urls[a.path]
    const localFile = localFiles[a.path]
    const isPdf = a.contentType === 'application/pdf'
    const isImg = a.contentType?.startsWith('image/')
    const hasLocalPdf = isPdf && Boolean(localFile)
    return (
      <figure
        key={a.path}
        className="theme-card border theme-border rounded-radius-md overflow-hidden"
      >
        <figcaption className="theme-bg-subtle text-xs font-black theme-text-muted uppercase tracking-widest px-3 py-2 border-b theme-border">
          {idx + 1}. {a.filename}
        </figcaption>
        {hasLocalPdf ? (
          <Suspense fallback={
            <div className="h-[60vh] flex items-center justify-center theme-text-muted text-sm">
              Loading PDF viewer…
            </div>
          }>
            <PdfJsViewer blob={localFile} title={a.filename} />
          </Suspense>
        ) : url === undefined ? (
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

/**
 * Step 2 — the paper's IDENTITY, as structured fields.
 *
 * The free-text title input is gone. A hand-typed name was the only thing
 * distinguishing an ECZ paper from a PRISCA mock of the same grade, year and
 * subject: inconsistent (one live title begins with the word "In"), unsortable,
 * unfilterable, and no barrier at all to uploading the same paper twice. What
 * replaces it is a required `source`, an optional `paperNumber` and `session`,
 * and a READ-ONLY preview of the title those fields compose — so an admin can
 * still see the name they are creating, without being able to author a name
 * that disagrees with the fields under it.
 */
function DetailsStep({ details, setDetail, duplicate, checkingDuplicate }) {
  const previewTitle = derivedPaperTitle({
    grade: details.grade,
    subject: details.subject,
    year: details.year,
    source: details.source,
    paperNumber: details.paperNumber,
  })
  const sourceRecord = getPaperSource(details.source)

  return (
    <section className="space-y-4">
      {/* The derived title, shown rather than typed. */}
      <div className="theme-card border theme-border rounded-radius-md p-4">
        <p className="text-[11px] font-black theme-text-muted uppercase tracking-widest">
          Title (derived)
        </p>
        <p className="theme-text font-black text-base mt-1.5 break-words">{previewTitle}</p>
        <p className="theme-text-muted text-xs mt-1.5">
          Composed from the fields below and regenerated on every save. Learners
          see the source badge and the paper number, not this string.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <FieldRow label="Grade">
          <select value={details.grade} onChange={(e) => setDetail('grade', e.target.value)} className={inputCls()}>
            {PAPER_GRADES.map((g) => <option key={g} value={g}>Grade {g}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Subject">
          <select value={details.subject} onChange={(e) => setDetail('subject', e.target.value)} className={inputCls()}>
            {PAPER_SUBJECTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Year">
          <select value={details.year} onChange={(e) => setDetail('year', Number(e.target.value))} className={inputCls()}>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </FieldRow>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <FieldRow label="Source" hint="required">
          <select
            value={details.source}
            onChange={(e) => setDetail('source', e.target.value)}
            className={inputCls()}
            required
          >
            {/* No blank option once a source is set, but a new paper starts
                without one so the admin has to CHOOSE rather than accept
                whichever entry happened to be first in the registry. */}
            {!details.source && <option value="">Choose a source…</option>}
            {listPaperSources().map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="Paper number" hint="not applicable is fine">
          <select
            value={details.paperNumber === null || details.paperNumber === undefined ? '' : String(details.paperNumber)}
            onChange={(e) => setDetail('paperNumber', e.target.value)}
            className={inputCls()}
          >
            <option value="">Not applicable</option>
            {listPaperNumbers().map((n) => (
              <option key={n.value} value={String(n.value)}>{n.label}</option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="Session" hint="optional — e.g. October, trial">
          <input
            type="text"
            value={details.session}
            onChange={(e) => setDetail('session', e.target.value)}
            className={inputCls()}
            placeholder="October"
          />
        </FieldRow>
      </div>

      {sourceRecord && (
        <p className="theme-text-muted text-xs">
          <span className="font-black theme-text">{sourceRecord.fullName}</span>
          {' — '}
          {sourceRecord.descriptor}
        </p>
      )}

      {/* Duplicate detection, inline: the same grade + year + subject + source
          + paper number IS the same paper, and re-uploading it is the failure
          the free-text title could never catch. */}
      {checkingDuplicate && (
        <p className="theme-text-muted text-xs font-bold">Checking for an existing paper…</p>
      )}
      {duplicate && (
        <div className="rounded-radius-md border-2 border-amber-400 bg-amber-50 p-4">
          <p className="font-black text-amber-900 text-sm">
            A paper with these details already exists
          </p>
          <p className="text-amber-900 text-xs mt-1">
            {duplicate.title || 'Untitled past paper'} — publishing this one would
            put two copies of the same paper in the archive.
          </p>
          <a
            href={`/admin/papers/${duplicate.id}/edit`}
            className="inline-block mt-2 text-xs font-black text-amber-900 underline"
          >
            Open the existing paper →
          </a>
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        <FieldRow label="Duration (min)" hint="optional">
          <input type="number" min="5" max="480" value={details.durationMinutes} onChange={(e) => setDetail('durationMinutes', e.target.value)} className={inputCls()} placeholder="120" />
        </FieldRow>
        <FieldRow label="Total marks" hint="optional">
          <input type="number" min="0" max="1000" value={details.totalMarks} onChange={(e) => setDetail('totalMarks', e.target.value)} className={inputCls()} placeholder="100" />
        </FieldRow>
        <FieldRow label="Exam board" hint="default ECZ">
          <input type="text" value={details.examBoard} onChange={(e) => setDetail('examBoard', e.target.value)} className={inputCls()} placeholder="ECZ" />
        </FieldRow>
      </div>
      <FieldRow label="Description" hint="shown to learners on the paper page">
        <textarea rows={3} value={details.description} onChange={(e) => setDetail('description', e.target.value)} className={inputCls()} placeholder="Algebra, geometry, and statistics. Closed-book. Calculator allowed." />
      </FieldRow>
    </section>
  )
}

function QuizStep({
  paperId, quizId, quizCount, hasAssets, linkingQuiz, importing,
  onOpenEditor, onImportWithAi, onRefreshCount, onSkip,
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
          read every question from the uploaded paper (any length, all question
          types), then open the editor to attach pictures and review answers.
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
            {importing ? 'Importing… reading every page' : '✨ Import with AI'}
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

      {/* The quiz is optional — batch-uploading an archive shouldn't stall on
          authoring questions for every paper. Skipping keeps whatever is
          already on the linked quiz; it only postpones attaching it.
          Offered only while the quiz is empty: once it has questions there is
          nothing to postpone, and un-attaching a working quiz is deliberately
          not part of this flow (it would regress the learner's view). */}
      {quizCount === 0 && (
      <div className="theme-card border theme-border border-dashed rounded-radius-md p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <p className="theme-text font-black text-sm">Not ready to build the quiz?</p>
          <p className="theme-text-muted text-xs mt-0.5">
            Publish the paper now and attach the quiz later — learners get the paper
            immediately with a &ldquo;Quiz coming soon&rdquo; note. Anything you have
            already added here is kept.
          </p>
        </div>
        <button
          type="button"
          onClick={onSkip}
          className="theme-card border-2 border-amber-400 rounded-full px-4 py-2 text-sm font-black text-amber-800 hover:bg-amber-50"
        >
          {QUIZ_PENDING_COPY.skipAction}
        </button>
      </div>
      )}

      <div className="theme-card border theme-border rounded-radius-md p-4 text-sm theme-text-muted">
        <p className="font-black theme-text mb-1">Tip</p>
        Open the Quiz Editor in a new browser tab if you want to keep the Studio
        open at the same time. When you come back, click <em>Refresh count</em>
        to see how many questions the editor now holds.
      </div>
    </section>
  )
}

function PublishStep({ paperId, details, assets, quizId, quizCount, onGoToQuizStep }) {
  const subjectMeta = useMemo(() => PAPER_SUBJECTS.find((s) => s.id === details.subject), [details.subject])
  // A quiz with no questions is not a quiz — the paper publishes as pending
  // either way, so the summary says so rather than reporting an id.
  const quizAttaching = Boolean(quizId) && quizCount > 0
  return (
    <section className="space-y-4">
      <div className="theme-card border theme-border rounded-radius-md p-5">
        <p className="theme-accent-text font-black text-xs uppercase tracking-widest mb-2">Paper</p>
        <h3 className="font-display font-black text-2xl theme-text">
          {derivedPaperTitle(details)}
        </h3>
        <p className="theme-text-muted text-sm mt-1">
          {subjectMeta?.label || details.subject} · Grade {details.grade} · {details.year}
          {paperNumberLabel(details.paperNumber) ? ` · ${paperNumberLabel(details.paperNumber)}` : ''}
        </p>
        <div className="mt-3">
          {/* The source is reviewed as the learner will SEE it — a badge, not
              a row in a table — because "did I mark this as an ECZ paper?" is
              the one question this step exists to answer. */}
          {details.source
            ? (
              <PaperSourceBadge
                label={getPaperSource(details.source)?.label || details.source}
                isOfficial={isOfficialSource(details.source)}
              />
            )
            : <span className="text-xs font-black text-amber-700">No source chosen — go back to Details</span>}
        </div>
        <div className="mt-4 grid sm:grid-cols-3 gap-3 text-xs theme-text-muted">
          <div><span className="font-black theme-text">Exam board:</span> {details.examBoard || 'ECZ'}</div>
          {details.session && <div><span className="font-black theme-text">Session:</span> {details.session}</div>}
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
        {quizAttaching ? (
          <>
            <p className="theme-text font-black text-sm">
              {quizCount} question{quizCount === 1 ? '' : 's'} ready
            </p>
            <p className="theme-text-muted text-xs mt-1 font-mono break-all">
              quiz id: {quizId}
            </p>
          </>
        ) : (
          <p className="theme-text font-black text-sm">
            No quiz attached — publishing as <span className="text-amber-700">Quiz pending</span>.
          </p>
        )}
      </div>

      {/* Informational, NOT an error: publishing without a quiz is a supported
          outcome, and the publish button stays enabled. */}
      {!quizAttaching && (
        <div className="border-l-4 border-amber-500 bg-amber-50 text-amber-900 text-sm rounded-r-lg p-3">
          <p className="font-black">No quiz attached yet.</p>
          <p className="mt-1">
            This paper will be published and visible to learners now, with a
            &ldquo;Quiz coming soon&rdquo; note. You can add the quiz any time from All papers.
          </p>
          <button
            type="button"
            onClick={onGoToQuizStep}
            className="mt-2 text-xs font-black underline hover:no-underline"
          >
            ← Back to the Quiz step
          </button>
        </div>
      )}

      {quizAttaching && (
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
        {quizAttaching ? (
          <>
            Publishing flips the paper to <strong>Published</strong> and turns on
            <strong> publicAccess</strong> on the linked quiz, so anonymous marketing
            visitors can preview up to 30 questions before the paywall.
          </>
        ) : (
          <>
            Publishing flips the paper to <strong>Published</strong>. It shows up in
            the archive with a <strong>Quiz pending</strong> badge until a quiz is
            attached.
          </>
        )}
      </p>
    </section>
  )
}
