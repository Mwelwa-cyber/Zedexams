/**
 * learnerCalendar — the MoE school calendar as a LEARNER reads it.
 *
 * This is the learner-side twin of `calendarResolver.js` (the teacher seam),
 * and it exists for the same reason that one does: so every surface asking
 * "what term is it?" asks ONE thing, and a calendar change is reflected
 * everywhere with no stored dates to migrate.
 *
 * IT OPENS NO DOOR BETWEEN THE TEACHER AND LEARNER SIDES. The national MoE
 * calendar is a published fact, not teacher data — it already sits below both
 * features in `./moeCalendar.js`, which the teacher's School Calendar page and
 * the learner dashboard both import today. Two features reading one module
 * beneath them is the allowed direction of the layering
 * (`app → features → engines/curriculum → shared/services/config`); reaching
 * INTO `features/teacherHome` from a learner screen is not, and nothing here
 * does it. The teacher's calendar PAGE is teacher chrome and stays where it is.
 *
 * ── The distinction the whole module turns on ────────────────────────────────
 *
 * Two questions have different right answers between terms, and conflating them
 * is the bug this was written for:
 *
 *   • WHICH TERM'S MATERIAL do I show?  The one that just closed — that is what
 *     the learner has been taught and can revise. (`recent` → resolveActiveTerm)
 *   • WHAT DO I SAY ON SCREEN?          That school is closed and when it opens.
 *     Printing a bare "Term 2" during the August holiday is only half true, and
 *     printing "Term 1" — which is what happened before the calendar was
 *     consulted at all — is not true at any point in the year after 10 April.
 *
 * So `resolveLearnerCalendar()` returns BOTH: `recent`, the reading the term
 * chain consumes, and the display fields (`phase`, `chipLabel`, `statusLine`).
 * One read of the calendar, two consumers, no chance of them disagreeing.
 *
 * Pure by contract: no React, no Firebase, no browser globals, so it runs under
 * plain `node`. Run tests: npm run test:learner-calendar
 */

import {
  MOE_CALENDAR,
  getActiveTerm,
  getNextTerm,
  getMostRecentTerm,
  getTermStatus,
  getCurrentForecastWeek,
  getTotalTeachingWeeks,
  getCalendarYears,
  fmtDate,
} from './moeCalendar.js'

// ── local date helpers (mirroring moeCalendar's own, deliberately) ───────────

function midnight(dateLike) {
  const d = dateLike instanceof Date ? new Date(dateLike) : new Date()
  if (Number.isNaN(d.getTime())) {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    return now
  }
  d.setHours(0, 0, 0, 0)
  return d
}

function parseISO(iso) {
  const d = new Date(`${iso}T00:00:00`)
  d.setHours(0, 0, 0, 0)
  return d
}

function toISO(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Whole CALENDAR days between two dates — counted as civil days, not as
 * elapsed milliseconds.
 *
 * `moeCalendar.daysUntil` divides a millisecond difference by 86,400,000, and
 * two local midnights either side of a daylight-saving change are not a whole
 * number of those apart. On a device set to a DST timezone that rounds a
 * countdown UP by one: from 1 Nov 2026 in America/New_York the old maths said
 * Third Term closes in 34 days when the answer is 33. Zambia keeps CAT all
 * year, so this never fires at home — but the countdown belongs to the device
 * clock, not to the school, and a learner abroad reads the same screen.
 *
 * Comparing UTC ordinals of the local Y/M/D removes the offset from both
 * sides, so only the date parts are ever subtracted.
 */
function civilDaysBetween(from, to) {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / 86400000)
}

/** Civil days from `from` to an ISO date string. Negative when it has passed. */
function daysToISO(iso, from) {
  return civilDaysBetween(from, parseISO(iso))
}

