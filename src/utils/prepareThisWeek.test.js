/**
 * Unit tests for prepareThisWeek.js — plain-node assertion script (throws on
 * failure), run via `npm run test:prepare-week`. Deterministic: every input,
 * including the calendar context and the clock, is injected.
 */

import {
  buildWeekPrep,
  resolveWeekContext,
  timetableAllocation,
  weekAttributionOf,
  termNumberOf,
  normSubject,
  normGrade,
  gradeLabelOf,
  subjectLabelOf,
} from './prepareThisWeek.js'

let passed = 0
function check(name, cond) {
  if (!cond) throw new Error(`FAIL: ${name}`)
  passed += 1
  console.log(`  ✓ ${name}`)
}

// A fixed "current week": 2026 Term 2, Week 8, Mon 18 May – Fri 22 May.
const CAL = {
  year: 2026,
  termNumber: 2,
  weekNumber: 8,
  beginning: '2026-05-18',
  ending: '2026-05-22',
  beginningLabel: '18 May 2026',
  endingLabel: '22 May 2026',
}
const NOW = new Date(2026, 4, 20, 9, 0, 0).getTime() // Wed of that week
const IN_WEEK = new Date(2026, 4, 19, 10, 0, 0).getTime()
const BEFORE_WEEK = new Date(2026, 4, 4, 10, 0, 0).getTime()

let idSeq = 0
function gen(tool, { subject, grade, term, createdAt = IN_WEEK, output = {}, header = {}, meta } = {}) {
  return {
    id: `g${++idSeq}`,
    tool,
    createdAt,
    inputs: { subject, grade, term: term != null ? String(term) : null },
    output: { header: { subject, grade, term, ...header }, ...output },
    ...(meta ? { meta } : {}),
  }
}

/* ── normalisers ─────────────────────────────────────────────────── */
check('termNumberOf parses "Term 2" and 2', termNumberOf('Term 2') === 2 && termNumberOf(2) === 2)
check('termNumberOf null on blank', termNumberOf('') === null && termNumberOf(undefined) === null)
check('normSubject folds slug and case', normSubject('Integrated_Science ') === 'integrated science')
check('normGrade canonicalises Grade 4 → G4', normGrade('Grade 4') === 'G4' && normGrade('g4') === 'G4')
check('gradeLabelOf expands G4', gradeLabelOf('G4') === 'Grade 4' && gradeLabelOf('') === '')
check('subjectLabelOf title-cases slug', subjectLabelOf('integrated_science') === 'Integrated Science')

/* ── empty states ────────────────────────────────────────────────── */
{
  const out = buildWeekPrep({ generations: [], calendar: null, now: NOW })
  check('no calendar → empty (no-calendar)', out.empty && out.emptyReason === 'no-calendar')
}
{
  const out = buildWeekPrep({ generations: [], calendar: CAL, profileSubject: '', now: NOW })
  check('no data + no profile subject → empty (no-context)', out.empty && out.emptyReason === 'no-context')
}

/* ── context resolution priority ─────────────────────────────────── */
{
  const gens = [
    gen('scheme_of_work', { subject: 'mathematics', grade: 'G5', term: 2 }),
    gen('weekly_forecast', { subject: 'integrated_science', grade: 'G4', term: 2, header: { weekNumber: 8 }, output: { days: [] } }),
  ]
  const ctx = resolveWeekContext({ generations: gens, calendar: CAL })
  check('this week’s focus outranks the scheme for context', ctx.subject === 'integrated science' && ctx.source === 'focus')
}
{
  const gens = [gen('scheme_of_work', { subject: 'mathematics', grade: 'G5', term: 2 })]
  const ctx = resolveWeekContext({ generations: gens, calendar: CAL })
  check('scheme provides context when no focus exists', ctx.subject === 'mathematics' && ctx.grade === 'G5')
}
{
  const ctx = resolveWeekContext({ generations: [], calendar: CAL, profileSubject: 'english' })
  check('profile subject is the last-resort context', ctx.subject === 'english' && ctx.source === 'profile')
}
{
  // A forecast for ANOTHER week must not define this week's context.
  const gens = [gen('weekly_forecast', { subject: 'english', grade: 'G4', term: 2, header: { weekNumber: 3 }, output: { days: [] } })]
  const ctx = resolveWeekContext({ generations: gens, calendar: CAL })
  check('a different week’s focus is ignored for context', ctx === null)
}

