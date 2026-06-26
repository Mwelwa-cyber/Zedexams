/**
 * aiCosts — admin-only Firestore reads for the AI cost dashboard
 * (audit B4).
 *
 * All reads are gated by Firestore rules to admin role only — calling
 * these from a non-admin context resolves to permission-denied.
 */

import { collection, doc, getDoc, getDocs, limit as fsLimit, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'

const COLLECTION = 'aiUsage'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function isoDate(d) { return d.toISOString().slice(0, 10) }

// A YYYY-MM-DD daily-rollup doc id. Anything else in aiUsage (e.g. the
// historical `{uid}_{day}` rate-limit counters that used to be written
// here) is not a daily row and must be skipped so it can't surface as a
// bogus bar / chart axis label.
const DATE_ID_RE = /^\d{4}-\d{2}-\d{2}$/

/** Last `days` days of daily rollups, oldest → newest. */
export async function listDailyUsage({ days = 30 } = {}) {
  const since = isoDate(new Date(Date.now() - (days - 1) * ONE_DAY_MS))
  const q = query(
    collection(db, COLLECTION),
    where('__name__', '>=', since),
    orderBy('__name__', 'asc'),
    fsLimit(days + 40),
  )
  const snap = await getDocs(q)
  return snap.docs
    .filter((d) => DATE_ID_RE.test(d.id))
    .map((d) => ({ date: d.id, ...d.data() }))
}

/**
 * Resolve a list of uids to display labels via the users collection.
 * Admin-only reads. Returns a Map<uid, { name, email }>; uids that
 * don't resolve are simply absent (caller falls back to the raw uid).
 */
export async function resolveUserLabels(uids = []) {
  const unique = [...new Set(uids.filter(Boolean))]
  const entries = await Promise.all(unique.map(async (uid) => {
    try {
      const snap = await getDoc(doc(db, 'users', uid))
      if (!snap.exists()) return null
      const d = snap.data() || {}
      return [uid, { name: d.displayName || '', email: d.email || '' }]
    } catch {
      return null
    }
  }))
  return new Map(entries.filter(Boolean))
}

/** Top consumers for a given day (defaults to today). Sorted desc. */
export async function listTopUsersForDate(date, { limit = 20 } = {}) {
  const q = query(
    collection(db, COLLECTION, date, 'users'),
    orderBy('costUsd', 'desc'),
    fsLimit(limit),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/** Per-tool breakdown for a given day. Sorted desc. */
export async function listToolsForDate(date, { limit = 20 } = {}) {
  const q = query(
    collection(db, COLLECTION, date, 'tools'),
    orderBy('costUsd', 'desc'),
    fsLimit(limit),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/** Single-day summary doc (the parent in aiUsage/{date}). */
export async function getDayUsage(date) {
  const snap = await getDoc(doc(db, COLLECTION, date))
  return snap.exists() ? { date: snap.id, ...snap.data() } : null
}

/**
 * Anomaly check — true when today's spend > 2× the median of the
 * previous 7 days (excluding today). Skips the check when there's
 * insufficient history.
 */
export function isAnomalous(today, previousDays) {
  if (!today || !Number.isFinite(today.totalCostUsd)) return false
  const sample = previousDays
    .filter((d) => d.date !== today.date && Number.isFinite(d.totalCostUsd))
    .map((d) => d.totalCostUsd)
    .sort((a, b) => a - b)
  if (sample.length < 4) return false
  const mid = Math.floor(sample.length / 2)
  const median = sample.length % 2
    ? sample[mid]
    : (sample[mid - 1] + sample[mid]) / 2
  if (median <= 0.0001) return false
  return today.totalCostUsd > median * 2
}
