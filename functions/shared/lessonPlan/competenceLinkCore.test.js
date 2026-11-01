/**
 * competenceLinkCore — the general competences on a CBC lesson plan must
 * show in its lesson goal or rationale.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import {
  COMPETENCE_LINK_DIRECTIVE,
  competenceShown,
  missingCompetences,
  competenceSentence,
  ensureCompetenceLink,
} from './competenceLinkCore.js'

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

// The official CDC Form 1 Geography sample, verbatim goal + rationale.
const GEOGRAPHY_SAMPLE = {
  generalCompetences: ['Analytical thinking', 'Citizenship', 'Collaboration', 'Environmental Sustainability'],
  lessonGoal: 'To enable learners, appreciate the importance of natural resources and develop the ability to use them responsibly and ensuring sustainable development.',
  rationale: 'This lesson is on natural resources and is particularly focused on their identification. Through group discussions and collaboration, learners will acquire a value of appreciating natural resources. This is Lesson 1 of 3.',
}

test('directive keeps the goal to one sentence and forbids the numbered-goal format', () => {
  assert.match(COMPETENCE_LINK_DIRECTIVE, /ONE SMART sentence/)
  assert.match(COMPETENCE_LINK_DIRECTIVE, /never a numbered list/)
  assert.match(COMPETENCE_LINK_DIRECTIVE, /RATIONALE/)
})

test('the official Geography sample shows three of its four competences and misses one', () => {
  // Analytical thinking is listed in the sample but appears in neither the
  // goal nor the rationale — exactly the gap this module exists to close.
  assert.deepEqual(missingCompetences(GEOGRAPHY_SAMPLE), ['Analytical thinking'])
})

test('competences are recognised by name and by the words that show them', () => {
  assert.ok(competenceShown('Critical Thinking', 'learners will develop critical thinking'))
  assert.ok(competenceShown('Collaboration', 'learners work in groups to sort the cards'))
  assert.ok(competenceShown('Problem Solving', 'suggest solutions to litter at school'))
  assert.ok(competenceShown('Creativity & Innovation', 'learners will develop creativity and innovation'))
  assert.ok(competenceShown('Critical thinking: ability to analyse and evaluate', 'evaluate the options'))
  assert.ok(!competenceShown('Digital Literacy', 'learners sort seeds into groups'))
})

test('a competence outside the framework list is matched on its own word', () => {
  assert.ok(competenceShown('Self-management skills', 'builds self-management in learners'))
  assert.ok(!competenceShown('Leadership', 'learners draw a map'))
})

test('competences given as one string are split on commas, never on "and"', () => {
  assert.deepEqual(
    missingCompetences({
      generalCompetences: 'Collaboration, Creativity and Innovation; Digital Literacy',
      lessonGoal: 'Learners should be able to work in groups to make a toy car.',
      rationale: 'This lesson is on toys.',
    }),
    ['Creativity and Innovation', 'Digital Literacy'],
  )
})

test('no competences, or a non-object, means nothing is missing', () => {
  assert.deepEqual(missingCompetences({lessonGoal: 'x', rationale: 'y'}), [])
  assert.deepEqual(missingCompetences(null), [])
})

test('the sentence names the missing competences in framework wording', () => {
  assert.equal(competenceSentence(['Analytical thinking']), 'Through these activities, learners will also develop analytical thinking.')
  assert.equal(
    competenceSentence(['Creativity & Innovation', 'Citizenship', 'Digital Literacy']),
    'Through these activities, learners will also develop creativity and innovation, citizenship and digital literacy.',
  )
  assert.equal(competenceSentence([]), '')
})

test('the repair goes BEFORE the closing position sentence', () => {
  const out = ensureCompetenceLink(GEOGRAPHY_SAMPLE)
  assert.equal(
    out.rationale,
    'This lesson is on natural resources and is particularly focused on their identification. Through group discussions and collaboration, learners will acquire a value of appreciating natural resources. Through these activities, learners will also develop analytical thinking. This is Lesson 1 of 3.',
  )
  assert.deepEqual(missingCompetences(out), [], 'after the repair nothing is missing')
})

test('a rationale without a position sentence gets the repair appended', () => {
  const out = ensureCompetenceLink({
    generalCompetences: ['Digital Literacy'],
    lessonGoal: 'Learners should be able to name three parts of a plant.',
    rationale: 'This lesson is on parts of a plant',
  })
  assert.equal(out.rationale, 'This lesson is on parts of a plant. Through these activities, learners will also develop digital literacy.')
})

test('a rationale that is only the position sentence gets the repair in front', () => {
  const out = ensureCompetenceLink({
    generalCompetences: ['Citizenship'],
    lessonGoal: 'Learners should be able to draw a map.',
    rationale: 'This is lesson 2 in a series of 3.',
  })
  assert.equal(out.rationale, 'Through these activities, learners will also develop citizenship. This is lesson 2 in a series of 3.')
})

test('nothing changes when every competence already shows — same object back', () => {
  const plan = {
    generalCompetences: ['Collaboration', 'Critical Thinking'],
    lessonGoal: 'Learners should be able to work in groups to evaluate ways of saving water.',
    rationale: 'This lesson is on saving water. This is lesson 1 in a series of 2.',
  }
  assert.equal(ensureCompetenceLink(plan), plan)
})

test('an empty rationale and a local-language plan are left alone', () => {
  const empty = {generalCompetences: ['Citizenship'], lessonGoal: 'Draw a map.', rationale: ''}
  assert.equal(ensureCompetenceLink(empty), empty)
  const local = {generalCompetences: ['Citizenship'], lessonGoal: 'x', rationale: 'Ici ni isambililo.'}
  assert.equal(ensureCompetenceLink(local, {localLanguage: true}), local)
})

test('the repair never touches the lesson goal or the competence list', () => {
  const out = ensureCompetenceLink(GEOGRAPHY_SAMPLE)
  assert.equal(out.lessonGoal, GEOGRAPHY_SAMPLE.lessonGoal)
  assert.equal(out.generalCompetences, GEOGRAPHY_SAMPLE.generalCompetences)
})

console.log(`\ncompetenceLinkCore: ${passed} passed`)
