/** Run: node src/utils/tableOfSpecifications.test.js */
import assert from 'node:assert/strict'
import {
  TOS_MODES,
  TOS_TAXONOMY_OPTIONS,
  addTableOfSpecificationsRow,
  blankTableOfSpecificationsRows,
  buildTableOfSpecificationsModel,
  buildTableOfSpecificationsHtml,
  convertTableOfSpecificationsRows,
  normalizeTableOfSpecificationsRows,
  removeTableOfSpecificationsRow,
  setTableOfSpecificationsCell,
  setTableOfSpecificationsTopic,
  suggestTableOfSpecificationsRows,
  tableOfSpecificationsCellText,
  tableOfSpecificationsEdited,
  tableOfSpecificationsFilename,
  tableOfSpecificationsRows,
  tableOfSpecificationsRowsFromQuestions,
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

/* ── derived from the paper rather than the plan ─────────────────────────── */

// The studio's own question shape: `bloom` is what it persists, `bloomLevel`
// what the generator emits, and a question may carry neither.
const questions = [
  { topic: 'Fractions', bloom: 'remember', marks: 1 },
  { topic: 'Fractions', bloomLevel: 'understand', marks: 2 },
  { topic: 'Angles', bloom: 'analyze', marks: 3 },
]

test('describes the paper as it now stands, not only as it was planned', () => {
  const rows = tableOfSpecificationsRowsFromQuestions(questions, 'revised')
  assert.deepEqual(rows.map((row) => row.topic), ['Fractions', 'Angles'])
  assert.equal(rows[0].remember, 1)
  assert.equal(rows[0].understand, 1)
  // 'analyze' and 'analyse' are the same level; a paper tagged either way counts.
  assert.equal(rows[1].analyse, 1)
  assert.equal(rows[1].marks, 3)
})

test('the paper wins over the plan once there are questions to describe', () => {
  // A teacher who deleted half the paper must not file a specification for the
  // paper they were originally offered.
  const rows = suggestTableOfSpecificationsRows({ blueprint, questions }, 'revised')
  assert.equal(rows.length, 2)
  assert.equal(rows.reduce((n, row) => n + row.questions, 0), 3)
})

test('falls back to the plan, then to a blank frame — never to nothing', () => {
  assert.equal(suggestTableOfSpecificationsRows({ blueprint }, 'revised').length, 2)
  assert.ok(suggestTableOfSpecificationsRows({}, 'revised').length > 0)
})

test('an untagged question is reported, never folded into a column', () => {
  // The Total column has to add up across on a document that gets signed, so an
  // untagged question cannot be quietly added to it — the teacher is told.
  const model = buildTableOfSpecificationsModel(
    { questions: [...questions, { topic: 'Angles', marks: 4 }] },
    { bloomTaxonomy: 'revised' },
  )
  assert.equal(model.totals.questions, 3)
  assert.equal(model.totals.untagged, 1)
  assert.equal(model.totals.marks, 10)
})

/* ── the blank frame ─────────────────────────────────────────────────────── */

test('publishes both ways of filling the grid in', () => {
  assert.deepEqual(TOS_MODES.map((mode) => mode.id), ['suggested', 'blank'])
})

test('a blank grid prints the frame and claims nothing about the paper', () => {
  const model = buildTableOfSpecificationsModel(blueprint, { mode: 'blank' })
  assert.equal(model.blank, true)
  assert.equal(model.rows.length, 6)
  assert.equal(model.totals.questions, 0)
  // It is not this paper's specification, so it must not report as a valid one.
  assert.equal(model.valid, false)
  const html = buildTableOfSpecificationsHtml(blueprint, { mode: 'blank' })
  assert.match(html, /complete by hand/i)
  assert.match(html, /TABLE OF SPECIFICATIONS/)
})

test('a blank filename says it is blank, so two downloads do not collide', () => {
  const model = buildTableOfSpecificationsModel(blueprint, { mode: 'blank' })
  assert.match(tableOfSpecificationsFilename(model), /-Blank-Table-of-Specifications\.docx$/)
})

test('an empty cell prints empty — a grid of zeroes reads as a broken export', () => {
  assert.equal(tableOfSpecificationsCellText(0), '')
  assert.equal(tableOfSpecificationsCellText(''), '')
  assert.equal(tableOfSpecificationsCellText(3), '3')
  const html = buildTableOfSpecificationsHtml(blueprint, { mode: 'blank' })
  assert.equal(html.includes('<td>0</td>'), false)
})

/* ── the teacher's edits ─────────────────────────────────────────────────── */

test('a corrected cell re-totals its row, so the sheet always adds up', () => {
  const rows = tableOfSpecificationsRows(blueprint, 'revised')
  const next = setTableOfSpecificationsCell(rows, 0, 'remember', '4', 'revised')
  assert.equal(next[0].remember, 4)
  assert.equal(next[0].questions, 6) // 4 + 1 understand + 1 apply
  assert.equal(next[1].questions, 3) // the other row is untouched
})

test('nonsense in a cell becomes an empty cell rather than NaN on a filed sheet', () => {
  const rows = tableOfSpecificationsRows(blueprint, 'revised')
  for (const bad of ['', '-2', 'abc', null, 2.7]) {
    const next = setTableOfSpecificationsCell(rows, 0, 'remember', bad, 'revised')
    assert.equal(Number.isInteger(next[0].remember), true, String(bad))
    assert.ok(next[0].remember >= 0, String(bad))
  }
  assert.equal(setTableOfSpecificationsCell(rows, 0, 'remember', 2.7, 'revised')[0].remember, 2)
})

test('rows can be added and removed, but never down to no table at all', () => {
  const rows = tableOfSpecificationsRows(blueprint, 'revised')
  assert.equal(addTableOfSpecificationsRow(rows, 'revised').length, 3)
  assert.equal(removeTableOfSpecificationsRow(rows, 0).length, 1)
  assert.equal(removeTableOfSpecificationsRow([rows[0]], 0).length, 1)
})

test('a renamed topic keeps its figures', () => {
  const rows = tableOfSpecificationsRows(blueprint, 'revised')
  const next = setTableOfSpecificationsTopic(rows, 1, '4.5 Angles')
  assert.equal(next[1].topic, '4.5 Angles')
  assert.equal(next[1].analyse, 1)
})

test('the teacher’s figures reach the document, not the suggestion’s', () => {
  const rows = setTableOfSpecificationsCell(
    tableOfSpecificationsRows(blueprint, 'revised'), 0, 'remember', 5, 'revised',
  )
  const model = buildTableOfSpecificationsModel(blueprint, { bloomTaxonomy: 'revised', rows })
  assert.equal(model.totals.remember, 5)
  assert.equal(model.totals.questions, 10)
  assert.match(buildTableOfSpecificationsHtml(blueprint, { bloomTaxonomy: 'revised', rows }), /<td>5<\/td>/)
})

test('switching Bloom wording relabels the grid without losing corrections', () => {
  // Both vocabularies carry one column per cognitive level, so this is lossless
  // — a teacher who has corrected six rows must not be reset by a relabelling.
  const rows = setTableOfSpecificationsCell(
    tableOfSpecificationsRows(blueprint, 'revised'), 0, 'remember', 5, 'revised',
  )
  const traditional = convertTableOfSpecificationsRows(rows, 'revised', 'traditional')
  assert.equal(traditional[0].knowledge, 5)
  assert.equal(traditional[0].comprehension, 1)
  assert.equal(traditional[1].synthesis, 1)   // revised "create"
  assert.equal(traditional[1].evaluation, 1)  // revised "evaluate"
  assert.equal(traditional[0].topic, 'Fractions')
  // And back again, unchanged.
  const roundTrip = convertTableOfSpecificationsRows(traditional, 'traditional', 'revised')
  assert.deepEqual(roundTrip, normalizeTableOfSpecificationsRows(rows, 'revised'))
})

test('knows whether the teacher has moved away from the suggestion', () => {
  const rows = tableOfSpecificationsRows(blueprint, 'revised')
  assert.equal(tableOfSpecificationsEdited(rows, rows, 'revised'), false)
  const changed = setTableOfSpecificationsCell(rows, 0, 'remember', 5, 'revised')
  assert.equal(tableOfSpecificationsEdited(changed, rows, 'revised'), true)
  assert.equal(tableOfSpecificationsEdited(blankTableOfSpecificationsRows(2, 'revised'), rows, 'revised'), true)
})

test('the sheet is numbered and headed the way a filed copy is', () => {
  const html = buildTableOfSpecificationsHtml(blueprint, { schoolName: 'Dudzai Primary School' })
  assert.match(html, /MINISTRY OF EDUCATION/)
  assert.match(html, /Dudzai Primary School/)
  assert.match(html, /S\/N/)
  assert.match(html, /Topics covered|Topic \/ Syllabus Area/)
})

console.log(`✓ table of specifications — ${passed} tests passed`)
