/**
 * Admin Generations service.
 *
 * Reads/writes the `aiGenerations` Firestore collection at admin scope.
 * Rules enforce:
 *   - admin can read any generation
 *   - admin can delete any generation
 *   - admin can update `teacherEdited`, `visibility`, `exportedFormats`
 *     (existing teacher rule — we reuse it for the flag toggle too by
 *     setting visibility or teacherEdited as the signal)
 *
 * For flagging generations for review, we use the `visibility` field:
 *   - "private"           → teacher-owned, default
 *   - "flagged_for_review" → admin flagged for follow-up
 *   - "reviewed"           → admin cleared after review
 *   - "shared_to_school"   → future feature
 *   - "public_marketplace" → future feature
 *
 * This keeps the schema stable and avoids adding a new field just for
 * admin flagging.
 */

import {
  collection, doc, deleteDoc, getDocs, limit, orderBy, query,
  serverTimestamp, updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { isUnresolvedFailure, summarizeGenerationRows } from './generationsSummary'

const PAGE_SIZE = 200

/**
 * List generations, newest first, optionally filtered.
 */
export async function listAllGenerations(opts = {}) {
  const { tool, status, grade, subject } = opts

  const q = query(
    collection(db, 'aiGenerations'),
    orderBy('createdAt', 'desc'),
    limit(PAGE_SIZE),
  )

  let snap
  try {
    snap = await getDocs(q)
  } catch (err) {
    console.error('listAllGenerations failed', err)
    throw new Error(
      err?.code === 'failed-precondition' ?
        'The generations index is still being built. Try again in a minute.' :
        'Could not load generations. Check admin permissions.',
    )
  }

  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  return rows.filter((r) => {
    if (tool && r.tool !== tool) return false
    if (status && r.status !== status) return false
    if (grade && r.inputs?.grade !== grade) return false
    if (subject && r.inputs?.subject !== subject) return false
    return true
  })
}

/** Toggle admin review flag on a generation via the visibility field. */
export async function setAdminFlag(genId, flagged = true) {
  if (!genId) return false
  try {
    await updateDoc(doc(db, 'aiGenerations', genId), {
      visibility: flagged ? 'flagged_for_review' : 'reviewed',
    })
    return true
  } catch (err) {
    console.error('setAdminFlag failed', err)
    return false
  }
}

/**
 * Mark a failed generation as resolved (or reopen it).
 *
 * A failed run otherwise sits in the admin dashboard's "Needs attention"
 * queue forever — the only way to clear it was to delete the record, which
 * also throws away the error message you might want to keep for debugging.
 * Resolving sets a flag the dashboard count ignores, without touching the
 * `status` field, so the failure (and its `errorMessage`) stays auditable.
 * Admins can write any field on aiGenerations (firestore.rules), so this
 * needs no rules change.
 */
export async function resolveGeneration(genId, resolved = true) {
  if (!genId) return false
  try {
    await updateDoc(doc(db, 'aiGenerations', genId), {
      adminResolved: resolved,
      adminResolvedAt: resolved ? serverTimestamp() : null,
    })
    return true
  } catch (err) {
    console.error('resolveGeneration failed', err)
    return false
  }
}

/** Hard delete a generation. Admin only. */
export async function deleteGeneration(genId) {
  if (!genId) return false
  try {
    await deleteDoc(doc(db, 'aiGenerations', genId))
    return true
  } catch (err) {
    console.error('deleteGeneration failed', err)
    return false
  }
}

// Pure reducers live in a Firebase-free module so they're unit-testable.
export { isUnresolvedFailure, summarizeGenerationRows }

/** Summary stats for the admin dashboard. */
export async function getGenerationsSummary() {
  try {
    const rows = await listAllGenerations()
    return summarizeGenerationRows(rows)
  } catch (err) {
    return {
      total: 0, last24h: 0, failed: 0, flagged: 0, totalCostUsd: '0.00', byTool: {},
    }
  }
}

/** CSV export — useful for weekly quality-review spreadsheets. */
export function exportGenerationsCsv(rows, filename = 'zedexams-generations.csv') {
  if (!rows?.length) return

  const headers = [
    'id', 'tool', 'status', 'ownerUid',
    'grade', 'subject', 'topic', 'subtopic',
    'modelUsed', 'promptVersion', 'kbVersion',
    'tokensIn', 'tokensOut', 'costUsdCents',
    'createdAt', 'completedAt', 'errorMessage',
  ]

  const escape = (v) => {
    if (v == null) return ''
    const s = typeof v === 'object' && typeof v.toDate === 'function' ?
      v.toDate().toISOString() : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const flatten = (r) => ({
    ...r,
    grade: r.inputs?.grade || '',
    subject: r.inputs?.subject || '',
    topic: r.inputs?.topic || '',
    subtopic: r.inputs?.subtopic || '',
  })

  const lines = [
    headers.join(','),
    ...rows.map((r) => {
      const flat = flatten(r)
      return headers.map((h) => escape(flat[h])).join(',')
    }),
  ]

  const csv = lines.join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function formatDate(ts) {
  if (!ts) return ''
  const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts)
  const now = new Date()
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / (1000 * 60))
  if (diffMin < 60) return diffMin <= 1 ? 'just now' : `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDays = Math.floor(diffHr / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-ZM', { year: 'numeric', month: 'short', day: 'numeric' })
}

export const STATUS_COLOURS = {
  complete: 'bg-emerald-100 text-emerald-800',
  generating: 'bg-blue-100 text-blue-800',
  failed: 'bg-rose-100 text-rose-800',
  flagged: 'bg-amber-100 text-amber-800',
}

export const TOOL_META = {
  lesson_plan:    { label: 'Lesson Plan',     icon: '✨' },
  scheme_of_work: { label: 'Scheme of Work',  icon: '🗓️' },
  worksheet:      { label: 'Worksheet',       icon: '📝' },
  flashcards:     { label: 'Flashcards',      icon: '🎴' },
  rubric:         { label: 'Rubric',          icon: '📋' },
}
