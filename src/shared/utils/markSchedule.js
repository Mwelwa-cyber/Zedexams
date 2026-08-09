/**
 * Mark Schedule maths + comment suggestions — the deterministic core of
 * the Mark Schedule studio. No AI, no network: totals, dense-ranked
 * positions (ties share a place, next distinct total takes the next
 * number) and teacher-voice report comments derived from the entered
 * marks.
 *
 * Kept dependency-free so scripts/test-mark-schedule.mjs can unit-test it
 * with plain node, per repo convention.
 */

/**
 * Display label for the schedule's class, e.g. "Grade 4" or "Form 1".
 *
 * New artifacts carry header.gradeLabel — the human label from the
 * standardized curriculum selector — which is preferred verbatim (it
 * already reads "Form 1" / "Reception"). Old saved schedules only have
 * the wire code in header.grade ('G4'), which historically rendered by
 * stripping a leading 'G' and prefixing "Grade"; that exact fallback is
 * kept so legacy documents render unchanged (including the 'F1' →
 * "Grade F1" quirk this label fixes going forward).
 */
export function scheduleClassLabel(header) {
  const label = String(header?.gradeLabel || '').trim()
  if (label) return label
  return `Grade ${String(header?.grade ?? '').replace(/^G/i, '')}`
}

/** Sum a pupil's marks across the schedule's subjects (missing = 0). */
export function computeTotal(marks, subjects) {
  return subjects.reduce((sum, s) => sum + (Number(marks?.[s.key]) || 0), 0)
}

/** A mark as a whole percentage of its subject maximum. */
export function percentFor(mark, max) {
  const m = Number(max)
  if (!m || m <= 0) return 0
  return Math.round(((Number(mark) || 0) / m) * 100)
}

/** Whole-number average of a pupil's per-subject percentages. */
export function averagePercent(marks, subjects) {
  if (!subjects.length) return 0
  const sum = subjects.reduce((acc, s) => acc + percentFor(marks?.[s.key], s.max), 0)
  return Math.round(sum / subjects.length)
}

/**
 * Rank pupils by total (descending) with dense ranking — the convention
 * on school schedules: equal totals share a position, and the next
 * distinct total takes the next position number (104, 104 → 3, 3 then
 * 100 → 4).
 *
 * Returns NEW pupil objects ({ ...pupil, total, position }) sorted by
 * position; input order and objects are untouched.
 */
export function rankPupils(pupils, subjects) {
  const withTotals = pupils.map((p) => ({ ...p, total: computeTotal(p.marks, subjects) }))
  withTotals.sort((a, b) => b.total - a.total)
  let position = 0
  let prevTotal = null
  return withTotals.map((p) => {
    if (p.total !== prevTotal) {
      position += 1
      prevTotal = p.total
    }
    return { ...p, position }
  })
}

/** The subject (object) where the pupil scored the lowest percentage. */
export function weakestSubject(marks, subjects) {
  let weakest = null
  let weakestPct = Infinity
  for (const s of subjects) {
    const p = percentFor(marks?.[s.key], s.max)
    if (p < weakestPct) { weakestPct = p; weakest = s }
  }
  return weakest
}

// Comment bank — written the way Zambian teachers write on schedules and
// report books: short, warm, direct, pupil addressed by first name.
// Several variants per band so a whole class doesn't read identically;
// picked deterministically from the pupil's name so re-renders are stable.
const FIRST = (name) => String(name || '').trim().split(/\s+/)[0] || 'this pupil'
const pick = (list, seedText) => {
  let seed = 0
  const s = String(seedText || '')
  for (let i = 0; i < s.length; i += 1) seed = (seed + s.charCodeAt(i)) % 997
  return list[seed % list.length]
}

