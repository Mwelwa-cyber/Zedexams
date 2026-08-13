/**
 * Tests for planShape — the canonical lesson-plan stage normaliser shared by
 * the editor, the preview renderer and the Word export.
 *
 * Run: node src/features/lessonPlanStudio/lib/planShape.test.js
 */

import assert from 'node:assert'
import {
  toLines,
  linesToText,
  parseDurationMinutes,
  readStage,
  writeStage,
  normalizePlanShape,
  stagesForEditing,
} from './planShape.js'

let passed = 0
function ok(label, cond) {
  assert.ok(cond, label)
  passed += 1
  console.log(`  ✓ ${label}`)
}

console.log('toLines / linesToText')
ok('array trimmed + emptied', JSON.stringify(toLines([' a ', '', 'b'])) === JSON.stringify(['a', 'b']))
ok('newline string split', JSON.stringify(toLines('a\nb')) === JSON.stringify(['a', 'b']))
ok('semicolon string split', JSON.stringify(toLines('a; b')) === JSON.stringify(['a', 'b']))
ok('linesToText joins on newline', linesToText(['a', 'b']) === 'a\nb')

console.log('\nparseDurationMinutes')
ok('reads durationMinutes', parseDurationMinutes({ durationMinutes: 12 }) === 12)
ok('parses "10 minutes"', parseDurationMinutes({ duration: '10 minutes' }) === 10)
ok('0 when absent', parseDurationMinutes({}) === 0)

console.log('\nreadStage — accepts either field family')
{
  const fromArrays = readStage({
    name: 'INTRODUCTION', durationMinutes: 5,
    teacherActivities: ['Ask a question'],
    learnerActivities: ['Answer'],
    assessmentCriteria: ['Responds'],
  })
  ok('array family read', fromArrays.teacherActivities[0] === 'Ask a question' &&
    fromArrays.learnerActivities[0] === 'Answer' && fromArrays.assessmentCriteria[0] === 'Responds')

  const fromStrings = readStage({
    name: 'DEVELOPMENT', duration: '15 min',
    teacher: 'Demonstrate\nGuide', pupils: 'Observe\nPractise', assessment: 'Draws correctly',
  })
  ok('string family read into arrays',
    fromStrings.teacherActivities.length === 2 && fromStrings.learnerActivities[1] === 'Practise')
  ok('duration parsed from string', fromStrings.durationMinutes === 15)
}

console.log('\nwriteStage — emits BOTH families + preserves extras')
{
  const out = writeStage({
    name: 'CONCLUSION', durationMinutes: 8,
    teacherActivities: ['Summarise'], learnerActivities: ['Recap'], assessmentCriteria: ['States points'],
  }, { content: 'old content column', methods: 'discussion' })
  ok('teacher string mirror', out.teacher === 'Summarise')
  ok('learner array + pupils mirror', out.learnerActivities[0] === 'Recap' && out.pupils === 'Recap')
  ok('assessment both', out.assessmentCriteria[0] === 'States points' && out.assessment === 'States points')
  ok('duration string derived', out.duration === '8 min' && out.durationMinutes === 8)
  ok('preserves unknown fields', out.content === 'old content column' && out.methods === 'discussion')
}
ok('empty minutes → empty duration string', writeStage({ name: 'X' }).duration === '')

console.log('\nnormalizePlanShape — round-trips a model that emitted only arrays')
{
  const plan = {
    lessonGoal: 'Goal',
    stages: [
      { name: 'INTRODUCTION', durationMinutes: 5, teacherActivities: ['Greet'], learnerActivities: ['Reply'], assessmentCriteria: ['Greets'] },
    ],
  }
  const norm = normalizePlanShape(plan)
  ok('adds string mirror for preview', norm.stages[0].teacher === 'Greet' && norm.stages[0].pupils === 'Reply')
  ok('keeps array for export', Array.isArray(norm.stages[0].teacherActivities))
  ok('top-level untouched', norm.lessonGoal === 'Goal')
  ok('original not mutated', plan.stages[0].teacher === undefined)
}
ok('non-object passes through', normalizePlanShape(null) === null)
ok('missing stages tolerated', Array.isArray(normalizePlanShape({ lessonGoal: 'x' }).stages) === false)

console.log('\nnormalizePlanShape — folds variant top-level keys onto canonical ones')
{
  const norm = normalizePlanShape({
    generalCompetencies: ['Communication'],
    specificCompetency: '4.5.1 Joining of Materials',
    teachingMaterials: ['Glue', 'Wood'],
    expectedStandards: 'Materials joined correctly.',
  })
  ok('generalCompetencies -> generalCompetences', norm.generalCompetences[0] === 'Communication')
  ok('specificCompetency -> specificCompetence', norm.specificCompetence === '4.5.1 Joining of Materials')
  ok('teachingMaterials -> materials', norm.materials[1] === 'Wood')
  ok('expectedStandards -> expectedStandard', norm.expectedStandard === 'Materials joined correctly.')
}
{
  // A correct canonical key is never overwritten by a stray variant.
  const norm = normalizePlanShape({ generalCompetences: ['Right'], generalCompetencies: ['Wrong'] })
  ok('canonical key wins over variant', norm.generalCompetences[0] === 'Right')
}

console.log('\nstagesForEditing')
ok('maps to canonical', stagesForEditing({ stages: [{ name: 'A', teacher: 'do' }] })[0].teacherActivities[0] === 'do')
ok('empty when no stages', stagesForEditing({}).length === 0)

console.log(`\n✅ planShape — ${passed} assertions passed`)
