/**
 * Teacher Library — Firestore service layer.
 *
 * Reads from the aiGenerations collection (written by the Cloud Functions).
 * Writes allowed: toggle pin (teacherEdited bool), delete.
 *
 * Security: Firestore rules already restrict reads/writes to the owner,
 * but we still filter by ownerUid client-side to scope the query.
 */

import {
  collection, doc, getDoc, getDocs, deleteDoc, updateDoc,
  query, where, orderBy, limit,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { LIBRARY_SECTION_BY_ID, LIBRARY_TYPES } from '../config/library'
import { TOOL_TO_LIBRARY_TYPE, classifyForLibrary } from './libraryClassification'

const GENERATIONS_PAGE_SIZE = 60

/**
 * List the current user's generations, newest first. Optional filters.
 *
 * @param {object} opts
 *   uid (required)
 *   tool  (optional) one of "lesson_plan" | "worksheet" | "flashcards"
 *   grade (optional) e.g. "G5"
 *   subject (optional) e.g. "mathematics"
 */
export async function listMyGenerations(opts = {}) {
  const {uid, tool, grade, subject} = opts
  if (!uid) return []

  // Base query: own generations, newest first. We do tool/grade/subject
  // filtering client-side for simplicity; server-side indexing would need
  // a composite index for each combination. With ≤60 recent items this is
  // cheap and avoids index deploys for every filter combination.
  const q = query(
    collection(db, 'aiGenerations'),
    where('ownerUid', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(GENERATIONS_PAGE_SIZE),
  )

  let snap
  try {
    snap = await getDocs(q)
  } catch (err) {
    // If the composite index (ownerUid + createdAt) is missing, Firestore
    // throws a FAILED_PRECONDITION with a link to create it. Surface a
    // friendly error the UI can display.
    console.error('listMyGenerations query failed', err)
    throw new Error(
      err?.code === 'failed-precondition' ?
        'The library index is still being built. Try again in a minute.' :
        'Could not load your library right now. Please try again.',
    )
  }

  const rows = snap.docs.map((d) => ({id: d.id, ...d.data()}))
  return rows.filter((r) => {
    if (tool && r.tool !== tool) return false
    if (grade && r.inputs?.grade !== grade) return false
    if (subject && r.inputs?.subject !== subject) return false
    return true
  })
}

/**
 * Fetch a single generation by id. Returns null if not found or not owned.
 */
export async function getGeneration(id) {
  if (!id) return null
  try {
    const snap = await getDoc(doc(db, 'aiGenerations', id))
    if (!snap.exists()) return null
    return {id: snap.id, ...snap.data()}
  } catch (err) {
    console.error('getGeneration failed', err)
    return null
  }
}

/**
 * Delete a generation.
 */
export async function deleteGeneration(id) {
  if (!id) return false
  try {
    await deleteDoc(doc(db, 'aiGenerations', id))
    return true
  } catch (err) {
    console.error('deleteGeneration failed', err)
    return false
  }
}

/**
 * Update the teacherEdited flag. Our Firestore rules allow the owner to
 * toggle this field and `visibility` + `exportedFormats` only.
 */
export async function markAsEdited(id, edited = true) {
  if (!id) return false
  try {
    await updateDoc(doc(db, 'aiGenerations', id), {teacherEdited: Boolean(edited)})
    return true
  } catch (err) {
    console.error('markAsEdited failed', err)
    return false
  }
}

/**
 * Replace the `output` field of a generation. Used by in-place editing in
 * the library detail view — e.g. personalising the header of a lesson plan
 * (teacher name, date, school) without re-running Claude.
 */
export async function updateGenerationOutput(id, output) {
  if (!id || !output || typeof output !== 'object') return false
  try {
    await updateDoc(doc(db, 'aiGenerations', id), {
      output,
      teacherEdited: true,
    })
    return true
  } catch (err) {
    console.error('updateGenerationOutput failed', err)
    return false
  }
}

/**
 * Attach the library coordinates ({syllabus, gradeForm, term, subject,
 * assessmentType, path, libraryType}) to a saved generation. Called by
 * studios immediately after generation succeeds so the doc lands in the
 * correct library folder. Idempotent.
 *
 * Firestore rules permit only `output | teacherEdited | visibility |
 * exportedFormats | library` to be updated by the owner — keep this set
 * in sync with `firestore.rules` if you change it.
 */
export async function setGenerationLibrary(id, library) {
  if (!id || !library || typeof library !== 'object') return false
  try {
    await updateDoc(doc(db, 'aiGenerations', id), { library })
    return true
  } catch (err) {
    console.error('setGenerationLibrary failed', err)
    return false
  }
}

/**
 * One-shot helper used by studios: classify the studio's raw inputs into
 * canonical library coords, then patch the saved generation. Silent
 * no-op when classification fails or the row isn't owned by the user.
 */
export async function attachLibraryToGeneration(generationId, classification) {
  const lib = classifyForLibrary(classification)
  if (!generationId || !lib) return null
  await setGenerationLibrary(generationId, lib)
  return lib
}

/**
 * Record that the user exported a generation in a given format. Appends to
 * the `exportedFormats` array (deduped).
 */
export async function recordExport(id, format) {
  if (!id || !format) return false
  try {
    const cur = await getDoc(doc(db, 'aiGenerations', id))
    const existing = Array.isArray(cur.data()?.exportedFormats) ?
      cur.data().exportedFormats : []
    if (existing.includes(format)) return true
    await updateDoc(doc(db, 'aiGenerations', id), {
      exportedFormats: [...existing, format],
    })
    return true
  } catch (err) {
    console.error('recordExport failed', err)
    return false
  }
}

/**
 * Summary stats for the current user's library — used by the dashboard.
 */
export async function getLibrarySummary(uid) {
  if (!uid) return {total: 0, byTool: {}}
  const rows = await listMyGenerations({uid})
  const byTool = rows.reduce((acc, r) => {
    acc[r.tool] = (acc[r.tool] || 0) + 1
    return acc
  }, {})
  return {total: rows.length, byTool}
}

/* ── UI constants ─────────────────────────────────────────── */

export const TOOL_META = {
  lesson_plan: {
    label: 'Lesson Plan',
    icon: '✨',
    route: '/teacher/generate/lesson-plan',
    colour: 'emerald',
  },
  scheme_of_work: {
    label: 'Scheme of Work',
    icon: '🗓️',
    route: '/teacher/generate/scheme-of-work',
    colour: 'teal',
  },
  worksheet: {
    label: 'Worksheet',
    icon: '📝',
    route: '/teacher/generate/worksheet',
    colour: 'indigo',
  },
  flashcards: {
    label: 'Flashcards',
    icon: '🎴',
    route: '/teacher/generate/flashcards',
    colour: 'amber',
  },
  rubric: {
    label: 'Rubric',
    icon: '📋',
    route: '/teacher/generate/rubric',
    colour: 'rose',
  },
  notes: {
    label: 'Teacher Notes',
    icon: '📓',
    route: '/teacher/generate/notes',
    colour: 'sky',
  },
}

export const TOOL_FILTER_OPTIONS = [
  {value: '', label: 'All tools'},
  {value: 'lesson_plan', label: 'Lesson plans'},
  {value: 'scheme_of_work', label: 'Schemes of work'},
  {value: 'worksheet', label: 'Worksheets'},
  {value: 'flashcards', label: 'Flashcards'},
  {value: 'rubric', label: 'Rubrics'},
  {value: 'notes', label: 'Teacher notes'},
]

/**
 * Derive a human-readable title for a generation.
 */
export function titleForGeneration(gen) {
  if (!gen) return 'Untitled'
  const out = gen.output || {}
  if (gen.tool === 'lesson_plan') {
    return out?.header?.topic ?
      `${out.header.topic}${out.header.subtopic ? ` — ${out.header.subtopic}` : ''}` :
      `${gen.inputs?.grade || ''} ${gen.inputs?.subject || ''} lesson plan`.trim()
  }
  if (gen.tool === 'worksheet') {
    return out?.header?.title || `${gen.inputs?.topic || 'Worksheet'}`
  }
  if (gen.tool === 'flashcards') {
    return out?.header?.title || `${gen.inputs?.topic || 'Flashcards'}`
  }
  if (gen.tool === 'scheme_of_work') {
    const g = out?.header?.class || gen.inputs?.grade || ''
    const s = out?.header?.subject || gen.inputs?.subject || ''
    const t = out?.header?.term || gen.inputs?.term || ''
    return `${g} ${s} — Term ${t} Scheme of Work`.trim()
  }
  if (gen.tool === 'rubric') {
    return out?.header?.title ||
      `${gen.inputs?.grade || ''} ${gen.inputs?.subject || ''} — ${gen.inputs?.taskType || 'rubric'}`.trim()
  }
  if (gen.tool === 'notes') {
    if (out?.header?.title) return out.header.title
    const topic = out?.header?.topic || gen.inputs?.topic || 'Notes'
    const grade = out?.header?.grade || gen.inputs?.grade || ''
    return [`Teacher notes — ${topic}`, grade].filter(Boolean).join(' · ')
  }
  return gen.inputs?.topic || 'Generation'
}

/* ── Library bucketing & access control ─────────────────────── */

/**
 * Bucket a generation into a library section. Prefers the saved
 * `library.libraryType` (set by `setGenerationLibrary`) and falls back
 * to deriving it from the legacy `tool` field for un-backfilled rows.
 */
export function libraryTypeForGeneration(gen) {
  if (!gen) return null
  if (gen.library?.libraryType) return gen.library.libraryType
  return TOOL_TO_LIBRARY_TYPE[gen.tool] || null
}

/**
 * Returns the LIBRARY_SECTIONS entry for an item, or null if unknown.
 */
export function librarySectionForGeneration(gen) {
  const t = libraryTypeForGeneration(gen)
  return t ? LIBRARY_SECTION_BY_ID[t] : null
}

/**
 * Bucket the user's generations + assessments into the canonical library
 * folder tree. Returns a map keyed by libraryType → syllabus → gradeForm
 * → term → subject → [items]. For Syllabi the term level is omitted; for
 * Assessments an extra `assessmentType` level is added beneath subject.
 *
 *   tree.lesson_plans.CBC['Grade 4']['Term 2'].Mathematics  // [item, ...]
 */
export function bucketIntoTree(rows = []) {
  const tree = {}
  for (const row of rows) {
    const section = librarySectionForGeneration(row)
    if (!section) continue
    const lib = row.library || {}
    const path = [
      section.id,
      lib.syllabus || 'Unsorted',
      lib.gradeForm || 'Unsorted',
      ...(section.hasTerm ? [lib.term || 'Unsorted'] : []),
      lib.subject || 'Unsorted',
      ...(section.hasAssessmentType ? [lib.assessmentType || 'Unsorted'] : []),
    ]
    let cursor = tree
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i]
      if (!cursor[key]) cursor[key] = {}
      cursor = cursor[key]
    }
    const leafKey = path[path.length - 1]
    if (!cursor[leafKey]) cursor[leafKey] = []
    cursor[leafKey].push(row)
  }
  return tree
}

