/**
 * Unit tests for schemeTermDivision — intelligent syllabus division by term.
 * Run: node src/utils/schemeTermDivision.test.js
 */

import {
  estimateTopicWeeks,
  divideTopicsByTerm,
  topicsForTerm,
  weeksNeeded,
  validateTermSelection,
  crossTermDuplicates,
  toTopicSelectionPayload,
  topicName,
} from './schemeTermDivision.js'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

// A realistic ordered Science outline (topic + sub-topics), longer than one term.
const SCIENCE = [
  { label: 'Human Body', subtopics: ['Parts of the Body', 'Sense Organs', 'Health and Hygiene'] },
  { label: 'Plants', subtopics: ['Parts of a Plant', 'Photosynthesis'] },
  { label: 'Matter', subtopics: ['States of Matter', 'Changes of State'] },
  { label: 'Energy', subtopics: ['Forms of Energy', 'Heat', 'Light', 'Sound'] },
  { label: 'Forces', subtopics: ['Push and Pull', 'Gravity'] },
  { label: 'Electricity', subtopics: ['Simple Circuits', 'Conductors'] },
  { label: 'Earth and Space', subtopics: ['The Solar System', 'Day and Night'] },
  { label: 'Environment', subtopics: ['Ecosystems', 'Conservation'] },
  { label: 'Water', subtopics: ['The Water Cycle', 'Water Sources'] },
  { label: 'Weather', subtopics: ['Weather Elements', 'Seasons'] },
  { label: 'Living Things', subtopics: ['Classification', 'Life Cycles'] },
  { label: 'Materials', subtopics: ['Natural Materials', 'Man-made Materials'] },
]

console.log('estimateTopicWeeks — ~2 weeks per sub-topic (CBC pace)')
{
  assert(estimateTopicWeeks({ subtopics: [] }) === 1, 'no sub-topics → 1 week')
  assert(estimateTopicWeeks({ subtopics: ['a'] }) === 2, 'one sub-topic → 2 weeks')
  assert(estimateTopicWeeks({ subtopics: ['a', 'b'] }) === 4, 'two sub-topics → 4 weeks')
  assert(estimateTopicWeeks({ subtopics: ['a', 'b', 'c'] }) === 6, 'three sub-topics → 6 weeks')
  assert(estimateTopicWeeks({ subtopics: Array.from({ length: 20 }, (_, i) => `s${i}`) }) === 6, 'huge topic capped at 6 weeks')
}

console.log('divideTopicsByTerm — the core "no restart" guarantee')
{
  const { byTerm } = divideTopicsByTerm(SCIENCE, { weeksByTerm: { 1: 12, 2: 12, 3: 11 } })

  assert(byTerm[1].length > 0, 'Term 1 has topics')
  assert(byTerm[2].length > 0, 'Term 2 has topics')

  // Term 1 must START at the first syllabus topic.
  assert(byTerm[1][0].topic === 'Human Body', 'Term 1 starts at "Human Body"')

  // Term 2 must NOT restart at "Human Body" — it continues the syllabus.
  assert(byTerm[2][0].topic !== 'Human Body', 'Term 2 does NOT restart at "Human Body"')

  // The first topic of Term 2 comes AFTER the last topic of Term 1 in order.
  const t1LastIdx = byTerm[1][byTerm[1].length - 1].index
  assert(byTerm[2][0].index === t1LastIdx + 1, 'Term 2 continues immediately after Term 1')

  // No topic appears in more than one term.
  const all = [...byTerm[1], ...byTerm[2], ...byTerm[3]].map((it) => it.topic)
  assert(new Set(all).size === all.length, 'no topic is repeated across terms')

  // Every syllabus topic is placed exactly once.
  assert(all.length === SCIENCE.length, 'every topic is placed exactly once')

  // Ordering is preserved globally.
  const indices = [...byTerm[1], ...byTerm[2], ...byTerm[3]].map((it) => it.index)
  assert(indices.every((v, i) => i === 0 || v > indices[i - 1]), 'global order preserved')
}

console.log('divideTopicsByTerm — a light syllabus still spreads across all three terms')
{
  // Grade 4 Mathematics: 8 topics with 1–2 sub-topics each. Under the old
  // fill-first division every topic estimated ~1 week, so ALL EIGHT fit
  // inside Term 1's budget and Terms 2 and 3 came back empty (the "it is
  // not fixed" screenshot). The balanced division must reproduce the
  // official CBC split: 4.1–4.3 · 4.4–4.6 · 4.7–4.8.
  const MATHS = [
    { label: '4.1 Sets', subtopics: ['Operations on Sets'] },
    { label: '4.2 Numbers', subtopics: ['Numbers and Notation', 'Factors and Multiples'] },
    { label: '4.3 Fractions', subtopics: ['Common Fractions', 'Decimal Fractions'] },
    { label: '4.4 Financial Arithmetic', subtopics: ['Money'] },
    { label: '4.5 Angles', subtopics: ['Types of Angles'] },
    { label: '4.6 Shapes', subtopics: ['Plane Shapes', 'Solid Shapes'] },
    { label: '4.7 Measures', subtopics: ['Time and Area'] },
    { label: '4.8 Statistics', subtopics: ['Bar Graphs and Line Graphs'] },
  ]
  const { byTerm } = divideTopicsByTerm(MATHS, { weeksByTerm: { 1: 10, 2: 10, 3: 9 } })
  assert(byTerm[1].length > 0 && byTerm[2].length > 0 && byTerm[3].length > 0,
    'no term is left empty')
  assert(
    byTerm[1].map((t) => t.topic).join('|') === '4.1 Sets|4.2 Numbers|4.3 Fractions',
    'Term 1 = Sets, Numbers, Fractions (official split)',
  )
  assert(
    byTerm[2].map((t) => t.topic).join('|') === '4.4 Financial Arithmetic|4.5 Angles|4.6 Shapes',
    'Term 2 = Financial Arithmetic, Angles, Shapes (official split)',
  )
  assert(
    byTerm[3].map((t) => t.topic).join('|') === '4.7 Measures|4.8 Statistics',
    'Term 3 = Measures, Statistics (official split)',
  )
}

