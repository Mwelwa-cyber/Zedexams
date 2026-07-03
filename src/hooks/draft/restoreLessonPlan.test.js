/**
 * Tests for the Lesson Plan Studio draft restore ordering — the sequence that
 * defeats the studio's curriculum cascade-reset effects. Pure, so it runs under
 * plain node.
 *
 * Run: node src/hooks/draft/restoreLessonPlan.test.js
 */

import { applyLessonPlanRestore } from './restoreLessonPlan.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

// Build a setters object that records the call order + arguments.
function makeSetters() {
  const calls = []
  const rec = (name) => (arg) => calls.push({ name, arg })
  return {
    calls,
    setCurriculumMode: rec('setCurriculumMode'),
    setLessonDetails: rec('setLessonDetails'),
    setTopicData: rec('setTopicData'),
    setSelectedOutcomes: rec('setSelectedOutcomes'),
    setLearningEnvironments: rec('setLearningEnvironments'),
    setLessonSeries: rec('setLessonSeries'),
    setLessonBreakdown: rec('setLessonBreakdown'),
    setFormatOptions: rec('setFormatOptions'),
    // Present but must NEVER be used by the restore (would trigger the cascade).
    setTopicField: rec('setTopicField'),
    updateTopic: rec('updateTopic'),
  }
}

const cbcPayload = {
  curriculumMode: 'cbc',
  lessonDetails: { grade: 'Grade 5', subject: 'Mathematics Syllabus (Grades 4-6)' },
  topicData: { topic: 'Fractions', subtopic: 'Adding fractions', subtopicRow: { specificCompetence: 'x' } },
  selectedOutcomes: ['o1'],
  learningEnvironments: ['classroom'],
  lessonSeries: { planningMode: 'single', lessonNumber: 1 },
  lessonBreakdown: [{ n: 1 }],
  formatOptions: { detail: 'standard', advanced: { includeAttendance: true } },
}

console.log('applyLessonPlanRestore — order defeats the cascade resets')
{
  const s = makeSetters()
  applyLessonPlanRestore(s, cbcPayload)
  const order = s.calls.map((c) => c.name)
  const idx = (n) => order.indexOf(n)
  assert(idx('setCurriculumMode') === 0, 'curriculumMode is restored FIRST')
  assert(idx('setCurriculumMode') < idx('setLessonDetails'), 'mode before lessonDetails (grade stays valid for the mode list)')
  assert(idx('setLessonDetails') < idx('setTopicData'), 'lessonDetails before topicData')
  assert(idx('setTopicData') < idx('setSelectedOutcomes'), 'topicData before selectedOutcomes (outcomes not wiped)')
  assert(!order.includes('setTopicField') && !order.includes('updateTopic'),
    'restore NEVER uses the cascade helpers setTopicField/updateTopic')
}

console.log('\napplyLessonPlanRestore — topicData restored atomically incl. subtopicRow')
{
  const s = makeSetters()
  applyLessonPlanRestore(s, cbcPayload)
  const td = s.calls.find((c) => c.name === 'setTopicData')
  assert(td && td.arg.topic === 'Fractions' && td.arg.subtopic === 'Adding fractions', 'topic + subtopic land together')
  assert(td.arg.subtopicRow?.specificCompetence === 'x', 'subtopicRow bridged in the same atomic set')
}

console.log('\napplyLessonPlanRestore — learningEnvironments only for CBC')
{
  const cbc = makeSetters()
  applyLessonPlanRestore(cbc, cbcPayload)
  assert(cbc.calls.some((c) => c.name === 'setLearningEnvironments'), 'CBC restores learning environments')

  const prev = makeSetters()
  applyLessonPlanRestore(prev, { ...cbcPayload, curriculumMode: 'previous' })
  assert(!prev.calls.some((c) => c.name === 'setLearningEnvironments'),
    'Previous curriculum does NOT restore environments (they are force-cleared anyway)')
}

console.log('\napplyLessonPlanRestore — formatOptions restored whole (nested advanced kept)')
{
  const s = makeSetters()
  applyLessonPlanRestore(s, cbcPayload)
  const fo = s.calls.find((c) => c.name === 'setFormatOptions')
  assert(fo && fo.arg.advanced?.includeAttendance === true, 'nested advanced block restored in one shot')
}

console.log('\napplyLessonPlanRestore — no-ops safely')
{
  const s = makeSetters()
  applyLessonPlanRestore(s, null)
  assert(s.calls.length === 0, 'null payload restores nothing')
  applyLessonPlanRestore(null, cbcPayload)
  assert(true, 'null setters do not throw')

  const partial = makeSetters()
  applyLessonPlanRestore(partial, { curriculumMode: 'cbc' })
  const names = partial.calls.map((c) => c.name)
  assert(names.length === 1 && names[0] === 'setCurriculumMode', 'only present slices are restored')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll restoreLessonPlan tests passed.')
