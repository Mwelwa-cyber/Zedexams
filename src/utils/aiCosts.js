/**
 * aiCosts — admin-only Firestore reads for the AI cost dashboard
 * (audit B4).
 *
 * All reads are gated by Firestore rules to admin role only — calling
 * these from a non-admin context resolves to permission-denied.
 */

import { collection, doc, getDoc, getDocs, limit as fsLimit, orderBy, query } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db } from '../firebase/config'

const COLLECTION = 'aiUsage'
const callable = httpsCallable(getFunctions(app, 'us-central1'), 'getAiBudgetEnforcementSummary')

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function isoDate(d) { return d.toISOString().slice(0, 10) }

/**
 * Sum an array of shard/legacy docs into one totals object — every numeric
 * field summed, `date`/`tool`/`month` carried through, `updatedAt` dropped.
 * Mirrors functions/shardedCounter.sumShardDocs so client + server aggregate
 * the sharded counters identically. Exported for unit tests.
 */
export function sumUsageDocs(docs, { carry = [] } = {}) {
  const out = {}
  for (const d of docs) {
    if (!d) continue
    for (const [k, v] of Object.entries(d)) {
      if (k === 'updatedAt') continue
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[k] = (out[k] || 0) + v
      } else if (carry.includes(k) && out[k] === undefined && v != null) {
        out[k] = v
      }
    }
  }
  return out
}

/** Group flattened tool-shard docs by `tool`, sum each, sort by cost desc. */
export function groupToolDocs(docs) {
  const byTool = new Map()
  for (const d of docs) {
    if (!d) continue
    const tool = d.tool || d.id || 'unknown'
    if (!byTool.has(tool)) byTool.set(tool, [])
    byTool.get(tool).push(d)
  }
  const rows = []
  for (const [tool, group] of byTool.entries()) {
    rows.push({ id: tool, tool, ...sumUsageDocs(group, { carry: ['tool'] }) })
  }
  return rows.sort((a, b) => (Number(b.costUsd) || 0) - (Number(a.costUsd) || 0))
}

/** Read + merge one date's legacy day doc and its shard subcollection. */
async function readDayUsage(date) {
  const dayRef = doc(db, COLLECTION, date)
  const [legacySnap, shardsSnap] = await Promise.all([
    getDoc(dayRef).catch(() => null),
    getDocs(collection(db, COLLECTION, date, 'shards')).catch(() => null),
  ])
  const docs = []
  if (legacySnap && legacySnap.exists()) docs.push(legacySnap.data())
  if (shardsSnap) shardsSnap.forEach((s) => docs.push(s.data()))
  if (docs.length === 0) return null
  return { ...sumUsageDocs(docs, { carry: ['date'] }), date }
}

/**
 * Last `days` days of daily rollups, oldest → newest. Each day is summed
 * from its legacy parent doc (pre-migration) PLUS its `shards` subcollection
 * (the sharded writer). Dates are enumerated locally because the new writer
 * never touches the shared parent doc. Days with no data are dropped.
 */
export async function listDailyUsage({ days = 30 } = {}) {
  const today = Date.now()
  const dates = []
  for (let i = days - 1; i >= 0; i -= 1) {
    dates.push(isoDate(new Date(today - i * ONE_DAY_MS)))
  }
  const rows = await Promise.all(dates.map((date) => readDayUsage(date)))
  return rows.filter(Boolean)
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

/**
 * Per-tool breakdown for a given day, summed across the flattened tool
 * shards (aiUsage/{date}/toolShards/{tool}__{shard}) plus any legacy
 * per-tool docs (aiUsage/{date}/tools/{tool}). Sorted by cost desc, limited.
 */
export async function listToolsForDate(date, { limit = 20 } = {}) {
  const [legacySnap, shardsSnap] = await Promise.all([
    getDocs(collection(db, COLLECTION, date, 'tools')).catch(() => null),
    getDocs(collection(db, COLLECTION, date, 'toolShards')).catch(() => null),
  ])
  const docs = []
  if (legacySnap) legacySnap.forEach((d) => docs.push({ tool: d.id, ...d.data() }))
  if (shardsSnap) shardsSnap.forEach((d) => docs.push(d.data()))
  return groupToolDocs(docs).slice(0, limit)
}

/** Single-day summary — legacy parent doc + shard subcollection, summed. */
export async function getDayUsage(date) {
  return readDayUsage(date)
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

export async function getBudgetEnforcementSummary(month = null) {
  const payload = month ? { month } : {}
  const res = await callable(payload)
  return res?.data || null
}
