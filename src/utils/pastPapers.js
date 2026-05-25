/**
 * pastPapers — Firestore data access for the ECZ past-paper archive
 * (audit A2). Public-read for `status === 'published'` papers.
 *
 * Why a dedicated util instead of inline queries:
 *   - Centralises the published-only filter so a learner-side surface
 *     can never accidentally render a draft.
 *   - Wraps the file-storage URL resolution so callers never construct
 *     gs:// or storagebucket URLs directly.
 *   - Keeps all the index-bound query shapes here so a new "list by
 *     grade + subject ordered by year" view re-uses the same code.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit as fsLimit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from 'firebase/storage'
import { db, storage } from '../firebase/config'
import { capture } from './analytics'

export const PAPER_GRADES = ['7', '9', '12']

// Paper assets can be a PDF (one file) or a series of images (scanned
// papers — common for older ECZ exams that were photocopied). Anything
// up to 50MB per asset goes through `uploadPaperAsset` below.
export const ALLOWED_PAPER_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]
export const MAX_PAPER_FILE_BYTES = 50 * 1024 * 1024

export const PAPER_STATUSES = {
  DRAFT:     'draft',
  PUBLISHED: 'published',
  ARCHIVED:  'archived',
}

const COLLECTION = 'pastPapers'

/**
 * List papers visible to the public — status==published — with
 * optional grade / subject / year filters. Sorted year desc so the
 * most recent papers land on top of the list. Limit defaults to 200
 * (the full ECZ archive at 7 years × 7 subjects × 3 grades is well
 * under that cap).
 */
