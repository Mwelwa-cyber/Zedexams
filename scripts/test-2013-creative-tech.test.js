// Guards the repaired Creative & Technology Studies (2013) syllabus in
// curriculum-data-2013.json. Before the fix this subject was a thicket of
// phantom "COLUMN N" headers with text shattered across them (the user saw
// literal "COLUMN 6 / COLUMN 7" headers and words split apart in the Syllabi
// Studio table); see scripts/fix-2013-creative-tech-columns.mjs.
//
// Plain `node` assertion script — run via `npm run test:2013-creative-tech`
// (auto-discovered by scripts/run-all-tests.mjs).

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CREATIVE_TECH_2013,
  CANONICAL_COLUMNS,
  reconstructCreativeTechSheet,
  reconstructCreativeTechRow,
  joinFragment,
  leadingCodeDepth,
} from './fix-2013-creative-tech-columns.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const FILES = [
  'public/syllabi/curriculum-data-2013.json',
  'functions/data/curriculum-data-2013.json',
]

let passed = 0
function check(label, fn) {
  fn()
  passed++
  console.log(`  ✓ ${label}`)
}

// ── Unit checks on the pure helpers ─────────────────────────────────────────
console.log('\nhelpers')

check('mid-word lowercase fragments join tight', () => {
  assert.strictEqual(joinFragment('Mo', 've'), 'Move')
  assert.strictEqual(joinFragment(joinFragment('Mo', 've'), 'ment'), 'Movement')
  assert.strictEqual(joinFragment('Perf', 'orm'), 'Perform')
})

check('phrases / capitalised / coded fragments space-join', () => {
  assert.strictEqual(joinFragment('Perform', 'warm up activities'), 'Perform warm up activities')
  assert.strictEqual(joinFragment('1.1.1 Safety', 'Body Posture'), '1.1.1 Safety Body Posture')
})

check('row reconstruction buckets by code depth and stitches fragments', () => {
  // Models the real Grade 1 "Fundamental movement" row: outcome text shattered
  // across phantom columns, knowledge bullets in another.
  const columns = ['COLUMN 1', 'COLUMN 3', 'COLUMN 5', 'COLUMN 6', 'COLUMN 7', 'COLUMN 9', 'COLUMN 10', 'COLUMN 11']
  const cells = {
    'COLUMN 1': '1.3 Fundamental movement.',
    'COLUMN 3': '1.1.3.1 Perf',
    'COLUMN 5': 'orm',
    'COLUMN 6': 'warm up activities',
    'COLUMN 11': '• Rhythmic movement',
  }
  const b = reconstructCreativeTechRow(columns, cells)
  assert.strictEqual(b.TOPIC, '1.3 Fundamental movement.')
  assert.strictEqual(b['SPECIFIC OUTCOMES'], '1.1.3.1 Perform warm up activities')
  assert.strictEqual(b.CONTENT, '• Rhythmic movement')
  assert.strictEqual(leadingCodeDepth(b.TOPIC), 2)
})

// ── Whole-dataset guards on the committed JSON ──────────────────────────────
for (const rel of FILES) {
  console.log(`\n${rel}`)
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
  const subject = data[CREATIVE_TECH_2013]

  check('subject present with the four grade sheets', () => {
    assert.ok(subject, `missing "${CREATIVE_TECH_2013}"`)
    assert.deepStrictEqual(Object.keys(subject), ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4'])
  })

  for (const [sheetName, sheet] of Object.entries(subject)) {
    check(`${sheetName}: canonical columns, no phantom COLUMN N`, () => {
      assert.deepStrictEqual(sheet.columns, CANONICAL_COLUMNS)
      for (const col of sheet.columns) {
        assert.ok(!/^COLUMN\s*\d+$/i.test(col), `phantom column survived: ${col}`)
      }
    })

    check(`${sheetName}: data rows carry only canonical keys, no leaked headers`, () => {
      let outcomeRows = 0
      for (const row of sheet.rows) {
        if (row.type !== 'data') continue
        assert.deepStrictEqual(Object.keys(row.cells).sort(), [...CANONICAL_COLUMNS].sort())
        if (row.cells['SPECIFIC OUTCOMES']) outcomeRows++
        const joined = Object.values(row.cells).join(' ').trim()
        assert.notStrictEqual(joined, 'KNOWLEDGE')
        assert.notStrictEqual(joined, 'KNOWLEDGE SKILLS VALUES')
      }
      assert.ok(outcomeRows > 0, 'expected populated SPECIFIC OUTCOMES cells')
    })

    check(`${sheetName}: reconstruction is idempotent`, () => {
      const again = reconstructCreativeTechSheet(sheet)
      assert.strictEqual(JSON.stringify(again), JSON.stringify(sheet))
    })
  }
}

console.log(`\nAll ${passed} Creative & Technology Studies 2013 checks passed.`)
