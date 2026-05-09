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

/** Last `days` days of dailyrollups, oldest → newest. */
export async function listDailyUsage({ days = 30 } = {}) {
  const since = isoDate(new Date(Date.now() - (days - 1) * ONE_DAY_MS))
  const q = query(
    collection(db, COLLECTION),
    where('__name__', '>=', since),
    orderBy('__name__', 'asc'),
    fsLimit(days + 5),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ date: d.id, ...d.data() }))
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
