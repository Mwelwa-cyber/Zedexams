/**
 * src/utils/classTerms.js
 *
 * Term/year period helpers for the Class Register. A class has a "current
 * period" (its term + academic year); every marking record is stamped with the
 * period it was created in, so views can be filtered per term and the class can
 * roll forward without rebuilding the roster. Pure + dependency-free so
 * scripts/test-class-terms.mjs can unit-test it with node.
 */

export const TERMS = ['Term 1', 'Term 2', 'Term 3']

/** Stable string key for a { term, year } period. */
export function periodKey({ term, year } = {}) {
  return `${term || ''}|${year || ''}`
}

export function parsePeriodKey(key) {
  const [term, year] = String(key || '').split('|')
  return { term: term || '', year: year ? Number(year) : null }
}

/** Same term AND same year (year compared numerically). */
export function samePeriod(a, b) {
  return (a?.term || '') === (b?.term || '') && Number(a?.year) === Number(b?.year)
}

/** Human label, e.g. "Term 2 · 2026" (tolerates missing parts). */
export function formatPeriod({ term, year } = {}) {
  if (!term && !year) return 'No term set'
  if (!term) return String(year)
  return year ? `${term} · ${year}` : term
}

/**
 * The next term in sequence — Term 1→2→3, then Term 1 of the following year.
 * An unknown/blank term resets to Term 1 of the current (or given) year.
 */
export function nextPeriod({ term, year } = {}) {
  const i = TERMS.indexOf(term)
  const y = Number(year) || new Date().getFullYear()
  if (i === -1) return { term: 'Term 1', year: y }
  if (i < TERMS.length - 1) return { term: TERMS[i + 1], year: y }
  return { term: TERMS[0], year: y + 1 }
}

/** Distinct { term, year } periods present across records, newest first. */
export function periodsFromRecords(records) {
  const seen = new Map()
  for (const r of records || []) {
    const p = { term: r.term || '', year: Number(r.year) || null }
    const k = periodKey(p)
    if (!seen.has(k)) seen.set(k, p)
  }
  return [...seen.values()].sort(
    (a, b) => (b.year || 0) - (a.year || 0) || TERMS.indexOf(b.term) - TERMS.indexOf(a.term),
  )
}

export function recordMatchesPeriod(record, period) {
  return (record?.term || '') === (period?.term || '') && Number(record?.year) === Number(period?.year)
}

/**
 * Filter records by a selected view:
 *   'all'      → everything
 *   'current'  → the class's current period (`currentPeriod`)
 *   <key>      → a specific period key from periodKey()
 */
export function filterRecordsByPeriod(records, selected, currentPeriod) {
  if (selected === 'all') return records || []
  const period = (!selected || selected === 'current') ? currentPeriod : parsePeriodKey(selected)
  return (records || []).filter((r) => recordMatchesPeriod(r, period))
}
