/**
 * computeStreak — count consecutive days back from today (or yesterday)
 * that have at least one entry.
 *
 * Pass an array of timestamps (Firestore Timestamp objects, Date objects,
 * ISO strings, or unix-ms numbers — any mix). The function:
 *
 * - Buckets each entry by its **local-time** calendar day (so a learner in
 *   Lusaka who attempts at 23:50 and again at 00:30 the next morning gets
 *   credit for two days, which is the intuitive behaviour).
 * - Anchors the streak on either today OR yesterday — yesterday is the
 *   one-day grace window so a learner who hasn't yet practised today
 *   doesn't see "0 day streak" all morning.
 * - Walks backwards day by day and counts consecutive days with at least
 *   one entry. Stops at the first gap.
 *
 * Returns 0 when the input is empty or when the most recent entry is more
 * than one day in the past (broken streak).
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function startOfLocalDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function toDate(value) {
  if (!value) return null
  // Firestore Timestamp has a toDate() method.
  if (typeof value.toDate === 'function') return value.toDate()
  // Already a Date.
  if (value instanceof Date) return value
  // ISO string or unix-ms.
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function computeStreak(timestamps) {
  if (!Array.isArray(timestamps) || timestamps.length === 0) return 0

  const days = new Set()
  for (const t of timestamps) {
    const d = toDate(t)
    if (d) days.add(startOfLocalDay(d))
  }
  if (days.size === 0) return 0

  const today = startOfLocalDay(new Date())
  const yesterday = today - ONE_DAY_MS

  // Anchor: today wins, yesterday is the grace window.
  let cursor = days.has(today)
    ? today
    : days.has(yesterday)
      ? yesterday
      : null
  if (cursor === null) return 0

  let streak = 0
  while (days.has(cursor)) {
    streak++
    cursor -= ONE_DAY_MS
  }
  return streak
}
