/**
 * attendanceInsights — the patterns a term's attendance shows, stated as
 * observations.
 *
 * Pure module (no React / Firebase / DOM); node suite covers it directly.
 *
 * THE LINE THIS MODULE DOES NOT CROSS (§16): it describes what the register
 * records and stops. "Absent for three consecutive teaching days" is a fact
 * about the register. "Truant", "unwell", "at risk of dropping out" are
 * medical, disciplinary and legal conclusions that this data cannot support,
 * and a platform that prints them puts words in a teacher's mouth that a
 * parent will hold them to. Every message here is a sentence a teacher could
 * verify by looking at the grid.
 *
 * Insights are ordered by how many teaching days they concern, so the learner
 * a teacher should ask about first is first.
 */

import { ATTENDANCE_STATUSES } from '../../../utils/attendanceConstants.js'
import { computeLearnerTotals, formatPercent } from '../../../utils/attendanceCalculator.js'
import { formatDateLong, weekdayOf } from '../../../utils/attendanceCalendarResolver.js'

export const INSIGHT_KINDS = [
  'consecutive_absence',
  'weekday_pattern',
  'attendance_drop',
  'below_threshold',
  'unmarked_days',
  'perfect_attendance',
]

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * A learner's marks over the term's teaching days, oldest first.
 *
 * Reads `day.records`, the same shape the attendance calculator reads and the
 * same object `useClassRegister` hands out — one representation of a marked
 * day rather than a second one that can disagree with it.
 */
function timeline(learner, days) {
  const out = []
  for (const day of days) {
    if (!day?.markable || day.isFuture) continue
    const status = day.records?.[learner.id]?.status || null
    // A day the learner was not enrolled for is not part of their story.
    if (status === 'not_applicable') continue
    if (learner.joinedClassOn && day.date < learner.joinedClassOn) continue
    if (learner.leftClassOn && day.date > learner.leftClassOn) continue
    out.push({ date: day.date, status, day })
  }
  return out
}

function isAbsenceLike(status) {
  return Boolean(status) && ATTENDANCE_STATUSES[status]?.countsAsAbsence
}

// ── individual patterns ──────────────────────────────────────────

/**
 * The longest run of consecutive TEACHING DAYS a learner was absent, and
 * whether it is still running.
 *
 * Consecutive means consecutive on the school calendar, not on the wall
 * calendar: a Friday and the following Monday are consecutive teaching days,
 * and counting the weekend between them as a break would hide exactly the
 * pattern this is looking for.
 */
export function longestAbsenceRun(entries) {
  let best = { length: 0, from: null, to: null, ongoing: false }
  let run = 0
  let start = null
  entries.forEach((entry, i) => {
    if (isAbsenceLike(entry.status)) {
      if (run === 0) start = entry.date
      run += 1
      if (run > best.length) {
        best = { length: run, from: start, to: entry.date, ongoing: i === entries.length - 1 }
      }
    } else if (entry.status) {
      run = 0
      start = null
    }
    // An UNMARKED day breaks nothing and starts nothing — we do not know what
    // happened, and treating a gap in the paperwork as attendance or as
    // absence would both be inventions.
  })
  return best
}

/**
 * A weekday the learner misses far more than the others.
 *
 * Requires at least three misses on that weekday AND that they are most of the
 * learner's absences AND at least half of that weekday's occasions — three
 * Mondays missed out of twelve is not a Monday pattern, it is three absences.
 */
export function weekdayPattern(entries) {
  const missedBy = new Map()
  const totalBy = new Map()
  for (const entry of entries) {
    const wd = weekdayOf(entry.date)
    totalBy.set(wd, (totalBy.get(wd) || 0) + 1)
    if (isAbsenceLike(entry.status)) missedBy.set(wd, (missedBy.get(wd) || 0) + 1)
  }
  const totalMissed = [...missedBy.values()].reduce((a, b) => a + b, 0)
  if (totalMissed < 3) return null
  let best = null
  for (const [wd, missed] of missedBy) {
    const occasions = totalBy.get(wd) || 0
    if (missed < 3 || occasions === 0) continue
    const shareOfAbsences = missed / totalMissed
    const shareOfThatDay = missed / occasions
    if (shareOfAbsences >= 0.6 && shareOfThatDay >= 0.5) {
      if (!best || missed > best.missed) {
        best = { weekday: wd, weekdayName: WEEKDAY_NAMES[wd], missed, occasions }
      }
    }
  }
  return best
}

/**
 * A fall in attendance between the first and second half of the term.
 *
 * Both halves need enough days to mean anything (five each), and the fall has
 * to be at least fifteen points — smaller than that is the ordinary
 * week-to-week variation of a child with a cold.
 */
export function attendanceDrop(entries, { attendedSet }) {
  const marked = entries.filter((e) => e.status)
  if (marked.length < 10) return null
  const mid = Math.floor(marked.length / 2)
  const rate = (slice) => {
    if (!slice.length) return null
    const attended = slice.filter((e) => attendedSet.has(e.status)).length
    return (attended / slice.length) * 100
  }
  const first = rate(marked.slice(0, mid))
  const second = rate(marked.slice(mid))
  if (first == null || second == null) return null
  const delta = first - second
  if (delta < 15) return null
  return { from: Math.round(first), to: Math.round(second), delta: Math.round(delta) }
}

