// Record of Work — planned-vs-actual comparison states (pure, unit-testable).
//
// Phase 2 of the Record of Work thread: derive a per-week comparison state from
// what the teacher RECORDED (coverage) and where the week sits against the live
// School Calendar. States are computed at render time — never stored on the
// document — and the teacher's recorded coverage always outranks anything
// date-derived (a planned topic alone never marks a week as taught).
//
// Indicators are text + icon, never colour alone (statutory-record review).
//
// Run tests: npm run test:record-of-work-status

/**
 * Where "now" sits relative to a record's term, as a comparable week number:
 *   - the live week number when the record IS the current term + year
 *   - Infinity for a past term/year (every week is due)
 *   - 0 for a future term/year (no week is due yet)
 *   - null when the calendar can't place today (no date-derived states at all)
 *
 * @param {{term:number|string, year:number|string}} header  record header
 * @param {{year:number, termNumber:number, weekNumber:number}|null} forecastWeek
 *        getCurrentForecastWeek() result
 */
export function currentWeekForRecord(header, forecastWeek) {
  if (!forecastWeek || !Number.isInteger(forecastWeek.weekNumber)) return null
  // Blank strings coerce to 0 via Number(''), so require non-empty raw values.
  const rawYear = String(header?.year ?? '').trim()
  const rawTerm = String(header?.term ?? '').trim()
  if (!rawYear || !rawTerm) return null
  const recYear = Number(rawYear)
  const recTerm = Number(rawTerm)
  if (!Number.isFinite(recYear) || !Number.isFinite(recTerm)) return null
  const nowYear = Number(forecastWeek.year)
  const nowTerm = Number(forecastWeek.termNumber)
  if (recYear === nowYear && recTerm === nowTerm) return forecastWeek.weekNumber
  if (recYear < nowYear || (recYear === nowYear && recTerm < nowTerm)) return Infinity
  return 0
}

/**
 * The comparison state for one week row. Recorded coverage wins; date-derived
 * states apply only when nothing is recorded yet.
 *
 *   completed    coverage 'full'    — completed as planned
 *   partial      coverage 'partial' — partially covered, review
 *   not-covered  coverage 'none'    — recorded as not covered
 *   due          no coverage, this is the live week
 *   overdue      no coverage, the week has passed
 *   future       no coverage, the week hasn't arrived
 *   pending      no coverage and no calendar context (never guessed)
 *
 * @param {{week, coverage}} w         record week row
 * @param {number|null} currentWeek    currentWeekForRecord() result
 */
export function weekComparisonStatus(w, currentWeek) {
  const coverage = String(w?.coverage || '').trim()
  if (coverage === 'full') return 'completed'
  if (coverage === 'partial') return 'partial'
  if (coverage === 'none') return 'not-covered'
  const weekNum = Number(w?.week)
  if (currentWeek == null || !Number.isFinite(weekNum)) return 'pending'
  if (weekNum === currentWeek) return 'due'
  if (weekNum < currentWeek) return 'overdue'
  return 'future'
}

/** Text + icon per state (never colour alone). `tone` keys the chip styling. */
export const WEEK_STATUS_META = {
  completed: { icon: '✅', label: 'Completed as planned', tone: 'good' },
  partial: { icon: '🟡', label: 'Partially covered — review', tone: 'warn' },
  'not-covered': { icon: '❗', label: 'Not covered', tone: 'bad' },
  due: { icon: '🔵', label: 'Due this week', tone: 'info' },
  overdue: { icon: '🔴', label: 'Overdue — not recorded', tone: 'bad' },
  future: { icon: '⚪', label: 'Not yet due', tone: 'muted' },
  pending: { icon: '⚪', label: 'Not recorded', tone: 'muted' },
}

/**
 * The week a "Record of Work is behind" deep-link should open: the OLDEST week
 * that is due (or overdue) with nothing recorded yet — not simply today's week,
 * since an earlier unrecorded week is usually the real cause of the behind
 * status. Returns null when nothing is due-and-unrecorded or when there's no
 * calendar context (recorded coverage always outranks date-derived states, so a
 * 'partial'/'none' week is already recorded and never targeted).
 */
export function oldestDueIncompleteWeek(weeks, currentWeek) {
  if (currentWeek == null) return null
  let oldest = null
  for (const w of Array.isArray(weeks) ? weeks : []) {
    const status = weekComparisonStatus(w, currentWeek)
    if (status !== 'due' && status !== 'overdue') continue
    const n = Number(w.week)
    if (oldest == null || n < oldest) oldest = n
  }
  return oldest
}

/**
 * Compact "what needs attention" summary for the studio header:
 * how many past weeks still have nothing recorded, and how many were partial.
 * Returns '' when there's nothing to flag (or no calendar context).
 */
export function recordAttentionSummary(weeks, currentWeek) {
  if (currentWeek == null) return ''
  const list = Array.isArray(weeks) ? weeks : []
  const overdue = list.filter((w) => weekComparisonStatus(w, currentWeek) === 'overdue').length
  const partial = list.filter((w) => weekComparisonStatus(w, currentWeek) === 'partial').length
  const bits = []
  if (overdue > 0) bits.push(`${overdue} past week${overdue === 1 ? '' : 's'} not recorded yet`)
  if (partial > 0) bits.push(`${partial} partially covered`)
  return bits.join(' · ')
}