/* ── timetable allocation (the real weekly target) ───────────────── */
{
  const timetable = gen('class_timetable', {
    grade: 'G4',
    output: {
      slots: {
        p1: { Monday: 'Mathematics', Tuesday: 'English', Wednesday: 'Mathematics' },
        p2: { Monday: 'Mathematics', Thursday: 'Integrated Science' },
      },
    },
  })
  const alloc = timetableAllocation([timetable], { subject: 'mathematics', grade: 'G4' })
  check('timetable allocation counts periods + distinct days', alloc.periods === 3 && alloc.days === 2)
  const none = timetableAllocation([timetable], { subject: 'creative_arts', grade: 'G4' })
  check('subject absent from timetable → null (falls back)', none === null)
}

/* ── full build: a mid-week teacher ──────────────────────────────── */
{
  const days = (n, filled) => Array.from({ length: n }, (_, i) => ({
    day: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][i],
    topic: i < filled ? `Topic ${i + 1}` : '',
    learningActivities: [],
    specificCompetence: '',
  }))
  const gens = [
    gen('scheme_of_work', { subject: 'integrated_science', grade: 'G4', term: 2, createdAt: BEFORE_WEEK }),
    gen('weekly_forecast', { subject: 'integrated_science', grade: 'G4', term: 2, header: { weekNumber: 8 }, output: { days: days(5, 3) } }),
    gen('lesson_plan', { subject: 'integrated_science', grade: 'G4', term: 2 }),
    gen('lesson_plan', { subject: 'integrated_science', grade: 'G4', term: 2 }),
    gen('lesson_plan', { subject: 'integrated_science', grade: 'G4', term: 2, createdAt: BEFORE_WEEK }), // outside week
    gen('lesson_plan', { subject: 'mathematics', grade: 'G4', term: 2 }), // other subject
    gen('worksheet', { subject: 'integrated_science', grade: 'G4', term: 2 }),
    gen('record_of_work', {
      subject: 'integrated_science', grade: 'G4', term: 2, createdAt: BEFORE_WEEK,
      output: { weeks: [{ week: '8', coverage: '' }, { week: '7', coverage: 'full' }] },
    }),
  ]
  const out = buildWeekPrep({ generations: gens, calendar: CAL, now: NOW })
  check('not empty with real data', !out.empty)
  check('context is Grade 4 Integrated Science, Term 2 Week 8',
    out.context.gradeLabel === 'Grade 4' && out.context.subjectLabel === 'Integrated Science' &&
    out.context.termNumber === 2 && out.context.weekNumber === 8)
  check('range label joins beginning – ending', out.context.rangeLabel === '18 May 2026 – 22 May 2026')

  const byKey = Object.fromEntries(out.rows.map((r) => [r.key, r]))
  check('scheme row done and links to the saved doc',
    byKey.scheme.status === 'done' && /^\/teacher\/library\//.test(byKey.scheme.to))
  check('focus row 3 of 5 (progress)', byKey.focus.done === 3 && byKey.focus.target === 5 && byKey.focus.status === 'progress')
  check('lesson row counts only this week + this subject', byKey.lessons.done === 2 && byKey.lessons.target === 5)
  check('worksheet row done at 1 created', byKey.worksheet.status === 'done')
  check('record row alert when week 8 coverage is blank', byKey.record.status === 'alert')
  check('stage is plan while focus incomplete', out.stage === 'plan')
  check('continue button targets first incomplete row', out.continueTo === byKey.focus.to)
  check('view week opens the saved focus doc', /^\/teacher\/library\//.test(out.viewWeekTo))
}

/* ── record updated + timetable-driven targets ───────────────────── */
{
  const gens = [
    gen('class_timetable', {
      grade: 'G4',
      createdAt: BEFORE_WEEK,
      output: { slots: { p1: { Monday: 'English', Wednesday: 'English' }, p2: { Monday: 'English' } } },
    }),
    gen('weekly_forecast', {
      subject: 'english', grade: 'G4', term: 2, header: { weekNumber: 8 },
      output: { days: [{ day: 'Monday', topic: 'Nouns' }, { day: 'Wednesday', topic: 'Verbs' }] },
    }),
    gen('record_of_work', {
      subject: 'english', grade: 'G4', term: 2,
      output: { weeks: [{ week: 8, coverage: 'partial' }] },
    }),
  ]
  const out = buildWeekPrep({ generations: gens, calendar: CAL, now: NOW })
  const byKey = Object.fromEntries(out.rows.map((r) => [r.key, r]))
  check('day target comes from timetable distinct days (2, not 5)', byKey.focus.target === 2)
  check('lesson target comes from timetable periods (3)', byKey.lessons.target === 3)
  check('focus done when all timetable days prepared', byKey.focus.status === 'done')
  check('record row done when this week’s coverage is filled', byKey.record.status === 'done')
  check('scheme row still todo → routed to the studio', byKey.scheme.to === '/teacher/generate/scheme-of-work')
}

/* ── week attribution ladder (risk item 5) ───────────────────────── */
{
  const WINDOW = { weekStartMs: new Date(2026, 4, 18).getTime(), weekEndMs: new Date(2026, 4, 22).getTime(), termNumber: 2 }
  // 1. Planned teaching date wins over creation date, both directions.
  const plannedIn = gen('lesson_plan', { subject: 'english', term: 2, createdAt: BEFORE_WEEK, meta: { date: '2026-05-20' } })
  let a = weekAttributionOf(plannedIn, WINDOW)
  check('planned date inside week counts even when created earlier', a.inWeek && !a.estimated && a.basis === 'planned')
  const plannedOut = gen('lesson_plan', { subject: 'english', term: 2, createdAt: IN_WEEK, meta: { date: '2026-06-03' } })
  a = weekAttributionOf(plannedOut, WINDOW)
  check('planned date outside week excludes a doc created this week', !a.inWeek && a.basis === 'planned')
  // 3. A different stored term never counts, whatever the creation date.
  const otherTerm = gen('lesson_plan', { subject: 'english', term: 1, createdAt: IN_WEEK })
  a = weekAttributionOf(otherTerm, WINDOW)
  check('term mismatch excludes a doc created this week', !a.inWeek && a.basis === 'term')
  // 4. Legacy fallback: creation date, flagged estimated.
  const legacy = gen('lesson_plan', { subject: 'english', term: 2, createdAt: IN_WEEK })
  a = weekAttributionOf(legacy, WINDOW)
  check('creation-date fallback counts but is estimated', a.inWeek && a.estimated && a.basis === 'created')
}

{
  // Estimated flag surfaces on the lessons row (≈ prefix) only when a
  // counted doc used the fallback; planned-dated docs keep the row precise.
  const gens = [
    gen('weekly_forecast', { subject: 'english', grade: 'G4', term: 2, header: { weekNumber: 8 }, output: { days: [{ day: 'Monday', topic: 'Nouns' }] } }),
    gen('lesson_plan', { subject: 'english', grade: 'G4', term: 2, createdAt: IN_WEEK }), // fallback
    gen('lesson_plan', { subject: 'english', grade: 'G4', term: 2, createdAt: BEFORE_WEEK, meta: { date: '2026-05-21' } }), // planned
  ]
  const out = buildWeekPrep({ generations: gens, calendar: CAL, now: NOW })
  const lessons = out.rows.find((r) => r.key === 'lessons')
  check('lessons row counts planned + fallback docs (2)', lessons.label.startsWith('Lesson plans: 2 of'))
  check('lessons row is flagged estimated with an ≈ meta', lessons.estimated === true && lessons.meta.startsWith('≈'))

  const preciseOut = buildWeekPrep({
    generations: gens.filter((g) => !(g.tool === 'lesson_plan' && !g.meta)),
    calendar: CAL,
    now: NOW,
  })
  const preciseLessons = preciseOut.rows.find((r) => r.key === 'lessons')
  check('row is precise when every counted doc has a planned date',
    preciseLessons.estimated === false && !preciseLessons.meta.startsWith('≈'))
}

/* ── holiday mode (risk item 7) ──────────────────────────────────── */
{
  const HOLIDAY_CAL = {
    year: 2026,
    termNumber: 3,
    weekNumber: 1,
    beginning: '2026-09-07',
    ending: '2026-09-11',
    beginningLabel: '7 Sep 2026',
    endingLabel: '11 Sep 2026',
    isActiveTermNow: false,
    openLabel: '7 September 2026',
    daysToOpen: 26,
  }
  const gens = [gen('scheme_of_work', { subject: 'mathematics', grade: 'G5', term: 3 })]
  const out = buildWeekPrep({ generations: gens, calendar: HOLIDAY_CAL, now: NOW })
  check('holiday → next-term mode', out.mode === 'next-term')
  check('holiday shows planning rows only (scheme + focus)',
    out.rows.length === 2 && out.rows[0].key === 'scheme' && out.rows[1].key === 'focus')
  check('holiday context carries opening date + countdown',
    out.context.openLabel === '7 September 2026' && out.context.daysToOpen === 26)
  check('holiday stage is plan', out.stage === 'plan')
  const active = buildWeekPrep({ generations: gens, calendar: { ...HOLIDAY_CAL, isActiveTermNow: true }, now: NOW })
  check('active term keeps week mode with all five rows', active.mode === 'week' && active.rows.length === 5)
}

console.log(`\nprepareThisWeek: ${passed} checks passed`)