const BAND_TEMPLATES = {
  top: [
    (n) => `Excellent results! Keep it up, ${n}.`,
    (n) => `Excellent work, ${n}. Well done — maintain the standard.`,
  ],
  upper: [
    (n) => `Very good work. Aim for number one next term, ${n}.`,
    (n) => `Very good performance. Keep working hard, ${n}.`,
  ],
  middle: [
    (n, subj) => subj
      ? `Good work, but put more effort in ${subj}, ${n}.`
      : `Good work, ${n}. Keep it up.`,
    (n, subj) => subj
      ? `Good effort. With more practice in ${subj} you will do even better.`
      : `Good effort, ${n}. Aim higher next term.`,
  ],
  lower: [
    (n, subj) => subj
      ? `A fair result. Pull up your socks in ${subj}, ${n}.`
      : `A fair result. Pull up your socks, ${n}.`,
    (n, subj) => subj
      ? `Fair work. More effort is needed in ${subj}.`
      : `Fair work, ${n}. More effort is needed next term.`,
  ],
  bottom: [
    (n) => `Work extra hard next term, ${n}. Please see me for remedial lessons.`,
    (n) => `Below average. Do not give up, ${n} — keep practising every day.`,
  ],
}

/** Which comment band a position falls in, given the number of distinct positions. */
export function bandFor(position, lastPosition) {
  if (position === 1) return 'top'
  if (lastPosition <= 3) return position === lastPosition ? 'bottom' : 'upper'
  const fraction = (position - 1) / (lastPosition - 1)
  if (fraction <= 0.25) return 'upper'
  if (fraction <= 0.55) return 'middle'
  if (fraction <= 0.85) return 'lower'
  return 'bottom'
}

/**
 * Teacher-voice comment for a ranked pupil. Deterministic for a given
 * name + position so the schedule doesn't reshuffle wording on every
 * keystroke.
 */
export function suggestComment(pupil, subjects, lastPosition) {
  const band = bandFor(pupil.position, lastPosition)
  const name = FIRST(pupil.name)
  const weakest = (band === 'middle' || band === 'lower') ? weakestSubject(pupil.marks, subjects) : null
  const subjectLabel = weakest ? titleCase(weakest.label) : null
  const template = pick(BAND_TEMPLATES[band], `${pupil.name}|${pupil.position}`)
  return template(name, subjectLabel)
}

function titleCase(label) {
  const s = String(label || '').trim()
  // Schedule headers are CAPS (MATHS, SOCIAL STUDIES) — comments read as
  // prose, so bring them down to title case but keep short acronyms.
  if (s.length <= 5 && s === s.toUpperCase() && s.includes('.')) return s // e.g. C.T.S
  return s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())
}

/**
 * One call for the studio: pupils in, fully ranked rows out — total,
 * position and a suggested comment on every pupil (existing non-empty
 * pupil.comment values are kept; they're the teacher's own words).
 */
export function buildSchedule(pupils, subjects) {
  const ranked = rankPupils(pupils, subjects)
  const lastPosition = ranked.length ? ranked[ranked.length - 1].position : 0
  return ranked.map((p) => ({
    ...p,
    comment: p.comment?.trim() ? p.comment : suggestComment(p, subjects, lastPosition),
  }))
}

/**
 * Per-pupil report cards from a completed schedule artifact (the
 * destination the schedule's comments were always headed for — the
 * comments sheet exists because cards, not the A4 schedule, carry
 * them home). One card per pupil: every subject's mark, out-of and
 * percentage, the total, average % and class position, plus the class
 * teacher's comment. Pure data — reportCardsToDocx.js does the layout.
 */
export function buildReportCards(schedule) {
  const subjects = schedule?.subjects || []
  const pupils = schedule?.pupils || []
  const classSize = pupils.length
  const maxTotal = subjects.reduce((sum, s) => sum + (Number(s.max) || 0), 0)
  return pupils.map((p) => ({
    sn: p.sn,
    name: p.name || '',
    position: p.position,
    classSize,
    rows: subjects.map((s) => {
      const mark = p.marks?.[s.key]
      return {
        subject: s.label,
        mark: mark == null || mark === '' ? '' : Number(mark),
        max: Number(s.max) || 0,
        percent: percentFor(mark, s.max),
      }
    }),
    total: p.total,
    maxTotal,
    averagePercent: averagePercent(p.marks, subjects),
    comment: p.comment || '',
  }))
}
