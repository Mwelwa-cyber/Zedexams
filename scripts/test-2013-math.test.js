// Guards the re-extracted Mathematics (Grades 10-12, 2013) Grade 12 syllabus
// in curriculum-data-2013.json. Grade 12 was re-extracted from the source CDC
// PDF (see scripts/extract-2013-math.mjs) because its rows drifted by varying
// offsets and couldn't be realigned in place like the phantom-column cases.
// The PDF isn't committed, so this validates the committed output shape.
//
// Plain `node` assertion script — run via `npm run test:2013-math`
// (auto-discovered by scripts/run-all-tests.mjs).

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUBJECT, GRADE, COLS, topicKeyOf, lineKey } from './extract-2013-math.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const FILES = [
  'public/syllabi/curriculum-data-2013.json',
  'functions/data/curriculum-data-2013.json',
]

let passed = 0
function check(label, fn) { fn(); passed++; console.log(`  ✓ ${label}`) }

// ── Unit checks on the extractor helpers ────────────────────────────────────
console.log('\nhelpers')
check('topicKeyOf groups a sub-topic and its outcomes under one key', () => {
  assert.strictEqual(topicKeyOf('12.1.1 Cubic functions'), '12.1.1')
  assert.strictEqual(topicKeyOf('12.1.1.2 Use graphs to find solutions'), '12.1.1')
  assert.strictEqual(topicKeyOf('12.2 LINEAR PROGRAMMING'), '12.2')
  assert.strictEqual(topicKeyOf('Cubic functions'), null)
})
check('lineKey resolves from sub-topic OR outcome cell', () => {
  assert.strictEqual(lineKey('12.1.2 Inverse functions', ''), '12.1.2')
  assert.strictEqual(lineKey('', '12.1.1.3 Determine gradients'), '12.1.1')
  assert.strictEqual(lineKey('functions', 'curves'), null)
})

// ── Whole-dataset guards on the committed JSON ──────────────────────────────
for (const rel of FILES) {
  console.log(`\n${rel}`)
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
  const subject = data[SUBJECT]

  check('Mathematics subject present with Grades 10, 11, 12', () => {
    assert.ok(subject, `missing "${SUBJECT}"`)
    for (const g of ['Grade 10', 'Grade 11', 'Grade 12']) assert.ok(subject[g], `missing ${g}`)
  })

  const sheet = subject[GRADE]
  check(`${GRADE}: canonical columns, no COLUMN N / data-value headers`, () => {
    assert.deepStrictEqual(sheet.columns, COLS)
    for (const col of sheet.columns) {
      assert.ok(!/^COLUMN\s*\d+$/i.test(col), `phantom column: ${col}`)
      assert.ok(!/^\d+\.\d/.test(col), `data-value header: ${col}`)
    }
  })

  check(`${GRADE}: well-formed rows with populated outcomes`, () => {
    const rows = sheet.rows.filter(r => r.type === 'data')
    assert.ok(rows.length >= 15, `only ${rows.length} rows`)
    let coded = 0
    for (const r of rows) {
      assert.deepStrictEqual(Object.keys(r.cells).sort(), [...COLS].sort())
      if (topicKeyOf(r.cells['SUB TOPIC']) || topicKeyOf(r.cells['SPECIFIC OUTCOME'])) coded++
      assert.ok(r.cells['SPECIFIC OUTCOME'].trim(), 'empty SPECIFIC OUTCOME')
      for (const v of Object.values(r.cells)) assert.ok(v.length < 1200, 'over-merged cell')
    }
    assert.ok(coded >= rows.length * 0.9, `only ${coded}/${rows.length} coded rows`)
  })

  check(`${GRADE}: all seven topics 12.1–12.7 present`, () => {
    const topics = sheet.rows.filter(r => r.type === 'data').map(r => r.cells.TOPIC)
    for (let n = 1; n <= 7; n++) {
      assert.ok(topics.some(t => t.startsWith(`12.${n} `)), `missing topic 12.${n}`)
    }
  })
}

check('public and functions copies agree on the Mathematics subject', () => {
  const a = JSON.parse(fs.readFileSync(path.join(ROOT, FILES[0]), 'utf8'))[SUBJECT]
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, FILES[1]), 'utf8'))[SUBJECT]
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b))
})

console.log(`\nAll ${passed} Mathematics 2013 checks passed.`)
