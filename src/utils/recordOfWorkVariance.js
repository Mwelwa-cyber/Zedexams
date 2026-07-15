// Record of Work — variance metadata (Phase 3 slice 4, safe interim).
//
// Optional digital-only detail a teacher can record against a week: the date
// actually taught, the reason for a variance, the follow-up action, and their
// initials. Stored inside the existing output.weeks[] rows (rules-safe: the
// client-created record_of_work doc still carries only inputs|output|library)
// and NEVER exposed in the printed statutory table or the Word export — the
// printed layout is unchanged until the statutory format is signed off.
//
// The statutory status stays the existing `coverage` field; variance never
// introduces a second status source. Legacy records without variance load and
// export unchanged; teachers are never required to backfill.
//
// Run tests: npm run test:record-of-work-variance

const MAX = { reason: 300, followUp: 300, initials: 10 }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Normalize a variance-like object to the stored shape. Trims, caps lengths,
 * and drops an invalid actualDate rather than storing junk. Returns null when
 * nothing meaningful remains — callers then OMIT the field entirely.
 */
export function normalizeVariance(v) {
  if (!v || typeof v !== 'object') return null
  const actualDate = ISO_DATE.test(String(v.actualDate || '').trim()) ? String(v.actualDate).trim() : ''
  const reason = String(v.reason || '').trim().slice(0, MAX.reason)
  const followUp = String(v.followUp || '').trim().slice(0, MAX.followUp)
  const initials = String(v.initials || '').trim().slice(0, MAX.initials)
  if (!actualDate && !reason && !followUp && !initials) return null
  return { actualDate, reason, followUp, initials }
}

/** True when a week row carries any recorded variance detail. */
export function weekHasVariance(w) {
  return normalizeVariance(w?.variance) != null
}

/**
 * Return the week row with one variance field updated — the `variance` key is
 * present only while it holds content, so untouched weeks stay byte-identical
 * to the legacy shape.
 */
export function weekWithVarianceField(week, field, value) {
  const w = week && typeof week === 'object' ? week : {}
  const next = normalizeVariance({ ...(w.variance || {}), [field]: value })
  if (!next) {
    const { variance: _dropped, ...rest } = w
    return rest
  }
  return { ...w, variance: next }
}
