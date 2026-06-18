// Guards the repaired Home Economics (Grades 5-7, 2013) syllabus in
// curriculum-data-2013.json. Before the fix this subject had phantom
// "COLUMN N" headers and an empty SPECIFIC OUTCOMES column (the real outcome
// text had drifted into CONTENT); see scripts/fix-2013-home-economics-columns.mjs.
//
// Plain `node` assertion script — run via `npm run test:2013-home-economics`
// (auto-discovered by scripts/run-all-tests.mjs).

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HOME_ECONOMICS_2013,
  CANONICAL_COLUMNS,
  reconstructHomeEconomicsSheet,
} from './fix-2013-home-economics-columns.mjs'

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

// Match the topic/sub-topic/outcome code hierarchy used by Home Economics.
function codeDepth(value) {
  const m = /^\s*(\d+(?:\.\d+)+)\.?/.exec(value)
  return m ? m[1].split('.').filter(Boolean).length : 0
}

for (const rel of FILES) {
  console.log(`\n${rel}`)
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
  const subject = data[HOME_ECONOMICS_2013]

  check('subject present with the three grade sheets', () => {
    assert.ok(subject, `missing "${HOME_ECONOMICS_2013}"`)
    assert.deepStrictEqual(Object.keys(subject), ['Grade 5', 'Grade 6', 'Grade 7'])
  })

  for (const [sheetName, sheet] of Object.entries(subject)) {
    check(`${sheetName}: canonical columns, no phantom COLUMN N`, () => {
      assert.deepStrictEqual(sheet.columns, CANONICAL_COLUMNS)
      assert.ok(sheet.title, 'title metadata preserved')
    })

    check(`${sheetName}: cells are correctly bucketed by code depth`, () => {
      let outcomeRows = 0
      for (const row of sheet.rows) {
        if (row.type !== 'data') continue
        const c = row.cells
        // No stray keys beyond the canonical columns.
        assert.deepStrictEqual(Object.keys(c).sort(), [...CANONICAL_COLUMNS].sort())
        if (c.TOPIC) assert.strictEqual(codeDepth(c.TOPIC), 2, `TOPIC depth: ${c.TOPIC}`)
        if (c['SUB-TOPIC']) assert.strictEqual(codeDepth(c['SUB-TOPIC']), 3, `SUB-TOPIC depth: ${c['SUB-TOPIC']}`)
        if (c['SPECIFIC OUTCOMES']) {
          assert.strictEqual(codeDepth(c['SPECIFIC OUTCOMES']), 4, `OUTCOME depth: ${c['SPECIFIC OUTCOMES']}`)
          outcomeRows++
        }
      }
      // The whole point of the fix: SPECIFIC OUTCOMES is actually populated.
      assert.ok(outcomeRows > 0, 'expected at least one populated SPECIFIC OUTCOMES cell')
    })

    check(`${sheetName}: no leaked "KNOWLEDGE SKILLS VALUES" header rows`, () => {
      for (const row of sheet.rows) {
        if (row.type !== 'data') continue
        const joined = Object.values(row.cells).join(' ').trim()
        assert.notStrictEqual(joined, 'KNOWLEDGE SKILLS VALUES')
      }
    })

    check(`${sheetName}: reconstruction is idempotent`, () => {
      const again = reconstructHomeEconomicsSheet(sheet)
      assert.strictEqual(JSON.stringify(again), JSON.stringify(sheet))
    })
  }
}

console.log(`\nAll ${passed} Home Economics 2013 checks passed.`)