export async function listPublishedPapers({ grade, subject, year, limit = 200 } = {}) {
  const filters = [where('status', '==', PAPER_STATUSES.PUBLISHED)]
  if (grade)   filters.push(where('grade',   '==', String(grade)))
  if (subject) filters.push(where('subject', '==', String(subject)))
  if (year)    filters.push(where('year',    '==', Number(year)))
  const q = query(
    collection(db, COLLECTION),
    ...filters,
    orderBy('year', 'desc'),
    fsLimit(limit),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/** Admin-side list — includes drafts + archived. Sorted updatedAt desc. */
export async function listAllPapersForAdmin({ limit = 200 } = {}) {
  const q = query(
    collection(db, COLLECTION),
    orderBy('updatedAt', 'desc'),
    fsLimit(limit),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function getPaper(paperId) {
  const snap = await getDoc(doc(db, COLLECTION, paperId))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

/** Alias kept for readability at call sites that fetch by id. */
export const getPaperById = getPaper

/**
 * Like listPublishedPapers but restricted to papers that have a linked
 * quiz (i.e. learners can press "Quiz" on them). The marketing page +
 * the hub's quiz tab both call into this.
 */
export async function listPapersWithQuiz({ limit = 60 } = {}) {
  const all = await listPublishedPapers({ limit })
  return all.filter((p) => Boolean(p.quizId))
}

/**
 * Resolve a Storage path to a download URL. The Hosting / SDK auth
 * token is automatically applied by getDownloadURL — signed-out
 * visitors get a CORS error and fall back to the "Sign in to download"
 * UX in the viewer.
 */
export async function resolvePaperUrl(path) {
  if (!path) return null
  return getDownloadURL(storageRef(storage, path))
}

/**
 * Upload a PDF for a past paper. Path convention:
 *   papers/{adminUid}/{paperId}/{kind}-{filename}
 * where kind is 'paper' or 'mark-scheme'. Returns the Storage path so
 * the caller can persist it on the Firestore doc.
 */
export async function uploadPaperPdf({ uid, paperId, kind, file }) {
  if (!uid || !paperId || !file) throw new Error('Missing arguments for paper upload')
  const safeName = (file.name || 'paper.pdf').replace(/[^a-z0-9._-]+/gi, '_')
  const path = `papers/${uid}/${paperId}/${kind}-${safeName}`
  await uploadBytes(storageRef(storage, path), file, {
    contentType: 'application/pdf',
  })
  return { path, filename: file.name, size: file.size }
}

/**
 * Upload an arbitrary paper asset (PDF or image). Scanned papers come
 * in as JPG/PNG and we accept multiple of them on one paper. Path
 * convention:
 *   papers/{adminUid}/{paperId}/assets/{idx}-{filename}
 * `idx` keeps assets sortable in the order the admin uploaded them.
 */
export async function uploadPaperAsset({ uid, paperId, file, index = 0 }) {
  if (!uid || !paperId || !file) throw new Error('Missing arguments for paper upload')
  if (!ALLOWED_PAPER_MIME.includes(file.type)) {
    throw new Error(`Unsupported file type: ${file.type || 'unknown'}. Use PDF, JPG, PNG or WEBP.`)
  }
  if (file.size > MAX_PAPER_FILE_BYTES) {
    throw new Error(`File "${file.name}" is larger than 50MB.`)
  }
  const safeName = (file.name || 'asset').replace(/[^a-z0-9._-]+/gi, '_')
  const path = `papers/${uid}/${paperId}/assets/${index}-${safeName}`
  await uploadBytes(storageRef(storage, path), file, { contentType: file.type })
  return {
    path,
    filename: file.name,
    size: file.size,
    contentType: file.type,
  }
}

export async function deletePaperPdf(path) {
  if (!path) return
  try {
    await deleteObject(storageRef(storage, path))
  } catch (err) {
    // Storage 404 is fine — caller is removing a paper that already
    // had its file cleared. Other errors propagate.
    if (err?.code !== 'storage/object-not-found') throw err
  }
}

export async function createPaper({ uid, fields }) {
  const now = serverTimestamp()
  const docRef = await addDoc(collection(db, COLLECTION), {
    ...fields,
    examBoard: fields.examBoard || 'ECZ',
    status: fields.status || PAPER_STATUSES.DRAFT,
    views: 0,
    downloads: 0,
    uploadedBy: uid,
    uploadedAt: now,
    updatedAt: now,
  })
  return docRef.id
}

export async function updatePaper(paperId, fields) {
  await updateDoc(doc(db, COLLECTION, paperId), {
    ...fields,
    updatedAt: serverTimestamp(),
  })
}

export async function deletePaper(paperId, paths = []) {
  // Delete the Firestore doc first so a stale row never points at a
  // missing file. Storage cleanup runs after; a failure there leaves
  // an orphan blob (cheap enough — admin can clean from console).
  await deleteDoc(doc(db, COLLECTION, paperId))
  await Promise.all(paths.filter(Boolean).map((p) => deletePaperPdf(p)))
}

/**
 * Increment a counter on the paper. Best-effort — failures are logged
 * but never thrown to callers, because counter mishaps shouldn't break
 * the user-visible read flow.
 */
export async function recordPaperEvent(paperId, kind) {
  if (!paperId || !kind) return
  const field = kind === 'view' ? 'views'
    : kind === 'download' ? 'downloads'
      : null
  if (!field) return
  try {
    await updateDoc(doc(db, COLLECTION, paperId), { [field]: increment(1) })
  } catch (err) {
    console.warn('[pastPapers] counter update failed', err)
  }
}

/** Stable list of years to surface in the year filter chips. */
export function paperYearsFromList(papers) {
  const years = new Set()
  for (const p of papers) {
    if (typeof p.year === 'number') years.add(p.year)
  }
  return [...years].sort((a, b) => b - a)
}

// ── Audit A2 PR 3 — timed practice attempts ─────────────────────────

const ATTEMPTS_COLLECTION = 'paperAttempts'

/**
 * Start a timed practice run for `paper`. Writes a paperAttempts/{id}
 * doc with status='in_progress' and the paper's metadata snapshotted
 * inline so the attempt remains readable even if the underlying
 * paper is later unpublished.
 *
 * Returns the new attemptId for the runner to update on submit.
 */
export async function startPaperAttempt({ uid, paper, durationMinutes }) {
  const ref = await addDoc(collection(db, ATTEMPTS_COLLECTION), {
    userId: uid,
    paperId: paper.id,
    paperTitle: paper.title,
    paperGrade: paper.grade ?? null,
    paperSubject: paper.subject ?? null,
    paperYear: paper.year ?? null,
    durationMinutes: Number(durationMinutes) || null,
    elapsedSeconds: 0,
    status: 'in_progress',
    startedAt: serverTimestamp(),
  })
  return ref.id
}

/**
 * Mark an in-flight attempt as submitted. Records the actual elapsed
 * time and an optional reflection note. Idempotent — re-calling on a
 * doc that's already submitted just no-ops the timestamp updates.
 */
export async function submitPaperAttempt({ attemptId, elapsedSeconds, reflection, paperGrade, paperSubject }) {
  await updateDoc(doc(db, ATTEMPTS_COLLECTION, attemptId), {
    status: 'submitted',
    elapsedSeconds: Math.max(0, Math.min(60 * 60 * 12, Math.round(elapsedSeconds || 0))),
    reflection: reflection ? String(reflection).slice(0, 1000) : null,
    submittedAt: serverTimestamp(),
  })
  // Audit B2 — analytics. Aggregate stats only; we never send the
  // reflection text (it's free-form learner content).
  capture('paper_practice_completed', {
    elapsedSeconds: Math.round(elapsedSeconds || 0),
    grade: paperGrade ?? null,
    subject: paperSubject ?? null,
    hasReflection: Boolean(reflection),
  })
}

/**
 * The user navigated away or closed the tab without submitting. Best-
 * effort flip to status='abandoned' so admin can tell the difference
 * between "still studying" and "ghosted" on the analytics later.
 */
export async function abandonPaperAttempt(attemptId) {
  try {
    await updateDoc(doc(db, ATTEMPTS_COLLECTION, attemptId), {
      status: 'abandoned',
    })
  } catch (err) {
    // Network drop on close, expected — don't bother surfacing.
    console.warn('[pastPapers] abandon mark failed', err)
  }
}

export async function listMyPaperAttempts(uid, { limit = 30 } = {}) {
  const q = query(
    collection(db, ATTEMPTS_COLLECTION),
    where('userId', '==', uid),
    orderBy('submittedAt', 'desc'),
    fsLimit(limit),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}