function addDaysISO(iso, n) {
  const d = parseISO(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

/**
 * "in 18 days" / "tomorrow" / "today" — the phrase a learner reads, never a
 * bare number of days. Negative never renders: a date in the past is not
 * something to count down to, and saying "in -3 days" is how a stale countdown
 * announces itself instead of disappearing.
 */
export function whenPhrase(days) {
  const n = Number(days)
  if (!Number.isFinite(n) || n < 0) return ''
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  return `in ${n} days`
}

/** "30 days" / "1 day" — a duration, not a countdown. */
export function dayCountPhrase(days) {
  const n = Math.max(0, Number(days) || 0)
  return n === 1 ? '1 day' : `${n} days`
}

// ── the one read ─────────────────────────────────────────────────────────────

/** The shape returned when the calendar cannot answer for this date. */
function unresolved(reason, today) {
  return {
    status: 'out_of_range',
    reason,
    today,
    phase: 'unknown',
    recent: null,
    isSchoolOpen: false,
    year: null,
    termNumber: null,
    termName: '',
    termId: '',
    termOpen: null,
    termClose: null,
    termOpenLabel: '',
    termCloseLabel: '',
    weekNumber: null,
    totalWeeks: 0,
    weeksLeft: 0,
    daysUntilClose: null,
    nextTerm: null,
    chipLabel: '',
    shortLabel: '',
    statusLine: '',
  }
}

/**
 * Resolve today's (or any date's) school-calendar picture for a learner.
 *
 * `status` is 'ok' or 'out_of_range'. 'out_of_range' means the date is past the
 * end of the calendar data (2030) or before it with nothing to name — an honest
 * blank rather than a guessed term. Callers branch on it; every field is
 * present and null-ish either way, so destructuring never throws.
 *
 * `phase`:
 *   'in-term'           — school is open; weekNumber/totalWeeks are populated.
 *   'holiday'           — between terms; `recent` names the term that closed and
 *                         `nextTerm` the one that opens.
 *   'before-first-term' — before the calendar's first term ever opened.
 */
export function resolveLearnerCalendar(date) {
  const today = midnight(date)
  const active = getActiveTerm(today)
  const recent = getMostRecentTerm(today)
  const next = getNextTerm(today)

  if (!active && !next && !recent) return unresolved('no_term_data', today)
  // No term running and none to come. Two different situations, and collapsing
  // them was wrong: INSIDE the last year we hold, the year's shape is still
  // known — Third Term closed on 6 December 2030 and Christmas is still on the
  // calendar — so this is an ordinary holiday whose next opening we cannot
  // name. Only a date PAST that year is genuinely beyond the data, and it is
  // the only one that reports 'out_of_range'; naming a term that closed years
  // ago as current would be the same lie in a different month.
  const years = getCalendarYears()
  const lastCoveredYear = years.length ? years[years.length - 1] : null
  const beyondData = lastCoveredYear == null || today.getFullYear() > lastCoveredYear
  if (!active && !next && beyondData) return unresolved('calendar_exhausted', today)

  const nextTerm = next
    ? {
        year: next.year,
        termNumber: next.term.number,
        termName: next.term.name,
        termId: next.term.id,
        open: next.term.open,
        openLabel: fmtDate(next.term.open, 'full'),
        openShort: fmtDate(next.term.open, 'short'),
        daysUntilOpen: daysToISO(next.term.open, today),
      }
    : null

  if (active) {
    const forecast = getCurrentForecastWeek(today)
    const totalWeeks = getTotalTeachingWeeks(active.term)
    const weekNumber = forecast ? forecast.weekNumber : null
    const daysUntilClose = daysToISO(active.term.close, today)
    return {
      status: 'ok',
      reason: null,
      today,
      phase: 'in-term',
      recent,
      isSchoolOpen: true,
      year: active.year,
      termNumber: active.term.number,
      termName: active.term.name,
      termId: active.term.id,
      termOpen: active.term.open,
      termClose: active.term.close,
      termOpenLabel: fmtDate(active.term.open, 'full'),
      termCloseLabel: fmtDate(active.term.close, 'full'),
      weekNumber,
      totalWeeks,
      weeksLeft: weekNumber != null ? Math.max(0, totalWeeks - weekNumber) : totalWeeks,
      daysUntilClose,
      nextTerm,
      chipLabel: weekNumber ? `Term ${active.term.number} · Week ${weekNumber}` : `Term ${active.term.number}`,
      shortLabel: `Term ${active.term.number}`,
      statusLine: weekNumber
        ? `Week ${weekNumber} of ${totalWeeks} — ${active.term.name} ends ${fmtDate(active.term.close, 'full')}.`
        : `${active.term.name} ends ${fmtDate(active.term.close, 'full')}.`,
    }
  }

  // School is closed. Two closed states, and they read differently: a holiday
  // has a term behind it to revise, the run-up to the very first term does not.
  const closedPhase = recent ? 'holiday' : 'before-first-term'
  const named = recent || null
  const opensPhrase = nextTerm ? whenPhrase(nextTerm.daysUntilOpen) : ''

  return {
    status: 'ok',
    reason: null,
    today,
    phase: closedPhase,
    recent,
    isSchoolOpen: false,
    year: named ? named.year : nextTerm?.year ?? null,
    termNumber: named ? named.term.number : null,
    termName: named ? named.term.name : '',
    termId: named ? named.term.id : '',
    termOpen: named ? named.term.open : null,
    termClose: named ? named.term.close : null,
    termOpenLabel: named ? fmtDate(named.term.open, 'full') : '',
    termCloseLabel: named ? fmtDate(named.term.close, 'full') : '',
    weekNumber: null,
    totalWeeks: named ? getTotalTeachingWeeks(named.term) : 0,
    weeksLeft: 0,
    daysUntilClose: null,
    nextTerm,
    chipLabel: nextTerm
      ? `Holiday · Term ${nextTerm.termNumber} ${opensPhrase}`
      : 'Holiday',
    // The compact form for lines that are already carrying a grade and a
    // school name. It leads with the term whose work the app is showing and
    // says the school is shut — the same two facts as the long form, in the
    // order a crowded line can afford.
    shortLabel: named
      ? `Term ${named.term.number} · holiday`
      : nextTerm ? `Term ${nextTerm.termNumber} soon` : 'Holiday',
    statusLine: nextTerm
      ? (closedPhase === 'holiday'
          ? `School is closed. ${nextTerm.termName} opens ${opensPhrase} — ${nextTerm.openLabel}.`
          : `${nextTerm.termName} opens ${opensPhrase} — ${nextTerm.openLabel}.`)
      : 'School is closed.',
  }
}

/**
 * The full term label — "Term 2 · Week 5" while school is open, "Holiday ·
 * Term 3 in 18 days" while it is closed. Used where the term IS the message:
 * the Home chip and the calendar screen.
 *
 * `fallbackTerm` is the term the app is actually SCOPED to (the resolved
 * `activeTerm`), and it is used only when the calendar cannot answer at all —
 * a date beyond 2030, or before the calendar's first term. Naming the scoped
 * term is still true then; inventing a phase would not be.
 */
export function termLabel(view, fallbackTerm) {
  return pickLabel(view, fallbackTerm, 'chipLabel')
}

/**
 * The compact twin — "Term 2" open, "Term 2 · holiday" closed — for lines that
 * already carry a grade and a school name. Same two facts, less room.
 */
export function termLabelShort(view, fallbackTerm) {
  return pickLabel(view, fallbackTerm, 'shortLabel')
}

function pickLabel(view, fallbackTerm, field) {
  if (view && view.status === 'ok' && view[field]) return view[field]
  const t = Number(fallbackTerm)
  return Number.isInteger(t) && t >= 1 && t <= 3 ? `Term ${t}` : ''
}

/**
 * The Grade · Term chip's text. Grade comes from the learner's profile, the
 * rest from the calendar; a grade with no resolvable calendar still prints the
 * grade rather than an empty chip.
 */
export function gradeTermChip(grade, view, fallbackTerm) {
  const parts = []
  if (grade != null && String(grade).trim()) parts.push(`🎓 Grade ${grade}`)
  const label = termLabel(view, fallbackTerm)
  if (label) parts.push(label)
  return parts.join('  ·  ')
}

// ── the calendar screen's model ──────────────────────────────────────────────

/** Every year the calendar holds data for, ascending. */
export function learnerCalendarYears() {
  return getCalendarYears()
}

/** The year to open the calendar screen on: today's, else the nearest we hold. */
export function defaultCalendarYear(date) {
  const today = midnight(date)
  const years = getCalendarYears()
  if (!years.length) return null
  const y = today.getFullYear()
  if (years.includes(y)) return y
  return y < years[0] ? years[0] : years[years.length - 1]
}

/**
 * One holiday gap, as a learner sees it: the day after school closes to the
 * day before it opens again. Returns null when there is no gap to describe.
 *
 * `prevTerm` or `nextTermRow` may be absent at the edges of the data — the run
 * up to the first term we hold, and the run out from the last one — so the
 * caller passes explicit `start`/`end` bounds for those. A gap with a term on
 * neither side would be the whole year and is refused.
 */
function gapRow({ prevTerm, nextTermRow, start, end, today, idHint }) {
  if (!prevTerm && !nextTermRow) return null
  if (parseISO(start) > parseISO(end)) return null
  const days = civilDaysBetween(parseISO(start), parseISO(end)) + 1
  const isNow = today >= parseISO(start) && today <= parseISO(end)
  // A break inside one year prints its year once, on the end date. The full
  // form wrapped onto a second line on a phone and pushed the "Now" badge
  // off centre; the year was the only word doing no work.
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  return {
    kind: 'break',
    id: `${idHint}-break`,
    label: prevTerm ? `Holiday after ${prevTerm.name}` : `Holiday before ${nextTermRow.name}`,
    start,
    end,
    startLabel: fmtDate(start, sameYear ? 'day' : 'short'),
    endLabel: fmtDate(end, 'short'),
    days,
    daysPhrase: dayCountPhrase(days),
    isNow,
    daysUntilOver: isNow && nextTermRow ? daysToISO(nextTermRow.open, today) : null,
    holidays: [],
  }
}

/** The display shape for one public holiday on the calendar screen. */
function holidayRow(h, today) {
  return {
    ...h,
    label: fmtDate(h.date, 'short'),
    dayLabel: fmtDate(h.date, 'day'),
    daysAway: daysToISO(h.date, today),
    isToday: h.date === toISO(today),
    isPast: parseISO(h.date) < today,
  }
}

/**
 * The calendar screen's model for one year: each term with its status, dates
 * and week progress, interleaved with the holiday breaks between them, and
 * every public holiday sitting under the row whose dates actually contain it.
 *
 * Two things here are corrections rather than choices:
 *
 *  • **The rows TILE the year.** Term, break, term, break, term, plus the runs
 *    at either end — the December holiday crossing into January, and the run
 *    in from 1 January where we hold no previous year. Every day of the year
 *    falls in exactly one row, which is what lets a holiday be placed by its
 *    date rather than by which term's record happens to carry it.
 *  • **A holiday is placed by its DATE.** `MOE_CALENDAR` files each one under a
 *    term, and several of them fall outside that term: 2026's First Term record
 *    carries Kenneth Kaunda Day (28 Apr) and Labour Day (1 May), which land 18
 *    and 21 days after it closed, and Third Term carries Christmas. Rendering
 *    the record's grouping put those inside the term card, ABOVE the break row
 *    they actually fall in — a calendar out of chronological order.
 *
 * Progress is only ever reported for the term that is actually running. A past
 * term is 100% by definition and an upcoming one is 0%, so drawing a bar on
 * either is decoration that reads like a measurement.
 */
export function buildLearnerCalendarYear(year, date) {
  const today = midnight(date)
  const terms = MOE_CALENDAR[year]?.terms ?? []
  if (!terms.length) return { year, exists: false, terms: [], rows: [], holidays: [] }

  const termRows = terms.map((t) => {
    const status = getTermStatus(t, today)
    const totalWeeks = getTotalTeachingWeeks(t)
    const forecast = status === 'active' ? getCurrentForecastWeek(today) : null
    const weekNumber = forecast && forecast.termNumber === t.number ? forecast.weekNumber : null
    return {
      kind: 'term',
      id: t.id,
      number: t.number,
      name: t.name,
      open: t.open,
      close: t.close,
      openLabel: fmtDate(t.open, 'short'),
      closeLabel: fmtDate(t.close, 'short'),
      openFull: fmtDate(t.open, 'full'),
      closeFull: fmtDate(t.close, 'full'),
      status,
      totalWeeks,
      weekNumber,
      percent: status === 'active' && weekNumber ? Math.min(100, Math.round((weekNumber / totalWeeks) * 100)) : null,
      daysUntilOpen: status === 'upcoming' ? daysToISO(t.open, today) : null,
      daysUntilClose: status === 'active' ? daysToISO(t.close, today) : null,
      midBreak: t.eceMidStart && t.eceMidEnd
        ? {
            start: t.eceMidStart,
            end: t.eceMidEnd,
            label: `${fmtDate(t.eceMidStart, 'day')} – ${fmtDate(t.eceMidEnd, 'day')}`,
          }
        : null,
      holidays: [],
    }
  })

  const first = terms[0]
  const last = terms[terms.length - 1]
  const prevYearLast = MOE_CALENDAR[year - 1]?.terms?.slice(-1)[0] ?? null
  const nextYearFirst = MOE_CALENDAR[year + 1]?.terms?.[0] ?? null

  const rows = []
  // The run in to the first term. When we hold the previous year it is that
  // year's December break, shown again at the head of this one — it is the
  // same holiday and a learner reading January wants to see when it ends.
  const leading = gapRow({
    prevTerm: prevYearLast,
    nextTermRow: first,
    start: prevYearLast ? addDaysISO(prevYearLast.close, 1) : `${year}-01-01`,
    end: addDaysISO(first.open, -1),
    today,
    idHint: prevYearLast ? prevYearLast.id : `${year}-start`,
  })
  if (leading) rows.push(leading)

  termRows.forEach((row, i) => {
    rows.push(row)
    const next = terms[i + 1]
    if (!next) return
    const gap = gapRow({
      prevTerm: terms[i],
      nextTermRow: next,
      start: addDaysISO(terms[i].close, 1),
      end: addDaysISO(next.open, -1),
      today,
      idHint: terms[i].id,
    })
    if (gap) rows.push(gap)
  })

  // The run out from the last term — the December holiday, the longest of the
  // lot. Stopping at Third Term's close would leave a learner looking at the
  // calendar in December with nothing after it, and would strand Christmas.
  const trailing = gapRow({
    prevTerm: last,
    nextTermRow: nextYearFirst,
    start: addDaysISO(last.close, 1),
    end: nextYearFirst ? addDaysISO(nextYearFirst.open, -1) : `${year}-12-31`,
    today,
    idHint: last.id,
  })
  if (trailing) rows.push(trailing)

  // Place every holiday by date. Terms and breaks tile the year, so a holiday
  // inside `year` lands in exactly one row; one carried on a term record but
  // dated in a neighbouring year (none today) simply finds no row here.
  const holidays = terms
    .flatMap((t) => t.holidays || [])
    .filter((h, i, all) => all.findIndex((x) => x.date === h.date) === i)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((h) => holidayRow(h, today))

  for (const h of holidays) {
    const row = rows.find((r) => {
      const from = r.kind === 'term' ? r.open : r.start
      const to = r.kind === 'term' ? r.close : r.end
      return h.date >= from && h.date <= to
    })
    if (row) row.holidays.push(h)
  }

  return { year, exists: true, terms: termRows, rows, holidays }
}

/**
 * The next few public holidays worth naming on the calendar screen, from a
 * date. Kept here rather than read from `getUpcomingHolidays` directly so the
 * screen gets display labels with them.
 */
export function upcomingLearnerHolidays(date, { withinDays = 60, limit = 4 } = {}) {
  const today = midnight(date)
  const out = []
  for (const year of getCalendarYears()) {
    for (const term of MOE_CALENDAR[year].terms) {
      for (const h of term.holidays || []) {
        const away = daysToISO(h.date, today)
        if (away < 0 || away > withinDays) continue
        if (out.some((x) => x.date === h.date)) continue
        out.push({
          ...h,
          daysAway: away,
          label: fmtDate(h.date, 'short'),
          dayLabel: fmtDate(h.date, 'day'),
          whenPhrase: whenPhrase(away),
        })
      }
    }
  }
  return out.sort((a, b) => a.daysAway - b.daysAway).slice(0, limit)
}
