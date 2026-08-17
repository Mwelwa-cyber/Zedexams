#!/usr/bin/env node
/**
 * scripts/test-grade-subjects.mjs
 *
 * The learner's "My subjects" list. Grade 7 is the ECZ Primary School
 * Leaving Examination set, and it must be exactly the seven subjects a
 * Grade 7 is taught — no more (the band-wide list put a Zambian-language
 * alternative and an exam paper on a child's home screen) and no fewer
 * (filtering by "has published material" showed one card where there
 * should be seven).
 */

import assert from 'node:assert/strict'
import {
  GRADE_SUBJECT_IDS, getGradeSubjects, getSubtopics, TOPICS, SUBJECTS,
} from '../src/config/curriculum.js'

let passed = 0
function test(name, fn) { fn(); passed += 1; console.log(`  ✓ ${name}`) }

test('Grade 7 is exactly the seven taught subjects, in teaching order', () => {
  const ids = getGradeSubjects(7).map((s) => s.id)
  assert.deepEqual(ids, [
    'english', 'mathematics', 'science', 'social-studies',
    'technology', 'expressive-arts', 'home-economics',
  ])
  assert.equal(ids.length, 7)
})

test('the two non-subjects stay off a learner home', () => {
  const ids = getGradeSubjects(7).map((s) => s.id)
  // One of SEVEN Zambian-language alternatives on the PSLE timetable —
  // listing it for everyone shows a Silozi learner a subject they do
  // not take.
  assert.ok(!ids.includes('cinyanja'))
  // "Special Paper 1" is an exam paper, not a taught subject.
  assert.ok(!ids.includes('creative-technology-studies'))
})

test('every listed subject resolves to a real subject object with a label', () => {
  for (const s of getGradeSubjects(7)) {
    assert.ok(s && s.id && s.label, `bad subject entry: ${JSON.stringify(s)}`)
    assert.ok(SUBJECTS.some((x) => x.id === s.id))
  }
})

test('ids are ids, never labels — the bug that lost multi-word subjects', () => {
  // "Integrated Science".toLowerCase() is not "science"; grouping content
  // by a lowercased LABEL silently dropped every multi-word subject.
  const science = getGradeSubjects(7).find((s) => s.id === 'science')
  assert.equal(science.label, 'Integrated Science')
  assert.notEqual(science.label.toLowerCase(), science.id)
})

test('every Grade 7 subject has a topic catalogue to show', () => {
  for (const s of getGradeSubjects(7)) {
    const topics = TOPICS[s.id]?.[7] || []
    assert.ok(topics.length > 0, `${s.id} has no Grade 7 topics`)
  }
})

test('subtopics resolve for the subjects that have them', () => {
  // Real catalogue data — not every subject is covered yet, but the ones
  // that are must come back through the accessor the subject page uses.
  const subs = getSubtopics('mathematics', 7, TOPICS.mathematics[7][0])
  assert.ok(Array.isArray(subs) && subs.length > 0, 'maths topic 1 has no subtopics')
  assert.deepEqual(getSubtopics('mathematics', 7, 'No Such Topic'), [])
})

test('an unlisted grade falls back to subjects that have content, not to nothing', () => {
  const g5 = getGradeSubjects(5)
  assert.ok(g5.length > 0)
  assert.ok(!GRADE_SUBJECT_IDS[5], 'Grade 5 is expected to be unlisted for this case')
})

test('a nonsense grade is empty rather than everything', () => {
  assert.deepEqual(getGradeSubjects(null), [])
  assert.deepEqual(getGradeSubjects('banana'), [])
})

console.log(`\ngrade-subjects: ${passed} tests passed`)
