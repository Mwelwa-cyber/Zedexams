#!/usr/bin/env node
/**
 * Unit tests for the Lesson Plan Studio's persistent-memory pure helpers
 * (src/components/teacher/studio/utils/lessonMemory.js).
 *
 * Plain `node` assertion script (no Vitest) — throws on failure. Registered as
 * `npm run test:lesson-memory` and auto-discovered by scripts/run-all-tests.mjs.
 */

import assert from 'node:assert/strict'
import {
  normToken,
  stableHash,
  curriculumTypeLabel,
  curriculumIdFor,
  buildSubtopicKey,
  buildGradeSubjectKey,
  lessonPlanDocId,
  lessonProgressDocId,
  extractCode,
  stripCode,
  lessonsForSubtopic,
  subtopicProgress,
  findLessonByNumber,
  generateButtonState,
  recommendationFor,
  resolveExpectedCount,
  isTeachingStatus,
  teachingStatusLabel,
} from '../src/shared/utils/lessonMemory.js'

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

// ── normalisation + keys ──────────────────────────────────────────────────────

test('normToken lowercases and strips non-alphanumerics', () => {
  assert.equal(normToken('Grade 4'), 'grade4')
  assert.equal(normToken('  O.1.2.1 '), 'o121')
  assert.equal(normToken(null), '')
})

test('stableHash is deterministic and base36', () => {
  assert.equal(stableHash('hello'), stableHash('hello'))
  assert.notEqual(stableHash('a'), stableHash('b'))
  assert.match(stableHash('anything'), /^[0-9a-z]+$/)
})

test('curriculumTypeLabel / curriculumIdFor map both directions', () => {
  assert.equal(curriculumTypeLabel('cbc'), 'CBC')
  assert.equal(curriculumTypeLabel('previous'), 'Previous Curriculum')
  assert.equal(curriculumIdFor('CBC'), 'cbc')
  assert.equal(curriculumIdFor('Previous Curriculum'), 'previous')
  assert.equal(curriculumIdFor('previous'), 'previous')
})

test('buildSubtopicKey is stable across cosmetic differences', () => {
  const a = buildSubtopicKey({ curriculumType: 'CBC', grade: 'Grade 4', subject: 'science', topic: 'The Body', subtopic: 'Body Parts' })
  const b = buildSubtopicKey({ curriculumType: 'cbc', grade: 'grade  4', subject: 'Science', topic: 'the body', subtopic: 'body  parts' })
  assert.equal(a, b)
})

test('buildSubtopicKey distinguishes curriculum, grade, subject, topic, subtopic', () => {
  const base = { curriculumType: 'CBC', grade: 'Grade 4', subject: 'science', topic: 'T', subtopic: 'S' }
  assert.notEqual(buildSubtopicKey(base), buildSubtopicKey({ ...base, curriculumType: 'Previous Curriculum' }))
  assert.notEqual(buildSubtopicKey(base), buildSubtopicKey({ ...base, grade: 'Grade 5' }))
  assert.notEqual(buildSubtopicKey(base), buildSubtopicKey({ ...base, subtopic: 'S2' }))
})

test('buildGradeSubjectKey ignores topic/subtopic', () => {
  const k1 = buildGradeSubjectKey({ curriculumType: 'CBC', grade: 'Grade 4', subject: 'science' })
  const k2 = buildGradeSubjectKey({ curriculumType: 'cbc', grade: 'Grade 4', subject: 'Science' })
  assert.equal(k1, k2)
})

test('lessonPlanDocId is deterministic per slot and valid as a doc id', () => {
  const key = buildSubtopicKey({ curriculumType: 'CBC', grade: 'Grade 4', subject: 'science', topic: 'T', subtopic: 'S' })
  const id1 = lessonPlanDocId({ uid: 'abc', subtopicKey: key, lessonNumber: 1 })
  const id2 = lessonPlanDocId({ uid: 'abc', subtopicKey: key, lessonNumber: 1 })
  const id3 = lessonPlanDocId({ uid: 'abc', subtopicKey: key, lessonNumber: 2 })
  assert.equal(id1, id2, 'same slot → same id (idempotent upsert)')
  assert.notEqual(id1, id3, 'different lesson number → different id')
  assert.ok(!id1.includes('/'), 'doc id must not contain a slash')
})

