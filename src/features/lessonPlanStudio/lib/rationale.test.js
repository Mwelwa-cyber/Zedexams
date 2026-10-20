import assert from 'node:assert/strict'
import {
  ensureRationalePosition,
  hasRationalePosition,
  rationalePositionSentence,
  rationalePositionPromptLine,
  RATIONALE_DIRECTIVE,
} from './rationale.js'

// The directive names all four parts the teacher asked for.
for (const part of ['lesson content', 'value or importance', 'teaching methods', 'This is lesson K in a series of N.']) {
  assert.ok(RATIONALE_DIRECTIVE.includes(part), `directive names: ${part}`)
}

assert.equal(rationalePositionSentence(2, 3), 'This is lesson 2 in a series of 3.')
assert.equal(rationalePositionSentence(undefined, undefined), 'This is lesson 1 in a series of 1.')
assert.equal(rationalePositionSentence(3, 2), 'This is lesson 3 in a series of 3.', 'never "lesson 3 of 2"')
assert.match(rationalePositionPromptLine(1, 2), /This is lesson 1 in a series of 2\./)

// Recognises the phrasings Zambian plans use.
assert.ok(hasRationalePosition('This is lesson 1 in a series of 2.'))
assert.ok(hasRationalePosition('This lesson is number 1 in the series of 2.'))
assert.ok(hasRationalePosition('This is lesson 2 of 4.'))
assert.ok(hasRationalePosition('It is the first of three lessons.'))
assert.ok(!hasRationalePosition('Learners will use group work and discussion.'))

const pos = { lessonNumber: 1, totalLessons: 2 }

// A rationale missing its position gets the sentence appended.
const missing = { rationale: 'This lesson is on ICT tools. Group work will be used' }
assert.equal(
  ensureRationalePosition(missing, pos).rationale,
  'This lesson is on ICT tools. Group work will be used. This is lesson 1 in a series of 2.',
)
assert.equal(
  ensureRationalePosition({ rationale: 'Group work will be used.' }, pos).rationale,
  'Group work will be used. This is lesson 1 in a series of 2.',
)

// One that already has it is returned unchanged, by identity.
const complete = { rationale: 'Content. Value. Methods. This is lesson 1 in a series of 2.' }
assert.equal(ensureRationalePosition(complete, pos), complete)

// Empty, switched-off and local-language rationales are left alone.
const empty = { rationale: '' }
assert.equal(ensureRationalePosition(empty, pos), empty)
const noField = { lessonGoal: 'x' }
assert.equal(ensureRationalePosition(noField, pos), noField)
assert.equal(ensureRationalePosition(missing, { ...pos, localLanguage: true }), missing)
assert.equal(ensureRationalePosition(null, pos), null)

console.log('rationale: all assertions passed')
