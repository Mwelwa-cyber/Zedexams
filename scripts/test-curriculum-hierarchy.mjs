#!/usr/bin/env node
/**
 * test-curriculum-hierarchy.mjs
 * ==============================
 * Regression tests for the curriculum TOPIC-cell hierarchy repair.
 *
 * Guards the "concatenated topic + sub-topic in one cell" bug at three layers:
 *   1. the pure splitConcatenatedTopicCell classifier (unit),
 *   2. numeric code-segment ordering (unit),
 *   3. the real curriculum-data.json → rowsWithPropagatedTopic pipeline that
 *      feeds every studio picker + coverage counter (integration).
 *
 * Plain `node` assertion script (throws on failure) — discovered by
 * scripts/run-all-tests.mjs via the `test:curriculum-hierarchy` npm script.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  splitConcatenatedTopicCell,
  compareCurriculumCodes,
  sortByCurriculumCode,
  mapLegacyTopicValue,
} from '../src/utils/curriculumTopicCell.js'
import { rowsWithPropagatedTopic } from '../src/utils/syllabusMapping.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

let passed = 0
function test(name, fn) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

console.log('\ncurriculum-hierarchy: splitConcatenatedTopicCell')

test('English Comprehension: splits topic + fills empty sub-topic', () => {
  const r = splitConcatenatedTopicCell('1.2.1 COMPREHENSION 1.2.1.1. Listening Comprehension', '')
  assert.equal(r.split, true)
  assert.equal(r.topic, '1.2.1 Comprehension')
  assert.equal(r.subtopic, '1.2.1.1 Listening Comprehension')
})

test('English Letter Writing: splits and title-cases', () => {
  const r = splitConcatenatedTopicCell('1.3.4 LETTER WRITING 1.3.4.1. Informal Letter', '')
  assert.equal(r.topic, '1.3.4 Letter Writing')
  assert.equal(r.subtopic, '1.3.4.1 Informal Letter')
})

test('Agriculture with OCR "2.3.I": fixes topic, keeps existing sub-topic', () => {
  const r = splitConcatenatedTopicCell(
    '2.3 CLIMATE- SMART AGRICULTURE 2.3.I Climate Change Impact on Agriculture and Food Security',
    '2.3.1 Climate Change Impact on Agriculture and Food Security',
  )
  assert.equal(r.split, true)
  assert.equal(r.topic, '2.3 Climate- Smart Agriculture')
  // Sub-topic cell was already populated — must NOT be overwritten.
  assert.equal(r.subtopic, '2.3.1 Climate Change Impact on Agriculture and Food Security')
})

test('SUB-TOPIC cell glued to first competence: splits (same bug one tier down)', () => {
  const r = splitConcatenatedTopicCell(
    '2.1.9.2 Making an Offer 2.1.9.2.1. Use appropriate language to make an offer', '',
  )
  assert.equal(r.split, true)
  assert.equal(r.topic, '2.1.9.2 Making an Offer')
  assert.equal(r.subtopic, '2.1.9.2.1 Use appropriate language to make an offer')
})

test('data-loss guard: child cell holds a DIFFERENT code → not split', () => {
  // Truncating would drop "3.21.1.2 Water orientation" (the competence cell
  // already holds an unrelated "3.13.1.1" code) — refuse to guess.
  const r = splitConcatenatedTopicCell(
    '3.21.1 Pool hygiene 3.21.1.2 Water orientation',
    '3.13.1.1 Demonstrate pool hygiene activities',
  )
  assert.equal(r.split, false)
  assert.equal(r.ambiguous, true)
})

test('same-code child cell → safe to truncate the parent (Agriculture)', () => {
  const r = splitConcatenatedTopicCell(
    '3.4 CROP PRODUCTION 3.4.1 Fruit and Tuber Crop Production',
    '3.4.1 Farm Power',
  )
  assert.equal(r.split, true)
  assert.equal(r.topic, '3.4 Crop Production')
  assert.equal(r.subtopic, '3.4.1 Farm Power') // existing child kept, not overwritten
})

test('Sibling codes (Geography) are NOT split — flagged ambiguous', () => {
  const r = splitConcatenatedTopicCell('1.1 Geography 1.2.The Solar System', '')
  assert.equal(r.split, false)
  assert.equal(r.ambiguous, true)
  assert.equal(r.topic, '1.1 Geography 1.2.The Solar System') // untouched
})

test('Three+ codes are NOT split — flagged ambiguous', () => {
  const r = splitConcatenatedTopicCell('10.6 Weather 10.7 Vegetation 10.8 Hazards', '')
  assert.equal(r.split, false)
  assert.equal(r.ambiguous, true)
})

test('Well-formed single-code topic is a no-op', () => {
  const r = splitConcatenatedTopicCell('1.1.1 Greetings', '1.1.1.1 Formal and Informal Greetings')
  assert.equal(r.split, false)
  assert.equal(r.ambiguous, false)
  assert.equal(r.topic, '1.1.1 Greetings')
  assert.equal(r.subtopic, '1.1.1.1 Formal and Informal Greetings')
})

test('idempotent: splitting an already-split topic is a no-op', () => {
  const once = splitConcatenatedTopicCell('1.2.1 COMPREHENSION 1.2.1.1. Listening Comprehension', '')
  const twice = splitConcatenatedTopicCell(once.topic, once.subtopic)
  assert.equal(twice.split, false)
  assert.equal(twice.topic, once.topic)
  assert.equal(twice.subtopic, once.subtopic)
})

test('empty / code-less topic cells are left alone', () => {
  assert.equal(splitConcatenatedTopicCell('', '').split, false)
  assert.equal(splitConcatenatedTopicCell('Reading Skills', '').split, false)
})

console.log('\ncurriculum-hierarchy: numeric code ordering')

test('compareCurriculumCodes orders 1.2.2 < 1.2.9 < 1.2.10', () => {
  const input = ['1.2.10 Ten', '1.2.2 Two', '1.2.9 Nine']
  const sorted = sortByCurriculumCode(input)
  assert.deepEqual(sorted, ['1.2.2 Two', '1.2.9 Nine', '1.2.10 Ten'])
  assert.ok(compareCurriculumCodes('1.2.2', '1.2.10') < 0)
  assert.ok(compareCurriculumCodes('1.2.10', '1.2.9') > 0)
})

test('code-less labels sort after coded ones, stably', () => {
  const sorted = sortByCurriculumCode(['Zebra', '1.1 Alpha', 'Apple', '1.2 Beta'])
  assert.deepEqual(sorted, ['1.1 Alpha', '1.2 Beta', 'Zebra', 'Apple'])
})

console.log('\ncurriculum-hierarchy: legacy value remap (Phase 7)')

test('mapLegacyTopicValue remaps a stored combined label', () => {
  const r = mapLegacyTopicValue('1.2.1 COMPREHENSION 1.2.1.1. Listening Comprehension')
  assert.equal(r.remapped, true)
  assert.equal(r.topic, '1.2.1 Comprehension')
  assert.equal(r.subtopic, '1.2.1.1 Listening Comprehension')
})

console.log('\ncurriculum-hierarchy: real data → picker pipeline (English Form 1)')

const raw = JSON.parse(readFileSync(join(ROOT, 'public/syllabi/curriculum-data.json'), 'utf8'))
const englishForm1 = raw['English Syllabus (Forms 1-4)']?.['Form 1']
assert.ok(englishForm1, 'English Form 1 sheet must exist')
const rows = rowsWithPropagatedTopic(englishForm1.rows)

// Build the topic → subtopics map exactly as getTopicsForSubject does.
const topicMap = new Map()
for (const row of rows) {
  if (!row.topic) continue
  const t = topicMap.get(row.topic) || { label: row.topic, subtopics: [] }
  if (row.subtopic && !t.subtopics.includes(row.subtopic)) t.subtopics.push(row.subtopic)
  topicMap.set(row.topic, t)
}

test('topic "1.2.1 Comprehension" exists as its own topic', () => {
  assert.ok(topicMap.has('1.2.1 Comprehension'), 'Comprehension topic present')
})

test('Comprehension has separate Listening + Reading sub-topics', () => {
  const subs = topicMap.get('1.2.1 Comprehension').subtopics
  assert.ok(subs.includes('1.2.1.1 Listening Comprehension'), 'Listening Comprehension present')
  assert.ok(subs.includes('1.2.1.2 Reading Comprehension'), 'Reading Comprehension present')
})

test('"1.3.4 Letter Writing" and "1.3.4.1 Informal Letter" are separate records', () => {
  assert.ok(topicMap.has('1.3.4 Letter Writing'), 'Letter Writing is a topic')
  assert.ok(
    topicMap.get('1.3.4 Letter Writing').subtopics.includes('1.3.4.1 Informal Letter'),
    'Informal Letter is a sub-topic of Letter Writing',
  )
})

test('backfilled COMPOSITION topic headers exist with their own sub-topics', () => {
  // Authoritative topic headers restored from the official Form 1 PDF — each
  // orphaned sub-topic now sits under its real topic, not the preceding one.
  const cases = [
    ['1.3.2 Narrative Writing', '1.3.2.1 Story Writing'],
    ['1.3.3 Descriptive Writing', '1.3.3.1 Describing a Person, an Animal or an Object'],
    ['1.3.5 Expository Writing', '1.3.5.1 Writing Expository Essays'],
    ['1.3.6 Persuasive Writing', '1.3.6.1 An Argumentative Composition'],
  ]
  for (const [topicLabel, subLabel] of cases) {
    assert.ok(topicMap.has(topicLabel), `topic "${topicLabel}" present`)
    assert.ok(topicMap.get(topicLabel).subtopics.includes(subLabel), `"${subLabel}" under "${topicLabel}"`)
  }
})

test('no sub-topic is orphaned under a non-ancestor topic (English Form 1)', () => {
  const lead = (s) => (String(s).match(/^(\d+(?:\.\d+)*)/) || [])[1] || ''
  for (const t of topicMap.values()) {
    const tc = lead(t.label)
    for (const s of t.subtopics) {
      const sc = lead(s)
      if (tc && sc) assert.ok(sc.startsWith(tc), `orphan: "${s}" filed under "${t.label}"`)
    }
  }
})

test('no topic label contains a second (child) curriculum code', () => {
  for (const label of topicMap.keys()) {
    const codes = (label.match(/\d+(?:\.\d+)+/g) || [])
    assert.ok(codes.length <= 1, `topic label still concatenated: "${label}"`)
  }
})

test('no sub-topic option represents two hierarchy levels', () => {
  for (const t of topicMap.values()) {
    for (const s of t.subtopics) {
      const codes = (s.match(/\d+(?:\.\d+)+/g) || [])
      assert.ok(codes.length <= 1, `sub-topic still concatenated: "${s}"`)
    }
  }
})

console.log('\ncurriculum-hierarchy: English Form 2 restored hierarchy')

const form2 = raw['English Syllabus (Forms 1-4)']?.['Form 2']
assert.ok(form2, 'English Form 2 sheet must exist')
const rows2 = rowsWithPropagatedTopic(form2.rows)
const topicMap2 = new Map()
for (const row of rows2) {
  if (!row.topic) continue
  const t = topicMap2.get(row.topic) || { label: row.topic, subtopics: [] }
  if (row.subtopic && !t.subtopics.includes(row.subtopic)) t.subtopics.push(row.subtopic)
  topicMap2.set(row.topic, t)
}

test('Form 2 COMPOSITION topic headers (2.3.2-2.3.9) restored with their sub-topics', () => {
  const cases = [
    ['2.3.2 Descriptive Writing', '2.3.2.1 Describing a Place'],
    ['2.3.3 Report Writing', '2.3.3.1 Introduction to Report Writing'],
    ['2.3.4 Speech Writing', '2.3.4.1 Speech of Introduction'],
    ['2.3.5 Biography Writing', '2.3.5.2 Biography'],
    ['2.3.6 Expository Writing', '2.3.6.1 Features of Expository Writing'],
    ['2.3.7 Persuasive Writing', '2.3.7.2 Discursive Composition'],
    ['2.3.8 Diary Writing', '2.3.8.1 Writing Diary Entries'],
    ['2.3.9 Letter Writing', '2.3.9.1 Semi-Formal Letter'],
    ['2.5.1 Summary Writing', '2.5.1.7 Prose Summaries'],
  ]
  for (const [topicLabel, subLabel] of cases) {
    assert.ok(topicMap2.has(topicLabel), `topic "${topicLabel}" present`)
    assert.ok(topicMap2.get(topicLabel).subtopics.includes(subLabel), `"${subLabel}" under "${topicLabel}"`)
  }
})

test('no sub-topic is orphaned under a non-ancestor topic (English Form 2)', () => {
  const lead = (s) => (String(s).match(/^(\d+(?:\.\d+)*)/) || [])[1] || ''
  for (const t of topicMap2.values()) {
    const tc = lead(t.label)
    for (const s of t.subtopics) {
      const sc = lead(s)
      if (tc && sc) assert.ok(sc.startsWith(tc), `orphan: "${s}" filed under "${t.label}"`)
    }
  }
})

test('page-break-truncated sub-topic titles are repaired from source', () => {
  const f1 = new Set()
  for (const t of topicMap.values()) for (const s of t.subtopics) f1.add(s)
  assert.ok(f1.has('1.4.10.1 Different Ways of Expressing Purpose'), '1.4.10.1 full title')
  assert.ok(f1.has('1.5.4.1 Types of Advertisements'), '1.5.4.1 word un-split')
})

console.log('\ncurriculum-hierarchy: English Form 3 restored hierarchy')

const form3 = raw['English Syllabus (Forms 1-4)']?.['Form 3']
assert.ok(form3, 'English Form 3 sheet must exist')
const rows3 = rowsWithPropagatedTopic(form3.rows)
const topicMap3 = new Map()
for (const row of rows3) {
  if (!row.topic) continue
  const t = topicMap3.get(row.topic) || { label: row.topic, subtopics: [] }
  if (row.subtopic && !t.subtopics.includes(row.subtopic)) t.subtopics.push(row.subtopic)
  topicMap3.set(row.topic, t)
}

test('Form 3 COMPOSITION topic headers restored + 3.3.10 title repaired', () => {
  const cases = [
    ['3.3.2 Descriptive Writing', '3.3.2.1 Describing Events'],
    ['3.3.3 Article Writing', '3.3.3.2 Feature Article'],
    ['3.3.4 Report Writing', '3.3.4.1 Detailed or Major Reports'],
    ['3.3.5 Speech Writing', '3.3.5.1 Main Speech (Keynote)'],
    ['3.3.6 Minutes Writing', '3.3.6.1 Introduction to Writing Minutes'],
    ['3.3.11 Letter Writing', '3.3.11.1 Formal Letter'],
  ]
  for (const [topicLabel, subLabel] of cases) {
    assert.ok(topicMap3.has(topicLabel), `topic "${topicLabel}" present`)
    assert.ok(topicMap3.get(topicLabel).subtopics.includes(subLabel), `"${subLabel}" under "${topicLabel}"`)
  }
  // OCR line-break repair: "Argumenta Tive" → "Argumentative"
  assert.ok(topicMap3.has('3.3.10 Argumentative'), '3.3.10 title repaired')
  assert.ok(!topicMap3.has('3.3.10 Argumenta Tive'), 'old broken title gone')
})

test('no sub-topic is orphaned under a non-ancestor topic (English Form 3)', () => {
  const lead = (s) => (String(s).match(/^(\d+(?:\.\d+)*)/) || [])[1] || ''
  for (const t of topicMap3.values()) {
    const tc = lead(t.label)
    for (const s of t.subtopics) {
      const sc = lead(s)
      if (tc && sc) assert.ok(sc.startsWith(tc), `orphan: "${s}" filed under "${t.label}"`)
    }
  }
})

console.log('\ncurriculum-hierarchy: English Form 4 restored hierarchy')

const form4 = raw['English Syllabus (Forms 1-4)']?.['Form 4']
assert.ok(form4, 'English Form 4 sheet must exist')
const rows4 = rowsWithPropagatedTopic(form4.rows)
const topicMap4 = new Map()
for (const row of rows4) {
  if (!row.topic) continue
  const t = topicMap4.get(row.topic) || { label: row.topic, subtopics: [] }
  if (row.subtopic && !t.subtopics.includes(row.subtopic)) t.subtopics.push(row.subtopic)
  topicMap4.set(row.topic, t)
}

test('Form 4 COMPOSITION topic headers restored with their sub-topics', () => {
  const cases = [
    ['4.3.2 Descriptive Writing', '4.3.2.1 Describing Careers/Professions'],
    ['4.3.4 Report Writing', '4.3.4.1 Detailed (Major) Reports'],
    ['4.3.5 Speech Writing', '4.3.5.1 Vote of thanks'],
    ['4.3.6 Persuasive Writing', '4.3.6.1 Discursive Composition'],
    ['4.3.7 Expository Writing', '4.3.7.1 Compare and Contrast'],
    ['4.3.8 Letter Writing', '4.3.8.2 Memorandum'],
  ]
  for (const [topicLabel, subLabel] of cases) {
    assert.ok(topicMap4.has(topicLabel), `topic "${topicLabel}" present`)
    assert.ok(topicMap4.get(topicLabel).subtopics.includes(subLabel), `"${subLabel}" under "${topicLabel}"`)
  }
})

test('no sub-topic is orphaned under a non-ancestor topic (English Form 4)', () => {
  const lead = (s) => (String(s).match(/^(\d+(?:\.\d+)*)/) || [])[1] || ''
  for (const t of topicMap4.values()) {
    const tc = lead(t.label)
    for (const s of t.subtopics) {
      const sc = lead(s)
      if (tc && sc) assert.ok(sc.startsWith(tc), `orphan: "${s}" filed under "${t.label}"`)
    }
  }
})

console.log('\ncurriculum-hierarchy: Lower Primary Grade 3 Creative & Technology (normalised codes)')

const g3ct = raw['Lower Primary Syllabi (Grades 1-3)']?.['Grade 3 - Creative & Technology']
assert.ok(g3ct, 'Grade 3 Creative & Technology sheet must exist')
const rowsG3 = rowsWithPropagatedTopic(g3ct.rows)
const topicMapG3 = new Map()
for (const row of rowsG3) {
  if (!row.topic) continue
  const t = topicMapG3.get(row.topic) || { label: row.topic, subtopics: [] }
  if (row.subtopic && !t.subtopics.includes(row.subtopic)) t.subtopics.push(row.subtopic)
  topicMapG3.set(row.topic, t)
}

test('child codes normalised to their parent topic (source off-by-one corrected)', () => {
  // CRAFTS is 3.15 → its sub-topics must be 3.15.x, not the source's 3.16.x.
  const crafts = topicMapG3.get('3.15. CRAFTS')
  assert.ok(crafts, 'CRAFTS topic present')
  assert.ok(crafts.subtopics.includes('3.15.1 Plaiting'), 'Plaiting renumbered to 3.15.1')
  assert.ok(crafts.subtopics.includes('3.15.6 Types of Structures'), '3.15.6 present')
  assert.ok(!crafts.subtopics.some((s) => s.startsWith('3.16')), 'no stray 3.16.x under CRAFTS')
})

test('split "Tumbling and Stunts" sub-topic title is merged', () => {
  const all = [...topicMapG3.values()].flatMap((t) => t.subtopics)
  assert.ok(all.includes('3.12.3 Educational gymnastics (Tumbling and Stunts)'), 'merged title present')
  assert.ok(!all.includes('and Stunts)'), 'orphan title fragment gone')
})

test('no sub-topic is orphaned in Grade 3 Creative & Technology', () => {
  const lead = (s) => (String(s).match(/^(\d+(?:\.\d+)*)/) || [])[1] || ''
  for (const t of topicMapG3.values()) {
    const tc = lead(t.label)
    for (const s of t.subtopics) {
      const sc = lead(s)
      if (tc && sc) assert.ok(sc.startsWith(tc), `orphan: "${s}" under "${t.label}"`)
    }
  }
})

console.log('\ncurriculum-hierarchy: garbled recap-row removal + guard')

test('no garbled "Sub-Topic"-header topic survives in any picker', () => {
  for (const [subject, sheets] of Object.entries(raw)) {
    for (const [sheetName, sheet] of Object.entries(sheets || {})) {
      for (const r of rowsWithPropagatedTopic(sheet.rows || [])) {
        assert.ok(!/sub\s*-?\s*topic/i.test(String(r.topic || '')),
          `garbled topic survived in ${subject}/${sheetName}: "${r.topic}"`)
      }
    }
  }
})

test('Food & Nutrition Form 4 shows only its four real topics', () => {
  const fn = raw['Food & Nutrition Syllabus (Forms 1-4)']?.['Form 4']
  assert.ok(fn, 'Food & Nutrition Form 4 sheet exists')
  const topics = new Set()
  for (const r of rowsWithPropagatedTopic(fn.rows)) if (r.topic) topics.add(r.topic)
  assert.deepEqual([...topics].sort(), [
    '4.1 RESEARCH IN FOOD AND NUTRITION',
    '4.2 FOOD SERVICE',
    '4.3 CONSUMER EDUCATION',
    '4.4 ENTREPRENEURSHIP',
  ].sort())
})

test('the runtime guard drops a garbled recap row (re-import protection)', () => {
  const out = rowsWithPropagatedTopic([
    { type: 'data', cells: { TOPIC: 'For Sub -Topic -junk content' } },
    { type: 'data', cells: { TOPIC: '4.1 Real', 'SUB-TOPIC': '4.1.1 Sub' } },
  ])
  assert.deepEqual(out.map((r) => r.topic), ['4.1 Real'])
})

console.log('\ncurriculum-hierarchy: History (Forms 1-4) source-verified repairs')

test('History Form 1 TOPIC 1.5 has no "SPEAD" phantom and a single sub-topic', () => {
  const f1 = raw['History Syllabus (Forms 1-4)']?.['Form 1']
  assert.ok(f1, 'History Form 1 sheet exists')
  const rows = rowsWithPropagatedTopic(f1.rows)
  // The OCR-typo duplicate topic must be gone.
  assert.ok(!rows.some((r) => /SPEAD/.test(String(r.topic || ''))), 'SPEAD phantom survived')
  // TOPIC 1.5 must expose exactly its one real sub-topic (1.5.1).
  const subs = rows
    .filter((r) => /^1\.5\s+THE BEGINNING AND SPREAD OF IRON-WORKING/i.test(String(r.topic || '')))
    .map((r) => String(r.subtopic || ''))
    .filter(Boolean)
  assert.equal(subs.length, 1, `expected one 1.5 sub-topic, got ${subs.length}`)
  assert.match(subs[0], /^1\.5\.1\s+Development of Iron-Technology and Farming/)
  // The recovered continuation bullets are present, "Kalomo" un-broken.
  const act = String(rows.find((r) => /^1\.5\.1/.test(String(r.subtopic || '')))?.learningActivities || '')
  assert.ok(act.includes('global trade environment'), 'continuation bullet lost')
  assert.ok(act.includes('Kalomo') && !act.includes('Kalo mo'), 'Kalomo still broken')
})

test('History Form 3 TOPIC 3.1 title un-broken ("ZAMBIA" not "ZAM BIA")', () => {
  const f3 = raw['History Syllabus (Forms 1-4)']?.['Form 3']
  const topics = new Set(rowsWithPropagatedTopic(f3.rows).map((r) => r.topic).filter(Boolean))
  assert.ok(topics.has('3.1 COPPER MINING IN ZAMBIA'), '3.1 topic title not normalised')
  assert.ok(![...topics].some((t) => /ZAM BIA/.test(t)), 'ZAM BIA break survived')
})

test('no competence-appendix row leaks into any picker (History + Geography F3)', () => {
  // The generic S/N | COMPETENCE appendix (Critical Thinking, Digital…) must
  // never appear as a sub-topic. Signature: a bare serial in SUB-TOPIC.
  for (const [subject, sheets] of Object.entries(raw)) {
    for (const [sheetName, sheet] of Object.entries(sheets || {})) {
      for (const r of rowsWithPropagatedTopic(sheet.rows || [])) {
        const sub = String(r.subtopic || '').trim()
        assert.ok(!/^(S\/N|\d{1,2})$/.test(sub),
          `competence-appendix row survived in ${subject}/${sheetName}: SUB=${JSON.stringify(sub)}`)
      }
    }
  }
})

console.log('\ncurriculum-hierarchy: Geography Form 1 glued-header split')

test('Geography Form 1 exposes 1.1 Geography and 1.2 The Solar System as separate topics', () => {
  const g1 = raw['Geography Syllabus (Forms 1-4)']?.['Form 1']
  assert.ok(g1, 'Geography Form 1 sheet exists')
  const rows = rowsWithPropagatedTopic(g1.rows)
  const topics = new Set(rows.map((r) => r.topic).filter(Boolean))
  // The two-topics-in-one-cell fusion must be gone; both real topics present.
  assert.ok(![...topics].some((t) => /Geography.*Solar System/i.test(t)), 'glued topic survived')
  assert.ok(topics.has('1.1 Geography'), '1.1 Geography topic missing')
  assert.ok(topics.has('1.2 The Solar System'), '1.2 The Solar System topic missing')
  // 1.1.1 sits under 1.1, 1.2.1 under 1.2, and the Solar-System bullets moved with it.
  const geo = rows.find((r) => /^1\.1\.1/.test(String(r.subtopic || '')))
  const solar = rows.find((r) => /^1\.2\.1/.test(String(r.subtopic || '')))
  assert.equal(geo?.topic, '1.1 Geography')
  assert.equal(solar?.topic, '1.2 The Solar System')
  assert.ok(/branches of Geography/i.test(String(geo?.learningActivities || '')), '1.1.1 activities lost')
  assert.ok(/elements found in the solar system/i.test(String(solar?.learningActivities || '')), '1.2.1 activities lost')
  // No code-mismatch orphan under the Solar-System topic (1.2.2–1.2.5 attach cleanly).
  const lead = (s) => (String(s || '').match(/^\s*(\d+(?:\.\d+)*)/) || [])[1] || null
  for (const r of rows) {
    const tc = lead(r.topic); const sc = lead(r.subtopic)
    if (tc && sc) assert.ok(sc.startsWith(tc), `Geography F1 orphan: "${r.subtopic}" under "${r.topic}"`)
  }
})

console.log('\ncurriculum-hierarchy: Hospitality Management code normalisation')

test('Hospitality Forms 1-4 have no code-mismatch orphan in any picker', () => {
  const hm = raw['Hospitality Management Syllabus (Forms 1-4)']
  assert.ok(hm, 'Hospitality sheet exists')
  const lead = (s) => (String(s || '').match(/^\s*(\d+(?:\.\d+)*)/) || [])[1] || null
  for (const form of ['Form 1', 'Form 2', 'Form 3', 'Form 4']) {
    const rows = rowsWithPropagatedTopic(hm[form].rows)
    for (const r of rows) {
      const tc = lead(r.topic); const sc = lead(r.subtopic)
      if (tc && sc) assert.ok(sc.startsWith(tc), `Hospitality ${form} orphan: "${r.subtopic}" under "${r.topic}"`)
    }
    // No duplicate sub-topic code within a form.
    const codes = rows.map((r) => lead(r.subtopic)).filter(Boolean)
    assert.equal(codes.length, new Set(codes).size, `Hospitality ${form} has a duplicate sub-topic code`)
  }
})

test('Hospitality key renumberings landed (Gastronomy 4.3, Entrepreneurship codes)', () => {
  const hm = raw['Hospitality Management Syllabus (Forms 1-4)']
  const topics = (form) => new Set(rowsWithPropagatedTopic(hm[form].rows).map((r) => r.topic).filter(Boolean))
  // Form 4: the second "4.1" topic became 4.3 GASTRONOMY (no duplicate 4.1).
  const f4 = topics('Form 4')
  assert.ok([...f4].some((t) => /^4\.3\.?\s+GASTRONOMY/i.test(t)), '4.3 GASTRONOMY missing')
  assert.ok([...f4].filter((t) => /^4\.1\b/.test(t)).length === 1, 'duplicate 4.1 topic remains')
  // Form 3: Entrepreneurship moved off the 3.2 collision to 3.8.
  assert.ok([...topics('Form 3')].some((t) => /^3\.8\.?\s+ENTREPRENEURSHIP/i.test(t)), '3.8 ENTREPRENEURSHIP missing')
  // Form 1: Ethics sits under 1.6 with a matching 1.6.1 code.
  const f1 = rowsWithPropagatedTopic(hm['Form 1'].rows)
  const ethics = f1.find((r) => /Ethics/.test(String(r.subtopic || '')))
  assert.match(String(ethics?.subtopic || ''), /^1\.6\.1/)
  assert.match(String(ethics?.topic || ''), /^1\.6\b/)
})

console.log(`\n✅ curriculum-hierarchy: all ${passed} checks passed\n`)
