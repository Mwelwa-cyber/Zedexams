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
import { getDownloadURL, ref as storageRef } from 'firebase/storage'
import { deleteObject, uploadBytes } from '../firebase/attestedStorage'
import { db, storage } from '../firebase/config'
import { capture } from './analytics'
import { isOfficialSource } from '../config/paperSources.js'
import { derivedPaperTitle, normalizePaperFields } from './pastPaperNormalize.js'
import {
  attachQuizFields,
  paperQuizIsAttached,
  pendingQuizFields,
} from './pastPaperQuizStatus.js'

// Grade 9 ECZ exams were phased out, so the public archive only
// surfaces Grade 7 and Grade 12 papers. Any legacy Grade 9 docs that
// remain in Firestore are filtered out at the hub level.
export const PAPER_GRADES = ['7', '12']

// Each uploaded asset can be either the paper itself or its mark
// scheme. Defaults to 'paper' when the field is absent (back-compat
// with assets uploaded before the role split landed).
export const ASSET_ROLES = {
  PAPER: 'paper',
  MARK_SCHEME: 'mark-scheme',
}

export function getAssetRole(asset) {
  return asset?.role === ASSET_ROLES.MARK_SCHEME
    ? ASSET_ROLES.MARK_SCHEME
    : ASSET_ROLES.PAPER
}

export function splitAssetsByRole(assets) {
  const paper = []
  const markScheme = []
  for (const a of (Array.isArray(assets) ? assets : [])) {
    if (getAssetRole(a) === ASSET_ROLES.MARK_SCHEME) markScheme.push(a)
    else paper.push(a)
  }
  return { paper, markScheme }
}

// Paper assets can be a PDF, a Word document (modern teacher-typed
// papers usually start life as .docx), or a series of images
// (scanned ECZ exams from the older archive). Anything up to 50MB
// per asset goes through `uploadPaperAsset` below.
export const ALLOWED_PAPER_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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
 *
 * `officialOnly` is ONE equality on the derived `isOfficial` boolean. That is
 * what the field is for: an OR across every mock publisher we ever add is not
 * a Firestore query.
 *
 * NOTE — there is deliberately NO filter on `sourceConfidence` here. #2191
 * constrained every learner read to papers whose provenance was established,
 * which combined with the matching rules gate to hide the ENTIRE archive until
 * a manual migration had run. Reverted: an unlabelled paper is listed and
 * renders with an "Unlabelled" badge, which is honest and visible, rather than
 * vanishing.
 */