/* ── Pro vs Premium access control ──────────────────────────── */
//
// Rule (per spec):
//   PRO     — view, preview, download ONLY their own generations.
//             Cannot download platform/admin-supplied library docs.
//   PREMIUM — view, download, print, export everything.
//   FREE    — view only (no download).
//
// "Premium" maps to the `max` subscription tier (or admin role).
// "Pro" maps to the `pro` tier or any other active premium subscriber.

export const LIBRARY_ACCESS = {
  FREE:    'free',
  PRO:     'pro',
  PREMIUM: 'premium',
}

/**
 * Resolve the access level of the current viewer relative to a saved
 * library item. Pass the user's profile and the item; returns one of
 * LIBRARY_ACCESS values.
 */
export function getLibraryAccessLevel({ userProfile, isAdmin = false } = {}) {
  if (isAdmin) return LIBRARY_ACCESS.PREMIUM
  if (!userProfile) return LIBRARY_ACCESS.FREE

  const tier = String(
    userProfile.subscriptionTier ||
    userProfile.tier ||
    userProfile.subscriptionPlan ||
    userProfile.plan ||
    '',
  ).toLowerCase()

  // 'max' / 'premium' / 'unlimited' → premium.
  if (tier.startsWith('max') || tier === 'premium' || tier === 'unlimited') {
    return LIBRARY_ACCESS.PREMIUM
  }
  // 'pro_*' or any active subscription → pro.
  if (tier.startsWith('pro') ||
      userProfile.premium === true ||
      userProfile.isPremium === true ||
      userProfile.subscriptionStatus === 'active' ||
      userProfile.paymentStatus === 'active') {
    return LIBRARY_ACCESS.PRO
  }
  return LIBRARY_ACCESS.FREE
}

