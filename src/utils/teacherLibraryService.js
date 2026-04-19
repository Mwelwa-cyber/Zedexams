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
}

export const TOOL_FILTER_OPTIONS = [
  {value: '', label: 'All tools'},
  {value: 'lesson_plan', label: 'Lesson plans'},
  {value: 'worksheet', label: 'Worksheets'},
  {value: 'flashcards', label: 'Flashcards'},
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
  return gen.inputs?.topic || 'Generation'
}

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
