/**
 * Admin-side service for the `aiGeneratedContentVersions` collection.
 *
 * Admins read version history through these helpers to power the
 * Compare Versions panel + the per-artifact audit trail. The
 * Firestore rule (`firestore.rules:aiGeneratedContentVersions`) is
 * admin-only-read; calling these as a non-admin throws.
 *
 * Never writes — all version writes happen server-side via
 * `functions/agents/learnerAi/versionRecorder.js`.
 */

import {
  collection, limit as fsLimit, onSnapshot, orderBy, query, where,
} from 'firebase/firestore'
import { db } from '../firebase/config'

const COLLECTION = 'aiGeneratedContentVersions'

/**
 * Subscribe to the version history for a given content doc, newest
 * version first. Returns an unsubscribe function.
 *
 * @param {object} args
 * @param {string} args.contentId        aiGeneratedContent doc id
 * @param {function} args.onChange       (versions[]) => void
 * @param {function} [args.onError]      (err) => void
 * @param {number} [args.limit=50]
 * @returns {function} unsubscribe
 */
export function listVersionsForContent({
  contentId, onChange, onError, limit: pageLimit = 50,
}) {
  if (!contentId || typeof onChange !== 'function') {
    if (typeof onChange === 'function') onChange([])
    return () => {}
  }
  const q = query(
    collection(db, COLLECTION),
    where('contentId', '==', contentId),
    orderBy('version', 'desc'),
    fsLimit(pageLimit),
  )
  return onSnapshot(
    q,
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => { if (onError) onError(err) },
  )
}

/**
 * Human-readable label + badge colour class for a changeType. The
 * Compare Versions UI uses this to render per-version chips.
 */
export function describeChangeType(changeType) {
  switch (changeType) {
    case 'ai_generated':
      return { label: 'AI generated',
        cls: 'bg-slate-100 text-slate-700 border-slate-300' }
    case 'admin_edit':
      return { label: 'Admin edit',
        cls: 'bg-blue-50 text-blue-800 border-blue-300' }
    case 'regenerated':
      return { label: 'Regenerated',
        cls: 'bg-amber-50 text-amber-800 border-amber-300' }
    case 'approved':
      return { label: 'Approved',
        cls: 'bg-emerald-50 text-emerald-800 border-emerald-300' }
    case 'published':
      return { label: 'Published',
        cls: 'bg-emerald-100 text-emerald-900 border-emerald-400' }
    case 'rejected':
      return { label: 'Rejected',
        cls: 'bg-rose-50 text-rose-700 border-rose-300' }
    default:
      return { label: changeType || 'unknown',
        cls: 'bg-slate-100 text-slate-600 border-slate-300' }
  }
}

/**
 * Compute a flat list of `{path, leftValue, rightValue}` triples for
 * the differing leaf nodes between two content snapshots. Used by the
 * Compare Versions panel to render the diff without pulling in a full
 * diff library.
 *
 * Walks each object recursively to a max depth so a deeply-nested
 * artifact (e.g. Section C structured questions) doesn't blow the
 * stack. Arrays diffed by index — adding/removing an item in the
 * middle of an array still surfaces as a flat list, which is fine
 * for human inspection.
 *
 * @param {object} left   the older snapshot's content
 * @param {object} right  the newer snapshot's content
 * @param {number} [maxDepth=6]
 * @returns {Array<{path: string, leftValue: any, rightValue: any}>}
 */
export function diffContent(left, right, maxDepth = 6) {
  const out = []
  walk(left, right, [], 0, maxDepth, out)
  return out.slice(0, 200)  // cap diff size for the UI
}

function walk(a, b, path, depth, maxDepth, out) {
  if (depth > maxDepth) {
    if (!cheapEqual(a, b)) {
      out.push({ path: path.join('.') || '<root>', leftValue: '…', rightValue: '…' })
    }
    return
  }
  if (a === b) return
  if (a == null || b == null) {
    if (a !== b) {
      out.push({ path: path.join('.') || '<root>', leftValue: a, rightValue: b })
    }
    return
  }
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) {
    out.push({ path: path.join('.') || '<root>', leftValue: a, rightValue: b })
    return
  }
  if (Array.isArray(a)) {
    const max = Math.max(a.length, b.length)
    for (let i = 0; i < max; i++) {
      walk(a[i], b[i], [...path, `[${i}]`], depth + 1, maxDepth, out)
    }
    return
  }
  if (typeof a === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      walk(a[k], b[k], [...path, k], depth + 1, maxDepth, out)
    }
    return
  }
  if (a !== b) {
    out.push({ path: path.join('.') || '<root>', leftValue: a, rightValue: b })
  }
}

function cheapEqual(a, b) {
  if (a === b) return true
  try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
}

/**
 * Format a snapshot's content as a pretty-printed JSON string for the
 * side-by-side view. Truncates extremely long values so the panel
 * stays usable on a phone.
 */
export function prettyJson(value, maxLen = 8000) {
  try {
    const s = JSON.stringify(value, null, 2)
    return s.length > maxLen ? s.slice(0, maxLen) + '\n… (truncated)' : s
  } catch {
    return String(value)
  }
}
