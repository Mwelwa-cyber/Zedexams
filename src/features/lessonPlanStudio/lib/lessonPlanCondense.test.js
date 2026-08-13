/**
 * Plain-node tests for the post-generation length gate (§3.2).
 * Run: node src/features/lessonPlanStudio/lib/lessonPlanCondense.test.js  (npm run test:lesson-plan-condense)
 */

import assert from 'node:assert/strict'
import {
  applyCondensed,
  buildCondensePrompt,
  countFragments,
  countWords,
  measurePlan,
  parseCondenseResponse,
  runLengthGate,
} from './lessonPlanCondense.js'

let passed = 0
function check(name, fn) {
  const out = fn()
  if (out && typeof out.then === 'function') throw new Error(`${name} returned a promise — use checkAsync`)
  passed += 1
  console.log(`  ✓ ${name}`)
}
async function checkAsync(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// A stage cell written the way the current generator writes them — narrative
// prose in a table cell, which is the whole reason this gate exists.
const PROSE =
  'Ask learners to close their textbooks. Draw arrows on the chalkboard diagram to show air moving from outside the body, through the nose, down the trachea and into the lungs, and then explain that the same path is used when the air comes back out again during breathing. Ask the learners which gas the body takes in and which gas the body sends out, and write both answers on the chalkboard beside the diagram so that every learner can copy them into an exercise book before the next activity begins.'

const TERSE = '– Draw arrows: nose → trachea → bronchi → lungs and back.\n– Introduce Asthma and TB briefly.'

function planWith(teacher) {
  return {
    lessonGoal: 'Identify the main parts of the respiratory system.',
    stages: [{ name: 'DEVELOPMENT', duration: '12 min', teacher, pupils: '– Trace the path of air.', assessment: '– Describes the path.' }],
  }
}

console.log('\ncounting')
check('dash prefixes are not counted as words', () => {
  assert.equal(countWords('– Draw and label'), 3)
  assert.equal(countWords('• Draw and label'), 3)
  assert.equal(countWords('1. Draw and label'), 3)
})
check('an array cell counts as its joined text', () => {
  assert.equal(countWords(['Draw and label', 'Explain each part']), 6)
})
check('fragments are counted per line', () => {
  assert.equal(countFragments(TERSE), 2)
  assert.equal(countFragments(['a', 'b', '']), 2)
  assert.equal(countFragments(''), 0)
})

console.log('\nmeasuring')
check('a prose cell overshoots the 2-page budget', () => {
  const m = measurePlan(planWith(PROSE), { pageBudget: '2' })
  const cell = m.cells.find((c) => c.stageKey === 'teacher')
  assert.equal(cell.budget, 40)
  assert.ok(cell.words > 40)
  assert.equal(cell.over, true)
  assert.ok(m.over.some((c) => c.stageKey === 'teacher'))
})
check('a point-form cell is within budget', () => {
  const m = measurePlan(planWith(TERSE), { pageBudget: '2' })
  assert.deepEqual(m.over, [])
})
check('the 25% tolerance is real — 45 words against a 40 budget is left alone', () => {
  const fortyFive = Array.from({ length: 45 }, (_, i) => `w${i}`).join(' ')
  const m = measurePlan(planWith(fortyFive), { pageBudget: '2' })
  assert.equal(m.cells.find((c) => c.stageKey === 'teacher').over, false)
  const fiftyOne = Array.from({ length: 51 }, (_, i) => `w${i}`).join(' ')
  const m2 = measurePlan(planWith(fiftyOne), { pageBudget: '2' })
  assert.equal(m2.cells.find((c) => c.stageKey === 'teacher').over, true)
})
check('No limit enforces nothing', () => {
  const m = measurePlan(planWith(PROSE), { pageBudget: 'none' })
  assert.deepEqual(m.over, [])
  assert.equal(m.cells.find((c) => c.stageKey === 'teacher').budget, null)
})
check('a zero budget is not treated as an overshoot', () => {
  // At 1 page remedialWork is budgeted 0 — the section TOGGLE removes it, and
  // the gate must not burn a model call trying to condense it to nothing.
  const m = measurePlan({ ...planWith(TERSE), remedialWork: 'Re-teach labelling with a partial diagram.' }, { pageBudget: '1' })
  const cell = m.cells.find((c) => c.path === 'remedialWork')
  assert.equal(cell.budget, 0)
  assert.equal(cell.over, false)
})
check('too many fragments is flagged even when the word count fits', () => {
  const many = '– a\n– b\n– c\n– d\n– e'
  const m = measurePlan(planWith(many), { pageBudget: '1' })
  const cell = m.cells.find((c) => c.stageKey === 'teacher')
  assert.equal(cell.maxFragments, 3)
  assert.equal(cell.overFragments, true)
  assert.ok(m.over.length > 0)
})
check('an empty cell is not measured at all', () => {
  const m = measurePlan(planWith(''), { pageBudget: '2' })
  assert.equal(m.cells.some((c) => c.stageKey === 'teacher'), false)
})

console.log('\ncondense prompt')
check('the prompt names every over-budget cell and its limit', () => {
  const m = measurePlan(planWith(PROSE), { pageBudget: '2' })
  const prompt = buildCondensePrompt(m.over)
  assert.match(prompt, /stages\[0\]\.teacher/)
  assert.match(prompt, /"maxWords": 40/)
  assert.match(prompt, /preserve EVERY distinct action/i)
  assert.match(prompt, /point form/i)
})

console.log('\nparsing')
check('a fenced reply still parses', () => {
  assert.deepEqual(parseCondenseResponse('```json\n{"a":"x"}\n```'), { a: 'x' })
})
check('an array value is joined into lines', () => {
  assert.deepEqual(parseCondenseResponse('{"a":["x","y"]}'), { a: 'x\ny' })
})
check('malformed JSON yields an empty map rather than throwing', () => {
  assert.deepEqual(parseCondenseResponse('not json at all'), {})
  assert.deepEqual(parseCondenseResponse(''), {})
  assert.deepEqual(parseCondenseResponse('[1,2,3]'), {})
})

console.log('\nsplicing')
check('a condensed stage cell updates BOTH field families', () => {
  const plan = planWith(PROSE)
  const next = applyCondensed(plan, { 'stages[0].teacher': '– Draw arrows nose to lungs.\n– Name the parts.' })
  assert.equal(next.stages[0].teacher, '– Draw arrows nose to lungs.\n– Name the parts.')
  assert.deepEqual(next.stages[0].teacherActivities, ['Draw arrows nose to lungs.', 'Name the parts.'])
})
check('untouched stages come back reference-identical', () => {
  const plan = {
    stages: [
      { name: 'A', teacher: PROSE },
      { name: 'B', teacher: TERSE },
    ],
  }
  const next = applyCondensed(plan, { 'stages[0].teacher': '– short.' })
  assert.notEqual(next.stages[0], plan.stages[0])
  assert.equal(next.stages[1], plan.stages[1], 'stage B is the same object')
})
check('an empty or unrecognised map returns the same plan object', () => {
  const plan = planWith(PROSE)
  assert.equal(applyCondensed(plan, {}), plan)
  assert.equal(applyCondensed(plan, { 'stages[9].teacher': '' }), plan)
  assert.equal(applyCondensed(plan, { somethingElse: 'x' }), plan)
})
check('a top-level field condenses', () => {
  const plan = planWith(TERSE)
  const next = applyCondensed(plan, { lessonGoal: 'Name respiratory parts; describe air path.' })
  assert.equal(next.lessonGoal, 'Name respiratory parts; describe air path.')
})

console.log('\nthe gate')
await checkAsync('a plan within budget never calls the model', async () => {
  let calls = 0
  const result = await runLengthGate(planWith(TERSE), { pageBudget: '2' }, async () => { calls += 1; return '{}' })
  assert.equal(calls, 0)
  assert.equal(result.repaired, false)
  assert.equal(result.plan.stages[0].teacher, TERSE)
})
await checkAsync('an over-budget plan is repaired in one call', async () => {
  let calls = 0
  const result = await runLengthGate(planWith(PROSE), { pageBudget: '2' }, async () => {
    calls += 1
    return JSON.stringify({ 'stages[0].teacher': '– Draw arrows nose to lungs.' })
  })
  assert.equal(calls, 1)
  assert.equal(result.repaired, true)
  assert.equal(result.plan.stages[0].teacher, '– Draw arrows nose to lungs.')
})
await checkAsync('a failed repair leaves the teacher’s plan alone', async () => {
  const plan = planWith(PROSE)
  const result = await runLengthGate(plan, { pageBudget: '2' }, async () => { throw new Error('timeout') })
  assert.equal(result.plan, plan)
  assert.equal(result.repaired, false)
  assert.equal(result.error, 'timeout')
})
await checkAsync('a garbage repair reply leaves the plan alone', async () => {
  const plan = planWith(PROSE)
  const result = await runLengthGate(plan, { pageBudget: '2' }, async () => 'sorry, I cannot do that')
  assert.equal(result.plan, plan)
  assert.equal(result.repaired, false)
  assert.equal(result.error, null)
})

console.log(`\n✅ lessonPlanCondense — ${passed} checks passed\n`)