console.log('divideTopicsByTerm — very few 1-week topics still spread out')
{
  const tiny = [
    { label: 'A', subtopics: [] },
    { label: 'B', subtopics: [] },
    { label: 'C', subtopics: [] },
  ]
  const { byTerm } = divideTopicsByTerm(tiny, { weeksByTerm: { 1: 12, 2: 12, 3: 11 } })
  assert(byTerm[1].length === 1 && byTerm[2].length === 1 && byTerm[3].length === 1,
    'three light topics land one per term')
}

console.log('topicsForTerm — Term 3 continues Term 2')
{
  const t2 = topicsForTerm(SCIENCE, 2)
  const t3 = topicsForTerm(SCIENCE, 3)
  if (t2.length && t3.length) {
    assert(t3[0].index === t2[t2.length - 1].index + 1, 'Term 3 continues immediately after Term 2')
  } else {
    assert(true, 'Term 3 continuation (skipped — short syllabus)')
  }
}

console.log('divideTopicsByTerm — a single oversized topic never skips a term')
{
  const heavy = [
    { label: 'Big One', subtopics: Array.from({ length: 30 }, (_, i) => `s${i}`) },
    { label: 'Two', subtopics: ['a'] },
    { label: 'Three', subtopics: ['a'] },
    { label: 'Four', subtopics: ['a'] },
  ]
  const { byTerm } = divideTopicsByTerm(heavy, { weeksByTerm: { 1: 2, 2: 2, 3: 2 } })
  assert(byTerm[1].length >= 1, 'oversized first topic still lands in Term 1')
  assert(byTerm[1][0].topic === 'Big One', 'Term 1 keeps the oversized topic')
}

console.log('validateTermSelection — safeguards')
{
  const empty = validateTermSelection({ items: [], deliveryWeeks: 10 })
  assert(empty.some((a) => a.code === 'empty' && a.level === 'error'), 'empty selection → error')

  const items = [
    { topic: 'A', subtopics: ['x'], weeks: 1 },
    { topic: 'B', subtopics: ['y'], weeks: 1 },
    { topic: 'A', subtopics: ['x'], weeks: 1 },
  ]
  const dup = validateTermSelection({ items, deliveryWeeks: 10 })
  assert(dup.some((a) => a.code === 'duplicate'), 'repeated topic → duplicate warning')

  const over = validateTermSelection({
    items: [{ topic: 'A', subtopics: [], weeks: 15 }],
    deliveryWeeks: 5,
  })
  assert(over.some((a) => a.code === 'overloaded'), 'too many weeks → overloaded warning')

  const under = validateTermSelection({
    items: [{ topic: 'A', subtopics: [], weeks: 2 }],
    deliveryWeeks: 12,
  })
  assert(under.some((a) => a.code === 'underfilled'), 'too few weeks → underfilled info')

  const good = validateTermSelection({
    items: [{ topic: 'A', subtopics: [], weeks: 10 }],
    deliveryWeeks: 10,
    hasRevision: true,
    hasExam: true,
  })
  assert(!good.some((a) => a.level === 'error'), 'a balanced, reserved term has no errors')
  assert(!good.some((a) => a.code === 'no-revision'), 'revision marked → no revision nag')
}

console.log('crossTermDuplicates')
{
  const byTerm = {
    1: [{ topic: 'Human Body' }, { topic: 'Plants' }],
    2: [{ topic: 'Plants' }, { topic: 'Matter' }],
    3: [{ topic: 'Energy' }],
  }
  const dups = crossTermDuplicates(byTerm)
  assert(dups.includes('Plants'), 'detects a topic repeated across terms')
  assert(!dups.includes('Human Body'), 'a single-term topic is not flagged')
}

console.log('toTopicSelectionPayload — server-ready projection')
{
  const payload = toTopicSelectionPayload([
    { topic: 'A', subtopics: ['x', { name: 'y' }, ''], weeks: 2, source: 'teacher' },
    { label: 'B', subtopics: [], weeks: 99 },
    { topic: '' },
  ])
  assert(payload.length === 2, 'drops empty-topic rows')
  assert(payload[0].source === 'teacher', 'keeps a teacher-added source')
  assert(payload[0].subtopics.length === 2, 'flattens and cleans sub-topics')
  assert(payload[1].weeks <= 6, 'clamps runaway week counts')
  assert(payload[1].source === 'syllabi_studio', 'defaults source to syllabi_studio')
}

console.log('weeksNeeded / topicName edge cases')
{
  assert(weeksNeeded([{ weeks: 2 }, { weeks: 3 }]) === 5, 'weeksNeeded sums')
  assert(weeksNeeded([]) === 0, 'weeksNeeded of empty is 0')
  assert(topicName({ topic: ' Foo ' }) === 'Foo', 'topicName trims topic')
  assert(topicName({ label: 'Bar' }) === 'Bar', 'topicName falls back to label')
  assert(topicName(null) === '', 'topicName of null is empty')
}

console.log(failures === 0
  ? '\nAll schemeTermDivision tests passed.'
  : `\n${failures} test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
