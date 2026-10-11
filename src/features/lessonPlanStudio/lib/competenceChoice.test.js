import assert from 'node:assert/strict'
import { applyCompetenceChoice, competencesOf } from './competenceChoice.js'

const A = { specificCompetence: '1.5.1.1 Use devices', learningActivities: ['a1'], expectedStandard: 'sA' }
const B = { specificCompetence: '1.5.1.2 Ethical use', learningActivities: ['b1', 'b2'], expectedStandard: 'sB' }
const row = { topic: 't', subtopic: 's', ...A, competences: [A, B] }

assert.deepEqual(competencesOf(null), [])
assert.deepEqual(competencesOf({}), [])

// Choosing the second swaps exactly the three competence-owned fields.
const picked = applyCompetenceChoice(row, B.specificCompetence)
assert.equal(picked.specificCompetence, B.specificCompetence)
assert.deepEqual(picked.learningActivities, ['b1', 'b2'])
assert.equal(picked.expectedStandard, 'sB')
assert.equal(picked.topic, 't')
assert.equal(picked.competences, row.competences, 'the list is kept so the choice can be changed again')

// Nothing chosen, or a stale choice from another sub-topic, falls back to the first.
assert.equal(applyCompetenceChoice(row, undefined), row, 'no choice returns the same row (stable identity)')
assert.equal(applyCompetenceChoice(row, 'something from another sub-topic'), row)
assert.equal(applyCompetenceChoice(row, A.specificCompetence), row)

// One competence, no list (old drafts, other callers): the row passes through untouched.
const single = { topic: 't', ...A }
assert.equal(applyCompetenceChoice(single, B.specificCompetence), single)
assert.equal(applyCompetenceChoice(null, 'x'), null)

console.log('ok: competence choice — swap, fallback, stable identity')
