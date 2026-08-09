/**
 * Unit tests for schemeEditing — pure row operations for the editable table.
 * Run: node src/utils/schemeEditing.test.js
 */

import {
  blankWeek,
  renumberWeeks,
  updateCell,
  addRow,
  deleteRow,
  splitRow,
  mergeRows,
  moveTopicToWeek,
} from './schemeEditing.js'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

const sample = () => ({
  header: { grade: '5', subject: 'mathematics' },
  weeks: [
    { week: 1, topic: 'A', subtopic: 'a1', specificCompetences: ['c1'], learningActivities: ['la1'], expectedStandard: 's1', methods: ['Q & A'], tlAids: ['chart'], references: 'p.1' },
    { week: 2, topic: 'B', subtopic: 'b1', specificCompetences: ['c2'], learningActivities: ['la2'], expectedStandard: 's2', methods: ['Group work'], tlAids: ['model'], references: 'p.2' },
    { week: 3, topic: 'C', subtopic: 'c1', specificCompetences: ['c3'], learningActivities: ['la3'], expectedStandard: 's3', methods: ['Demonstration'], tlAids: ['objects'], references: 'p.3' },
  ],
})

console.log('immutability — input never mutated')
{
  const s = sample()
  const before = JSON.stringify(s)
  addRow(s, 0); deleteRow(s, 0); splitRow(s, 0); mergeRows(s, 0); moveTopicToWeek(s, 0, 3)
  updateCell(s, 0, 'topic', 'X')
  assert(JSON.stringify(s) === before, 'original scheme is untouched by every op')
}

console.log('updateCell')
{
  const s = updateCell(sample(), 1, 'topic', 'BB')
  assert(s.weeks[1].topic === 'BB', 'sets a text field')
  const listStr = updateCell(sample(), 0, 'methods', 'Q & A\nGroup work\n')
  assert(Array.isArray(listStr.weeks[0].methods) && listStr.weeks[0].methods.length === 2, 'splits newline string into a list field')
  const listArr = updateCell(sample(), 0, 'specificCompetences', ['x', '', ' y '])
  assert(listArr.weeks[0].specificCompetences.join(',') === 'x,y', 'trims + drops blanks from an array list field')
  assert(updateCell(sample(), 9, 'topic', 'X').weeks.length === 3, 'out-of-range index is a no-op')
}

console.log('addRow / deleteRow renumber contiguously')
{
  const added = addRow(sample(), 0)
  assert(added.weeks.length === 4, 'row inserted')
  assert(added.weeks[1].topic === '', 'blank row lands after the index')
  assert(added.weeks.map((w) => w.week).join(',') === '1,2,3,4', 'renumbered 1..4')
  const del = deleteRow(sample(), 1)
  assert(del.weeks.length === 2, 'row removed')
  assert(del.weeks.map((w) => w.topic).join(',') === 'A,C', 'correct row removed')
  assert(del.weeks.map((w) => w.week).join(',') === '1,2', 'renumbered 1..2')
}

console.log('splitRow — duplicates content, marks (cont.), renumbers')
{
  const s = splitRow(sample(), 0)
  assert(s.weeks.length === 4, 'one extra row')
  assert(s.weeks[0].topic === 'A' && s.weeks[1].topic === 'A', 'topic duplicated into the next row')
  assert(/\(cont\.\)/i.test(s.weeks[1].subtopic), 'copy subtopic marked (cont.)')
  assert(s.weeks[1].specificCompetences[0] === 'c1', 'competences carried into the copy')
  assert(s.weeks.map((w) => w.week).join(',') === '1,2,3,4', 'renumbered')
  // list fields are independent copies (not shared references)
  const mutated = updateCell(s, 1, 'methods', ['only'])
  assert(s.weeks[0].methods.length === 1 && s.weeks[0].methods[0] === 'Q & A', 'original row list not mutated by editing the copy')
  assert(mutated.weeks[1].methods[0] === 'only', 'copy edited independently')
}

console.log('mergeRows — combines two weeks into one')
{
  const s = mergeRows(sample(), 0) // merge A + B
  assert(s.weeks.length === 2, 'two rows now')
  assert(s.weeks[0].topic === 'A; B', 'different topics joined')
  assert(s.weeks[0].specificCompetences.join(',') === 'c1,c2', 'competences concatenated')
  assert(s.weeks[0].learningActivities.join(',') === 'la1,la2', 'activities concatenated')
  assert(s.weeks[0].references === 'p.1; p.2', 'references joined')
  assert(s.weeks.map((w) => w.week).join(',') === '1,2', 'renumbered')
  // merging same-topic rows keeps the single topic
  const twoA = { header: {}, weeks: [ { week: 1, topic: 'A', subtopic: 'a1' }, { week: 2, topic: 'A', subtopic: 'a2' } ] }
  const m = mergeRows(twoA, 0)
  assert(m.weeks[0].topic === 'A', 'same topic stays singular')
  assert(m.weeks[0].subtopic === 'a1; a2', 'subtopics joined')
  assert(mergeRows(sample(), 2).weeks.length === 3, 'merging the last row is a no-op')
}

console.log('moveTopicToWeek — reorders + renumbers')
{
  const s = moveTopicToWeek(sample(), 2, 1) // move C to week 1
  assert(s.weeks.map((w) => w.topic).join(',') === 'C,A,B', 'C moved to front')
  assert(s.weeks.map((w) => w.week).join(',') === '1,2,3', 'renumbered')
  const clamp = moveTopicToWeek(sample(), 0, 99) // move A to end (clamped)
  assert(clamp.weeks.map((w) => w.topic).join(',') === 'B,C,A', 'target week clamped to range')
}

console.log('renumberWeeks + blankWeek')
{
  const messy = { header: {}, weeks: [ { week: 7, topic: 'A' }, { week: 2, topic: 'B' } ] }
  assert(renumberWeeks(messy).weeks.map((w) => w.week).join(',') === '1,2', 'renumbers out-of-order weeks')
  const b = blankWeek()
  assert(Array.isArray(b.specificCompetences) && b.source === 'teacher', 'blank week has array fields + teacher source')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll schemeEditing tests passed')
