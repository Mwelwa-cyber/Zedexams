#!/usr/bin/env node
/**
 * Tests for Lesson Plan → Worksheet/Homework inheritance (pure resolver).
 * Run: npm run test:lesson-plan-inheritance
 */
import {
  inheritFromLessonPlan,
  lessonPlanSourceLabel,
  planBody,
} from '../src/utils/lessonPlanInheritance.js'

let pass = 0
let fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed') }
function eq(a, b, m) { assert(a === b, `${m || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

// A modern plan carries meta.planned (assignment-format grade/subject) + inputs.
const modernPlan = {
  id: 'plan-1',
  tool: 'lesson_plan',
  inputs: { grade: 'Grade 4', subject: 'Mathematics Syllabus (Grades 4-6)', topic: 'Fractions', subtopic: 'Equivalent fractions', term: '2' },
  meta: {
    planned: {
      assignmentId: 'a1', grade: 'G4', subject: 'mathematics', className: 'Grade 4A',
      curriculumType: 'cbc', academicYear: '2026', termId: 't2', termNumber: 2,
      schoolWeek: 8, plannedDate: '2026-05-19', weekStartDate: '2026-05-18',
      weekEndDate: '2026-05-22', schoolCalendarId: 'moe-national',
    },
  },
  data: { specificCompetence: 'Add and subtract fractions', lessonGoal: 'Learners add like fractions' },
}

console.log('\ninheritFromLessonPlan — modern plan (meta.planned wins)')
test('prefers meta.planned grade/subject (selector value-space)', () => {
  const r = inheritFromLessonPlan(modernPlan)
  eq(r.coords.grade, 'G4')
  eq(r.coords.subject, 'mathematics')
})
test('carries topic/subtopic/term/curriculum + calendar context', () => {
  const r = inheritFromLessonPlan(modernPlan)
  eq(r.coords.topic, 'Fractions')
  eq(r.coords.subtopic, 'Equivalent fractions')
  eq(r.coords.term, 2)
  eq(r.coords.curriculum, 'cbc')
  eq(r.coords.schoolWeek, 8)
  eq(r.coords.plannedDate, '2026-05-19')
  eq(r.coords.className, 'Grade 4A')
})
test('stamps the source link', () => {
  eq(inheritFromLessonPlan(modernPlan).sourceLessonPlanId, 'plan-1')
  eq(inheritFromLessonPlan(modernPlan).coords.sourceLessonPlanId, 'plan-1')
})
test('grounds generation with the lesson CBC anchors', () => {
  const r = inheritFromLessonPlan(modernPlan)
  assert(r.coords.instructions.includes('Specific competence: Add and subtract fractions'), 'anchors missing')
  assert(r.coords.instructions.includes('Lesson goal'), 'lesson goal missing')
})
test('builds a human source label', () => {
  eq(inheritFromLessonPlan(modernPlan).label, 'Grade 4 · Mathematics · Fractions · Term 2, Week 8')
})

console.log('\ninheritFromLessonPlan — legacy plan (no meta.planned)')
const legacyPlan = {
  id: 'plan-2',
  tool: 'lesson_plan',
  inputs: { grade: 'G5', subject: 'english', topic: 'Reading', term: '1' },
  data: {},
}
test('falls back to inputs grade/subject', () => {
  const r = inheritFromLessonPlan(legacyPlan)
  eq(r.coords.grade, 'G5')
  eq(r.coords.subject, 'english')
  eq(r.coords.topic, 'Reading')
  eq(r.coords.term, 1)
})
test('defaults curriculum to cbc, no planned context', () => {
  const r = inheritFromLessonPlan(legacyPlan)
  eq(r.coords.curriculum, 'cbc')
  eq('schoolWeek' in r.coords, false)
  eq('instructions' in r.coords, false)
})
test('uses the fallback seed only for fields the plan lacks', () => {
  const bare = { id: 'p3', inputs: { topic: 'Shapes' } }
  const r = inheritFromLessonPlan(bare, { curriculum: 'previous', grade: 'G3', subject: 'mathematics' })
  eq(r.coords.grade, 'G3')
  eq(r.coords.subject, 'mathematics')
  eq(r.coords.curriculum, 'previous')
  eq(r.coords.topic, 'Shapes')
})
test('plan curriculum wins over the fallback seed', () => {
  const r = inheritFromLessonPlan(modernPlan, { curriculum: 'previous' })
  eq(r.coords.curriculum, 'cbc')
})

console.log('\nguards')
test('null / id-less plan → null', () => {
  eq(inheritFromLessonPlan(null), null)
  eq(inheritFromLessonPlan({ inputs: {} }), null)
})

console.log('\nplanBody')
test('prefers data, then output', () => {
  eq(planBody({ data: { a: 1 } }).a, 1)
  eq(planBody({ output: { b: 2 } }).b, 2)
  eq(planBody({}), null)
})

console.log('\nlessonPlanSourceLabel')
test('skips parts it cannot resolve', () => {
  eq(lessonPlanSourceLabel({ grade: 'G4' }), 'Grade 4')
  eq(lessonPlanSourceLabel({}), '')
  eq(lessonPlanSourceLabel({ grade: 'G4', subject: 'mathematics', term: 3 }), 'Grade 4 · Mathematics · Term 3')
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) { console.log('\nfailures:'); failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`)); process.exit(1) }
