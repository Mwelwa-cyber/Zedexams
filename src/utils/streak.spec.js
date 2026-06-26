import { describe, expect, it } from 'vitest'
import { computeStreak } from './streak'

// Build a Date at local noon N days before today, so day-bucketing is stable
// regardless of the time the test runs (noon keeps us clear of DST edges).
function daysAgo(n) {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - n)
  return d
}

describe('computeStreak', () => {
  it('returns 0 for empty / non-array input', () => {
    expect(computeStreak([])).toBe(0)
    expect(computeStreak(null)).toBe(0)
    expect(computeStreak(undefined)).toBe(0)
  })

  it('counts a single entry today as a 1-day streak', () => {
    expect(computeStreak([daysAgo(0)])).toBe(1)
  })

  it('counts consecutive days back from today', () => {
    expect(computeStreak([daysAgo(0), daysAgo(1), daysAgo(2)])).toBe(3)
  })

  it('anchors on yesterday as a grace window when there is no entry today', () => {
    expect(computeStreak([daysAgo(1), daysAgo(2)])).toBe(2)
  })

  it('stops at the first gap', () => {
    // today + a 3-days-ago entry, but yesterday and 2-days-ago are missing.
    expect(computeStreak([daysAgo(0), daysAgo(3)])).toBe(1)
  })

  it('treats a streak older than the grace window as broken (0)', () => {
    expect(computeStreak([daysAgo(2), daysAgo(3)])).toBe(0)
  })

  it('dedupes multiple entries on the same calendar day', () => {
    const morning = daysAgo(0)
    const evening = new Date(morning)
    evening.setHours(23, 0, 0, 0)
    expect(computeStreak([morning, evening, daysAgo(1)])).toBe(2)
  })

  it('accepts mixed timestamp formats (Date, ISO string, unix-ms, Firestore Timestamp)', () => {
    const tsLike = (date) => ({ toDate: () => date })
    const mixed = [
      daysAgo(0), // Date
      daysAgo(1).toISOString(), // ISO string
      daysAgo(2).getTime(), // unix-ms
      tsLike(daysAgo(3)), // Firestore Timestamp-like
    ]
    expect(computeStreak(mixed)).toBe(4)
  })

  it('ignores unparseable entries without throwing', () => {
    expect(computeStreak(['not-a-date', null, daysAgo(0)])).toBe(1)
    expect(computeStreak(['garbage', undefined])).toBe(0)
  })
})
