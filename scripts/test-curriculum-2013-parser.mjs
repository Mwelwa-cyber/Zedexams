/**
 * Unit tests for the canonical 2013 curriculum parser
 * (src/utils/curriculum2013Parser.js).
 *
 * Covers the 12 acceptance test cases from the 2013-curriculum-structure fix
 * plus the code classifier and the validator. Plain-node — run with:
 *   node scripts/test-curriculum-2013-parser.mjs
 * Wired into `npm run test:all` via the `test:curriculum-2013` script.
 */

import assert from 'node:assert/strict'
import {
  classifyCode, codeDepth, parentCode, parseCodedStatement, cleanStatement,
  splitSpecificOutcomes, splitPoints, resolveColumnRoles, isHeaderEchoRow,
  repairColumnShiftedRow, parseSheet, validateRecord,
} from '../src/utils/curriculum2013Parser.js'

let passed = 0
const check = (name, fn) => {
  try { fn(); passed++; console.log(`  ✓ ${name}`) } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`)
    process.exitCode = 1
  }
}

// Build a minimal sheet from rows of cell-objects.
const sheet = (columns, rowCells) => ({
  columns,
  rows: rowCells.map((cells) => ({ type: 'data', cells })),
})
const IS_COLS = ['TOPIC', 'SUBTOPIC', 'SPECIFIC OUTCOMES', 'CONTENT', 'SKILLS', 'VALUES']
const outcomeCodes = (recs) => recs.map((r) => r.specificOutcome.code)

console.log('\ncode classification')
check('topic codes (primary .0 and secondary 2-seg)', () => {
  assert.equal(classifyCode('1.3.0'), 'topic')
  assert.equal(classifyCode('5.2.0'), 'topic')
  assert.equal(classifyCode('10.1'), 'topic')
})
check('subtopic codes (3-seg not .0)', () => {
  assert.equal(classifyCode('1.3.1'), 'subtopic')
  assert.equal(classifyCode('5.2.3'), 'subtopic')
  assert.equal(classifyCode('10.1.1'), 'subtopic')
})
check('outcome codes (4+ seg)', () => {
  assert.equal(classifyCode('1.3.1.1'), 'outcome')
  assert.equal(classifyCode('1.3.1.2'), 'outcome')
  assert.equal(classifyCode('5.2.3.3'), 'outcome')
})
check('parentCode walks the hierarchy', () => {
  assert.equal(parentCode('1.3.1.2'), '1.3.1')
  assert.equal(parentCode('5.2.3.2'), '5.2.3')
  assert.equal(parentCode('1.3.1'), '1.3.0')
  assert.equal(codeDepth('1.3.1.2'), 4)
})

console.log('\nTest 1: Malaria — joined outcomes, no punctuation between')
check('splits into three coded outcomes', () => {
  const input = '5.2.3.1 Identify causes of malaria 5.2.3.2 State the symptoms of malaria 5.2.3.3 Describe ways of preventing and treating malaria'
  const out = splitSpecificOutcomes(input)
  assert.deepEqual(out, [
    { code: '5.2.3.1', statement: 'Identify causes of malaria' },
    { code: '5.2.3.2', statement: 'State the symptoms of malaria' },
    { code: '5.2.3.3', statement: 'Describe ways of preventing and treating malaria' },
  ])
})

console.log('\nTest 2: Personal Hygiene — four outcomes')
check('four separate outcomes', () => {
  const input = '4.2.1.1 Describe the care for eyes 4.2.1.2 Describe the care for ears 4.2.1.3 Describe the care of the feet 4.2.1.4 Describe the care for the skin'
  assert.deepEqual(outcomeCodes(splitSpecificOutcomes(input).map((o) => ({ specificOutcome: o }))),
    ['4.2.1.1', '4.2.1.2', '4.2.1.3', '4.2.1.4'])
})

console.log('\nTest 3: Water in the body — three outcomes')
check('three separate outcomes', () => {
  const input = '4.2.2.1 Explain the importance of water in the body 4.2.2.2 Explain the effects of dehydration 4.2.2.3 Explain how to prevent and treat dehydration'
  assert.equal(splitSpecificOutcomes(input).length, 3)
})

console.log('\nTest 4: Plant Growth — three outcomes')
check('three separate outcomes', () => {
  const input = '4.4.2.1 Identify conditions necessary for seed germination 4.4.2.2 Investigate factors necessary for plant growth 4.4.2.3 Grow maize seeds to maturity'
  assert.deepEqual(outcomeCodes(splitSpecificOutcomes(input).map((o) => ({ specificOutcome: o }))),
    ['4.4.2.1', '4.4.2.2', '4.4.2.3'])
})

console.log('\nTest 5: Environment hierarchy — full sheet parse')
check('one topic, one subtopic, three independent outcomes', () => {
  const s = sheet(IS_COLS, [
    {
      TOPIC: '1.3.0 The Environment',
      SUBTOPIC: '1.3.1 The Environment',
      'SPECIFIC OUTCOMES': '1.3.1.1 Identify the main features of the local environment. 1.3.1.2 Distinguish between urban and rural environment. 1.3.1.3 Explain the importance of the environment to living things.',
      CONTENT: '• Plants • Rocks • Animals • Streams • Buildings • Houses • Roads • Heating and lighting • Water supply',
      SKILLS: '• Observing the main features of the local environment',
      VALUES: '',
    },
  ])
  const { records } = parseSheet(s, { sheetName: 'Grade 1', gradeName: 'Grade 1', subjectName: 'Integrated Science' })
  assert.equal(records.length, 3, 'three outcome records')
  for (const rec of records) {
    assert.equal(rec.topic.code, '1.3.0')
    assert.equal(rec.topic.title, 'The Environment')
    assert.equal(rec.subtopic.code, '1.3.1')
    assert.equal(rec.subtopic.title, 'The Environment')
  }
  assert.deepEqual(outcomeCodes(records), ['1.3.1.1', '1.3.1.2', '1.3.1.3'])
  // Content stays a structured list in the Content field, not new subtopics.
  assert.ok(records[0].content.includes('Streams'))
  assert.ok(records[0].content.includes('Water supply'))
  assert.equal(records[0].content.length, 9)
  // No record is flagged and none looks like a heading.
  assert.ok(records.every((r) => !r.needsReview), 'no false positives on review')
})

console.log('\nTest 6: Misaligned content is NOT turned into subtopics')
check('bare content points never become their own subtopic records', () => {
  const s = sheet(IS_COLS, [
    { TOPIC: '1.3.0 The Environment', SUBTOPIC: '1.3.1 The Environment', 'SPECIFIC OUTCOMES': '1.3.1.1 Identify the main features of the local environment.', CONTENT: '• Streams • Buildings • Houses • Roads • Heating and lighting • Water supply', SKILLS: '', VALUES: '' },
  ])
  const { records } = parseSheet(s, { sheetName: 'Grade 1' })
  assert.equal(records.length, 1)
  assert.deepEqual(records[0].content, ['Streams', 'Buildings', 'Houses', 'Roads', 'Heating and lighting', 'Water supply'])
  assert.equal(records[0].subtopic.code, '1.3.1')
})

console.log('\nTest 7: Shared merged sub-topic cell inherits down')
check('blank subtopic on continuation rows inherits 1.3.1', () => {
  const s = sheet(IS_COLS, [
    { TOPIC: '1.3.0 The Environment', SUBTOPIC: '1.3.1 The Environment', 'SPECIFIC OUTCOMES': '1.3.1.1 Identify the main features of the local environment.', CONTENT: '', SKILLS: '', VALUES: '' },
    { TOPIC: '', SUBTOPIC: '', 'SPECIFIC OUTCOMES': '1.3.1.2 Distinguish between urban and rural environment.', CONTENT: '', SKILLS: '', VALUES: '' },
    { TOPIC: '', SUBTOPIC: '', 'SPECIFIC OUTCOMES': '1.3.1.3 Explain the importance of the environment to living things.', CONTENT: '', SKILLS: '', VALUES: '' },
  ])
  const { records } = parseSheet(s, { sheetName: 'Grade 1' })
  assert.equal(records.length, 3)
  assert.ok(records.every((r) => r.subtopic.code === '1.3.1' && r.topic.code === '1.3.0'))
  assert.deepEqual(outcomeCodes(records), ['1.3.1.1', '1.3.1.2', '1.3.1.3'])
})

console.log('\nTest 8: Table headings are not stored as records')
check('a KNOWLEDGE/SKILLS/VALUES echo row is dropped', () => {
  assert.equal(isHeaderEchoRow({ CONTENT: 'KNOWLEDGE', SKILLS: 'SKILLS', VALUES: 'VALUES' }), true)
  const s = sheet(IS_COLS, [
    { TOPIC: '', SUBTOPIC: '', 'SPECIFIC OUTCOMES': '', CONTENT: 'KNOWLEDGE', SKILLS: 'SKILLS', VALUES: 'VALUES' },
    { TOPIC: '1.1.0 The human body', SUBTOPIC: '1.1.1 External parts', 'SPECIFIC OUTCOMES': '1.1.1.1 Identify the external parts of the human body.', CONTENT: '', SKILLS: '', VALUES: '' },
  ])
  const { records, stats } = parseSheet(s, { sheetName: 'Grade 1' })
  assert.equal(stats.headerRowsRemoved, 1)
  assert.equal(records.length, 1)
  assert.equal(records[0].specificOutcome.code, '1.1.1.1')
})

console.log('\nTest 9: OCR spacing — code glued to first word')
check('1.3.1.1Identify → code + spaced statement', () => {
  const out = splitSpecificOutcomes('1.3.1.1Identify the main features of the local environment.')
  assert.deepEqual(out, [{ code: '1.3.1.1', statement: 'Identify the main features of the local environment.' }])
  const one = parseCodedStatement('1.3.1.1Identify the main features')
  assert.equal(one.code, '1.3.1.1')
  assert.equal(one.statement, 'Identify the main features')
})

console.log('\nTest 10: Joined outcomes without punctuation')
check('two outcomes split on the code boundary alone', () => {
  const out = splitSpecificOutcomes('1.3.1.2 Distinguish between urban and rural environment 1.3.1.3 Explain the importance of the environment')
  assert.equal(out.length, 2)
  assert.equal(out[0].code, '1.3.1.2')
  assert.equal(out[1].code, '1.3.1.3')
})

console.log('\nTest 11: Repeated import is idempotent')
check('deterministic ids, stable across two parses', () => {
  const s = sheet(IS_COLS, [
    { TOPIC: '5.2.0 Health', SUBTOPIC: '5.2.3 Malaria', 'SPECIFIC OUTCOMES': '5.2.3.1 Identify causes of malaria 5.2.3.2 State the symptoms of malaria 5.2.3.3 Describe ways of preventing and treating malaria', CONTENT: '', SKILLS: '', VALUES: '' },
  ])
  const ctx = { sheetName: 'Grade 5', gradeId: 'grade-5', subjectId: 'integrated-science' }
  const a = parseSheet(s, ctx).records
  const b = parseSheet(s, ctx).records
  assert.deepEqual(a.map((r) => r.id), b.map((r) => r.id))
  assert.deepEqual(a.map((r) => r.id), [
    '2013-grade-5-integrated-science-5-2-3-1',
    '2013-grade-5-integrated-science-5-2-3-2',
    '2013-grade-5-integrated-science-5-2-3-3',
  ])
})

console.log('\ncolumn-shifted rows (the "1.3.1.2 rendered as a topic heading" bug)')
check('detects + re-maps a two-column-left-shifted continuation row', () => {
  // Real Grade 1 Integrated Science row 9: outcomes in TOPIC, content in
  // SUBTOPIC, skills in SPECIFIC OUTCOMES, values in CONTENT.
  const roles = resolveColumnRoles(IS_COLS)
  const { cells, shifted } = repairColumnShiftedRow({
    TOPIC: '1.3.1.2 Distinguish between urban and rural environment. 1.3.1.3 Explain the importance of the environment to living things.',
    SUBTOPIC: 'Streams, buildings) • Refer to Houses, roads, heating and lighting, water supply',
    'SPECIFIC OUTCOMES': 'urban and rural environment • Communicating the importance of the environment.',
    CONTENT: 'group work',
    SKILLS: '', VALUES: '',
  }, IS_COLS, roles)
  assert.equal(shifted, true)
  assert.equal(cells.TOPIC, '')
  assert.equal(cells.SUBTOPIC, '')
  assert.ok(cells['SPECIFIC OUTCOMES'].startsWith('1.3.1.2'))
  assert.ok(cells.CONTENT.includes('Streams'))
})
check('a legitimate topic row is never treated as shifted', () => {
  const roles = resolveColumnRoles(IS_COLS)
  const { shifted } = repairColumnShiftedRow({
    TOPIC: '1.3.0 The Environment', SUBTOPIC: '1.3.1 The Environment',
    'SPECIFIC OUTCOMES': '1.3.1.1 Identify the main features.', CONTENT: '', SKILLS: '', VALUES: '',
  }, IS_COLS, roles)
  assert.equal(shifted, false)
})
check('full-sheet parse: shifted outcomes join their subtopic, never a heading (Problem B)', () => {
  const s = sheet(IS_COLS, [
    {
      TOPIC: '1.3.0 The Environment', SUBTOPIC: '1.3.1 The Environment',
      'SPECIFIC OUTCOMES': '1.3.1.1 Identify the main features of the local environment.',
      CONTENT: '• Features of the local environment(Plants, Rocks, animals', SKILLS: '', VALUES: '',
    },
    {
      TOPIC: '1.3.1.2 Distinguish between urban and rural environment. 1.3.1.3 Explain the importance of the environment to living things.',
      SUBTOPIC: 'Streams, buildings) • Refer to Houses, roads',
      'SPECIFIC OUTCOMES': 'urban and rural environment • Communicating the importance.',
      CONTENT: 'group work', SKILLS: '', VALUES: '',
    },
  ])
  const { records, stats } = parseSheet(s, { sheetName: 'Grade 1' })
  assert.equal(stats.columnShiftsRepaired, 1)
  const codes = records.map((r) => r.specificOutcome.code).filter(Boolean)
  assert.deepEqual(codes, ['1.3.1.1', '1.3.1.2', '1.3.1.3'])
  // Every outcome sits under the inherited 1.3.0 / 1.3.1 hierarchy — no record
  // has an outcome code as its topic or subtopic.
  for (const rec of records) {
    assert.equal(rec.topic.code, '1.3.0')
    assert.equal(rec.subtopic.code, '1.3.1')
  }
  // The repaired rows are flagged for review rather than silently trusted.
  const shiftedRecs = records.filter((r) => r.reviewReasons.some((x) => /column-shifted/.test(x)))
  assert.ok(shiftedRecs.length >= 2)
})

console.log('\nvalidators')
check('flags a statement carrying a second outcome code', () => {
  const problems = validateRecord({
    topic: { code: '1.3.0' }, subtopic: { code: '1.3.1' },
    specificOutcome: { code: '1.3.1.2', statement: 'Distinguish between urban and rural 1.3.1.3 Explain the importance' },
  })
  assert.ok(problems.some((p) => /another outcome code/.test(p)))
})
check('flags an outcome whose code does not match its subtopic parent', () => {
  const problems = validateRecord({
    topic: { code: '1.3.0' }, subtopic: { code: '1.3.1' },
    specificOutcome: { code: '1.4.1.1', statement: 'Something' },
  })
  assert.ok(problems.some((p) => /does not match subtopic parent/.test(p)))
})
check('flags a table-heading word saved as a subtopic', () => {
  const problems = validateRecord({
    topic: { code: '1.3.0', title: 'X' }, subtopic: { code: null, title: 'KNOWLEDGE' },
    specificOutcome: { code: null, statement: '' },
  })
  assert.ok(problems.some((p) => /table-heading word/.test(p)))
})
check('clean record has no problems', () => {
  assert.deepEqual(validateRecord({
    topic: { code: '1.3.0', title: 'The Environment' },
    subtopic: { code: '1.3.1', title: 'The Environment' },
    specificOutcome: { code: '1.3.1.2', statement: 'Distinguish between urban and rural environment.' },
  }), [])
})

console.log('\ncolumn-role resolution across the 28 header spellings')
check('resolves OCR + spacing + leading-column variants', () => {
  assert.equal(resolveColumnRoles(['TOPIC', 'SUB-TOPIC', 'SPECIFIC OUTCOMES', 'CONTENT', 'Skills', 'Values']).subtopic, 'SUB-TOPIC')
  assert.equal(resolveColumnRoles(['TOPIC', 'SUBTOPIC', 'SPECIFIC OUTCOMES', 'CONTENT']).content[0], 'CONTENT')
  assert.equal(resolveColumnRoles(['THEME', 'TOPIC', 'SPECIFIC OUTCOMES', 'KNOWLEDGE', 'SKILLS', 'VALUES']).content[0], 'KNOWLEDGE')
  // OCR "SPECIFIC OUTC OME" still maps to the outcomes role.
  assert.equal(resolveColumnRoles(['THEME', 'TOPIC', 'SUB-TOPIC', 'SPECIFIC OUTC OME', 'CONTENT', 'SKILLS', 'VALUE']).outcomes, 'SPECIFIC OUTC OME')
  // THEME with no TOPIC column promotes THEME to topic and SUB TOPIC to subtopic.
  const r = resolveColumnRoles(['THEME', 'SUB TOPIC', 'SPECIFIC OUTCOMES', 'KNOWLEDGE', 'SKILLS', 'VALUES'])
  assert.equal(r.topic, 'THEME')
  assert.equal(r.subtopic, 'SUB TOPIC')
})
check('does not split normal decimals as codes (Rule 5)', () => {
  const out = splitSpecificOutcomes('4.2.1.1 Measure 2.5 litres of water and record 3.2 kg')
  assert.equal(out.length, 1)
  assert.equal(out[0].code, '4.2.1.1')
})
check('splitPoints keeps commas inside a point, splits only on bullets', () => {
  assert.deepEqual(splitPoints('• Head, neck, arm • Elbow, hand'), ['Head, neck, arm', 'Elbow, hand'])
})

console.log(`\n${passed} checks passed`)
if (process.exitCode) { console.error('\nSOME TESTS FAILED'); } else { console.log('ALL TESTS PASSED') }