test('lessonProgressDocId is deterministic per grade+subject', () => {
  const a = lessonProgressDocId({ uid: 'u', curriculumType: 'CBC', grade: 'Grade 4', subject: 'science' })
  const b = lessonProgressDocId({ uid: 'u', curriculumType: 'cbc', grade: 'Grade 4', subject: 'Science' })
  assert.equal(a, b)
})

// ── code extraction ───────────────────────────────────────────────────────────

test('extractCode pulls a leading curriculum code', () => {
  assert.equal(extractCode('O.1.2.1 The External Human Body Parts'), 'O.1.2.1')
  assert.equal(extractCode('3.1.1 Counting'), '3.1.1')
  assert.equal(extractCode('Grouping of Things'), '')
})

test('stripCode removes the code prefix but keeps the name', () => {
  assert.equal(stripCode('O.1.2.1 The External Human Body Parts'), 'The External Human Body Parts')
  assert.equal(stripCode('3.1.1 Counting'), 'Counting')
  assert.equal(stripCode('Grouping of Things'), 'Grouping of Things')
  // A label that is only a code falls back to the original rather than ''.
  assert.equal(stripCode('O.1.2.1'), 'O.1.2.1')
})

// ── per-subtopic lessons ──────────────────────────────────────────────────────

const KEY = buildSubtopicKey({ curriculumType: 'CBC', grade: 'Grade 4', subject: 'science', topic: 'Body', subtopic: 'Parts' })
const OTHER = buildSubtopicKey({ curriculumType: 'CBC', grade: 'Grade 4', subject: 'science', topic: 'Body', subtopic: 'Functions' })

function plan(n, extra = {}) {
  return { id: `L${n}`, subtopicKey: KEY, lessonNumber: n, status: 'draft', teachingStatus: 'planned', ...extra }
}

test('lessonsForSubtopic filters by key, drops archived, sorts by number', () => {
  const plans = [
    plan(3),
    plan(1),
    plan(2, { status: 'archived' }),
    { id: 'X', subtopicKey: OTHER, lessonNumber: 1 },
  ]
  const out = lessonsForSubtopic(plans, KEY)
  assert.deepEqual(out.map((l) => l.lessonNumber), [1, 3])
})

test('lessonsForSubtopic returns [] for empty inputs', () => {
  assert.deepEqual(lessonsForSubtopic(null, KEY), [])
  assert.deepEqual(lessonsForSubtopic([plan(1)], null), [])
})

// ── progress maths ────────────────────────────────────────────────────────────

test('subtopicProgress reports created/expected/missing/next', () => {
  const lessons = [plan(1), plan(3)]
  const p = subtopicProgress(lessons, 4)
  assert.equal(p.created, 2)
  assert.equal(p.expected, 4)
  assert.deepEqual(p.missingNumbers, [2, 4])
  assert.equal(p.nextToCreate, 2, 'first gap is the next to create')
})

test('subtopicProgress never lets expected fall below created', () => {
  const p = subtopicProgress([plan(1), plan(2), plan(3)], 1)
  assert.equal(p.expected, 3)
  assert.deepEqual(p.missingNumbers, [])
  assert.equal(p.nextToCreate, 4, 'next after a full run is max+1')
})

test('subtopicProgress counts taught lessons and next-to-teach', () => {
  const lessons = [plan(1, { teachingStatus: 'taught' }), plan(2, { teachingStatus: 'planned' })]
  const p = subtopicProgress(lessons, 2)
  assert.equal(p.taughtCount, 1)
  assert.equal(p.nextToTeach, 2)
})

