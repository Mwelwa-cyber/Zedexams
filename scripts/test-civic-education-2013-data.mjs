/**
 * Guards the 2013 Civic Education (Grades 10-12) syllabus data.
 *
 * The sheets were once a lossy PDF extraction: the SUB-TOPIC level was gone, 3-
 * and 4-segment outcome codes were mangled, and page-break overflow rows showed
 * up as fake topics — so a teacher picking "Gender Equity and Equality" got an
 * empty Sub-topic dropdown. They were re-extracted cell-by-cell from the source
 * PDF (CDC "Civic Education Syllabus Grade 10-12"). This pins the structure
 * that extraction established so a re-import cannot quietly regress it.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SUBJECT = 'Civic Education Syllabus (Grades 10-12, 2013)'
const FILES = ['public/syllabi/curriculum-data-2013.json', 'functions/data/curriculum-data-2013.json']

// Official topics per the syllabus table of contents, with their sub-topic and
// outcome counts as printed in the PDF.
const EXPECTED = {
  'Grade 10': {
    '10.1': ['CONSTITUTION', [5]],
    '10.2': ['GOVERNANCE SYSTEM IN ZAMBIA', [4, 2]],
    '10.3': ['CITIZENSHIP', [7]],
    '10.4': ['INTRODUCTION TO HUMAN RIGHTS', [5]],
    '10.5': ['CORRUPTION', [6]],
    '10.6': ['CULTURAL STUDIES', [10]],
    '10.7': ['SUBSTANCE ABUSE', [5]],
  },
  'Grade 11': {
    '11.1': ['THE ZAMBIAN BILL OF RIGHTS', [4]],
    '11.2': ['CIVIL SOCIETY AND MEDIA IN GOVERNANCE', [5, 4]],
    '11.3': ['ECONOMIC AND SOCIAL DEVELOPMENT', [8]],
    '11.4': ['ZAMBIA’S LEGAL SYSTEM', [5, 4]],
    '11.5': ['GENDER EQUITY AND EQUALITY', [8]],
    '11.6': ['CULTURE OF PEACE', [7]],
    '11.7': ['CHILD ABUSE', [3, 2, 4]],
  },
  'Grade 12': {
    '12.1': ['INTERNATIONAL HUMAN RIGHTS INSTRUMENTS', [5]],
    '12.2': ['RIGHTS OF A CHILD', [3]],
    '12.3': ['FAMILY LAW', [4]],
    '12.4': ['DEVELOPMENT PLANNING', [6, 1]],
    '12.5': ['POVERTY REDUCTION IN ZAMBIA', [5]],
    '12.6': ['GLOBAL ISSUES', [8]],
  },
}

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
assert.equal(read(FILES[0]), read(FILES[1]), 'functions/ copy must be byte-identical (npm run sync:syllabus-data)')

const sheets = JSON.parse(read(FILES[0]))[SUBJECT]
let topicCount = 0
let subCount = 0
let outcomeCount = 0
assert.ok(sheets, 'Civic Education subject present')
assert.deepEqual(Object.keys(sheets), Object.keys(EXPECTED), 'grades present')

for (const [grade, expected] of Object.entries(EXPECTED)) {
  const sheet = sheets[grade]
  assert.deepEqual(sheet.columns, ['TOPIC', 'SUB-TOPIC', 'SPECIFIC OUTCOMES', 'CONTENT', 'Skills', 'Values'], `${grade}: columns`)

  // Walk the sheet the way the picker does: topic/sub-topic cells are written on
  // the first row of their group only, and carry forward.
  const topics = new Map()
  let topic = null
  let sub = null
  for (const { cells } of sheet.rows) {
    const t = cells.TOPIC.trim()
    const s = cells['SUB-TOPIC'].trim()
    const outcome = cells['SPECIFIC OUTCOMES'].trim()
    if (t) { topic = { label: t, subs: new Map() }; topics.set(t.split(' ')[0], topic); sub = null }
    if (s) { sub = []; topic.subs.set(s, sub) }
    assert.ok(topic && sub, `${grade}: row "${outcome.slice(0, 30)}" has no topic/sub-topic above it`)
    assert.match(outcome, /^\d+\.\d+\.\d+\.\d+\s+\S/, `${grade}: outcome "${outcome.slice(0, 40)}" is not "N.N.N.N text"`)
    assert.ok(outcome.startsWith(`${[...topics.keys()].pop()}.`), `${grade}: outcome ${outcome.slice(0, 12)} is not under topic ${[...topics.keys()].pop()}`)
    sub.push(outcome)

    for (const [col, value] of Object.entries(cells)) {
      assert.ok(!/KNOWLEDGE|/.test(value) && !/^(SKILLS|VALUES)\b/.test(value),
        `${grade}: header/glyph residue in ${col}: "${value.slice(0, 40)}"`)
      assert.ok(!/ {2}/.test(value), `${grade}: doubled space in ${col}`)
    }
  }

  assert.deepEqual([...topics.keys()], Object.keys(expected), `${grade}: topic codes`)
  for (const [code, [title, counts]] of Object.entries(expected)) {
    const got = topics.get(code)
    assert.equal(got.label, `${code} ${title}`, `${grade}: ${code} title`)
    assert.deepEqual([...got.subs.values()].map((o) => o.length), counts, `${grade}: ${code} outcome counts per sub-topic`)
    assert.ok(got.subs.size >= 1, `${grade}: ${code} has a sub-topic`)
    topicCount += 1
    subCount += got.subs.size
    outcomeCount += [...got.subs.values()].reduce((n, o) => n + o.length, 0)
  }
}

// The reported case: a teacher picks "Gender Equity and Equality" and must get a
// sub-topic to continue with.
const gender = sheets['Grade 11'].rows.find((r) => r.cells.TOPIC.startsWith('11.5 '))
assert.equal(gender.cells['SUB-TOPIC'], '11.5.1 GENDER EQUITY AND EQUALITY')

// 10.2.2 once landed on the previous row because its sub-topic cell is vertically
// centred across two rows; it must sit beside its own first outcome.
const local = sheets['Grade 10'].rows.find((r) => r.cells['SUB-TOPIC'].startsWith('10.2.2 '))
assert.match(local.cells['SPECIFIC OUTCOMES'], /^10\.2\.2\.1 /)

console.log(`ok: civic education 2013 data — ${topicCount} topics, ${subCount} sub-topics, ${outcomeCount} outcomes`)
