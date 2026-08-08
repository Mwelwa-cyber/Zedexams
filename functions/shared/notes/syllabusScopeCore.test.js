/**
 * The grade ceiling.
 *
 * The named cases from the acceptance checklist (§7) are the fixtures: Grade 7
 * digestive notes must not carry "jejunum", and Grade 4 skin notes must not
 * carry "melanocytes" or "homeostasis" — while the SAME terms in a Grade 12
 * document are correct and must pass untouched. A ceiling that fires at every
 * grade is not a ceiling.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import {
  ABOVE_GRADE_TERMS,
  canonicalGrade,
  checkScope,
  coverageGaps,
  findOutOfScopeTerms,
  gradeRank,
  scopeMessage,
} from './syllabusScopeCore.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

test('grades rank in teaching order', () => {
  assert.ok(gradeRank('G4') < gradeRank('G7'))
  assert.ok(gradeRank('G7') < gradeRank('G12'))
  assert.ok(gradeRank('ECE_N') < gradeRank('G1'))
  assert.equal(gradeRank('nonsense'), -1)
})

test('a Form code ranks as the secondary grade it replaces', () => {
  assert.equal(canonicalGrade('F1'), 'G8')
  assert.ok(gradeRank('F1') > gradeRank('G7'))
})

test('Grade 7 digestive notes must not reach the jejunum', () => {
  const text = 'Food then passes into the small intestine, made of the duodenum, jejunum and ileum.'
  const hits = findOutOfScopeTerms(text, { grade: 'G7', subject: 'integrated_science' })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].term, 'jejunum')
  assert.ok(hits[0].note.includes('duodenum'), 'the finding must say what the book DOES teach')
})

test('the same sentence at Grade 10 is correct and passes', () => {
  const text = 'The small intestine is made of the duodenum, jejunum and ileum.'
  assert.deepEqual(findOutOfScopeTerms(text, { grade: 'G10', subject: 'biology' }), [])
})

test('Grade 4 skin notes must not reach melanocytes or homeostasis', () => {
  const text = 'The epidermis contains melanocytes, and the skin maintains homeostasis of body temperature.'
  const terms = findOutOfScopeTerms(text, { grade: 'G4', subject: 'integrated_science' })
    .map((h) => h.term)
  assert.ok(terms.includes('melanocyte'))
  assert.ok(terms.includes('homeostasis'))
})

test('Grade 12 skin notes carrying the same terms pass', () => {
  const text = 'The epidermis contains melanocytes, and the skin maintains homeostasis.'
  assert.deepEqual(findOutOfScopeTerms(text, { grade: 'G12', subject: 'biology' }), [])
})

test('a rule scoped to a subject does not fire in another subject', () => {
  // "mole" is a chemistry quantity at G10; the word in a Grade 4 Integrated
  // Science note about animals is an animal.
  const hits = findOutOfScopeTerms('A mole digs tunnels under the ground.', {
    grade: 'G4', subject: 'integrated_science',
  })
  assert.deepEqual(hits, [])
})

test('an unrankable grade reports nothing rather than guessing a ceiling', () => {
  assert.deepEqual(findOutOfScopeTerms('melanocytes everywhere', { grade: '', subject: 'biology' }), [])
})

test('every registry entry names the grade that introduces it', () => {
  for (const entry of ABOVE_GRADE_TERMS) {
    assert.ok(entry.term, 'entry needs a term')
    assert.ok(gradeRank(entry.introducedAt) >= 0, `${entry.term} has an unrankable introducedAt`)
  }
})

test('the completeness floor reports an outcome the draft never covered', () => {
  const draft = 'Your teeth cut food into small pieces. Then you swallow it.'
  const gaps = coverageGaps(draft, [
    'describe how teeth break down food',
    'explain the role of the liver in digestion',
  ])
  assert.equal(gaps.length, 1)
  assert.match(gaps[0], /liver/)
})

test('a reworded outcome still counts as covered', () => {
  const draft = 'The parts of a flower are the petal, the stem, the leaf and the roots.'
  assert.deepEqual(coverageGaps(draft, ['identify the parts of a flower']), [])
})

test('checkScope names the section so one section can be regenerated', () => {
  const notes = {
    sections: [
      { heading: 'Your mouth', body: ['Your teeth cut food into small pieces.'] },
      { heading: 'The small intestine', body: ['Next comes the jejunum, where most food is absorbed.'] },
    ],
    exercise: { questions: [{ prompt: 'Name two parts of your digestive system.' }] },
  }
  const result = checkScope(notes, { grade: 'G7', subject: 'integrated_science', outcomes: [] })
  assert.equal(result.ok, false)
  assert.deepEqual(result.sections, ['sections'])
  assert.equal(result.outOfScope[0].section, 'sections.1')
  assert.match(scopeMessage(result), /jejunum/)
})

test('a scope check with no outcomes and no rankable grade reports UNCHECKED, not ok', () => {
  // Reporting a pass here would be reporting absence of evidence as evidence
  // of absence — the studio needs to tell the teacher it did not look.
  const result = checkScope({ sections: [] }, { grade: '', subject: '', outcomes: [] })
  assert.equal(result.checked, false)
})

test('a clean in-scope draft passes and is marked checked', () => {
  const notes = {
    sections: [{ heading: 'Your mouth', body: ['Your teeth cut food into small pieces.'] }],
  }
  const result = checkScope(notes, {
    grade: 'G4', subject: 'integrated_science',
    outcomes: ['describe how teeth break down food'],
  })
  assert.equal(result.checked, true)
  assert.equal(result.ok, true)
  assert.equal(scopeMessage(result), '')
})

if (process.exitCode) {
  console.error('\n✗ syllabus scope check FAILED')
} else {
  console.log(`\n✓ syllabus scope check — ${passed} checks passed`)
}