test('findLessonByNumber locates an exact lesson', () => {
  const lessons = [plan(1), plan(2)]
  assert.equal(findLessonByNumber(lessons, 2).id, 'L2')
  assert.equal(findLessonByNumber(lessons, 5), null)
})

// ── adaptive Generate button (requirement #9) ─────────────────────────────────

test('generateButtonState: no lessons → Generate Lesson Plan', () => {
  const s = generateButtonState({ lessons: [], expected: 4 })
  assert.equal(s.label, 'Generate Lesson Plan')
  assert.equal(s.action, 'generate')
  assert.equal(s.nextLessonNumber, 1)
})

test('generateButtonState: gaps remain → Create Next Lesson', () => {
  const s = generateButtonState({ lessons: [plan(1)], expected: 4 })
  assert.equal(s.label, 'Create Next Lesson')
  assert.equal(s.action, 'create-next')
  assert.equal(s.nextLessonNumber, 2)
})

test('generateButtonState: all planned, untaught → Continue Lesson Plan', () => {
  const s = generateButtonState({ lessons: [plan(1), plan(2)], expected: 2 })
  assert.equal(s.label, 'Continue Lesson Plan')
  assert.equal(s.action, 'continue')
})

test('generateButtonState: all planned + taught → Review Completed Lessons', () => {
  const lessons = [plan(1, { teachingStatus: 'taught' }), plan(2, { teachingStatus: 'taught' })]
  const s = generateButtonState({ lessons, expected: 2 })
  assert.equal(s.label, 'Review Completed Lessons')
  assert.equal(s.action, 'review')
})

// ── recommendations (requirement #5) ──────────────────────────────────────────

test('recommendationFor: empty subtopic', () => {
  const r = recommendationFor({ lessons: [], expected: 4, subtopicName: 'Body Parts' })
  assert.match(r.text, /no lesson plan yet/i)
  assert.equal(r.kind, 'empty')
})

test('recommendationFor: continue series points at the next lesson', () => {
  const r = recommendationFor({ lessons: [plan(1)], expected: 4, subtopicName: 'Body Parts' })
  assert.match(r.text, /Lesson 2/)
  assert.equal(r.kind, 'continue-series')
})

test('recommendationFor: done suggests the next subtopic', () => {
  const lessons = [plan(1, { teachingStatus: 'taught' })]
  const r = recommendationFor({ lessons, expected: 1, subtopicName: 'Body Parts', nextRecommendedSubtopic: 'Grouping of Things' })
  assert.match(r.text, /completed all planned lessons/i)
  assert.match(r.text, /Grouping of Things/)
  assert.equal(r.kind, 'done')
})

test('recommendationFor: single existing lesson', () => {
  const r = recommendationFor({ lessons: [plan(1)], expected: 1, subtopicName: 'Body Parts' })
  assert.match(r.text, /already created Lesson 1/i)
})

// ── expected-count resolution ─────────────────────────────────────────────────

test('resolveExpectedCount prefers breakdown, then AI, then created, then 1', () => {
  assert.equal(resolveExpectedCount({ breakdownLength: 5, aiRecommended: 3, created: 2 }), 5)
  assert.equal(resolveExpectedCount({ breakdownLength: 0, aiRecommended: 3, created: 2 }), 3)
  assert.equal(resolveExpectedCount({ breakdownLength: 0, aiRecommended: 0, created: 4 }), 4)
  assert.equal(resolveExpectedCount({}), 1)
})

// ── teaching-status helpers ───────────────────────────────────────────────────

test('isTeachingStatus / teachingStatusLabel', () => {
  assert.equal(isTeachingStatus('taught'), true)
  assert.equal(isTeachingStatus('bogus'), false)
  assert.equal(teachingStatusLabel('needs_revision'), 'Needs revision')
  assert.equal(teachingStatusLabel('bogus'), 'Planned')
})

// ── summary ───────────────────────────────────────────────────────────────────

console.log(`\nlesson-memory: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  for (const f of failures) console.error(`  - ${f.name}: ${f.message}`)
  process.exit(1)
}
