/**
 * Tests for the hand-built studio draft descriptors — that serialize whitelists
 * the right slices, isNonEmpty gates on real work, and generationId round-trips.
 *
 * Run: node src/hooks/draft/descriptors/handBuilt.test.js
 */

import {
  recordOfWorkDescriptor,
  markScheduleDescriptor,
  classTimetableDescriptor,
  weeklyForecastDescriptor,
  sbaTrackerDescriptor,
  sbaPlannerDescriptor,
} from './handBuilt.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

console.log('recordOfWorkDescriptor')
{
  const s = recordOfWorkDescriptor.serialize({ header: { grade: 'G4' }, weeks: [{ topic: 'Fractions' }], generationId: 'g1', junk: 1 })
  assert(s.header.grade === 'G4' && s.weeks[0].topic === 'Fractions', 'serializes header + weeks')
  assert(s.generationId === 'g1', 'generationId round-trips')
  assert(!('junk' in s), 'non-whitelisted state dropped')
  assert(recordOfWorkDescriptor.isNonEmpty({ weeks: [{ topic: 'x' }] }) === true, 'a typed topic counts as work')
  assert(recordOfWorkDescriptor.isNonEmpty({ weeks: [{ topic: '' }] }) === false, 'blank weeks are empty')
}

console.log('\nmarkScheduleDescriptor')
{
  assert(markScheduleDescriptor.isNonEmpty({ pupils: [{ name: 'Mwansa' }] }) === true, 'a named pupil counts')
  assert(markScheduleDescriptor.isNonEmpty({ pupils: [{ name: '' }, {}] }) === false, 'unnamed pupils are empty')
  const s = markScheduleDescriptor.serialize({ header: {}, subjects: ['Maths'], pupils: [], mode: 'termly', generationId: null })
  assert(s.mode === 'termly' && Array.isArray(s.subjects), 'serializes mode + subjects')
}

console.log('\nclassTimetableDescriptor')
{
  assert(classTimetableDescriptor.isNonEmpty({ slots: {} }) === false, 'no slots is empty')
  assert(classTimetableDescriptor.isNonEmpty({ slots: { 'mon-1': 'Maths' } }) === true, 'a filled slot counts')
  assert(classTimetableDescriptor.isNonEmpty({ slots: { 'mon-1': '' } }) === false, 'blank slot value is empty')
}

console.log('\nweeklyForecastDescriptor — persists derived grade/subjectLabel')
{
  const s = weeklyForecastDescriptor.serialize({
    header: {}, days: [{ topic: 'Verbs' }], timetableId: 't1', generationId: 'g', grade: 'G5', subjectLabel: 'English',
  })
  assert(s.grade === 'G5' && s.subjectLabel === 'English', 'derived grade + subjectLabel persisted for selector reseed')
  assert(weeklyForecastDescriptor.isNonEmpty({ days: [{ topic: 'x' }] }) === true, 'a topic counts')
  assert(weeklyForecastDescriptor.isNonEmpty({ days: [{ learningActivities: ['a'] }] }) === true, 'activities count')
  assert(weeklyForecastDescriptor.isNonEmpty({ days: [{}] }) === false, 'blank days empty')
}

console.log('\nSBA descriptors')
{
  assert(sbaTrackerDescriptor.isNonEmpty({ pupils: [{ name: 'A' }] }) === true, 'tracker: named pupil counts')
  assert(sbaPlannerDescriptor.isNonEmpty({ statuses: { m1: 'done' } }) === true, 'planner: any status counts')
  assert(sbaPlannerDescriptor.isNonEmpty({ statuses: {} }) === false, 'planner: no statuses empty')
}

console.log('\nall descriptors — hydrate is identity, schemaVersion + ttl set')
{
  for (const [name, d] of Object.entries({
    recordOfWorkDescriptor, markScheduleDescriptor, classTimetableDescriptor,
    weeklyForecastDescriptor, sbaTrackerDescriptor, sbaPlannerDescriptor,
  })) {
    const obj = { a: 1 }
    assert(d.hydrate(obj) === obj, `${name}: hydrate is identity`)
    assert(typeof d.schemaVersion === 'number' && d.ttl > 0, `${name}: has schemaVersion + ttl`)
    assert(typeof d.studioId === 'string' && d.studioId.length > 0, `${name}: has studioId`)
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll handBuilt descriptor tests passed.')