export async function listPublishedPapers({
  grade, subject, year, officialOnly = false, limit = 200,
} = {}) {
  const filters = [where('status', '==', PAPER_STATUSES.PUBLISHED)]
  if (grade)   filters.push(where('grade',   '==', String(grade)))
  if (subject) filters.push(where('subject', '==', String(subject)))
  if (year)    filters.push(where('year',    '==', Number(year)))
  if (officialOnly) filters.push(where('isOfficial', '==', true))
  const q = query(
    collection(db, COLLECTION),
    ...filters,
    orderBy('year', 'desc'),
    fsLimit(limit),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/**
 * The paper already occupying a `paperKey`, or null.
 *
 * `excludeId` is what makes this usable while EDITING: a paper re-deriving its
 * own unchanged key must not be told it is a duplicate of itself.
 *
 * This is a check, not a lock. Two admins publishing the same paper in the
 * same second can still both pass it — Firestore has no unique index, and the
 * alternative (a transaction against a key-registry collection) is a heavier
 * mechanism than a two-person admin team needs. What it does prevent is the
 * case that actually happens: the same archive being uploaded twice, weeks
 * apart, because nothing said it was already there.
 */
export async function findPaperByKey(key, { excludeId = null } = {}) {
  if (!key) return null
  const snap = await getDocs(query(
    collection(db, COLLECTION),
    where('paperKey', '==', String(key)),
    fsLimit(2),
  ))
  const hit = snap.docs.find((d) => d.id !== excludeId)
  return hit ? { id: hit.id, ...hit.data() } : null
}

// ── Published-list cache (stale-while-revalidate) ───────────────────
// `/papers` is the top public SEO landing page and re-mounts on every
// navigation back to it. Each visit was paying for a cold getDocs of
// the whole published archive — and every doc drags its full `assets[]`
// array (one entry per scanned page on image papers) that the hub list
// never renders. The web SDK can't project fields away, so instead we
// cache the unfiltered list per tab (memory) and across mounts
// (sessionStorage) and let the hub paint instantly from cache while a
// background re-read refreshes it. TTL is advisory — cache is shown
// regardless and always revalidated; the timestamp just lets callers
// skip a refetch when they want to.
const PUBLISHED_CACHE_KEY = 'zx_published_papers_v1'
export const PUBLISHED_CACHE_TTL_MS = 10 * 60 * 1000
let publishedMemoryCache = null // { at: number, papers: [] }

function readPublishedSessionCache() {
  try {
    const raw = sessionStorage.getItem(PUBLISHED_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.papers) || !parsed.papers.length) return null
    return parsed
  } catch {
    return null
  }
}

function writePublishedCache(papers) {
  // Only cache a non-empty result — an empty read means "archive still
  // being uploaded", and the hub renders its sample fallback for that.
  // Caching [] would suppress the fallback and re-show empty on revisit.
  if (!Array.isArray(papers) || !papers.length) return
  const entry = { at: Date.now(), papers }
  publishedMemoryCache = entry
  try {
    sessionStorage.setItem(PUBLISHED_CACHE_KEY, JSON.stringify(entry))
  } catch {
    /* private mode / quota — the in-memory cache still applies this tab */
  }
}

/**
 * Synchronously return the cached published-papers list (memory first,
 * then sessionStorage) or null when nothing is cached yet. Lets a
 * surface paint immediately and revalidate in the background.
 */
export function getCachedPublishedPapers() {
  if (publishedMemoryCache) return publishedMemoryCache.papers
  const session = readPublishedSessionCache()
  if (session) {
    publishedMemoryCache = session
    return session.papers
  }
  return null
}

/**
 * listPublishedPapers + cache write. The hub calls this for its
 * full-archive read so repeat visits in the same tab/session are
 * instant. Filtered/limited reads should keep using listPublishedPapers
 * directly so they don't clobber the full-list cache.
 */
export async function listPublishedPapersCached(opts = {}) {
  const papers = await listPublishedPapers(opts)
  writePublishedCache(papers)
  return papers
}

// Single denormalised doc maintained server-side (pastPapersIndexOnWrite
// trigger + 6-hourly cron). Holds only the lightweight fields the hub
// renders, so reading it is one tiny doc fetch instead of pulling every
// pastPapers doc with its heavy assets[] array.
const INDEX_DOC_PATH = ['pastPapersIndex', 'published']

/**
 * Read the published-papers index doc. Returns the lightweight papers
 * array, or null when the doc doesn't exist yet (e.g. before the first
 * server-side rebuild) so the caller can fall back to a direct query.
 */
export async function getPublishedPapersIndex() {
  try {
    const snap = await getDoc(doc(db, ...INDEX_DOC_PATH))
    if (!snap.exists()) return null
    const papers = snap.data()?.papers
    return Array.isArray(papers) && papers.length ? papers : null
  } catch (err) {
    console.warn('[pastPapers] index read failed', err)
    return null
  }
}

/**
 * The hub's published-list loader. Prefers the lightweight index doc
 * (one small read); falls back to the full collection query when the
 * index hasn't been built yet. Writes the result to the cache either
 * way so a revisit paints instantly.
 */
export async function loadPublishedPapers() {
  const fromIndex = await getPublishedPapersIndex()
  if (fromIndex) {
    writePublishedCache(fromIndex)
    return fromIndex
  }
  return listPublishedPapersCached({})
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

// The implementation lives in pastPaperLookup.js — the read-only module the
// public quiz route imports so the zero-write guard can walk its whole graph
// (this module's admin write helpers forced it to be a skipped boundary).
export { getPaperById } from './pastPaperLookup.js'
export { getPaperById as getPaper } from './pastPaperLookup.js'

/**
 * Read-only peek at the lightweight metadata of a paper's linked quiz —
 * used by the viewer's quiz panel to show "N questions" / difficulty
 * without loading the whole question set. Never writes; returns null if
 * the id is missing or the quiz doc can't be read (best-effort, the
 * panel degrades to "Quiz Available" without the count).
 */
export async function getLinkedQuizMeta(quizId) {
  if (!quizId) return null
  try {
    const snap = await getDoc(doc(db, 'quizzes', quizId))
    if (!snap.exists()) return null
    const data = snap.data() || {}
    return {
      questionCount: Number.isFinite(data.questionCount) ? data.questionCount : null,
      difficulty: data.difficulty || null,
      isPublished: Boolean(data.isPublished),
      publicAccess: Boolean(data.publicAccess),
      // Needed by the featured-strip subject-integrity filter (see
      // listFeaturedPapersWithQuiz) so a paper whose linked quiz belongs to a
      // different subject is never surfaced as a featured card.
      subject: data.subject ?? null,
      grade: data.grade ?? null,
      linkedPaperId: data.linkedPaperId || data.sourcePastPaperId || null,
    }
  } catch (err) {
    console.warn('[pastPapers] getLinkedQuizMeta failed', err)
    return null
  }
}

/**
 * Like listPublishedPapers but restricted to papers that have a linked
 * quiz (i.e. learners can press "Quiz" on them). The marketing page +
 * the hub's quiz tab both call into this.
 */
export async function listPapersWithQuiz({ limit = 60 } = {}) {
  const all = await listPublishedPapers({ limit })
  // Derived status, not `Boolean(p.quizId)` — a paper published with the Quiz
  // step skipped can still carry an id in `pendingQuizId`, and a paper whose
  // quiz was skipped after a draft quiz existed reads 'pending'. Neither
  // belongs on a surface that promises "take the quiz".
  return all.filter((p) => paperQuizIsAttached(p))
}

/**
 * Featured-strip loader for the marketing page. Unlike listPapersWithQuiz this
 * FAILS CLOSED on subject integrity: for each candidate it reads the linked
 * quiz's lightweight metadata and only keeps the paper when the paper's subject
 * matches the quiz's subject (normalised) AND the quiz is genuinely published +
 * public-access. This stops the "featured Social Studies paper links to a Maths
 * quiz" defect from ever reaching the landing page.
 *
 * Cost-aware: it validates candidates one page at a time and stops as soon as
 * it has `count` good cards, so the landing page pays for ~count small quiz-meta
 * reads, not the whole archive. A mismatched paper is skipped silently (the
 * repair script + admin queue handle the remediation); the visitor just sees the
 * next clean paper.
 */
export async function listFeaturedPapersWithQuiz({ count = 4, scanLimit = 24 } = {}) {
  const { paperQuizSubjectMatches } = await import('./quizSubjectIntegrity.js')
  const candidates = await listPapersWithQuiz({ limit: scanLimit })
  const out = []
  for (const paper of candidates) {
    if (out.length >= count) break
    let meta
    try {
      meta = await getLinkedQuizMeta(paper.quizId)
    } catch {
      continue
    }
    if (!meta || !meta.isPublished || !meta.publicAccess) continue
    if (!paperQuizSubjectMatches(paper, meta)) continue
    out.push(paper)
  }
  return out
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
 * Resolve a paper file's download URL with a server fallback.
 *
 * First tries the normal client-side read (getDownloadURL under
 * storage.rules). If — and only if — that read is DENIED
 * (storage/unauthorized / storage/unauthenticated), asks the staff-only
 * `resolvePaperAssetUrl` callable instead: the server verifies the caller is
 * teacher/admin and that `path` belongs to `pastPapers/{paperId}`, then
 * returns the same tokened URL shape. This is what keeps the Quiz Editor's
 * "Crop from page" (and the paper/mark-scheme reference links) working when
 * the caller's token claims, users doc, and the DEPLOYED rules version don't
 * line up — the exact production failure this fallback was added for.
 *
 * Any other error (offline, missing object, …) is rethrown untouched: the
 * fallback exists for permission denials, not as a second network path.
 *
 * LIFETIME DIFFERS BY PATH, and callers that hold the URL must care. The
 * direct read returns a Firebase download URL that never expires; the
 * fallback returns a V4 signed URL valid for ~10 minutes, deliberately, so a
 * leaked link stops being a credential. Callers that fetch the bytes straight
 * away (the page provider, figure attach) are unaffected. A caller that
 * stashes the URL and uses it much later — an <a href> on a long-lived screen
 * — should re-resolve at use time rather than at mount.
 */
export async function resolvePaperUrlSmart({ paperId, path }) {
  if (!path) return null
  try {
    return await resolvePaperUrl(path)
  } catch (err) {
    const code = String(err?.code || '')
    const denied = code === 'storage/unauthorized' || code === 'storage/unauthenticated'
    if (!denied || !paperId) throw err
    const { getFunctions, httpsCallable } = await import('firebase/functions')
    // Name the region explicitly, as every other callable in the app does —
    // `app` is not exported from firebase/config, hence the `undefined` first
    // argument (same shape as PastPaperStudio.jsx). Relying on the SDK's
    // default region would leave this one call site silently depending on a
    // default the repo never states anywhere else.
    const callable = httpsCallable(getFunctions(undefined, 'us-central1'), 'resolvePaperAssetUrl')
    const res = await callable({ paperId, path })
    const url = res?.data?.url
    if (!url) throw err
    return url
  }
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
 * Read the intrinsic pixel dimensions of an image file before upload.
 * Used by uploadPaperAsset so the viewer can render `<img width height>`
 * and reserve the layout slot before the bytes arrive (no jank on
 * mobile). Returns null on any failure — dimensions are nice-to-have,
 * never block the upload.
 */
async function readImageDimensions(file) {
  if (typeof window === 'undefined') return null
  if (!file?.type?.startsWith('image/')) return null
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve) => {
      const img = new window.Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => resolve(null)
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Upload an arbitrary paper asset (PDF or image). Scanned papers come
 * in as JPG/PNG and we accept multiple of them on one paper. Path
 * convention:
 *   papers/{adminUid}/{paperId}/assets/{idx}-{filename}
 * `idx` keeps assets sortable in the order the admin uploaded them.
 *
 * For images, captures the intrinsic width/height client-side and
 * stores them on the asset record so the viewer can reserve layout
 * space before download completes.
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
  const dims = await readImageDimensions(file)
  await uploadBytes(storageRef(storage, path), file, { contentType: file.type })
  return {
    path,
    filename: file.name,
    size: file.size,
    contentType: file.type,
    ...(dims ? { width: dims.width, height: dims.height } : {}),
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
  // Single normalization pipeline (grade / subject / examBoard / year /
  // paperNumber / source + derived isOfficial, slug and paperKey) so every
  // paper lands with consistent, query-matchable metadata regardless of what
  // the admin typed.
  const norm = withDerivedTitle(normalizePaperFields(fields))
  const docRef = await addDoc(collection(db, COLLECTION), {
    ...norm,
    examBoard: norm.examBoard || 'ECZ',
    status: norm.status || PAPER_STATUSES.DRAFT,
    views: 0,
    downloads: 0,
    uploadedBy: uid,
    uploadedAt: now,
    updatedAt: now,
  })
  return docRef.id
}

export async function updatePaper(paperId, fields) {
  // Run edits through the same pipeline. normalizePaperFields only touches keys
  // that are present, so a status-only update never clobbers title/grade/etc.,
  // and the slug + paperKey are re-derived whenever their inputs are in play.
  await updateDoc(doc(db, COLLECTION, paperId), {
    ...withDerivedTitle(normalizePaperFields(fields)),
    updatedAt: serverTimestamp(),
  })
}

/**
 * Regenerate `title` from the structured fields whenever this write carries
 * enough of them to compose one.
 *
 * `title` is display-only now: admins do not type it, nothing branches on it,
 * and <PaperTitle/> composes what a learner reads from the fields directly. It
 * stays on the document so the surfaces that legitimately want one string —
 * the search haystack, the paperAttempts snapshot, exports — keep having one,
 * and regenerating it here is what stops that string from describing the paper
 * as it was three edits ago.
 *
 * The whole identity must be present, not merely some of it. A write carrying
 * only `{ year }` would compose "— 2025" and file it as the paper's name; a
 * status flip or a quiz attach carries none of the inputs at all. Both are
 * left alone. The Details step sends grade, subject, year and source together,
 * which is the write this exists for.
 */
function withDerivedTitle(norm) {
  const complete = ['grade', 'subject', 'year'].every((k) => norm[k])
  if (!complete) return norm
  return { ...norm, title: derivedPaperTitle(norm) }
}

/**
 * Attach a quiz to a paper — `quizId` + `quizStatus` in ONE updateDoc.
 *
 * Deliberately not two `updatePaper` calls and never a read-modify-write of
 * the whole doc: between two writes the paper is readable in a state it
 * should never be in (attached with no id, or an id the UI won't route to),
 * and a stale tab re-writing a doc it read minutes ago is a failure this
 * platform has shipped before. `pendingQuizId` is cleared in the same patch
 * so nothing is left pointing at the paper's authoring quiz.
 */
export async function attachQuizToPaper(paperId, quizId) {
  if (!paperId) throw new Error('attachQuizToPaper requires a paper id')
  await updateDoc(doc(db, COLLECTION, paperId), {
    ...attachQuizFields(quizId),
    updatedAt: serverTimestamp(),
  })
}

/**
 * Mark a paper's quiz as still to come — the Studio's "Skip for now" path.
 * `quizId` is nulled so no learner surface can route into a quiz with no
 * questions; the draft quiz the Studio was authoring is parked in
 * `pendingQuizId` so re-entering the wizard picks that one back up instead of
 * minting a second, orphaned quiz doc.
 */
export async function markPaperQuizPending(paperId, draftQuizId = null) {
  if (!paperId) throw new Error('markPaperQuizPending requires a paper id')
  await updateDoc(doc(db, COLLECTION, paperId), {
    ...pendingQuizFields(draftQuizId),
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
    // Snapshotted with the rest of the paper's metadata so an attempt stays
    // attributable after the paper is edited or unpublished — and so a
    // practice run against a PRISCA mock is never counted as evidence about
    // how a learner does on the real exam. `paperIsOfficial` is derived from
    // the source here, never read from the document, so an attempt cannot
    // inherit a stale boolean that disagrees with its own source.
    paperSource: paper.source ?? null,
    paperIsOfficial: isOfficialSource(paper.source),
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