/**
 * Decides what the viewer can do with a single library item.
 *
 *   { canView, canDownload, canPrint, canExport }
 */
export function getItemPermissions({ userProfile, isAdmin = false, item }) {
  const level = getLibraryAccessLevel({ userProfile, isAdmin })
  const ownsIt = !!item && !!userProfile && item.ownerUid === userProfile.uid

  if (level === LIBRARY_ACCESS.PREMIUM) {
    return { canView: true, canDownload: true, canPrint: true, canExport: true, level }
  }
  if (level === LIBRARY_ACCESS.PRO) {
    // Pro: download own generations only. Library-supplied/admin docs are
    // view-only for pro users.
    return {
      canView:     true,
      canDownload: ownsIt,
      canPrint:    ownsIt,
      canExport:   ownsIt,
      level,
    }
  }
  return { canView: true, canDownload: false, canPrint: false, canExport: false, level }
}

/* ── Library section meta passthrough ───────────────────────── */

export { LIBRARY_TYPES, LIBRARY_SECTION_BY_ID }

/**
 * Format a Firestore Timestamp as a short relative date.
 */
export function formatDate(ts) {
  if (!ts) return ''
  const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString('en-ZM', {hour: '2-digit', minute: '2-digit'})
  }
  const diffMs = now - d
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-ZM', {year: 'numeric', month: 'short', day: 'numeric'})
}
