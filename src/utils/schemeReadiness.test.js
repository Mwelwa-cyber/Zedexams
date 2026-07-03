/**
 * Unit tests for schemeReadiness — the pre-generation validation gate.
 * Run: node src/utils/schemeReadiness.test.js
 */

import { evaluate, MISSING_TIME_ALLOCATION_MESSAGE } from './schemeReadiness.js'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

const complete = {
  curriculum: 'cbc',
  grade: 'G5',
  subject: 'mathematics',
  term: 1,
  teachingWeeks: 12,
  periodsPerWeek: 6,
  hasSyllabus: true,
}

console.log('evaluate — complete input is ready')
{
  const r = evaluate(complete)
  assert(r.ready === true, 'ready when everything present')
  assert(r.missing.length === 0, 'nothing missing')
  assert(r.messages.length === 0, 'no messages')
}

console.log('evaluate — each missing field blocks + is reported')
{
  for (const key of ['curriculum', 'grade', 'subject', 'term', 'teachingWeeks', 'periodsPerWeek']) {
    const bad = { ...complete, [key]: key === 'term' || key === 'teachingWeeks' || key === 'periodsPerWeek' ? 0 : '' }
    const r = evaluate(bad)
    assert(r.ready === false, `missing ${key} → not ready`)
    assert(r.missing.includes(key), `missing[] includes ${key}`)
  }
}

console.log('evaluate — the exact time-allocation message')
{
  const r = evaluate({ ...complete, periodsPerWeek: 0 })
  const texts = r.messages.map((m) => m.text)
  assert(texts.includes(MISSING_TIME_ALLOCATION_MESSAGE), 'emits the required copy verbatim')
  assert(r.messages.find((m) => m.text === MISSING_TIME_ALLOCATION_MESSAGE).level === 'error', 'it blocks (error level)')
}

console.log('evaluate — no syllabus is advisory, not blocking')
{
  const r = evaluate({ ...complete, hasSyllabus: false })
  assert(r.ready === true, 'still ready without a syllabus outline')
  assert(r.messages.some((m) => m.level === 'info'), 'adds an info advisory')
  assert(r.messages.every((m) => m.level !== 'error'), 'no error-level message')
}

console.log('evaluate — teachingWeeks must be a positive number')
{
  assert(evaluate({ ...complete, teachingWeeks: '13' }).ready === true, "numeric string '13' counts")
  assert(evaluate({ ...complete, teachingWeeks: -1 }).ready === false, 'negative weeks blocked')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll schemeReadiness tests passed')