// ── the class-level pass ─────────────────────────────────────────

/**
 * Every insight for one class + term.
 *
 * @param {object} args
 * @param {Array}  args.learners  the class list
 * @param {Array}  args.days      term days WITH records attached (day.records),
 *                                as produced by useClassRegister
 * @param {object} args.policy    resolved attendance policy (attendedSet, threshold)
 * @param {object} args.term      { startDate, endDate }
 * @returns {Array} insights, most days-affected first
 */
export function buildAttendanceInsights({ learners, days, policy, term }) {
  const roster = Array.isArray(learners) ? learners : []
  const termDays = Array.isArray(days) ? days : []
  const insights = []
  const threshold = Number(policy?.warningThresholdPercent) || 80

  for (const learner of roster) {
    const entries = timeline(learner, termDays)
    if (!entries.length) continue

    const run = longestAbsenceRun(entries)
    if (run.length >= 3) {
      insights.push({
        kind: 'consecutive_absence',
        learnerId: learner.id,
        learnerName: learner.fullName,
        weight: run.length * 10,
        headline: `${learner.fullName} has been absent for ${run.length} consecutive teaching days.`,
        detail: `${formatDateLong(run.from)} to ${formatDateLong(run.to)}${run.ongoing ? ', up to the latest marked day' : ''}.`,
        days: run.length,
      })
    }

    const pattern = weekdayPattern(entries)
    if (pattern) {
      insights.push({
        kind: 'weekday_pattern',
        learnerId: learner.id,
        learnerName: learner.fullName,
        weight: pattern.missed * 6,
        headline: `${learner.fullName} has missed ${pattern.missed} of ${pattern.occasions} ${pattern.weekdayName}s this term.`,
        detail: 'Most of this learner’s absences fall on this weekday.',
        days: pattern.missed,
      })
    }

    const drop = attendanceDrop(entries, { attendedSet: policy?.attendedSet || new Set(['present', 'late']) })
    if (drop) {
      insights.push({
        kind: 'attendance_drop',
        learnerId: learner.id,
        learnerName: learner.fullName,
        weight: drop.delta * 2,
        headline: `${learner.fullName}’s attendance has fallen from ${drop.from}% to ${drop.to}% since the middle of the term.`,
        detail: 'Comparing the first and second halves of the marked days.',
        days: drop.delta,
      })
    }

    const totals = computeLearnerTotals({ learner, days: termDays, term, policy })
    const percent = totals.attendancePercentage
    if (totals.eligibleDays > 0 && percent != null) {
      if (percent < threshold) {
        insights.push({
          kind: 'below_threshold',
          learnerId: learner.id,
          learnerName: learner.fullName,
          weight: (threshold - percent) * 3,
          headline: `${learner.fullName} is at ${formatPercent(percent)} attendance, below the school’s ${threshold}% mark.`,
          detail: `${totals.attendedDays} of ${totals.eligibleDays} possible days.`,
          days: totals.eligibleDays - totals.attendedDays,
        })
      } else if (percent >= 100 && totals.eligibleDays >= 10) {
        insights.push({
          kind: 'perfect_attendance',
          learnerId: learner.id,
          learnerName: learner.fullName,
          weight: 1,
          tone: 'positive',
          headline: `${learner.fullName} has full attendance for all ${totals.eligibleDays} days so far.`,
          detail: '',
          days: 0,
        })
      }
    }
  }

  // One class-level entry for paperwork that is simply not finished, which is
  // the most common thing wrong with a register and is not about any learner.
  const unmarked = termDays.filter((d) => {
    if (!d.markable || d.isFuture) return false
    const dayRecords = d.records || {}
    return roster.some((l) => {
      if (l.joinedClassOn && d.date < l.joinedClassOn) return false
      if (l.leftClassOn && d.date > l.leftClassOn) return false
      return !dayRecords[l.id]?.status
    })
  })
  if (unmarked.length) {
    insights.push({
      kind: 'unmarked_days',
      learnerId: null,
      learnerName: null,
      weight: unmarked.length * 4,
      headline: `${unmarked.length} teaching day${unmarked.length === 1 ? '' : 's'} still ${unmarked.length === 1 ? 'has' : 'have'} unmarked learners.`,
      detail: unmarked.slice(0, 5).map((d) => formatDateLong(d.date)).join(', ')
        + (unmarked.length > 5 ? `, and ${unmarked.length - 5} more` : ''),
      days: unmarked.length,
      dates: unmarked.map((d) => d.date),
    })
  }

  return insights.sort((a, b) => b.weight - a.weight)
}

/**
 * The follow-up actions offered against an insight. Deliberately three, and
 * deliberately none of them a judgement: look at the learner, write down what
 * you did, mark it handled.
 */
export const INSIGHT_ACTIONS = [
  { value: 'review_learner', label: 'Review learner' },
  { value: 'add_note', label: 'Add follow-up note' },
  { value: 'mark_followed_up', label: 'Mark as followed up' },
]
