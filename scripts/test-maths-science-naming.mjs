/**
 * The combined maths/science learning area is never called "Numeracy".
 *
 * `numeracy` is the slug the ECE + Lower-Primary syllabus rows are stored
 * under, and one of the CBC key competences. It is not a subject on the 2023
 * syllabus, so it must not appear in a studio dropdown, a saved paper's header
 * or a message a teacher reads — the area is "Pre-Mathematics and Science" at
 * Nursery/Reception and "Mathematics and Science" from Grade 1.
 *
 * These tests cover the rule end to end: the names themselves, the studio
 * dropdown label, the round-trip back to the slug (a renamed label that no
 * longer folds to `numeracy` would fail every ALLOWED_SUBJECTS check on the
 * server), and the backend's own copy of the rule.
 *
 * Run: npm run test:maths-science-naming
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import {
  MATHS_SCIENCE_LABEL, PRE_MATHS_SCIENCE_LABEL, MATHS_SCIENCE_SUBJECT_KEY,
  isMathsScienceName, mathsScienceLabelForGrade, canonicalMathsScienceLabel,
  isEarlyChildhoodLevel,
} from '../src/config/mathsScienceArea.js'
import { subjectLabel, toKbSubjectKey } from '../src/shared/utils/paperTaxonomy.js'
import { getSubjectsForGrade } from '../src/config/teacherTaxonomy.js'
import { normalizeSubjectId } from '../src/config/curriculumCatalog.js'
import { cleanSubjectName } from '../src/shared/utils/subjectName.js'

const require = createRequire(import.meta.url)
const { subjectNameForGrade } = require('../functions/teacherTools/subjectNaming.js')
const { subjectLabelFor, curriculumRefusalMessage } =
  require('../functions/teacherTools/assessmentLabels.js')
const { buildUserPrompt } = require('../functions/teacherTools/assessmentPromptV10.js')

let failures = 0
function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failures += 1
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}

console.log('\nmaths/science learning-area naming\n')

// ── the names ────────────────────────────────────────────────────────────────

test('the two names are the syllabus\'s, and neither says "Numeracy"', () => {
  assert.equal(MATHS_SCIENCE_LABEL, 'Mathematics and Science')
  assert.equal(PRE_MATHS_SCIENCE_LABEL, 'Pre-Mathematics and Science')
  for (const label of [MATHS_SCIENCE_LABEL, PRE_MATHS_SCIENCE_LABEL]) {
    assert.ok(!/numeracy/i.test(label), `${label} must not say "Numeracy"`)
  }
})

test('ECE bands take the pre-formal name, Grade 1 up take the formal one', () => {
  for (const g of ['ECE', 'ECE_N', 'ECE_R', 'Nursery', 'Reception']) {
    assert.ok(isEarlyChildhoodLevel(g), `${g} is an ECE band`)
    assert.equal(mathsScienceLabelForGrade(g), PRE_MATHS_SCIENCE_LABEL, g)
  }
  for (const g of ['G1', 'G2', 'G3', 'G4']) {
    assert.equal(mathsScienceLabelForGrade(g), MATHS_SCIENCE_LABEL, g)
  }
})

test('with no grade the slug still resolves to a NAME, never to "Numeracy"', () => {
  assert.equal(mathsScienceLabelForGrade(), MATHS_SCIENCE_LABEL)
  assert.equal(mathsScienceLabelForGrade(''), MATHS_SCIENCE_LABEL)
})

test('every spelling the repo has produced is recognised as this area', () => {
  for (const name of [
    'numeracy', 'Numeracy', 'Numeracy (Maths & Science)',
    'Maths & Science', 'Mathematics and Science', 'mathematics_and_science',
    'Pre-Maths & Science', 'Pre-Mathematics and Science',
    'Pre-Mathematics and Pre-Science',
  ]) {
    assert.ok(isMathsScienceName(name), `${name} names this area`)
  }
})

test('subjects that merely mention maths or science are NOT this area', () => {
  for (const name of [
    'Mathematics', 'Mathematics II', 'Integrated Science',
    'Environmental Science', 'Agricultural Science', 'Social Studies',
  ]) {
    assert.ok(!isMathsScienceName(name), `${name} is its own subject`)
  }
})

test('a sheet name with no grade is read by its own "Pre-" prefix', () => {
  assert.equal(canonicalMathsScienceLabel('Pre-Maths & Science'), PRE_MATHS_SCIENCE_LABEL)
  assert.equal(canonicalMathsScienceLabel('Maths & Science'), MATHS_SCIENCE_LABEL)
  // An explicit grade always wins over the spelling it was handed.
  assert.equal(canonicalMathsScienceLabel('Maths & Science', 'ECE_R'), PRE_MATHS_SCIENCE_LABEL)
  assert.equal(canonicalMathsScienceLabel('Pre-Maths & Science', 'G2'), MATHS_SCIENCE_LABEL)
})

test('a subject that is not this area is left alone', () => {
  assert.equal(canonicalMathsScienceLabel('Integrated Science', 'G4'), '')
})

// ── the studio dropdowns ─────────────────────────────────────────────────────

test('subjectLabel names the area for its grade and never says "Numeracy"', () => {
  assert.equal(subjectLabel('numeracy', 'ECE_N'), PRE_MATHS_SCIENCE_LABEL)
  assert.equal(subjectLabel('numeracy', 'ECE_R'), PRE_MATHS_SCIENCE_LABEL)
  assert.equal(subjectLabel('numeracy', 'G1'), MATHS_SCIENCE_LABEL)
  assert.equal(subjectLabel('numeracy', 'G3'), MATHS_SCIENCE_LABEL)
  assert.equal(subjectLabel('numeracy'), MATHS_SCIENCE_LABEL)
})

test('no grade in either curriculum offers a subject called "Numeracy"', () => {
  const grades = [
    'ECE_N', 'ECE_R', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7',
    'G8', 'G9', 'G10', 'G11', 'G12',
  ]
  for (const curriculum of ['cbc', 'previous']) {
    for (const grade of grades) {
      for (const opt of getSubjectsForGrade(grade, curriculum)) {
        assert.ok(
          !/numeracy/i.test(opt.label || ''),
          `${curriculum} ${grade} offers "${opt.label}"`,
        )
      }
    }
  }
})

test('the ECE and Lower-Primary dropdowns name the area at their own level', () => {
  const labelOf = (opts, value) => (opts.find((o) => o.value === value) || {}).label
  assert.equal(labelOf(getSubjectsForGrade('ECE_N', 'cbc'), 'numeracy'), PRE_MATHS_SCIENCE_LABEL)
  assert.equal(labelOf(getSubjectsForGrade('ECE_R', 'cbc'), 'numeracy'), PRE_MATHS_SCIENCE_LABEL)
  assert.equal(labelOf(getSubjectsForGrade('G1', 'cbc'), 'numeracy'), MATHS_SCIENCE_LABEL)
  assert.equal(labelOf(getSubjectsForGrade('G3', 'cbc'), 'numeracy'), MATHS_SCIENCE_LABEL)
})

test('the syllabus sheet names print as the learning area, not as an abbreviation', () => {
  assert.equal(
    cleanSubjectName('Lower Primary Syllabi (Grades 1-3)::Grade 1 - Maths & Science'),
    MATHS_SCIENCE_LABEL,
  )
  assert.equal(
    cleanSubjectName('Early Childhood Education Syllabi (3-5 Years)::4-5 Years - Pre-Maths & Science'),
    PRE_MATHS_SCIENCE_LABEL,
  )
  // Every other sheet is untouched.
  assert.equal(
    cleanSubjectName('Lower Primary Syllabi (Grades 1-3)::Grade 2 - English Language'),
    'English Language',
  )
})

// ── the round trip ───────────────────────────────────────────────────────────
//
// Both labels are what the studio form STORES and sends. If one stopped
// folding back to `numeracy`, every generator's ALLOWED_SUBJECTS check would
// reject the paper — a rename would have quietly broken generation for three
// grades and Reception.

test('both names fold back to the storage slug', () => {
  for (const name of [
    MATHS_SCIENCE_LABEL, PRE_MATHS_SCIENCE_LABEL,
    'Numeracy (Maths & Science)', 'Maths & Science', 'Pre-Maths & Science',
    'numeracy',
  ]) {
    assert.equal(toKbSubjectKey(name), MATHS_SCIENCE_SUBJECT_KEY, `toKbSubjectKey(${name})`)
    assert.equal(normalizeSubjectId(name), MATHS_SCIENCE_SUBJECT_KEY, `normalizeSubjectId(${name})`)
  }
})

test('the round trip does not swallow the standalone subjects', () => {
  assert.equal(toKbSubjectKey('Mathematics'), 'mathematics')
  assert.equal(toKbSubjectKey('Integrated Science'), 'integrated_science')
  assert.equal(normalizeSubjectId('Mathematics'), 'mathematics')
  assert.equal(normalizeSubjectId('Integrated Science'), 'integrated_science')
})

// ── the backend half ─────────────────────────────────────────────────────────

test('the server names the area the same way the client does', () => {
  assert.equal(subjectNameForGrade('numeracy', 'ECE_R'), PRE_MATHS_SCIENCE_LABEL)
  assert.equal(subjectNameForGrade('numeracy', 'G2'), MATHS_SCIENCE_LABEL)
  assert.equal(subjectLabelFor('numeracy', 'ECE_N'), PRE_MATHS_SCIENCE_LABEL)
  assert.equal(subjectLabelFor('numeracy', 'G1'), MATHS_SCIENCE_LABEL)
  // Other subjects are untouched by the rewrite.
  assert.equal(subjectNameForGrade('integrated_science', 'G5'), 'integrated_science')
  assert.equal(subjectLabelFor('integrated_science', 'G5'), 'Integrated Science')
})

test('a refusal message names the area, not the slug', () => {
  const msg = curriculumRefusalMessage({grade: 'ECE_R', subject: 'numeracy', framework: '2023'})
  assert.ok(msg.startsWith(`${PRE_MATHS_SCIENCE_LABEL} for Reception`), msg)
  assert.ok(!/numeracy/i.test(msg), msg)
})

test('the generator prompt hands the model the NAME, never the slug', () => {
  for (const [grade, expected] of [['ECE_R', PRE_MATHS_SCIENCE_LABEL], ['G1', MATHS_SCIENCE_LABEL]]) {
    const prompt = buildUserPrompt({
      grade, subject: 'numeracy', topic: '1.4 Exploring Materials',
      totalMarks: 20, durationMinutes: 40, assessmentType: 'topic_test',
    })
    assert.ok(prompt.includes(`- Subject: ${expected}`), `${grade} subject line`)
    // The integrated-coverage rule survives the rename …
    assert.ok(prompt.includes('INTEGRATED Maths & Science'), `${grade} keeps the both-strands rule`)
    // … and the only mention of the slug is the instruction NOT to print it.
    const mentions = prompt.match(/numeracy/gi) || []
    assert.equal(mentions.length, 1, `${grade}: "Numeracy" appears ${mentions.length}×`)
    assert.ok(prompt.includes('never "Numeracy"'), `${grade} forbids the word explicitly`)
  }
})

test('a non-combined subject reaches the prompt unchanged', () => {
  const prompt = buildUserPrompt({
    grade: 'G8', subject: 'integrated_science', topic: 'Cells',
    totalMarks: 40, durationMinutes: 60, assessmentType: 'end_of_term',
  })
  assert.ok(prompt.includes('- Subject: integrated_science'))
  assert.ok(!/INTEGRATED Maths & Science/.test(prompt))
})

console.log('')
if (failures > 0) {
  console.error(`${failures} test(s) failed`)
  process.exit(1)
}
console.log('All maths/science naming tests passed')
