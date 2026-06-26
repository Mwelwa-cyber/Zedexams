/**
 * Tests for Visual Studio label/version logic (teacher / learner / answer key)
 * and the Assessment-Studio question patch.
 */
import assert from 'node:assert'
import {
  assignLetters, labelTextForVersion, answerKeyLines, blankLabelsFor,
  buildQuestionPatch, LETTER_SEQUENCE,
  defaultFollowUps, buildAssessmentDiagramHandoff,
} from '../src/features/visualStudio/lib/visualVersions.js'

const labels = [
  { id: 'a', x: 0.1, y: 0.1, text: 'Nose' },
  { id: 'b', x: 0.2, y: 0.2, text: 'Trachea' },
  { id: 'c', x: 0.3, y: 0.3, text: 'Lungs' },
]

// Zambian exam letters start at P, Q, R…
assert.equal(LETTER_SEQUENCE[0], 'P')
const lettered = assignLetters(labels)
assert.deepEqual(lettered.map((l) => l.letter), ['P', 'Q', 'R'])
// assignLetters must not mutate the input.
assert.equal(labels[0].letter, undefined)

// teacher → word, learner/answerKey → letter, picture → nothing.
assert.equal(labelTextForVersion(lettered[0], 'teacher'), 'Nose')
assert.equal(labelTextForVersion(lettered[0], 'learner'), 'P')
assert.equal(labelTextForVersion(lettered[1], 'answerKey'), 'Q')
assert.equal(labelTextForVersion(lettered[0], 'picture'), '')

assert.deepEqual(blankLabelsFor(labels), ['P', 'Q', 'R'])
assert.deepEqual(answerKeyLines(labels), ['P = Nose', 'Q = Trachea', 'R = Lungs'])

// Learner question patch → labelled blanks + answer-key legend + image.
const patch = buildQuestionPatch({
  imageUrl: 'https://x/y.png', imageAlt: 'respiratory system', labels,
  version: 'learner', instruction: 'Study the diagram below and answer the questions.',
})
assert.equal(patch.imageUrl, 'https://x/y.png')
assert.equal(patch.imageAlt, 'respiratory system')
assert.equal(patch.answerFormat, 'labelled_blanks')
assert.deepEqual(patch.blankLabels, ['P', 'Q', 'R'])
assert.ok(patch.explanation.includes('P = Nose'), 'answer key travels in explanation')
assert.equal(patch.text, 'Study the diagram below and answer the questions.')

// Picture-only / no labels → no blank rows.
const patch2 = buildQuestionPatch({ imageUrl: 'u', labels: [], version: 'picture' })
assert.equal(patch2.answerFormat, undefined)
assert.equal(patch2.blankLabels, undefined)
assert.equal(patch2.imageUrl, 'u')

// Default instruction used when none given.
const patch3 = buildQuestionPatch({ imageUrl: 'u', labels })
assert.ok(/Study the diagram/i.test(patch3.text))

// Assessment Diagram mode: follow-up suggestions from labels.
const fu = defaultFollowUps(labels)
assert.ok(fu.length >= 1, 'at least one follow-up suggested')
assert.ok(/function of the part labelled Q/.test(fu[0]), 'function-of-part question')
assert.ok(fu.some((t) => /importance of the part labelled R/.test(t)), 'importance question')
assert.deepEqual(defaultFollowUps([]), [], 'no labels → no suggestions')

// Assessment Diagram handoff: image question (no answer space) + scaffolded
// follow-ups, with "Name the parts" auto-built from the labels.
const handoff = buildAssessmentDiagramHandoff({
  imageUrl: 'u', labels, instruction: 'Study it.', followUps: ['Why is part P important?'],
})
assert.equal(handoff.imageUrl, 'u')
assert.equal(handoff.text, 'Study it.')
assert.equal(handoff.answerFormat, 'none')
assert.ok(Array.isArray(handoff.followUps))
assert.equal(handoff.followUps[0].answerFormat, 'labelled_blanks')
assert.deepEqual(handoff.followUps[0].blankLabels, ['P', 'Q', 'R'])
assert.ok(handoff.followUps[0].explanation.includes('P = Nose'))
assert.equal(handoff.followUps[handoff.followUps.length - 1].text, 'Why is part P important?')

// No labels → no "name the parts" question, but free-text follow-ups remain.
const handoff2 = buildAssessmentDiagramHandoff({ imageUrl: 'u', labels: [], followUps: ['Describe the picture.'] })
assert.equal(handoff2.followUps.length, 1)
assert.equal(handoff2.followUps[0].answerFormat, 'lines')

console.log('✓ visual-versions tests passed')
