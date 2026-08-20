#!/usr/bin/env node
/**
 * src/utils/learnerCalendar.js — the school calendar as a learner reads it.
 *
 * The bug this module exists for is dated, so the tests are too: on
 * 2026-08-20 the Zambian school year is between Second Term (closed 7 Aug)
 * and Third Term (opens 7 Sep), and the learner dashboard printed "Term 1".
 * Every assertion below is against a REAL date in the MoE calendar rather
 * than a fixture, because the failure was the calendar not being consulted —
 * a fixture calendar would have passed the whole time.
 *
 * Run: npm run test:learner-calendar
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  resolveLearnerCalendar,
  termLabel,
  termLabelShort,
  gradeTermChip,
  buildLearnerCalendarYear,
  learnerCalendarYears,
  defaultCalendarYear,
  upcomingLearnerHolidays,
  whenPhrase,
  dayCountPhrase,
} from '../src/utils/learnerCalendar.js'

const d = (iso) => new Date(`${iso}T09:00:00`)
let ran = 0
function test(name, fn) { fn(); ran += 1; console.log(`  ✓ ${name}`) }

console.log('\nlearnerCalendar')

// ── the reported bug ─────────────────────────────────────────────────────────

test('the August holiday is a holiday, and never Term 1', () => {
  const v = resolveLearnerCalendar(d('2026-08-20'))
  assert.equal(v.status, 'ok')
  assert.equal(v.phase, 'holiday')
  assert.equal(v.isSchoolOpen, false)
  // The term NAMED is the one that closed — the work a learner can revise.
  assert.equal(v.termNumber, 2)
  assert.equal(v.nextTerm.termNumber, 3)
  assert.equal(v.nextTerm.daysUntilOpen, 18)
  assert.match(v.chipLabel, /^Holiday · Term 3 in 18 days$/)
  assert.ok(!/Term 1/.test(v.chipLabel), 'the chip must never say Term 1 in August')
})

test('every day of the 2026 Term 2 → Term 3 break reads as a holiday', () => {
  // 8 Aug – 6 Sep inclusive. The whole point of the fix is that it is a month
  // long, not an edge case, so the whole month is checked.
  for (let day = 8; day <= 31; day += 1) {
    const v = resolveLearnerCalendar(d(`2026-08-${String(day).padStart(2, '0')}`))
    assert.equal(v.phase, 'holiday', `2026-08-${day}`)
    assert.equal(v.termNumber, 2, `2026-08-${day}`)
  }
  for (let day = 1; day <= 6; day += 1) {
    const v = resolveLearnerCalendar(d(`2026-09-0${day}`))
    assert.equal(v.phase, 'holiday', `2026-09-0${day}`)
    assert.equal(v.nextTerm.termNumber, 3)
  }
})

// ── in-term ──────────────────────────────────────────────────────────────────

test('a school day inside a term reports the term and the week', () => {
  const v = resolveLearnerCalendar(d('2026-05-11')) // Term 2 opens
  assert.equal(v.phase, 'in-term')
  assert.equal(v.isSchoolOpen, true)
  assert.equal(v.termNumber, 2)
  assert.equal(v.weekNumber, 1)
  assert.ok(v.totalWeeks >= 10 && v.totalWeeks <= 14, `totalWeeks=${v.totalWeeks}`)
  assert.equal(v.chipLabel, 'Term 2 · Week 1')
  assert.match(v.statusLine, /Second Term ends/)
})

test('the first and last day of a term are both inside it', () => {
  assert.equal(resolveLearnerCalendar(d('2026-01-12')).phase, 'in-term')
  assert.equal(resolveLearnerCalendar(d('2026-04-10')).phase, 'in-term')
  // The day after close is the holiday — the boundary is where an
  // off-by-one would put a learner in the wrong term for a day.
  assert.equal(resolveLearnerCalendar(d('2026-04-11')).phase, 'holiday')
  assert.equal(resolveLearnerCalendar(d('2026-04-11')).termNumber, 1)
})

test('the week number advances through the term', () => {
  const wk1 = resolveLearnerCalendar(d('2026-01-12')).weekNumber
  const wk3 = resolveLearnerCalendar(d('2026-01-26')).weekNumber
  assert.equal(wk1, 1)
  assert.equal(wk3, 3)
})

// ── the edges, which must be honest rather than guessed ──────────────────────

test('before the calendar starts, nothing is invented', () => {
  const v = resolveLearnerCalendar(d('2025-06-01'))
  assert.equal(v.status, 'ok')
  assert.equal(v.phase, 'before-first-term')
  assert.equal(v.termNumber, null, 'no term has closed yet, so none is named')
  assert.equal(v.nextTerm.termNumber, 1)
})

test('past the end of the calendar the status is out_of_range, not a stale term', () => {
  const v = resolveLearnerCalendar(d('2031-03-01'))
  assert.equal(v.status, 'out_of_range')
  assert.equal(v.phase, 'unknown')
  assert.equal(v.termNumber, null)
  assert.equal(v.chipLabel, '', 'an unusable reading renders nothing rather than a guess')
})

test('the last December we hold is a holiday, not an unusable calendar', () => {
  // Third Term 2030 closes on 6 December and there is no 2031 to open. That
  // is not the same as knowing nothing: the year's shape is still on the
  // screen, Christmas included, so it is an ordinary holiday whose next
  // opening we cannot name. Reporting 'out_of_range' here put "Calendar
  // unavailable" above a fully populated 2030 calendar.
  const v = resolveLearnerCalendar(d('2030-12-20'))
  assert.equal(v.status, 'ok')
  assert.equal(v.phase, 'holiday')
  assert.equal(v.termNumber, 3, 'the term that closed is still nameable')
  assert.equal(v.nextTerm, null, 'and the one after it is honestly unknown')
  assert.equal(v.chipLabel, 'Holiday')
  assert.equal(v.shortLabel, 'Term 3 · holiday')
  assert.equal(v.statusLine, 'School is closed.')
})

test('an invalid date falls back to today rather than throwing', () => {
  const v = resolveLearnerCalendar(new Date('not a date'))
  assert.ok(v && typeof v.status === 'string')
})

// ── labels ───────────────────────────────────────────────────────────────────

test('termLabel prefers the calendar and falls back to the scoped term', () => {
  const holiday = resolveLearnerCalendar(d('2026-08-20'))
  assert.equal(termLabel(holiday, 2), 'Holiday · Term 3 in 18 days')

  const dead = resolveLearnerCalendar(d('2031-03-01'))
  assert.equal(termLabel(dead, 2), 'Term 2', 'the fallback names the term the app is scoped to')
  assert.equal(termLabel(dead, null), '')
  assert.equal(termLabel(null, 9), '', 'a term outside 1–3 is not a term')
})

test('the short label carries the same two facts in less room', () => {
  // The lines that use it already print a grade and a school name, so the
  // week goes — but "the school is shut" must not, which is the half of the
  // truth the old bare "Term 2" was missing.
  assert.equal(termLabelShort(resolveLearnerCalendar(d('2026-05-25')), 2), 'Term 2')
  assert.equal(termLabelShort(resolveLearnerCalendar(d('2026-08-20')), 2), 'Term 2 · holiday')
  assert.equal(termLabelShort(resolveLearnerCalendar(d('2025-06-01')), null), 'Term 1 soon')
  assert.equal(termLabelShort(resolveLearnerCalendar(d('2031-03-01')), 3), 'Term 3', 'falls back like its twin')
  assert.equal(termLabelShort(null, null), '')
})

test('the grade chip keeps the grade when the calendar cannot answer', () => {
  const dead = resolveLearnerCalendar(d('2031-03-01'))
  assert.equal(gradeTermChip(7, dead, null), '🎓 Grade 7')
  assert.equal(gradeTermChip(7, resolveLearnerCalendar(d('2026-05-11'))), '🎓 Grade 7  ·  Term 2 · Week 1')
  assert.equal(gradeTermChip(null, null, null), '')
})

test('whenPhrase says today / tomorrow / in N days and never a negative', () => {
  assert.equal(whenPhrase(0), 'today')
  assert.equal(whenPhrase(1), 'tomorrow')
  assert.equal(whenPhrase(18), 'in 18 days')
  assert.equal(whenPhrase(-3), '', 'a date in the past is not a countdown')
  assert.equal(whenPhrase(undefined), '')
  assert.equal(dayCountPhrase(1), '1 day')
  assert.equal(dayCountPhrase(30), '30 days')
})

// ── the calendar screen's model ──────────────────────────────────────────────

test('a year is three terms with the breaks between them derived, not declared', () => {
  const model = buildLearnerCalendarYear(2026, d('2026-08-20'))
  assert.equal(model.exists, true)
  assert.equal(model.terms.length, 3)

  const breaks = model.rows.filter((r) => r.kind === 'break')
  const t1t2 = breaks.find((b) => b.start === '2026-04-11')
  const t2t3 = breaks.find((b) => b.start === '2026-08-08')
  assert.ok(t1t2, 'the day after Term 1 closes')
  assert.ok(t2t3)
  assert.equal(t2t3.end, '2026-09-06', 'the day before Term 3 opens')
  assert.equal(t2t3.days, 30)
  // The year prints once, on the end date — the phone line has no room for it
  // twice and the start date is unambiguous without it.
  assert.equal(t2t3.startLabel, '8 Aug')
  assert.equal(t2t3.endLabel, '6 Sept 2026')
  assert.equal(t2t3.isNow, true, 'today falls inside it')
  assert.equal(t1t2.isNow, false)
})

test('the rows TILE the year — every day falls in exactly one of them', () => {
  // This is what lets a holiday be placed by its date. A gap in the tiling
  // would silently drop whatever public holiday fell in it.
  for (const year of learnerCalendarYears()) {
    const { rows } = buildLearnerCalendarYear(year, d('2026-08-20'))
    const spans = rows.map((r) => (r.kind === 'term' ? [r.open, r.close] : [r.start, r.end]))
    assert.ok(spans[0][0] <= `${year}-01-01`, `${year}: the year starts covered`)
    assert.ok(spans[spans.length - 1][1] >= `${year}-12-31`, `${year}: the year ends covered`)
    for (let i = 1; i < spans.length; i += 1) {
      const prevEnd = new Date(`${spans[i - 1][1]}T00:00:00`)
      const thisStart = new Date(`${spans[i][0]}T00:00:00`)
      const gapDays = Math.round((thisStart - prevEnd) / 86400000)
      assert.equal(gapDays, 1, `${year}: row ${i} starts the day after row ${i - 1} ends`)
    }
  }
})

test('rows read down the year in order, and the December holiday is not lost', () => {
  const model = buildLearnerCalendarYear(2026, d('2026-08-20'))
  assert.deepEqual(
    model.rows.map((r) => r.kind),
    ['break', 'term', 'break', 'term', 'break', 'term', 'break'],
  )
  // The last break crosses into the next year — the longest holiday of the
  // lot, and the one a learner is looking at the calendar in December for.
  const december = model.rows[model.rows.length - 1]
  assert.equal(december.start, '2026-12-05')
  assert.equal(december.end, '2027-01-10')
  assert.equal(december.startLabel, '5 Dec 2026', 'a cross-year break prints both years')
  assert.equal(december.endLabel, '10 Jan 2027')
  assert.equal(december.isNow, false)
  assert.equal(resolveLearnerCalendar(d('2026-12-20')).phase, 'holiday')
})

test('the last year we hold still runs out to 31 December', () => {
  // There is no 2031 term to point at, so the trailing run ends with the year
  // rather than being dropped — Christmas 2030 lives in it.
  const model = buildLearnerCalendarYear(2030, d('2026-08-20'))
  const trailing = model.rows[model.rows.length - 1]
  assert.equal(trailing.kind, 'break')
  assert.equal(trailing.start, '2030-12-07')
  assert.equal(trailing.end, '2030-12-31')
  assert.deepEqual(trailing.holidays.map((h) => h.name), ['Christmas Day'])
})

test('a public holiday sits under the row its DATE falls in, not the term that files it', () => {
  // MOE_CALENDAR files Kenneth Kaunda Day (28 Apr) and Labour Day (1 May)
  // under First Term, which closed on 10 April, and Christmas under Third
  // Term, which closed on 4 December. Rendering the record's grouping put
  // them inside the term card, above the break they actually fall in.
  const model = buildLearnerCalendarYear(2026, d('2026-08-20'))
  const term1 = model.terms[0]
  assert.deepEqual(
    term1.holidays.map((h) => h.name),
    ['Women\'s Day', 'Youth Day', 'Good Friday', 'Holy Saturday', 'Easter Monday'],
    'only the holidays that fall while Term 1 is open',
  )
  const aprilBreak = model.rows.find((r) => r.start === '2026-04-11')
  assert.deepEqual(aprilBreak.holidays.map((h) => h.name), ['Kenneth Kaunda Day', 'Labour Day'])

  const december = model.rows[model.rows.length - 1]
  assert.deepEqual(december.holidays.map((h) => h.name), ['Christmas Day'])

  // New Year's Day falls before Term 1 opens; the run in from 1 January is
  // what keeps it on the screen at all.
  const january = model.rows[0]
  assert.equal(january.kind, 'break')
  assert.deepEqual(january.holidays.map((h) => h.name), ['New Year\'s Day'])
})

test('no holiday is ever orphaned or filed under a row that does not contain it', () => {
  for (const year of learnerCalendarYears()) {
    const model = buildLearnerCalendarYear(year, d('2026-08-20'))
    const placed = model.rows.flatMap((r) => r.holidays.map((h) => h.date))
    for (const h of model.holidays) {
      assert.ok(placed.includes(h.date), `${year}: ${h.name} ${h.date} was dropped`)
    }
    for (const r of model.rows) {
      const from = r.kind === 'term' ? r.open : r.start
      const to = r.kind === 'term' ? r.close : r.end
      for (const h of r.holidays) {
        assert.ok(h.date >= from && h.date <= to, `${year}: ${h.name} is outside ${r.id}`)
      }
    }
  }
})

test('only the running term reports progress', () => {
  const model = buildLearnerCalendarYear(2026, d('2026-05-25'))
  const [t1, t2, t3] = model.terms
  assert.equal(t1.status, 'past')
  assert.equal(t2.status, 'active')
  assert.equal(t3.status, 'upcoming')
  assert.equal(t1.percent, null, 'a finished term draws no bar')
  assert.equal(t3.percent, null, 'nor does one that has not started')
  assert.ok(t2.percent > 0 && t2.percent <= 100)
  assert.ok(t2.weekNumber >= 1)
  assert.equal(t3.daysUntilOpen, 105)
})

test('during a holiday no term is active and none claims to be', () => {
  const model = buildLearnerCalendarYear(2026, d('2026-08-20'))
  assert.deepEqual(model.terms.map((t) => t.status), ['past', 'past', 'upcoming'])
  assert.deepEqual(model.terms.map((t) => t.percent), [null, null, null])
})

test('holidays are labelled and dated, and past ones are marked', () => {
  const model = buildLearnerCalendarYear(2026, d('2026-08-20'))
  const t2 = model.terms[1]
  const heroes = t2.holidays.find((h) => h.name === 'Heroes Day')
  assert.ok(heroes, 'Heroes Day is in Term 2 2026')
  assert.equal(heroes.isPast, true)
  assert.ok(heroes.dayLabel)
  // No duplicates across the year's roll-up.
  const dates = model.holidays.map((h) => h.date)
  assert.equal(new Set(dates).size, dates.length)
})

test('a year we hold no data for says so rather than rendering empty terms', () => {
  const model = buildLearnerCalendarYear(1999, d('2026-08-20'))
  assert.equal(model.exists, false)
  assert.deepEqual(model.rows, [])
})

test('the year list and default land inside the data we hold', () => {
  const years = learnerCalendarYears()
  assert.deepEqual(years, [2026, 2027, 2028, 2029, 2030])
  assert.equal(defaultCalendarYear(d('2026-08-20')), 2026)
  assert.equal(defaultCalendarYear(d('2019-01-01')), 2026, 'before the data → its first year')
  assert.equal(defaultCalendarYear(d('2044-01-01')), 2030, 'after it → its last')
})

test('upcoming holidays are future-only, deduped and ordered', () => {
  const soon = upcomingLearnerHolidays(d('2026-08-20'), { withinDays: 90, limit: 5 })
  assert.ok(soon.length > 0)
  assert.ok(soon.every((h) => h.daysAway >= 0), 'nothing already past')
  const away = soon.map((h) => h.daysAway)
  assert.deepEqual(away, [...away].sort((a, b) => a - b))
  assert.equal(new Set(soon.map((h) => h.date)).size, soon.length)
  assert.ok(soon[0].whenPhrase)
})

test('countdowns are civil days, so a DST timezone cannot round them up', () => {
  // The one thing here that cannot be checked in-process: TZ is read when the
  // first Date is constructed, so the comparison runs in a child.
  //
  // Zambia keeps CAT all year, so this never fires at home — but the countdown
  // belongs to the DEVICE clock, and a learner abroad reads the same screen.
  // 1 Nov 2026 is a US fallback day: the millisecond delta to 4 December is 33
  // days and one hour, which `Math.ceil` used to round to 34.
  const mod = fileURLToPath(new URL('../src/utils/learnerCalendar.js', import.meta.url))
  const probe = `
    const { resolveLearnerCalendar } = await import(${JSON.stringify(mod)})
    const v = resolveLearnerCalendar(new Date('2026-11-01T09:00:00'))
    process.stdout.write(String(v.daysUntilClose))
  `
  const read = (tz) => execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  })
  assert.equal(read('Africa/Lusaka'), '33')
  assert.equal(read('America/New_York'), '33', 'a DST fallback must not add a day to the countdown')
  assert.equal(read('Pacific/Auckland'), '33', 'nor may a spring-forward take one off')
})

test('the same date always resolves the same way', () => {
  // Guards against a helper reaching for `new Date()` internally, which is how
  // a "pure" calendar module quietly becomes untestable.
  const a = resolveLearnerCalendar(d('2027-06-15'))
  const b = resolveLearnerCalendar(d('2027-06-15'))
  assert.deepEqual({ ...a, today: null }, { ...b, today: null })
})

console.log(`\n${ran} learnerCalendar assertions passed\n`)
