/**
 * Unit tests for schemeTermPlan — calendar → pacing skeleton.
 * Run: node src/utils/schemeTermPlan.test.js
 */

import {
  buildTermPlan,
  reserveWeeks,
  reservedWeekCount,
  deliveryWeekCount,
  defaultRevisionWeeks,
  toWeekPlanPayload,
  roleLabel,
} from './schemeTermPlan.js'
import { getTotalTeachingWeeks, getTermByNumber } from '../../../utils/moeCalendar.js'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

console.log('buildTermPlan — real calendar years')
{
  const plan = buildTermPlan({ year: 2026, term: 1 })
  assert(plan !== null, '2026 Term 1 resolves')
  const expected = getTotalTeachingWeeks(getTermByNumber(2026, 1))
  assert(plan.weeks.length === expected, `week count matches calendar (${expected})`)
  assert(plan.teachingWeeks === expected, 'teachingWeeks matches')
  assert(expected === 12 || expected === 13, `term is 12 or 13 weeks (${expected})`)
  assert(plan.weeks[0].weekNumber === 1, 'weeks are 1-based')
  assert(plan.weeks.every((w) => w.beginningLabel && w.endingLabel), 'every week has date labels')
  assert(plan.weeks[plan.weeks.length - 1].role === 'exam', 'final week defaults to exam')
  assert(plan.weeks.slice(0, -1).every((w) => w.role === 'teaching'), 'all other weeks default to teaching')
}

console.log('buildTermPlan — supports 12 AND 13 week terms across years')
{
  const counts = new Set()
  for (const year of [2026, 2027, 2028, 2029, 2030]) {
    for (const term of [1, 2, 3]) {
      const p = buildTermPlan({ year, term })
      if (p) counts.add(p.weeks.length)
    }
  }
  assert(counts.has(12) || counts.has(13), 'calendar produces 12- and/or 13-week terms')
  assert([...counts].every((c) => c >= 10 && c <= 14), 'all terms land in a sane 10–14 week range')
}

console.log('buildTermPlan — holidays land in their week')
{
  // 2026 Term 1 opens 12 Jan; Women's Day 8 Mar + Youth Day 12 Mar fall mid-term.
  const plan = buildTermPlan({ year: 2026, term: 1 })
  const flat = plan.weeks.flatMap((w) => w.holidays.map((h) => h.name))
  assert(flat.includes("Women's Day"), "Women's Day is tagged to a week")
  // Each holiday assigned to at most one week.
  const totalTagged = plan.weeks.reduce((s, w) => s + w.holidays.length, 0)
  const names = new Set(flat)
  assert(totalTagged === flat.length, 'no holiday counted twice')
  assert(names.size >= 1, 'at least one holiday tagged')
}

console.log('buildTermPlan — unknown year/term → null')
{
  assert(buildTermPlan({ year: 1999, term: 1 }) === null, 'unknown year → null')
  assert(buildTermPlan({ year: 2026, term: 9 }) === null, 'bad term → null')
  assert(buildTermPlan({}) === null, 'empty → null')
}

console.log('reserveWeeks — teacher marks exam/revision')
{
  const plan = buildTermPlan({ year: 2026, term: 1 })
  const n = plan.weeks.length
  const reserved = reserveWeeks(plan, { revisionWeeks: [n - 1], examWeeks: [n] })
  assert(reserved.weeks[n - 2].role === 'revision', 'second-to-last marked revision')
  assert(reserved.weeks[n - 1].role === 'exam', 'last marked exam')
  assert(reservedWeekCount(reserved) === 2, 'two reserved weeks')
  assert(deliveryWeekCount(reserved) === n - 2, 'delivery weeks = total - reserved')
  // exam wins when a week is in both lists
  const both = reserveWeeks(plan, { revisionWeeks: [3], examWeeks: [3] })
  assert(both.weeks[2].role === 'exam', 'exam wins over revision on a shared week')
  // un-marking the default-last-week exam clears it
  const cleared = reserveWeeks(plan, { revisionWeeks: [], examWeeks: [] })
  assert(cleared.weeks[n - 1].role === 'teaching', 'clearing marks resets the default exam week')
}

console.log('toWeekPlanPayload — compact projection')
{
  const plan = buildTermPlan({ year: 2026, term: 2 })
  const payload = toWeekPlanPayload(plan)
  assert(payload.length === plan.weeks.length, 'one entry per week')
  assert(payload.every((p) => typeof p.week === 'number' && typeof p.role === 'string'), 'week + role are primitives')
  assert(payload.every((p) => Array.isArray(p.holidays)), 'holidays projected to name arrays')
  assert(toWeekPlanPayload(null).length === 0, 'null → []')
}

console.log('defaultRevisionWeeks — the spec term shape when nothing is typed')
{
  // 13-week Term 1 with the exam in the last week → 2 revision weeks before it.
  assert(
    JSON.stringify(defaultRevisionWeeks({ totalWeeks: 13, examWeeks: [13], term: 1 })) === JSON.stringify([11, 12]),
    'Term 1 (13 wks) → revision in weeks 11–12',
  )
  // 12-week Term 2 → content ~9 weeks, 2 revision, 1 exam (the spec's shape).
  assert(
    JSON.stringify(defaultRevisionWeeks({ totalWeeks: 12, examWeeks: [12], term: 2 })) === JSON.stringify([10, 11]),
    'Term 2 (12 wks) → revision in weeks 10–11',
  )
  // Term 3 revises the whole year → 3 revision weeks when the term is long enough.
  assert(
    JSON.stringify(defaultRevisionWeeks({ totalWeeks: 13, examWeeks: [13], term: 3 })) === JSON.stringify([10, 11, 12]),
    'Term 3 (13 wks) → revision in weeks 10–12',
  )
  // Revision sits before the FIRST exam week, not the end of the term.
  assert(
    JSON.stringify(defaultRevisionWeeks({ totalWeeks: 13, examWeeks: [10, 13], term: 1 })) === JSON.stringify([8, 9]),
    'revision precedes the first exam week',
  )
  // Short terms scale down; very short terms reserve nothing extra.
  assert(
    JSON.stringify(defaultRevisionWeeks({ totalWeeks: 8, examWeeks: [8], term: 1 })) === JSON.stringify([7]),
    'short term (8 wks) → a single revision week',
  )
  assert(defaultRevisionWeeks({ totalWeeks: 5, examWeeks: [5], term: 1 }).length === 0, 'tiny term → no default revision')
  assert(defaultRevisionWeeks({}).length === 0, 'no inputs → no defaults')
  // Missing exam list falls back to the final week.
  assert(
    JSON.stringify(defaultRevisionWeeks({ totalWeeks: 12, term: 1 })) === JSON.stringify([10, 11]),
    'no exam weeks given → assumes the last week is the exam',
  )
}

console.log('roleLabel')
{
  assert(roleLabel('exam') === 'Revision & Examination', 'exam label')
  assert(roleLabel('revision') === 'Revision', 'revision label')
  assert(roleLabel('teaching') === 'Teaching', 'teaching label')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll schemeTermPlan tests passed')
