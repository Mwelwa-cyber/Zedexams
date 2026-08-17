#!/usr/bin/env node
/**
 * scripts/test-grade-term-plan.mjs
 *
 * The Grade 7 term plan. The claims worth pinning:
 *
 *   • It covers English and Integrated Science and NOTHING ELSE — this file is
 *     the owner's own allocation, and a term GUESSED for another subject would
 *     be a fabricated syllabus in front of a child. The other subjects get
 *     their terms by dividing the published catalogue instead
 *     (`config/termDivision`, `test:term-division`), which invents no content
 *     and is labelled on screen as a suggested split.
 *   • Every planned Science title names a real sub-topic in the catalogue.
 *   • The unplaced-topic matcher neither drops real content nor duplicates
 *     the whole list onto all three tabs.
 */

import assert from 'node:assert/strict'
import {
  GRADE_TERM_PLAN, getTermPlan, planTopicsForTerm, strandLabel,
  unplacedCatalogueTopics, STRAND_LABELS,
} from '../src/config/gradeTermPlan.js'
import { TOPICS, getSubtopics, SUBJECTS } from '../src/config/curriculum.js'

let passed = 0
function test(name, fn) { fn(); passed += 1; console.log(`  ✓ ${name}`) }

test('only the two subjects the owner has actually planned', () => {
  assert.deepEqual(Object.keys(GRADE_TERM_PLAN), ['7'])
  assert.deepEqual(Object.keys(GRADE_TERM_PLAN[7]).sort(), ['english', 'science'])
  // The five unplanned subjects return null, not an empty plan — "no scheme
  // of work" and "a scheme of work with nothing in it" are different claims,
  // and the caller distinguishes them: null is what sends it to termDivision.
  for (const id of ['mathematics', 'social-studies', 'technology', 'expressive-arts', 'home-economics']) {
    assert.equal(getTermPlan(id, 7), null, `${id} must not carry an invented plan`)
  }
})

test('plans are keyed by subject ID, never by label', () => {
  // "Integrated Science".toLowerCase() !== "science" — comparing a label to
  // an id is the bug that silently dropped every multi-word subject.
  assert.ok(getTermPlan('science', 7))
  assert.equal(getTermPlan('Integrated Science', 7), null)
  assert.equal(getTermPlan('integrated science', 7), null)
})

test('a grade with no plan, and junk, return null rather than throwing', () => {
  for (const g of [4, 5, 6, 8, null, undefined, 'banana', '', {}]) {
    assert.equal(getTermPlan('science', g), null)
  }
  assert.equal(getTermPlan('nope', 7), null)
})

test('both plans cover all three terms with no empty term', () => {
  for (const id of ['english', 'science']) {
    const plan = getTermPlan(id, 7)
    for (const term of [1, 2, 3]) {
      assert.ok(planTopicsForTerm(plan, term).length > 0, `${id} term ${term} is empty`)
    }
    // Every row lands in exactly one real term.
    for (const row of plan) {
      assert.ok([1, 2, 3].includes(row.term), `${id}: bad term ${row.term}`)
      assert.ok(row.title && row.icon && row.strand, `${id}: incomplete row ${JSON.stringify(row)}`)
    }
  }
})

test('the plans are the prototype\'s, at the prototype\'s sizes', () => {
  assert.equal(getTermPlan('english', 7).length, 21)
  assert.equal(getTermPlan('science', 7).length, 13)
  assert.deepEqual([1, 2, 3].map((t) => planTopicsForTerm(getTermPlan('english', 7), t).length), [7, 7, 7])
  assert.deepEqual([1, 2, 3].map((t) => planTopicsForTerm(getTermPlan('science', 7), t).length), [3, 4, 6])
})

test('every strand resolves to a label', () => {
  for (const id of ['english', 'science']) {
    for (const row of getTermPlan(id, 7)) {
      assert.ok(STRAND_LABELS[row.strand], `unknown strand ${row.strand}`)
      assert.ok(strandLabel(row.strand).length > 0)
    }
  }
  assert.equal(strandLabel('nope'), 'nope')
  assert.equal(strandLabel(null), '')
})

test('a Science strand IS a real parent topic in the catalogue', () => {
  // The prototype's `sd` values are the five entries of TOPICS.science[7],
  // so a row is a sub-topic and its strand is the topic above it.
  const catalogue = TOPICS.science[7]
  for (const row of getTermPlan('science', 7)) {
    const label = strandLabel(row.strand).toLowerCase()
    assert.ok(
      catalogue.some((t) => t.toLowerCase().includes(label.split(' & ')[0].toLowerCase())),
      `strand "${label}" matches no Grade 7 Science topic`,
    )
  }
})

test('every planned Science title names real catalogue content', () => {
  // Guards against the plan drifting away from the syllabus it transcribes.
  const all = TOPICS.science[7].flatMap((t) => getSubtopics('science', 7, t) || [])
  const unmatched = unplacedCatalogueTopics(getTermPlan('science', 7), all)
  // Exactly the three the prototype's plan does not list.
  assert.deepEqual(unmatched.sort(), ['Metals and Non-metals', 'Mining', 'The Solar System'])
})

test('unplaced matching does not collapse or explode', () => {
  const plan = [{ term: 1, title: 'Electric Circuits', icon: '🔌', strand: 'materials-energy' }]
  // The syllabus's wording differs from the owner's; it must still match.
  assert.deepEqual(unplacedCatalogueTopics(plan, ['Electric Current and Circuits']), [])
  // A genuinely different topic is reported.
  assert.deepEqual(unplacedCatalogueTopics(plan, ['Mining']), ['Mining'])
  // No plan → nothing is "unplaced" (the whole catalogue shows normally).
  assert.deepEqual(unplacedCatalogueTopics(null, ['Mining']), [])
  assert.deepEqual(unplacedCatalogueTopics([], ['Mining']), [])
  // Stop-words alone never make a match.
  assert.deepEqual(unplacedCatalogueTopics([{ term: 1, title: 'The', icon: 'x', strand: 'health' }], ['The Flower']), ['The Flower'])
})

test('the planned subjects are subjects a Grade 7 actually takes', () => {
  for (const id of Object.keys(GRADE_TERM_PLAN[7])) {
    assert.ok(SUBJECTS.some((s) => s.id === id), `${id} is not a real subject`)
  }
})

console.log(`\ngrade-term-plan: ${passed} tests passed`)
