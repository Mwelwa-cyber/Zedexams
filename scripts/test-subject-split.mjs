/**
 * The subject split: Commerce / Principles of Accounts and Food & Nutrition /
 * Home Management are four separate canonical subjects.
 *
 * A topic code is only unique within one curriculum + grade + subject. These
 * tests pin the two consequences of getting that wrong:
 *
 *   1. Two subjects that legitimately share a code must stay independent —
 *      Commerce "1.1" and Principles of Accounts "1.1" are different topics.
 *   2. A sub-topic must never be adopted across a subject boundary — Food &
 *      Nutrition "10.1" must not become the parent of a Home Management "10.1.x".
 *
 * Run: npm run test:subject-split
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'

import {
  sectionsByCodeReset, resolveSplitSubjects, SPLIT_DOCUMENTS, LEGACY_COMBINED_KEYS,
} from '../src/utils/syllabusSubjectSplit.js'
import { normalizeTopicTree } from '../src/utils/syllabusTopicTree.js'
import { syllabiToKbTopics } from '../src/utils/syllabusMapping.js'
import { extract2013TopicLookup } from '../src/utils/syllabus2013Topics.js'
import {
  classifyRecord, buildTopicSubjectIndex, buildSubjectPresence, resolveGradeCode, OUTCOMES,
} from '../src/utils/subjectSplitClassifier.js'
import { topicIdentity, topicScopeKey } from '../src/utils/curriculumTopicIdentity.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const raw2023 = JSON.parse(readFileSync(path.join(ROOT, 'public/syllabi/curriculum-data.json'), 'utf8'))
const raw2013 = JSON.parse(readFileSync(path.join(ROOT, 'public/syllabi/curriculum-data-2013.json'), 'utf8'))

console.log('\nsubject split — section detection\n')

test('the numbering reset is what cuts a document into subjects', () => {
  const { sections, boundaries } = sectionsByCodeReset([
    '1.1 Commerce', '1.2 Production', '1.3 Home Trade',
    '1.1 Principles of Accounts', '1.2 Ethics',
  ])
  assert.equal(sections.length, 2)
  assert.deepEqual(boundaries, [3])
  assert.deepEqual(sections[0], ['1.1 Commerce', '1.2 Production', '1.3 Home Trade'])
  assert.deepEqual(sections[1], ['1.1 Principles of Accounts', '1.2 Ethics'])
})

test('an exact repeat does not open a section; only a decrease does', () => {
  // A duplicated heading row must not manufacture a subject boundary.
  const { sections } = sectionsByCodeReset(['2.1 A', '2.1 A again', '2.2 B'])
  assert.equal(sections.length, 1)
})

test('two-digit codes compare numerically, not as text', () => {
  // '1.10' after '1.9' is ascending. Compared as strings it would look like a
  // reset and split one subject in half.
  const { sections } = sectionsByCodeReset(['1.9 Nine', '1.10 Ten', '1.11 Eleven'])
  assert.equal(sections.length, 1)
})

test('an unnumbered label continues its section rather than starting one', () => {
  const { sections } = sectionsByCodeReset(['1.1 A', 'CONTINUED PROSE', '1.2 B', '1.1 C'])
  assert.equal(sections.length, 2)
  assert.ok(sections[0].includes('CONTINUED PROSE'))
})

test('a document that does not split as expected reassigns NOTHING', () => {
  const doc = 'Commerce & Principles of Accounts Syllabus (Forms 1-4)'
  // One ascending run → one section, but two are expected.
  const single = resolveSplitSubjects(doc, ['1.1 A', '1.2 B', '1.3 C'])
  assert.equal(single.ambiguous, true)
  assert.equal(single.byTopic.size, 0, 'an ambiguous sheet must not assign a subject')
  assert.match(single.reason, /expected 2 numbered sections, found 1/)
  // Three runs → also ambiguous, also assigns nothing.
  const triple = resolveSplitSubjects(doc, ['1.1 A', '1.2 B', '1.1 C', '1.2 D', '1.1 E'])
  assert.equal(triple.ambiguous, true)
  assert.equal(triple.byTopic.size, 0)
})

test('a non-split document is left entirely alone', () => {
  assert.equal(resolveSplitSubjects('Biology Syllabus (Forms 1-4)', ['1.1 Cells']), null)
})

console.log('\nreal catalogue\n')

test('every form of the Commerce & PoA workbook splits cleanly into two', () => {
  const title = 'Commerce & Principles of Accounts Syllabus (Forms 1-4)'
  const doc = raw2023[title]
  assert.ok(doc, 'the workbook must be present in the catalogue')
  for (const [sheetName, sheet] of Object.entries(doc)) {
    const seen = []
    for (const row of sheet.rows || []) {
      const topic = String(row?.cells?.TOPIC || '').trim()
      if (topic && !seen.includes(topic)) seen.push(topic)
    }
    const split = resolveSplitSubjects(title, seen)
    assert.equal(split.ambiguous, false, `${sheetName}: ${split.reason}`)
    assert.equal(split.sectionCount, 2, `${sheetName} must hold exactly 2 syllabi`)
    const subjects = new Set(split.byTopic.values())
    assert.deepEqual([...subjects].sort(), ['commerce', 'principles_of_accounts'])
  }
})

test('Commerce 1.1 and Principles of Accounts 1.1 remain independent topics', () => {
  const topics = syllabiToKbTopics(raw2023)
  const commerce = topics.filter((t) => t.subject === 'commerce' && t.grade === 'G8')
  const accounts = topics.filter((t) => t.subject === 'principles_of_accounts' && t.grade === 'G8')

  assert.ok(commerce.length > 0 && accounts.length > 0, 'both subjects must exist at G8')
  assert.ok(commerce.some((t) => t.topic === '1.1 Commerce'))
  assert.ok(accounts.some((t) => t.topic === '1.1 Principles of Accounts'))
  // The collision itself: neither may hold the other's 1.1.
  assert.ok(!commerce.some((t) => t.topic === '1.1 Principles of Accounts'))
  assert.ok(!accounts.some((t) => t.topic === '1.1 Commerce'))

  // Each subject claims the code exactly once, so 1.1.x has one parent.
  for (const [label, rows] of [['commerce', commerce], ['principles_of_accounts', accounts]]) {
    const ones = rows.filter((t) => /^1\.1(\s|$)/.test(t.topic))
    assert.equal(ones.length, 1, `${label} must claim 1.1 exactly once, saw ${ones.length}`)
  }

  // Their composite identities differ even though the visible code is identical.
  const a = topicIdentity({ curriculumId: 'cbc', gradeId: 'G8', subjectKey: 'commerce', topicCode: '1.1' })
  const b = topicIdentity({ curriculumId: 'cbc', gradeId: 'G8', subjectKey: 'principles_of_accounts', topicCode: '1.1' })
  assert.notEqual(a, b)
  // …and the visible code is untouched: it is still plain "1.1" in both.
  assert.ok(a.endsWith('|1.1') && b.endsWith('|1.1'))
})

test('the retired combined key produces no topics at all', () => {
  const topics = syllabiToKbTopics(raw2023)
  for (const legacy of LEGACY_COMBINED_KEYS) {
    assert.equal(
      topics.filter((t) => t.subject === legacy).length, 0,
      `${legacy} must no longer own any topic`,
    )
  }
})

test('Food & Nutrition and Home Management are separate scopes at G10-G12', () => {
  const lookup = extract2013TopicLookup(raw2013)
  for (const grade of ['G10', 'G11', 'G12']) {
    const food = lookup.get(`${grade}|food_and_nutrition`)
    const home = lookup.get(`${grade}|home_management`)
    assert.ok(food && food.size > 0, `${grade} Food & Nutrition must have topics`)
    assert.ok(home && home.size > 0, `${grade} Home Management must have topics`)
    // Both legitimately number from <grade>.1 — that is why they must not share
    // a bucket. Neither may contain the other's headings.
    for (const topic of home.keys()) assert.ok(!food.has(topic), `${grade}: ${topic} leaked into Food & Nutrition`)
    for (const topic of food.keys()) assert.ok(!home.has(topic), `${grade}: ${topic} leaked into Home Management`)
  }
  // The senior Home Management data must not still be filed as home_economics.
  assert.ok(!lookup.has('G10|home_economics'), 'G10 home_economics must no longer exist')
  // …while the genuinely-different G5-7 Home Economics syllabus is untouched.
  assert.ok(lookup.get('G7|home_economics')?.size > 0, 'G7 Home Economics must survive')
})

test('Food & Nutrition 10.1 cannot become the parent of a Home Management 10.1.x', () => {
  // The hierarchy repair only ever sees ONE curriculum + grade + subject, so the
  // Home Management sub-topic is not even in the same call as the Food &
  // Nutrition topic that shares its code.
  const food = normalizeTopicTree(new Map([['10.1 The Kitchen, equipment and utensils.', new Set()]]))
  const home = normalizeTopicTree(new Map([
    ['10.1 The House', new Set()],
    ['10.1.1 Choosing a site', new Set()],
  ]))
  // In Home Management the sub-topic folds under ITS OWN parent.
  assert.ok(home.topics.has('10.1 The House'))
  assert.ok(!home.topics.has('10.1.1 Choosing a site'), 'the sub-topic belongs under 10.1 The House')
  assert.ok(home.topics.get('10.1 The House').has('10.1.1 Choosing a site'))
  // And Food & Nutrition never saw it.
  assert.ok(!food.topics.get('10.1 The Kitchen, equipment and utensils.').has('10.1.1 Choosing a site'))

  // The scopes are different keys, which is what keeps the two calls apart.
  assert.notEqual(
    topicScopeKey({ curriculumId: 'previous', gradeId: 'G10', subjectKey: 'food_and_nutrition' }),
    topicScopeKey({ curriculumId: 'previous', gradeId: 'G10', subjectKey: 'home_management' }),
  )
})

test('a code claimed twice inside ONE scope is never given a parent by guessing', () => {
  // The residual case: two subjects still sharing a key (Fashion & Fabrics and
  // Hospitality Management both remain home_economics). A sub-topic of the
  // contested code has two candidate parents, so it must be left as a topic
  // rather than folded under whichever appears first.
  const { topics, ambiguous } = normalizeTopicTree(new Map([
    ['1.1 Fashion topic', new Set(['a'])],
    ['1.1 Hospitality topic', new Set(['b'])],
    ['1.1.1 Whose child is this?', new Set(['c'])],
  ]))
  assert.ok(topics.has('1.1.1 Whose child is this?'), 'the contested child stays a top-level topic')
  assert.ok(!topics.get('1.1 Fashion topic').has('1.1.1 Whose child is this?'))
  assert.ok(!topics.get('1.1 Hospitality topic').has('1.1.1 Whose child is this?'))
  assert.equal(ambiguous.length, 1)
  assert.equal(ambiguous[0].code, '1.1.1')
  assert.deepEqual(ambiguous[0].owners, ['1.1 Fashion topic', '1.1 Hospitality topic'])
})

console.log('\nclassifier\n')

const topicIndex = new Map()
const presence = new Set()
{
  const cbc = syllabiToKbTopics(raw2023)
  buildTopicSubjectIndex(cbc, 'cbc', topicIndex)
  buildSubjectPresence(cbc, 'cbc', presence)
  const flat = []
  for (const [key, inner] of extract2013TopicLookup(raw2013)) {
    const [grade, subject] = String(key).split('|')
    for (const topic of inner.keys()) flat.push({ grade, subject, topic })
  }
  buildTopicSubjectIndex(flat, 'previous', topicIndex)
  buildSubjectPresence(flat, 'previous', presence)
}
const ctx = { topicIndex, subjectPresence: presence, gradeResolver: resolveGradeCode }

test('a record whose topics all belong to one subject is classified from the catalogue', () => {
  const v = classifyRecord({
    subject: 'commerce_and_principles_of_accounts', grade: 'G8', curriculum: '2023',
    topics: ['1.2 Production', '1.3 Home Trade'],
  }, ctx)
  assert.equal(v.outcome, OUTCOMES.CLASSIFIED)
  assert.equal(v.subject, 'commerce')
  assert.match(v.evidence, /matched commerce/)
})

test('grade spellings are folded before the lookup ("Form 1" → G8)', () => {
  const v = classifyRecord({
    subject: 'commerce_and_principles_of_accounts', grade: 'Form 1', curriculum: '2023',
    topics: ['1.4 The Ledger'],
  }, ctx)
  assert.equal(v.outcome, OUTCOMES.CLASSIFIED)
  assert.equal(v.subject, 'principles_of_accounts')
})

test('a record spanning both subjects is ambiguous, not assigned to the first', () => {
  const v = classifyRecord({
    subject: 'commerce_and_principles_of_accounts', grade: 'G8', curriculum: '2023',
    topics: ['1.2 Production', '1.4 The Ledger'],
  }, ctx)
  assert.equal(v.outcome, OUTCOMES.AMBIGUOUS)
  assert.equal(v.subject, 'commerce_and_principles_of_accounts', 'the stored key is left alone')
  assert.match(v.evidence, /span commerce and principles_of_accounts/)
})

test('free-text topics, no topics and no grade are each ambiguous with a reason', () => {
  const cases = [
    [{ topics: ['Revision of everything'] }, /none of its 1 topic/],
    [{ topics: [] }, /no topics on the record/],
    [{ topics: ['1.2 Production'], grade: '' }, /no grade on the record/],
  ]
  for (const [extra, expected] of cases) {
    const v = classifyRecord({
      subject: 'commerce_and_principles_of_accounts', grade: 'G8', curriculum: '2023', ...extra,
    }, ctx)
    assert.equal(v.outcome, OUTCOMES.AMBIGUOUS)
    assert.match(v.evidence, expected)
  }
})

test('an explicit source syllabus decides on its own', () => {
  const v = classifyRecord({
    subject: 'home_economics', grade: 'G10', curriculum: '2013',
    sourceSyllabus: 'Home Management Syllabus (Grades 10-12, 2013)', topics: [],
  }, ctx)
  assert.equal(v.outcome, OUTCOMES.CLASSIFIED)
  assert.equal(v.subject, 'home_management')
  assert.match(v.evidence, /source syllabus/)
})

test('the combined workbook as a source syllabus is NOT evidence for either half', () => {
  const v = classifyRecord({
    subject: 'commerce_and_principles_of_accounts', grade: 'G8', curriculum: '2023',
    sourceSyllabus: 'Commerce & Principles of Accounts Syllabus (Forms 1-4)', topics: [],
  }, ctx)
  assert.equal(v.outcome, OUTCOMES.AMBIGUOUS)
})

test('a genuine primary Home Economics record is unchanged, not flagged', () => {
  // Neither Food & Nutrition nor Home Management is taught at Grade 6, so there
  // is nothing this record could be but Home Economics.
  const v = classifyRecord({
    subject: 'home_economics', grade: 'G6', curriculum: '2013', topics: ['anything at all'],
  }, ctx)
  assert.equal(v.outcome, OUTCOMES.UNCHANGED)
  assert.equal(v.subject, 'home_economics')
})

test('a subject that was never split is not touched', () => {
  const v = classifyRecord({ subject: 'mathematics', grade: 'G8', curriculum: '2023' }, ctx)
  assert.equal(v.outcome, OUTCOMES.NOT_APPLICABLE)
})

test('a topic label claimed by two candidate subjects is not used as evidence', () => {
  // Both syllabi contain a topic called "Entrepreneurship" at some grade. Where a
  // label is contested inside one curriculum+grade it is dropped from the index,
  // so it can never tip a classification either way.
  const index = buildTopicSubjectIndex([
    { grade: 'G9', subject: 'commerce', topic: 'Entrepreneurship' },
    { grade: 'G9', subject: 'principles_of_accounts', topic: 'Entrepreneurship' },
  ], 'cbc')
  assert.equal(index.get('cbc|G9|entrepreneurship'), undefined)
})

console.log('\nclient / server mirror\n')

test('syllabusSubjectSplit is identical on the client and the server', () => {
  const server = require('../functions/teacherTools/syllabusSubjectSplit.js')
  assert.deepEqual(
    Object.keys(server.SPLIT_DOCUMENTS).sort(), Object.keys(SPLIT_DOCUMENTS).sort(),
    'both copies must cover the same documents',
  )
  for (const [title, spec] of Object.entries(SPLIT_DOCUMENTS)) {
    assert.deepEqual(server.SPLIT_DOCUMENTS[title].sections, spec.sections)
    assert.equal(server.SPLIT_DOCUMENTS[title].legacyKey, spec.legacyKey)
  }
  // Same decisions on the same input, including the ambiguous paths.
  const title = 'Commerce & Principles of Accounts Syllabus (Forms 1-4)'
  const inputs = [
    ['1.1 Commerce', '1.2 Production', '1.1 Principles of Accounts'],
    ['1.1 A', '1.2 B'],
    ['1.1 A', '1.1 B', '1.1 C'],
    ['1.9 Nine', '1.10 Ten'],
  ]
  for (const labels of inputs) {
    const a = resolveSplitSubjects(title, labels)
    const b = server.resolveSplitSubjects(title, labels)
    assert.equal(b.ambiguous, a.ambiguous, `ambiguity differs for ${labels.join(' / ')}`)
    assert.equal(b.sectionCount, a.sectionCount)
    assert.deepEqual([...b.byTopic.entries()].sort(), [...a.byTopic.entries()].sort())
  }
})

test('the server subject tables carry the split keys', () => {
  const { STUDIO_SUBJECT_TO_KB, STUDIO_SUBJECT_TO_KB_2013 } = require('../functions/teacherTools/kbLookupCandidates.js')
  assert.equal(STUDIO_SUBJECT_TO_KB['Food & Nutrition Syllabus (Forms 1-4)'], 'food_and_nutrition')
  assert.equal(STUDIO_SUBJECT_TO_KB_2013['Food & Nutrition Syllabus (Grades 10-12, 2013)'], 'food_and_nutrition')
  assert.equal(STUDIO_SUBJECT_TO_KB_2013['Home Management Syllabus (Grades 10-12, 2013)'], 'home_management')
  assert.equal(STUDIO_SUBJECT_TO_KB_2013['Home Economics Syllabus (Grades 5-7, 2013)'], 'home_economics')
})

console.log(`\n${passed} passing\n`)
