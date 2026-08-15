// scripts/test-maths-subjects.mjs
//
// Which papers get the mathematics authoring tools (§1) and in what order the
// tools appear (§6). Plain-node assertions — run with `npm run test:maths-subjects`.
//
// The load-bearing case is the LOWER grades. "Mathematics and Science"
// (Grades 1-3) and "Pre-Mathematics and Science" (Nursery/Reception) do not
// store `mathematics`; both fold onto `numeracy`. A detector written against
// the word "mathematics" would pass every obvious test and still leave a
// Grade 2 teacher without the tools, which is precisely the silent failure
// this file exists to catch.

import assert from 'node:assert/strict'
import {
  isMathsSubject, MATHS_SUBJECT_KEYS, MATHS_TOOLS,
  mathsGradeBand, mathsToolOrder, mathsToolLabel, MATHS_GRADE_BANDS,
} from '../src/shared/utils/mathsSubjects.js'
import { toKbSubjectKey } from '../src/shared/utils/paperTaxonomy.js'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('\nmathematics subject detection')

check('the three canonical keys trigger maths mode', () => {
  for (const key of ['mathematics', 'mathematics_ii', 'numeracy']) {
    assert.equal(isMathsSubject(key), true, `${key} should be maths`)
  }
  assert.deepEqual([...MATHS_SUBJECT_KEYS].sort(), ['mathematics', 'mathematics_ii', 'numeracy'])
})

check('the Grades 1-3 / ECE subject slugs resolve through SUBJECT_FIXES onto numeracy', () => {
  // This is the assumption the whole lower-grade story rests on. If
  // paperTaxonomy ever stops folding these, the assert fails here rather
  // than the toolbar quietly vanishing for Grades 1-3.
  assert.equal(toKbSubjectKey('maths_science'), 'numeracy')
  assert.equal(toKbSubjectKey('pre_maths_science'), 'numeracy')
  assert.equal(isMathsSubject('maths_science'), true)
  assert.equal(isMathsSubject('pre_maths_science'), true)
})

check('display labels the pickers actually show are recognised', () => {
  const labels = [
    'Mathematics',
    'Maths',
    'Math',
    'Mathematics II',
    'Mathematics and Science',
    'Maths and Science',
    'Maths & Science',
    'Pre-Mathematics and Science',
    'Pre-Maths and Science',
    'Pre-Maths & Science',
    'Numeracy (Maths & Science)',
  ]
  for (const label of labels) {
    assert.equal(isMathsSubject(label), true, `${label} should be maths`)
  }
})

check('non-mathematics subjects are left alone', () => {
  const others = [
    'english', 'English', 'integrated_science', 'Integrated Science',
    'social_studies', 'literacy', 'Literacy', 'zambian_language',
    'expressive_arts', 'history', 'Religious Education', 'physics',
    'literature_in_english',
  ]
  for (const subject of others) {
    assert.equal(isMathsSubject(subject), false, `${subject} should NOT be maths`)
  }
})

check('an empty or unusable subject is not maths, and never throws', () => {
  for (const value of ['', '   ', null, undefined, 0, false, {}, []]) {
    assert.equal(isMathsSubject(value), false)
  }
})

console.log('\ngrade-band tool ordering')

check('bands split at Grade 4 / Grade 7 across both grade-value schemes', () => {
  const early = ['ECE_N', 'ECE_R', '1', '2', '3', '4']
  const upper = ['5', '6', '7']
  const secondary = ['G8', 'G12', 'Form 1', 'Form 4', '8', '12']
  for (const g of early) assert.equal(mathsGradeBand(g), MATHS_GRADE_BANDS.EARLY, g)
  for (const g of upper) assert.equal(mathsGradeBand(g), MATHS_GRADE_BANDS.UPPER_PRIMARY, g)
  for (const g of secondary) assert.equal(mathsGradeBand(g), MATHS_GRADE_BANDS.SECONDARY, g)
})

check('an unknown grade gets the full secondary ordering, not the narrowest', () => {
  // Assuming "early" for a grade we failed to identify would bury the
  // algebraic tools on a paper we simply did not recognise.
  for (const g of ['', null, undefined, 'Grade 99', 'whatever']) {
    assert.equal(mathsGradeBand(g), MATHS_GRADE_BANDS.SECONDARY)
  }
})

check('every band offers EVERY tool — ordering is convenience, never restriction', () => {
  for (const grade of ['ECE_N', '2', '4', '5', '7', 'G8', 'G12', 'nonsense']) {
    const order = mathsToolOrder(grade)
    assert.deepEqual(
      [...order].sort(), [...MATHS_TOOLS].sort(),
      `band for ${grade} must be a permutation of every tool`,
    )
    assert.equal(new Set(order).size, order.length, `band for ${grade} lists a tool twice`)
  }
})

check('lower primary reaches vertical calculation and fractions before algebra', () => {
  const order = mathsToolOrder('2')
  const at = (tool) => order.indexOf(tool)
  assert.ok(at('verticalArithmetic') < at('numberBase'), 'vertical sum before number base')
  assert.ok(at('fraction') < at('formula'), 'fraction before formula')
  assert.ok(at('mixedNumber') < at('formula'), 'mixed number before formula')
  // Number base and formula are the tools an early-years paper reaches for
  // last, so they sit at the back of the row / inside "More maths".
  assert.ok(at('numberBase') >= order.length - 2)
})

check('Grades 5-7 lead with fractions, mixed numbers and vertical calculation', () => {
  const order = mathsToolOrder('7')
  assert.deepEqual(order.slice(0, 3), ['fraction', 'mixedNumber', 'verticalArithmetic'])
  assert.ok(order.indexOf('power') < order.indexOf('formula'))
})

check('every tool has a teacher-readable name, and only real tools do', () => {
  for (const tool of MATHS_TOOLS) {
    const label = mathsToolLabel(tool)
    assert.ok(label && label.length > 2, `${tool} needs a readable label`)
    // §6: no unexplained technical vocabulary on screen.
    assert.ok(!/latex|tiptap|node|json/i.test(label), `${tool} label leaks machine words`)
  }
  assert.equal(mathsToolLabel('not_a_tool'), '')
})

console.log(`\n${passed} maths-subject checks passed\n`)
