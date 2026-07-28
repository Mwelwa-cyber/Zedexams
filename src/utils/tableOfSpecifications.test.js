/** Run: node src/utils/tableOfSpecifications.test.js */
import assert from 'node:assert/strict'
import {
  TOS_TAXONOMY_OPTIONS,
  buildTableOfSpecificationsModel,
  buildTableOfSpecificationsHtml,
  tableOfSpecificationsFilename,
  tableOfSpecificationsRows,
} from './tableOfSpecifications.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (error) {
    console.error(`✗ ${name}\n  ${error.message}`)
    process.exitCode = 1
  }
}

const blueprint = {
  version: 'blueprint.v1',
  grade: 'G4',
  gradeLabel: 'Grade 4',
  subject: 'mathematics',
  framework: '2023',
  assessmentType: 'end_of_term',
  term: 2,
  totalMarks: 10,
  durationMinutes: 40,
  sections: [{
    items: [
      { topic: 'Fractions', bloomLevel: 'remember', marks: 1 },
      { topic: 'Fractions', bloomLevel: 'understand', marks: 2 },
      { topic: 'Fractions', bloomLevel: 'apply', marks: 2 },
      { topic: 'Angles', bloomLevel: 'analyse', marks: 2 },
      { topic: 'Angles', bloomLevel: 'create', marks: 1 },
      { topic: 'Angles', bloomLevel: 'evaluate', marks: 2 },
    ],
  }],
}

test('groups questions by topic and traditional cognitive column', () => {
  const rows = tableOfSpecificationsRows(blueprint, 'traditional')
  assert.deepEqual(rows.map((row) => row.topic), ['Fractions', 'Angles'])
  assert.equal(rows[0].knowledge, 1)
  assert.equal(rows[0].comprehension, 1)
  assert.equal(rows[0].application, 1)
  assert.equal(rows[1].analysis, 1)
  assert.equal(rows[1].synthesis, 1)
  assert.equal(rows[1].evaluation, 1)
})

test('uses revised Bloom wording and revised evaluate-before-create order', () => {
  const model = buildTableOfSpecificationsModel(blueprint, { bloomTaxonomy: 'revised' })
  assert.deepEqual(
    model.columns.map((column) => column.label),
    ['Remember', 'Understand', 'Apply', 'Analyse', 'Evaluate', 'Create'],
  )
  assert.equal(model.rows[0].remember, 1)
  assert.equal(model.rows[0].understand, 1)
  assert.equal(model.rows[0].apply, 1)
  assert.equal(model.rows[1].analyse, 1)
  assert.equal(model.rows[1].evaluate, 1)
  assert.equal(model.rows[1].create, 1)
})

test('publishes both teacher-selectable taxonomy choices', () => {
  assert.deepEqual(
    TOS_TAXONOMY_OPTIONS.map((option) => option.id),
    ['traditional', 'revised'],
  )
})

test('totals and filing metadata reconcile with the blueprint', () => {
  const model = buildTableOfSpecificationsModel(blueprint, { year: '2026' })
  assert.equal(model.totals.questions, 6)
  assert.equal(model.totals.marks, 10)
  assert.equal(model.term, '2')
  assert.equal(model.durationMinutes, 40)
  assert.equal(model.valid, true)
})

test('HTML identifies the selected format and preserves term, duration and totals', () => {
  const html = buildTableOfSpecificationsHtml(blueprint, {
    schoolName: 'Jemareen Academy',
    bloomTaxonomy: 'revised',
    year: '2026',
  })
  assert.match(html, /Jemareen Academy/)
  assert.match(html, /TABLE OF SPECIFICATIONS/)
  assert.match(html, /Revised Bloom&#039;s Taxonomy/)
  assert.match(html, /Term 2 · 2026/)
  assert.match(html, /40 minutes/)
  assert.match(html, /6 questions · 10 marks/)
  assert.match(html, /Remember/)
  assert.match(html, /Evaluate/)
  assert.match(html, /Create/)
  assert.ok(html.indexOf('Evaluate') < html.indexOf('Create'))
  assert.match(html, /KEEP IN THE TEACHER'S ASSESSMENT FILE/i)
})

test('download filenames identify the selected taxonomy', () => {
  const traditional = buildTableOfSpecificationsModel(blueprint)
  const revised = buildTableOfSpecificationsModel(blueprint, { bloomTaxonomy: 'revised' })
  assert.equal(
    tableOfSpecificationsFilename(traditional),
    'Grade-4-Mathematics-End-Of-Term-Traditional-Blooms-Table-of-Specifications.docx',
  )
  assert.equal(
    tableOfSpecificationsFilename(revised),
    'Grade-4-Mathematics-End-Of-Term-Revised-Blooms-Table-of-Specifications.docx',
  )
})

console.log(`✓ table of specifications — ${passed} tests passed`)
