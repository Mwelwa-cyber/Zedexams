/**
 * quotaLedger — how many past papers this learner has opened this week.
 *
 * Device-scoped, in localStorage, keyed by visitor id + ISO week. That is the
 * same shape (and the same trade) as the existing free-preview counter in
 * `utils/pastPaperQuiz.js`: clearing storage resets it and a learner on two
 * phones gets two pools. It is a deliberate v1 choice, not an oversight —
 * a server-side per-open counter costs a write on every paper a learner
 * opens, including the ones they already paid for, and the gate it protects
 * is a soft volume limit rather than a security boundary.
 *
 * The week key is LOCAL, not UTC, and boundaries are Monday 00:00 — because
 * the lock card promises "unlocks on Monday" and the learner checks that
 * against their own calendar. `planState.nextWeeklyReset` computes the same
 * boundary from the other direction; they are tested against each other.
 *
 * Reading is free: a paper the learner has ALREADY opened this week never
 * costs a second slot, so re-reading Tuesday's paper on Thursday is not
 * rationed. That is what makes the cap a limit on breadth rather than a
 * penalty for revising.
 */

import { nextWeeklyReset } from './planState.js'

const STORAGE_KEY = 'zedexams:paperWeek'

function storage() {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * The Monday that starts the week containing `now`, as `YYYY-MM-DD` local.
 * Derived by walking BACK from `nextWeeklyReset` so the two cannot disagree
 * about where a week begins.
 */
export function weekKey(now = new Date()) {
  const nextMonday = nextWeeklyReset(now)
  const thisMonday = new Date(nextMonday.getTime() - 7 * 24 * 60 * 60 * 1000)
  const y = thisMonday.getFullYear()
  const m = String(thisMonday.getMonth() + 1).padStart(2, '0')
  const d = String(thisMonday.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function ledgerKey(visitorId) {
  return `${STORAGE_KEY}:${visitorId || 'anon'}`
}

/**
 * Read the week's ledger: `{ week, paperIds: string[] }`.
 * A ledger from a previous week reads as empty rather than being migrated —
 * last week's opens are spent and there is nothing to carry.
 */
export function readLedger(visitorId, now = new Date()) {
  const week = weekKey(now)
  const ls = storage()
  if (!ls) return { week, paperIds: [] }
  try {
    const raw = ls.getItem(ledgerKey(visitorId))
    if (!raw) return { week, paperIds: [] }
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.week !== week || !Array.isArray(parsed.paperIds)) {
      return { week, paperIds: [] }
    }
    return { week, paperIds: parsed.paperIds.filter((id) => typeof id === 'string') }
  } catch {
    return { week, paperIds: [] }
  }
}

function writeLedger(visitorId, ledger) {
  const ls = storage()
  if (!ls) return
  try { ls.setItem(ledgerKey(visitorId), JSON.stringify(ledger)) } catch { /* private mode */ }
}

/** How many DISTINCT papers have been opened this week. */
export function papersOpenedThisWeek(visitorId, now = new Date()) {
  return readLedger(visitorId, now).paperIds.length
}

export function hasOpenedThisWeek(visitorId, paperId, now = new Date()) {
  if (!paperId) return false
  return readLedger(visitorId, now).paperIds.includes(paperId)
}

/**
 * Record an open. Idempotent per paper per week — re-opening a paper already
 * in the ledger costs nothing and returns the unchanged count.
 *
 * @returns {{ count: number, counted: boolean }}
 */
export function recordPaperOpen(visitorId, paperId, now = new Date()) {
  const ledger = readLedger(visitorId, now)
  if (!paperId || ledger.paperIds.includes(paperId)) {
    return { count: ledger.paperIds.length, counted: false }
  }
  const next = { week: ledger.week, paperIds: [...ledger.paperIds, paperId] }
  writeLedger(visitorId, next)
  return { count: next.paperIds.length, counted: true }
}

/** Test/admin seam — clears this visitor's ledger. */
export function resetLedger(visitorId) {
  const ls = storage()
  if (!ls) return
  try { ls.removeItem(ledgerKey(visitorId)) } catch { /* ignore */ }
}
