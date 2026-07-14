/**
 * Unit tests for freePreview.js — plain-node script, run via
 * `npm run test:free-preview`.
 */

const assert = require('node:assert')
const { clampAssessmentPreview, clampSchemePreview } = require('./freePreview.js')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const q = (n, marks = 2) => ({ id: `q${n}`, prompt: `Question ${n}`, marks })

check('assessment over the cap is truncated across sections', () => {
  const { assessment, truncated } = clampAssessmentPreview({
    header: { totalMarks: 40 },
    sections: [
      { title: 'A', questions: [q(1), q(2), q(3)] },
      { title: 'B', questions: [q(4), q(5), q(6), q(7)] },
    ],
  }, 5)
  assert.equal(truncated, true)
  assert.equal(assessment.sections.length, 2)
  assert.equal(assessment.sections[0].questions.length, 3)
  assert.equal(assessment.sections[1].questions.length, 2)
  assert.equal(assessment.header.totalMarks, 10) // 5 kept × 2 marks — restamped
})

check('emptied trailing sections are dropped', () => {
  const { assessment } = clampAssessmentPreview({
    sections: [
      { title: 'A', questions: [q(1), q(2), q(3), q(4), q(5)] },
      { title: 'B', questions: [q(6)] },
    ],
  }, 5)
  assert.equal(assessment.sections.length, 1)
})

check('assessment at or under the cap passes through untouched', () => {
  const input = { sections: [{ title: 'A', questions: [q(1), q(2)] }] }
  const { assessment, truncated } = clampAssessmentPreview(input, 5)
  assert.equal(truncated, false)
  assert.strictEqual(assessment, input)
})

check('malformed assessment is returned untouched, never corrupted', () => {
  for (const bad of [null, {}, { sections: 'nope' }]) {
    const { assessment, truncated } = clampAssessmentPreview(bad, 5)
    assert.strictEqual(assessment, bad)
    assert.equal(truncated, false)
  }
})

check('scheme over the cap keeps only the first weeks and restamps the header', () => {
  const weeks = Array.from({ length: 12 }, (_, i) => ({ week: i + 1, topic: `T${i + 1}` }))
  const { scheme, truncated } = clampSchemePreview({ header: { numberOfWeeks: 12 }, weeks }, 2)
  assert.equal(truncated, true)
  assert.equal(scheme.weeks.length, 2)
  assert.equal(scheme.weeks[1].week, 2)
  assert.equal(scheme.header.numberOfWeeks, 2)
})

check('short scheme passes through untouched', () => {
  const input = { weeks: [{ week: 1 }] }
  const { scheme, truncated } = clampSchemePreview(input, 2)
  assert.equal(truncated, false)
  assert.strictEqual(scheme, input)
})

check('malformed scheme is returned untouched', () => {
  const { scheme, truncated } = clampSchemePreview({ weeks: null }, 2)
  assert.equal(truncated, false)
  assert.equal(scheme.weeks, null)
})

console.log(`\nfreePreview: ${passed} checks passed`)
