/**
 * The subject split. Five canonical subjects carved out of three shared keys:
 *
 *   commerce_and_principles_of_accounts → commerce | principles_of_accounts
 *   home_economics (senior secondary)   → food_and_nutrition | home_management
 *   mathematics (Forms 1-4)             → mathematics | mathematics_ii
 *
 * A topic code is only unique within one curriculum + grade + subject. These
 * tests pin the consequences of getting that wrong:
 *
 *   1. Two subjects that legitimately share a code stay independent — Commerce
 *      "1.1", Principles of Accounts "1.1" and Mathematics II "1.1" are three
 *      different topics from Mathematics "1.1".
 *   2. A sub-topic is never adopted across a subject boundary — Food & Nutrition
 *      "10.1" must not become the parent of a Home Management "10.1.x".
 *   3. Nothing is ever moved on a guess, and a record on a key that is STILL
 *      valid (a Mathematics paper) is left alone rather than flagged.
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
  classifyRecord, buildTopicSubjectIndex, buildSubjectPresence, resolveGradeCode,
  topicMatchKey, OUTCOMES,
} from '../src/utils/subjectSplitClassifier.js'
import { topicIdentity, topicScopeKey } from '../src/curriculum/resolvers/curriculumTopicIdentity.js'

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

test('Mathematics and Mathematics II are separate scopes at Forms 1-4', () => {
  const topics = syllabiToKbTopics(raw2023)
  for (const grade of ['G8', 'G9', 'G10', 'G11']) {
    const maths = topics.filter((t) => t.subject === 'mathematics' && t.grade === grade)
    const mathsII = topics.filter((t) => t.subject === 'mathematics_ii' && t.grade === grade)
    assert.ok(maths.length > 0, `${grade} Mathematics must have topics`)
    assert.ok(mathsII.length > 0, `${grade} Mathematics II must have topics`)
    // Both number from <form>.1 and are supposed to. Neither may hold the
    // other's headings — that collision is what this split removes.
    const mathsTopics = new Set(maths.map((t) => t.topic))
    for (const t of mathsII) assert.ok(!mathsTopics.has(t.topic), `${grade}: ${t.topic} leaked into Mathematics`)
  }
  // Mathematics stays a real subject everywhere else, unchanged.
  assert.ok(topics.some((t) => t.subject === 'mathematics' && t.grade === 'G4'))
})

test('Mathematics 1.1 and Mathematics II 1.1 remain independent topics', () => {
  const topics = syllabiToKbTopics(raw2023)
  const maths = topics.filter((t) => t.subject === 'mathematics' && t.grade === 'G8')
  const mathsII = topics.filter((t) => t.subject === 'mathematics_ii' && t.grade === 'G8')
  assert.ok(maths.some((t) => t.topic === '1.1 NUMBERS'), 'Mathematics owns 1.1 NUMBERS')
  assert.ok(mathsII.some((t) => /^1\.1\.?\s+REAL NUMBERS/.test(t.topic)), 'Mathematics II owns 1.1 REAL NUMBERS')
  // Each claims the code exactly once, so a 1.1.x sub-topic has one parent.
  for (const [label, rows] of [['mathematics', maths], ['mathematics_ii', mathsII]]) {
    const ones = rows.filter((t) => /^1\.1\.?(\s|$)/.test(t.topic))
    assert.equal(ones.length, 1, `${label} G8 must claim 1.1 exactly once, saw ${ones.length}`)
  }
  assert.notEqual(
    topicIdentity({ curriculumId: 'cbc', gradeId: 'G8', subjectKey: 'mathematics', topicCode: '1.1' }),
    topicIdentity({ curriculumId: 'cbc', gradeId: 'G8', subjectKey: 'mathematics_ii', topicCode: '1.1' }),
  )
})

test('English and Literature in English are separate scopes at Forms 1-4', () => {
  const topics = syllabiToKbTopics(raw2023)
  // The Literature workbook ships Form 1, Form 2 and a combined "Form 3 - 4"
  // sheet, which the grade map resolves to G10 — so G8-G10, not G8-G11.
  for (const grade of ['G8', 'G9', 'G10']) {
    const english = topics.filter((t) => t.subject === 'english' && t.grade === grade)
    const lit = topics.filter((t) => t.subject === 'literature_in_english' && t.grade === grade)
    assert.ok(english.length > 0, `${grade} English must have topics`)
    assert.ok(lit.length > 0, `${grade} Literature in English must have topics`)
    // Both number from <form>.1.1 and are supposed to. Neither may hold the
    // other's headings — that collision is what this split removes.
    const englishTopics = new Set(english.map((t) => t.topic))
    for (const t of lit) {
      assert.ok(!englishTopics.has(t.topic), `${grade}: ${t.topic} leaked into English`)
    }
    // Concretely: no Literature heading is offered under English any more.
    for (const t of english) {
      assert.ok(
        !/^\d[\d.]*\.\s*(ORAL |WRITTEN )?LITERATURE\b/i.test(t.topic),
        `${grade}: English still carries the Literature heading ${t.topic}`,
      )
    }
  }
  // English stays a real subject at every grade it was already taught at.
  for (const grade of ['ECE_N', 'G1', 'G4', 'G11']) {
    assert.ok(
      topics.some((t) => t.subject === 'english' && t.grade === grade),
      `English must survive at ${grade}`,
    )
  }
})

test('English 1.1.1 and Literature in English 1.1.1 remain independent topics', () => {
  const topics = syllabiToKbTopics(raw2023)
  const at = (subject, grade) => topics.filter((t) => t.subject === subject && t.grade === grade)
  assert.ok(at('english', 'G8').some((t) => t.topic === '1.1.1 Greetings'), 'English owns 1.1.1 Greetings')
  assert.ok(
    at('literature_in_english', 'G8').some((t) => /^1\.1\.1\.?\s*LITERATURE$/i.test(t.topic)),
    'Literature in English owns 1.1.1 LITERATURE',
  )
  // Each claims the code exactly once, in its own scope, so a 1.1.1.x sub-topic
  // has exactly one candidate parent. (\D guards the boundary: 1.1.10 is not
  // 1.1.1 — English G8 has both.)
  for (const subject of ['english', 'literature_in_english']) {
    const ones = at(subject, 'G8').filter((t) => /^1\.1\.1(\D|$)/.test(t.topic))
    assert.equal(ones.length, 1, `${subject} G8 must claim 1.1.1 once, saw ${ones.length}`)
  }
  // The same visible code, two internal identities.
  assert.notEqual(
    topicIdentity({ curriculumId: 'cbc', gradeId: 'G8', subjectKey: 'english', topicCode: '1.1.1' }),
    topicIdentity({ curriculumId: 'cbc', gradeId: 'G8', subjectKey: 'literature_in_english', topicCode: '1.1.1' }),
  )
  // And the G9 pair the validation report named: 2.2.1 Comprehension vs 2.2.1 PROSE.
  assert.ok(at('english', 'G9').some((t) => t.topic === '2.2.1 Comprehension'))
  assert.ok(at('literature_in_english', 'G9').some((t) => /^2\.2\.1\.?\s*PROSE$/i.test(t.topic)))
})

test('the Form 3-4 Literature heading survives the split', () => {
  // "3-4.1.1. SELECTED PRESCRIBED TEXT" carries a code the parser cannot read
  // (the leading "3-4"), so it is the entry most at risk of being folded away as
  // a fragment. It is a real heading and the ONLY Literature topic at G10.
  const topics = syllabiToKbTopics(raw2023)
  const g10 = topics.filter((t) => t.subject === 'literature_in_english' && t.grade === 'G10')
  assert.ok(
    g10.some((t) => /SELECTED PRESCRIBED TEXT/i.test(t.topic)),
    `expected the prescribed-text heading, saw ${JSON.stringify(g10.map((t) => t.topic))}`,
  )
  // Alone in its scope it must not collapse into anything.
  const { topics: tree } = normalizeTopicTree(new Map([['3-4.1.1. SELECTED PRESCRIBED TEXT', new Set(['a'])]]))
  assert.ok(tree.has('3-4.1.1. SELECTED PRESCRIBED TEXT'))
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

test('the three CBC Forms 1-4 home-economics pathways are separate scopes', () => {
  const topics = syllabiToKbTopics(raw2023)
  const pathways = ['food_and_nutrition', 'fashion_and_fabrics', 'hospitality_management']
  for (const grade of ['G8', 'G9', 'G10', 'G11']) {
    const byPathway = new Map(pathways.map((s) => [s, topics.filter((t) => t.subject === s && t.grade === grade)]))
    for (const [subject, rows] of byPathway) {
      assert.ok(rows.length > 0, `${grade} ${subject} must have topics`)
    }
    // All three number from <form>.1 and are supposed to. No pathway may hold
    // another's headings — that three-way collision is what this split removes.
    for (const [subject, rows] of byPathway) {
      const own = new Set(rows.map((t) => t.topic))
      for (const [other, otherRows] of byPathway) {
        if (other === subject) continue
        for (const t of otherRows) {
          assert.ok(!own.has(t.topic), `${grade}: ${t.topic} leaked from ${other} into ${subject}`)
        }
      }
    }
    // And none of them is filed as home_economics any more.
    assert.equal(
      topics.filter((t) => t.subject === 'home_economics' && t.grade === grade).length, 0,
      `${grade} must have no home_economics rows — it is not a Forms 1-4 subject`,
    )
  }
  // home_economics survives where it genuinely is one integrated subject.
  assert.ok(topics.some((t) => t.subject === 'home_economics' && t.grade === 'G4'))
})

test('the same code in all three pathways is three independent topics', () => {
  const topics = syllabiToKbTopics(raw2023)
  const PATHWAYS = ['food_and_nutrition', 'fashion_and_fabrics', 'hospitality_management']
  const at = (subject, grade) => topics.filter((t) => t.subject === subject && t.grade === grade)
  assert.ok(at('fashion_and_fabrics', 'G9').some((t) => t.topic === '2.1 SAFETY'))
  assert.ok(at('hospitality_management', 'G9').some((t) => /^2\.1\.?\s+INTRODUCTION TO HOSPITALITY/i.test(t.topic)))
  assert.ok(at('food_and_nutrition', 'G9').some((t) => t.topic === '2.1 PRACTICAL PLANNING'))
  // Each claims its <form>.1 code exactly once, so a <form>.1.x sub-topic has
  // exactly one candidate parent. (\D guards the boundary: 1.10 is not 1.1.)
  for (const [grade, form] of [['G8', 1], ['G9', 2], ['G10', 3], ['G11', 4]]) {
    const at1 = new RegExp(`^${form}\\.1(\\D|$)`)
    for (const subject of PATHWAYS) {
      const ones = at(subject, grade).filter((t) => at1.test(t.topic))
      assert.equal(ones.length, 1, `${subject} ${grade} must claim ${form}.1 once, saw ${ones.length}`)
    }
  }
  // Three distinct internal identities for the same visible code.
  const identities = new Set(PATHWAYS.map((subjectKey) =>
    topicIdentity({ curriculumId: 'cbc', gradeId: 'G8', subjectKey, topicCode: '1.1' })))
  assert.equal(identities.size, 3, 'the same code in three subjects must be three identities')
})

test('a Hospitality Management 2.1.x cannot become a child of Fashion & Fabrics 2.1', () => {
  // Each pathway's hierarchy is repaired in its own call, so the shared code is
  // never resolved across subjects.
  const fashion = normalizeTopicTree(new Map([['2.1 SAFETY', new Set()]]))
  const hospitality = normalizeTopicTree(new Map([
    ['2.1. INTRODUCTION TO HOSPITALITY', new Set()],
    ['2.1.1 Hospitality industry', new Set()],
  ]))
  assert.ok(hospitality.topics.get('2.1. INTRODUCTION TO HOSPITALITY')?.has('2.1.1 Hospitality industry'))
  assert.ok(!fashion.topics.get('2.1 SAFETY').has('2.1.1 Hospitality industry'))
  assert.notEqual(
    topicScopeKey({ curriculumId: 'cbc', gradeId: 'G9', subjectKey: 'fashion_and_fabrics' }),
    topicScopeKey({ curriculumId: 'cbc', gradeId: 'G9', subjectKey: 'hospitality_management' }),
  )
})

test('Grades 5-7 Home Economics stays ONE integrated subject — never split', () => {
  // Owner decision, 2026-07-25, confirmed against the CDC source: the Grade 5-7
  // Home Economics syllabus carries ONE set of general outcomes and key
  // competences for the whole subject, then presents FOOD AND NUTRITION, HOME
  // MANAGEMENT and NEEDLE WORK AND CRAFTS as components of it. Each component
  // restarts its numbering at <grade>.1, which is why the codes repeat — that is
  // the Ministry's layout, not two syllabi sharing a key. It is taught and
  // examined as one subject, so splitting it would be wrong.
  assert.ok(
    !Object.keys(SPLIT_DOCUMENTS).includes('Home Economics Syllabus (Grades 5-7, 2013)'),
    'the G5-7 Home Economics syllabus must never be registered as a split document',
  )

  const lookup = extract2013TopicLookup(raw2013)
  for (const grade of ['G5', 'G6', 'G7']) {
    const inner = lookup.get(`${grade}|home_economics`)
    assert.ok(inner && inner.size > 0, `${grade} Home Economics must exist as one subject`)
    // Its components all live under that ONE key — none broke out into its own.
    for (const key of ['food_and_nutrition', 'home_management', 'needlework', 'crafts']) {
      assert.ok(!lookup.has(`${grade}|${key}`), `${grade}|${key} must not exist — it is a component, not a subject`)
    }
  }

  // The repeated codes are real and expected: Grade 5 has several topics at 5.1,
  // one per component. That must stay true — collapsing them would lose content.
  const g5 = [...lookup.get('G5|home_economics').keys()]
  const atFiveOne = g5.filter((t) => /^5\.1(\s|$)/.test(t))
  assert.ok(atFiveOne.length > 1, `expected several 5.1 topics across components, saw ${atFiveOne.length}`)
})

test('a code claimed twice inside ONE scope is never given a parent by guessing', () => {
  // A code can still be claimed twice inside one legitimate scope — that is
  // exactly what an integrated subject's components produce (Grades 5-7 Home
  // Economics), and it is also what a still-shared key looks like (English +
  // Literature in English). Either way a sub-topic of the contested code has two
  // candidate parents, so it must be left as a topic rather than folded under
  // whichever appears first.
  const { topics, ambiguous } = normalizeTopicTree(new Map([
    ['1.1 First component topic', new Set(['a'])],
    ['1.1 Second component topic', new Set(['b'])],
    ['1.1.1 Whose child is this?', new Set(['c'])],
  ]))
  assert.ok(topics.has('1.1.1 Whose child is this?'), 'the contested child stays a top-level topic')
  assert.ok(!topics.get('1.1 First component topic').has('1.1.1 Whose child is this?'))
  assert.ok(!topics.get('1.1 Second component topic').has('1.1.1 Whose child is this?'))
  assert.equal(ambiguous.length, 1)
  assert.equal(ambiguous[0].code, '1.1.1')
  assert.deepEqual(ambiguous[0].owners, ['1.1 First component topic', '1.1 Second component topic'])
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

test('a senior home_economics record is classified across all four pathways', () => {
  // Forms 1-4: home_economics is not a subject at all, so the record is stranded
  // and its topics decide which of the three CBC pathways owns it.
  const cases = [
    ['1.2 FASHION AND FABRICS WORKROOM', 'fashion_and_fabrics'],
    ['1.2. FRONT OFFICE OPERATIONS', 'hospitality_management'],
    ['1.2 NUTRITION', 'food_and_nutrition'],
  ]
  for (const [topic, expected] of cases) {
    const v = classifyRecord({
      subject: 'home_economics', grade: 'F1', curriculum: '2023', topics: [topic],
    }, ctx)
    assert.equal(v.outcome, OUTCOMES.CLASSIFIED, `${topic} → ${expected}`)
    assert.equal(v.subject, expected)
  }
  // A paper spanning two pathways is reported, never assigned to the first.
  const spanning = classifyRecord({
    subject: 'home_economics', grade: 'F1', curriculum: '2023',
    topics: ['1.2 FASHION AND FABRICS WORKROOM', '1.2. FRONT OFFICE OPERATIONS'],
  }, ctx)
  assert.equal(spanning.outcome, OUTCOMES.AMBIGUOUS)
  assert.equal(spanning.subject, 'home_economics', 'the stored key is left alone')
  assert.match(spanning.evidence, /span fashion_and_fabrics and hospitality_management/)
  // And with no usable topics it is ambiguous, not guessed — unlike `mathematics`
  // below, nothing at this level still owns the key it carries.
  const blind = classifyRecord({
    subject: 'home_economics', grade: 'F1', curriculum: '2023', topics: [],
  }, ctx)
  assert.equal(blind.outcome, OUTCOMES.AMBIGUOUS)
  assert.equal(blind.subject, 'home_economics')
})

test('the Fashion & Fabrics / Hospitality Management documents decide on their own', () => {
  for (const [doc, expected] of [
    ['Fashion & Fabrics Syllabus (Forms 1-4)', 'fashion_and_fabrics'],
    ['Hospitality Management Syllabus (Forms 1-4)', 'hospitality_management'],
  ]) {
    const v = classifyRecord({
      subject: 'home_economics', grade: 'G9', curriculum: '2023', sourceSyllabus: doc, topics: [],
    }, ctx)
    assert.equal(v.outcome, OUTCOMES.CLASSIFIED, doc)
    assert.equal(v.subject, expected)
    assert.match(v.evidence, /source syllabus/)
  }
})

test('a subject that was never split is not touched', () => {
  const v = classifyRecord({ subject: 'biology', grade: 'G8', curriculum: '2023' }, ctx)
  assert.equal(v.outcome, OUTCOMES.NOT_APPLICABLE)
})

test('a Mathematics record moves only when its topics say Mathematics II', () => {
  // Mathematics II topics → reassigned.
  const two = classifyRecord({
    subject: 'mathematics', grade: 'G8', curriculum: '2023',
    topics: ['1.10. DIRECTIONS AND BEARINGS'],
  }, ctx)
  assert.equal(two.outcome, OUTCOMES.CLASSIFIED)
  assert.equal(two.subject, 'mathematics_ii')

  // Mathematics topics → confirmed where it is.
  const one = classifyRecord({
    subject: 'mathematics', grade: 'G8', curriculum: '2023', topics: ['1.6 MATRICES'],
  }, ctx)
  assert.equal(one.outcome, OUTCOMES.UNCHANGED)
  assert.equal(one.subject, 'mathematics')
})

test('a Mathematics record with no usable topics is LEFT ALONE, not flagged', () => {
  // `mathematics` is still the correct key for the Mathematics syllabus, so the
  // absence of evidence is not ambiguity — there is simply no reason to move it.
  // Contrast the retired combined key below, where nothing owns the record.
  for (const extra of [{ topics: [] }, { topics: ['Revision of everything'] }, { grade: '' }]) {
    const v = classifyRecord({
      subject: 'mathematics', grade: 'G8', curriculum: '2023', topics: ['x'], ...extra,
    }, ctx)
    assert.equal(v.outcome, OUTCOMES.UNCHANGED, JSON.stringify(extra))
    assert.equal(v.subject, 'mathematics')
  }
  // A Grade 4 Mathematics record cannot be Mathematics II at all (Forms only).
  const primary = classifyRecord({
    subject: 'mathematics', grade: 'G4', curriculum: '2023', topics: [],
  }, ctx)
  assert.equal(primary.outcome, OUTCOMES.UNCHANGED)

  // The retired key has no incumbent, so the same absence of evidence is a
  // genuine ambiguity a human has to resolve.
  const retired = classifyRecord({
    subject: 'commerce_and_principles_of_accounts', grade: 'G8', curriculum: '2023', topics: [],
  }, ctx)
  assert.equal(retired.outcome, OUTCOMES.AMBIGUOUS)
})

test('a topic both mathematics syllabi share is not evidence for either', () => {
  // Form 4 carries "GEOMETRICAL TRANSFORMATIONS" as 4.5 in both, punctuated
  // differently ("4.5" vs "4.5."). The match key normalises the code, so the two
  // collide, are seen as contested, and decide nothing.
  assert.equal(
    topicMatchKey('4.5 GEOMETRICAL TRANSFORMATIONS'),
    topicMatchKey('4.5. GEOMETRICAL TRANSFORMATIONS'),
  )
  const v = classifyRecord({
    subject: 'mathematics', grade: 'G11', curriculum: '2023',
    topics: ['4.5 GEOMETRICAL TRANSFORMATIONS'],
  }, ctx)
  assert.equal(v.topicsResolved, 0, 'a shared topic must resolve to no subject')
  assert.equal(v.outcome, OUTCOMES.UNCHANGED, 'and so leaves the record where it is')
})

test('an English record moves only when its topics say Literature in English', () => {
  // Literature topics → reassigned.
  const lit = classifyRecord({
    subject: 'english', grade: 'G9', curriculum: '2023',
    topics: ['2.2.1. PROSE', '2.2.3. POETRY'],
  }, ctx)
  assert.equal(lit.outcome, OUTCOMES.CLASSIFIED)
  assert.equal(lit.subject, 'literature_in_english')

  // English-language topics → confirmed where it is.
  const eng = classifyRecord({
    subject: 'english', grade: 'G9', curriculum: '2023', topics: ['2.2.1 Comprehension'],
  }, ctx)
  assert.equal(eng.outcome, OUTCOMES.UNCHANGED)
  assert.equal(eng.subject, 'english')

  // A paper spanning both is reported, never assigned to the first.
  const spanning = classifyRecord({
    subject: 'english', grade: 'G9', curriculum: '2023',
    topics: ['2.2.1 Comprehension', '2.2.1. PROSE'],
  }, ctx)
  assert.equal(spanning.outcome, OUTCOMES.AMBIGUOUS)
  assert.equal(spanning.subject, 'english', 'the stored key is left alone')
  assert.match(spanning.evidence, /span english and literature_in_english/)

  // `english` is not retired, so no evidence means no reason to move it — the
  // same rule Mathematics gets, and the reason primary English is never flagged.
  for (const extra of [{ topics: [] }, { topics: ['End of term revision'] }, { grade: '' }]) {
    const v = classifyRecord({
      subject: 'english', grade: 'G9', curriculum: '2023', topics: ['x'], ...extra,
    }, ctx)
    assert.equal(v.outcome, OUTCOMES.UNCHANGED, JSON.stringify(extra))
    assert.equal(v.subject, 'english')
  }
  for (const grade of ['ECE_N', 'G1', 'G4', 'G11']) {
    const v = classifyRecord({ subject: 'english', grade, curriculum: '2023', topics: [] }, ctx)
    assert.equal(v.outcome, OUTCOMES.UNCHANGED, `English at ${grade} must be left alone`)
  }
  // And the source-syllabus field decides on its own either way.
  for (const [doc, expected, outcome] of [
    ['Literature in English Syllabus (Forms 1-4)', 'literature_in_english', OUTCOMES.CLASSIFIED],
    ['English Syllabus (Forms 1-4)', 'english', OUTCOMES.UNCHANGED],
  ]) {
    const v = classifyRecord({
      subject: 'english', grade: 'G8', curriculum: '2023', sourceSyllabus: doc, topics: [],
    }, ctx)
    assert.equal(v.outcome, outcome, doc)
    assert.equal(v.subject, expected)
  }
})

test('RE 2044 and RE 2046 are separate scopes, each owning its own 10.1-10.4', () => {
  // The collision that motivated the split: both syllabi open at 10.1 and run to
  // 10.4, so under one key those four codes each had two different topics. Under
  // two keys each code resolves to exactly one subject.
  const pairs = [
    ['10.1 Work in a changing society.', 'religious_education_2044'],
    ['10.2 Leisure in a changing society', 'religious_education_2044'],
    ['10.3 Justice in Society', 'religious_education_2044'],
    ['10.4 Service in Society', 'religious_education_2044'],
    ['10.1 BIRTH AND INFANCY OF JOHN THE BAPTIST AND JESUS', 'religious_education_2046'],
    ['10.2 Ministry and Death of John the Baptist', 'religious_education_2046'],
    ['10.3 BAPTISM', 'religious_education_2046'],
    ['10.4 TEMPTATION', 'religious_education_2046'],
  ]
  for (const [topic, subject] of pairs) {
    assert.equal(
      topicIndex.get(`previous|G10|${topicMatchKey(topic)}`), subject,
      `${topic} must be owned by ${subject} alone`,
    )
  }
  // And the plain key owns nothing in the 2013 senior set any more — if it did,
  // the codes would still be contested.
  for (const grade of ['G10', 'G11', 'G12']) {
    assert.ok(
      !presence.has(`previous|${grade}|religious_education`),
      `religious_education must have no 2013 rows at ${grade}`,
    )
    for (const key of ['religious_education_2044', 'religious_education_2046']) {
      assert.ok(presence.has(`previous|${grade}|${key}`), `${key} missing at ${grade}`)
    }
  }
})

test('a Religious Education record moves only in the 2013 senior set', () => {
  // 2044 topics → reassigned.
  const thematic = classifyRecord({
    subject: 'religious_education', grade: 'G10', curriculum: '2013',
    topics: ['10.1 Work in a changing society.', '10.3 Justice in Society'],
  }, ctx)
  assert.equal(thematic.outcome, OUTCOMES.CLASSIFIED)
  assert.equal(thematic.subject, 'religious_education_2044')

  // 2046 topics → reassigned the other way.
  const biblical = classifyRecord({
    subject: 'religious_education', grade: 'G10', curriculum: '2013',
    topics: ['10.3 BAPTISM', '10.4 TEMPTATION'],
  }, ctx)
  assert.equal(biblical.outcome, OUTCOMES.CLASSIFIED)
  assert.equal(biblical.subject, 'religious_education_2046')

  // A paper drawing on both is reported, never assigned to the first.
  const spanning = classifyRecord({
    subject: 'religious_education', grade: 'G10', curriculum: '2013',
    topics: ['10.1 Work in a changing society.', '10.4 TEMPTATION'],
  }, ctx)
  assert.equal(spanning.outcome, OUTCOMES.AMBIGUOUS)
  assert.equal(spanning.subject, 'religious_education', 'the stored key is left alone')
  assert.match(spanning.evidence, /span religious_education_2044 and religious_education_2046/)

  // At 2013 senior the plain key IS retired, so no evidence is a real ambiguity.
  const stranded = classifyRecord({
    subject: 'religious_education', grade: 'G12', curriculum: '2013',
    topics: ['Revision of the whole syllabus'],
  }, ctx)
  assert.equal(stranded.outcome, OUTCOMES.AMBIGUOUS)

  // The CBC never divides RE, so a CBC record is confirmed where it is at every
  // grade — including the senior grades the 2013 split applies to.
  for (const grade of ['ECE_N', 'G1', 'G7', 'G9', 'G10', 'G12']) {
    const v = classifyRecord({
      subject: 'religious_education', grade, curriculum: '2023', topics: [],
    }, ctx)
    assert.equal(v.outcome, OUTCOMES.UNCHANGED, `CBC RE at ${grade} must be left alone`)
    assert.equal(v.subject, 'religious_education')
  }

  // The source-syllabus field decides on its own, in both directions.
  for (const [doc, expected, outcome] of [
    ['Religious Education 2044 Syllabus (Grades 10-12, 2013)', 'religious_education_2044', OUTCOMES.CLASSIFIED],
    ['Religious Education 2046 Syllabus (Grades 10-12, 2013)', 'religious_education_2046', OUTCOMES.CLASSIFIED],
    ['Religious Education Syllabus (Forms 1-4)', 'religious_education', OUTCOMES.UNCHANGED],
  ]) {
    const v = classifyRecord({
      subject: 'religious_education', grade: 'G11', curriculum: '2013', sourceSyllabus: doc, topics: [],
    }, ctx)
    assert.equal(v.outcome, outcome, doc)
    assert.equal(v.subject, expected, doc)
  }
})

test('a grade with no digitised rows for any candidate is left alone, not stranded', () => {
  // The 2013 set is only digitised in parts: it carries no Religious Education
  // sheet below Grade 10 at all. Narrowing by presence therefore yields NOTHING
  // for an OBC junior record — which says the catalogue is missing, not that the
  // record is on a dead key. Reading it as evidence would flag every such record
  // and bury the senior ones that genuinely need a human.
  assert.ok(!presence.has('previous|G8|religious_education'), 'precondition: no rows')
  for (const key of ['religious_education_2044', 'religious_education_2046']) {
    assert.ok(!presence.has(`previous|G8|${key}`), 'precondition: no rows for either half')
  }
  const junior = classifyRecord({
    subject: 'religious_education', grade: 'G8', curriculum: '2013',
    topics: ['Creation stories'],
  }, ctx)
  assert.equal(junior.outcome, OUTCOMES.UNCHANGED)
  assert.equal(junior.subject, 'religious_education')

  // But a RETIRED combined key is never among its own candidates, so the same
  // empty narrowing still sends it to the review pile.
  const retired = classifyRecord({
    subject: 'commerce_and_principles_of_accounts', grade: 'G3', curriculum: '2013', topics: [],
  }, ctx)
  assert.equal(retired.outcome, OUTCOMES.AMBIGUOUS)
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
