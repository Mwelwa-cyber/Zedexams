/**
 * The Notes Studio option vocabulary.
 *
 * The tests worth having here are the two that a later refactor would quietly
 * break: that a NEW note defaults to `learner` while a SAVED note with no
 * audience field reads as `teaching`, and that Length actually changes the
 * generation budget rather than only the layout.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import {
  DEFAULT_AUDIENCE,
  LEGACY_AUDIENCE,
  NOTE_AUDIENCES,
  NOTE_FORMATS,
  NOTE_LENGTHS,
  lengthBudget,
  isLearnerNotes,
  normalizeAudience,
  normalizeNotesOptions,
  notesLibraryLabel,
  readAudience,
} from './notesOptionsCore.js'

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

test('a new note defaults to learner notes', () => {
  assert.equal(DEFAULT_AUDIENCE, NOTE_AUDIENCES.LEARNER)
  assert.equal(normalizeAudience(undefined), NOTE_AUDIENCES.LEARNER)
  assert.equal(normalizeAudience('nonsense'), NOTE_AUDIENCES.LEARNER)
})

test('a saved note with no audience field is a TEACHING note', () => {
  // Every document written before the field existed came from the delivery
  // notes generator. Reading it as a learner handout would claim sections it
  // does not have.
  assert.equal(readAudience({ header: {}, keyConcepts: [] }), LEGACY_AUDIENCE)
  assert.equal(readAudience(null), LEGACY_AUDIENCE)
  assert.equal(isLearnerNotes({ keyConcepts: [] }), false)
  assert.equal(isLearnerNotes({ audience: 'learner' }), true)
})

test('an explicit audience on a saved note wins', () => {
  assert.equal(readAudience({ audience: 'learner' }), NOTE_AUDIENCES.LEARNER)
  assert.equal(readAudience({ audience: 'teaching' }), NOTE_AUDIENCES.TEACHING)
})

test('normalizeNotesOptions fills every field with a usable default', () => {
  const opts = normalizeNotesOptions({})
  assert.deepEqual(opts, {
    audience: 'learner',
    format: 'handout',
    detail: 'detailed',
    length: 'one',
    englishLevel: 'standard',
    paperSize: 'a4',
  })
})

test('normalizeNotesOptions can be told a different audience fallback', () => {
  // The library's read path passes `teaching` so an old document is not
  // silently converted on reopen.
  assert.equal(normalizeNotesOptions({}, { audienceFallback: 'teaching' }).audience, 'teaching')
})

test('Length changes the generation budget, not just the layout', () => {
  const half = lengthBudget({ length: NOTE_LENGTHS.HALF })
  const one = lengthBudget({ length: NOTE_LENGTHS.ONE })
  const two = lengthBudget({ length: NOTE_LENGTHS.TWO })
  assert.ok(half.words < one.words && one.words < two.words, 'word budgets must increase with length')
  assert.ok(half.sections <= one.sections && one.sections <= two.sections)
})

test('Summarised compresses the explanation but keeps the skeleton', () => {
  const detailed = lengthBudget({ length: 'one', detail: 'detailed' })
  const summarised = lengthBudget({ length: 'one', detail: 'summarised' })
  assert.ok(summarised.words < detailed.words, 'a revision sheet is shorter')
  assert.equal(summarised.includeFaq, false, 'a revision sheet drops the FAQ')
  // The boxed definitions, Remember! box and exercise are what make it a
  // revision sheet rather than a fragment.
  assert.equal(summarised.rememberPoints, detailed.rememberPoints)
  assert.equal(summarised.exerciseQuestions, detailed.exerciseQuestions)
})

test('Board notes carry no FAQ at any detail level', () => {
  for (const detail of ['summarised', 'detailed']) {
    const budget = lengthBudget({ length: 'two', detail, format: NOTE_FORMATS.BOARD })
    assert.equal(budget.faqs, 0, `board notes must not ask for an FAQ (${detail})`)
    assert.equal(budget.includeFaq, false)
  }
})

test('Board notes are shorter than a handout of the same length setting', () => {
  const handout = lengthBudget({ length: 'one', format: 'handout' })
  const board = lengthBudget({ length: 'one', format: 'board' })
  assert.ok(board.words < handout.words, 'a chalkboard holds less than a sheet')
})

test('the library label distinguishes a learner handout from teaching notes', () => {
  assert.equal(notesLibraryLabel({ audience: 'learner', format: 'handout' }), 'Learner notes — handout')
  assert.equal(notesLibraryLabel({ audience: 'learner', format: 'board' }), 'Learner notes — board notes')
  assert.equal(notesLibraryLabel({ keyConcepts: [] }), 'Teaching notes')
})

if (process.exitCode) {
  console.error('\n✗ notes options FAILED')
} else {
  console.log(`\n✓ notes option vocabulary — ${passed} checks passed`)
}
